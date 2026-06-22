import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Real Shazam-style audio recognition via AudD (https://audd.io). It
// matches against commercial recordings — it will NOT reliably identify a
// raw a cappella hum of an obscure raga (no audio-ID service can; that's a
// fundamentally different, much harder problem than fingerprinting a
// studio recording). Honest expectation: humming a well-known film/classical
// recording near-verbatim has a real shot; humming an original improvisation
// will usually correctly come back "no match" — which is the truthful
// result, not a bug.
//
// Get a free token at https://dashboard.audd.io and set AUDD_API_TOKEN.

export async function POST(req: NextRequest) {
  const token = process.env.AUDD_API_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: 'AUDD_API_TOKEN is not configured on the server.' },
      { status: 501 }
    );
  }

  const incoming = await req.formData().catch(() => null);
  const audio = incoming?.get('audio');

  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: 'audio file is required (multipart field "audio")' }, { status: 400 });
  }

  try {
    const forward = new FormData();
    forward.append('api_token', token);
    forward.append('file', audio, 'hum.webm');
    forward.append('return', 'apple_music,spotify');

    const res = await fetch('https://api.audd.io/', { method: 'POST', body: forward });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `AudD API error (${res.status}): ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (data.status !== 'success') {
      return NextResponse.json({ error: data?.error?.error_message ?? 'AudD request failed' }, { status: 502 });
    }

    if (!data.result) {
      return NextResponse.json({ matched: false });
    }

    const { title, artist, album, release_date, song_link } = data.result;
    return NextResponse.json({
      matched: true,
      title,
      artist,
      album,
      releaseDate: release_date,
      link: song_link,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Network error reaching AudD: ${err?.message ?? err}` }, { status: 502 });
  }
}
