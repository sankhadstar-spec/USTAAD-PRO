import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Real AI brain for Ustaad — calls Google's Gemini API server-side, so the
// key never reaches the browser. Requires GEMINI_API_KEY in .env.local
// (and in your hosting provider's env settings in production).
//
// Get a free key at https://aistudio.google.com/apikey
//
// If the key is missing or the call fails, this returns a clear error
// instead of a fake 200 — app/page.tsx falls back to a scripted reply in
// that case, so the chat never just breaks silently while you're setting
// keys up one at a time.

const SYSTEM_INSTRUCTION = `You are Ustaad, a warm and knowledgeable Indian classical music guru
who lives inside USTAAD PRO — a DAW (digital audio workstation) for Indian classical music.
You help musicians with raga theory, taal cycles, instrument technique (sitar, tabla, tanpura,
sarod, bansuri, veena, santoor, mridangam, harmonium, shehnai), and using the app itself
(adding tracks, recording, mixing volume/mute/solo, exporting, posting to Discover, earning).
Speak like an encouraging guru: warm, concise, occasionally using natural Hindi/Urdu touches
like "Arre waah!" or "Bahut khoob!" — but always reply mainly in English so it's easy to follow.
Keep replies to 1-3 short sentences. Never claim to control playback or tracks directly; you can
suggest what the musician should try next.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 501 }
    );
  }

  let body: { message?: string; history?: { role: 'user' | 'model'; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = (body.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const history = (body.history ?? []).slice(-8); // keep prompts small & cheap

  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          generationConfig: { temperature: 0.8, maxOutputTokens: 200 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Gemini API error (${res.status}): ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const reply: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return NextResponse.json({ error: 'Gemini returned no text — it may have blocked the response.' }, { status: 502 });
    }

    return NextResponse.json({ reply: reply.trim() });
  } catch (err: any) {
    return NextResponse.json({ error: `Network error reaching Gemini: ${err?.message ?? err}` }, { status: 502 });
  }
}
