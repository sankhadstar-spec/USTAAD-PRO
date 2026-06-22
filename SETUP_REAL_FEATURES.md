# USTAAD PRO — what's real, and how to switch each thing on

## 1. Real instrument samples (no setup needed)
Sitar, Bansuri, Harmonium, Shehnai, Piano, Guitar, Violin, Trumpet, Sax,
Organ all play real General MIDI samples via `smplr` — genuine recorded
audio, fetched on first use from a public sample CDN. No key required.
Tabla, Tanpura, Sarod, Veena, Santoor, Mridangam stay on the original
Tone.js synthesis — there's no free, redistributable authentic sample
library for those, so this is honest rather than faked. If you ever buy/
license a proper Indian-classical sample pack, swap them in via
`lib/instrumentEngine.ts`.

## 2. Real audio export (no setup needed)
"Download" actually records the live master-bus audio (instruments +
samples + your voice take, if any) via `MediaRecorder` and downloads what
was genuinely played — see `lib/recordOutput.ts`. Works fully offline.

## 3. Real voice/vocal recording (no setup needed)
The mic toggle on the Create screen requests `echoCancellation`,
`noiseSuppression`, and `autoGainControl` — that's what makes it usable
without headphones, though headphones still sound cleaner. Your take gets
mixed into the real export.

## 4. Ustaad's real AI brain — needs `GEMINI_API_KEY`
Free key: https://aistudio.google.com/apikey → add to `.env.local` and to
your Vercel project's env vars. Without it, chat replies are a clearly
labelled scripted fallback so it never just goes silent.

## 5. Real Hum-to-Match — needs `AUDD_API_TOKEN`
Free tier: https://dashboard.audd.io. Matches against AudD's commercial
catalog — it will not reliably identify an original/improvised hum (no
service can; that's expected, not a bug). Without the token, the button
tells you it isn't set up rather than faking a match.

## 6. Real UPI payouts — needs RazorpayX, not just an API key
This is the one piece that needs more than a `.env.local` edit:
1. Apply for **RazorpayX** (separate from regular Razorpay Payments) —
   requires business KYC approval.
2. Fund the RazorpayX virtual account you'll pay out from.
3. Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_ACCOUNT_NUMBER`
   to `.env.local`.
Until that's approved, withdrawals will fail with Razorpay's real error —
intentionally, so the app never pretends money moved when it didn't.

## 7. Real persistent earnings — already wired to your Supabase
Run `supabase_schema.sql` once in your Supabase SQL Editor. Earnings are
keyed by an anonymous per-browser `device_id` (see `lib/device.ts`) — real
and persistent, but **not** secure multi-user auth. Read the security note
at the top of `supabase_schema.sql` before this app has other people's real
money in it.

## Still not real (known, intentional gaps)
- **Discover feed** — static array in `app/page.tsx`; posting doesn't
  persist to a database other users can see.
- **Total Plays** — a vanity counter, not real analytics.
