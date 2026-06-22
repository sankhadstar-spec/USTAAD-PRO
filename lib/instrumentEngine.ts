import { Soundfont } from 'smplr';
import * as Tone from 'tone';
import { getSampleBus } from './audioBus';

// Real, sampled instrument audio — General MIDI soundfonts loaded over the
// network (https://smpldsnds.github.io, used by the `smplr` library, no API
// key). This is genuinely real recorded audio, not a synthesized
// approximation — "General MIDI" is itself a decades-old industry-standard
// instrument-sound format used across countless apps and devices.
//
// Coverage is honest, not maximal: GM happens to include authentic Sitar
// and Shehnai ("shanai") programs, which is a lucky fit for this app. It
// does NOT include Tabla, Tanpura, Sarod, Veena, Santoor, Mridangam, or a
// true Harmonium — those stay on the Tone.js synths defined in app/page.tsx
// (see SAMPLE_INSTRUMENT_NAMES below for exactly which ones are real
// samples vs. synthesized). A licensed Indian-classical multi-sample
// library could replace the synths later if you have/buy one — this engine
// would just need a different `instrumentUrl`/kit per instrument.

export type SampleInstrumentName =
  | 'sitar'
  | 'shanai'        // GM's spelling of shehnai
  | 'flute'         // closest real-sample stand-in for bansuri
  | 'reed_organ'    // a harmonium IS a type of reed organ — a genuinely apt match
  | 'acoustic_grand_piano'
  | 'acoustic_guitar_nylon'
  | 'violin'
  | 'trumpet'
  | 'alto_sax'
  | 'church_organ';

type SoundfontInstance = ReturnType<typeof Soundfont>;

const cache = new Map<SampleInstrumentName, SoundfontInstance>();

function getInstrument(name: SampleInstrumentName): SoundfontInstance {
  let inst = cache.get(name);
  if (!inst) {
    const ctx = Tone.getContext().rawContext as unknown as AudioContext;
    inst = Soundfont(ctx, { instrument: name, destination: getSampleBus() });
    cache.set(name, inst);
  }
  return inst;
}

// Pre-warms an instrument's real samples so the first note played isn't
// delayed by a network fetch. Safe to call repeatedly; errors are caught
// and logged rather than thrown, since a slow/offline sample CDN shouldn't
// crash the app — playSample() below will just no-op for that instrument.
export async function preloadSample(name: SampleInstrumentName): Promise<void> {
  try {
    await getInstrument(name).ready;
  } catch (err) {
    console.warn(`Could not load real samples for "${name}":`, err);
  }
}

export function playSample(name: SampleInstrumentName, note: string | number, velocity = 90): void {
  try {
    getInstrument(name).start({ note, velocity });
  } catch (err) {
    console.warn(`Sample playback failed for "${name}":`, err);
  }
}

export function disposeAllSamples(): void {
  cache.forEach((inst) => { try { inst.dispose(); } catch {} });
  cache.clear();
}
