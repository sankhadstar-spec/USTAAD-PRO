import * as Tone from 'tone';
import { getSampleBus } from './audioBus';

// Captures the ACTUAL audio coming out of Tone.js's master bus via
// MediaRecorder, instead of writing empty/fake bytes to a file. Works
// fully offline — no network, no server route, just the Web Audio API.
//
// Usage:
//   const recorder = await createOutputRecorder();
//   ... play your session through Tone.js as normal ...
//   const { blob, mimeType } = await recorder.stop();
//   downloadBlob(blob, `session.${extensionFor(mimeType)}`);

const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATE_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm'; // covers audio/webm and audio/webm;codecs=opus
}

export async function createOutputRecorder(): Promise<{
  stop: () => Promise<{ blob: Blob; mimeType: string }>;
}> {
  await Tone.start();

  const ctx = Tone.getContext().rawContext as unknown as AudioContext;
  const streamDest = ctx.createMediaStreamDestination();

  // Fan both real audio sources out to the recorder without muting normal
  // playback or doubling volume: Tone synths keep their existing path to
  // the speakers, sample instruments keep theirs via the shared sample bus
  // — this just adds one extra listener (the recorder) to each.
  Tone.getDestination().connect(streamDest as any);
  getSampleBus().connect(streamDest);

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(streamDest.stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();

  return {
    stop: async () => {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      try { Tone.getDestination().disconnect(streamDest as any); } catch {}
      try { getSampleBus().disconnect(streamDest); } catch {}
      return { blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), mimeType: recorder.mimeType || 'audio/webm' };
    },
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
