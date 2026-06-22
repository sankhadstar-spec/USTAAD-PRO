import * as Tone from 'tone';

// A single shared bus that every sample-based (smplr/Soundfont) instrument
// plays through. It's the ONE path those instruments take to the speakers,
// which means it can also be tapped once — alongside Tone's own destination
// — when recording a real export, without ever doubling playback volume.
//
// Tone-based synths keep using their existing `.toDestination()` path
// untouched; this bus is purely additive, just for the sample engine.

let sampleBus: GainNode | null = null;

export function getSampleBus(): GainNode {
  const ctx = Tone.getContext().rawContext as unknown as AudioContext;
  if (!sampleBus) {
    sampleBus = ctx.createGain();
    sampleBus.gain.value = 1;
    sampleBus.connect(ctx.destination);
  }
  return sampleBus;
}
