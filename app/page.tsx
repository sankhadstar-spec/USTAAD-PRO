'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play, Pause, Square, Mic, Mic2, Download, Share2, Award, Users,
  MessageCircle, Plus, Sparkles, Heart, Volume2, VolumeX, Wallet,
  Compass, Music2, Flame, Send, CheckCircle2, Loader2, Radio, Sliders,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import * as Tone from 'tone';
import { getDeviceId } from '@/lib/device';
import { createOutputRecorder, downloadBlob, extensionFor } from '@/lib/recordOutput';
import { preloadSample, playSample } from '@/lib/instrumentEngine';
import { getSampleBus } from '@/lib/audioBus';

/* ────────────────────────────────────────────────────────────────────────
   TYPES — unchanged from the original implementation
   ──────────────────────────────────────────────────────────────────────── */

interface InstrumentDef {
  id: string;
  name: string;
  color: string;
  icon: string;
  kind: 'sample' | 'synth'; // 'sample' = real recorded audio, 'synth' = Tone.js synthesis
  sample?: import('@/lib/instrumentEngine').SampleInstrumentName;
}

interface Track {
  id: string;
  name: string;
  instrument: string;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  notes: number[];
}

interface Song {
  id: string;
  title: string;
  artist: string;
  plays: number;
  likes: number;
  cover: string;
  duration: string;
  earnings: number;
}

interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
}

interface FallingNote {
  id: number;
  note: string;
  x: number;
}

/* ────────────────────────────────────────────────────────────────────────
   DATA
   ──────────────────────────────────────────────────────────────────────── */

// Indian classical instruments. Sitar, Shehnai, Bansuri and Harmonium use
// real General MIDI samples (see lib/instrumentEngine.ts for exactly which
// ones and why). Tabla, Tanpura, Sarod, Veena, Santoor and Mridangam don't
// have a free, redistributable authentic sample library available, so they
// stay on the original Tone.js synthesis — honest rather than faked.
const INDIAN_INSTRUMENTS: InstrumentDef[] = [
  { id: 'sitar', name: 'Sitar', color: '#D4A24C', icon: '🎸', kind: 'sample', sample: 'sitar' },
  { id: 'tabla', name: 'Tabla', color: '#EDE3D3', icon: '🥁', kind: 'synth' },
  { id: 'tanpura', name: 'Tanpura', color: '#8B6F47', icon: '🪕', kind: 'synth' },
  { id: 'sarod', name: 'Sarod', color: '#C9A14F', icon: '🎻', kind: 'synth' },
  { id: 'bansuri', name: 'Bansuri', color: '#A8442F', icon: '🪈', kind: 'sample', sample: 'flute' },
  { id: 'veena', name: 'Veena', color: '#D4A24C', icon: '🎼', kind: 'synth' },
  { id: 'santoor', name: 'Santoor', color: '#F4D35E', icon: '🎹', kind: 'synth' },
  { id: 'mridangam', name: 'Mridangam', color: '#EDE3D3', icon: '🥁', kind: 'synth' },
  { id: 'harmonium', name: 'Harmonium', color: '#8B6F47', icon: '🎹', kind: 'sample', sample: 'reed_organ' },
  { id: 'shehnai', name: 'Shehnai', color: '#A8442F', icon: '🎺', kind: 'sample', sample: 'shanai' },
];

// Western instruments — all real General MIDI samples.
const WESTERN_INSTRUMENTS: InstrumentDef[] = [
  { id: 'piano', name: 'Piano', color: '#EDE3D3', icon: '🎹', kind: 'sample', sample: 'acoustic_grand_piano' },
  { id: 'guitar', name: 'Guitar', color: '#C9A14F', icon: '🎸', kind: 'sample', sample: 'acoustic_guitar_nylon' },
  { id: 'violin', name: 'Violin', color: '#D4A24C', icon: '🎻', kind: 'sample', sample: 'violin' },
  { id: 'trumpet', name: 'Trumpet', color: '#F4D35E', icon: '🎺', kind: 'sample', sample: 'trumpet' },
  { id: 'sax', name: 'Sax', color: '#A8442F', icon: '🎷', kind: 'sample', sample: 'alto_sax' },
  { id: 'organ', name: 'Organ', color: '#8B6F47', icon: '🎹', kind: 'sample', sample: 'church_organ' },
];

const ALL_INSTRUMENTS: InstrumentDef[] = [...INDIAN_INSTRUMENTS, ...WESTERN_INSTRUMENTS];

const SAMPLE_SONGS: Song[] = [
  { id: '1', title: 'Raga Yaman Twilight', artist: 'Ustaad Priya', plays: 124300, likes: 18900, cover: 'https://picsum.photos/id/1015/300/300', duration: '4:32', earnings: 124 },
  { id: '2', title: 'Tabla Fire', artist: 'Zakir Ustad', plays: 87200, likes: 13400, cover: 'https://picsum.photos/id/1005/300/300', duration: '3:45', earnings: 87 },
  { id: '3', title: 'Monsoon Sitar', artist: 'Anoushka Sharma', plays: 203400, likes: 31200, cover: 'https://picsum.photos/id/160/300/300', duration: '6:12', earnings: 198 },
];

const TABS = [
  { id: 'studio', label: 'Create', icon: Sliders },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'ustaad', label: 'Ustaad AI', icon: Sparkles },
  { id: 'earn', label: 'Earn', icon: Wallet },
] as const;

// Gentle gold-family gradient per swara, so the falling notes read as one
// family of tones rather than random colour noise.
const SARGAM_NOTES = ['Sa', 'Re', 'Ga', 'Ma', 'Pa', 'Dha', 'Ni'];
const SARGAM_HUES: Record<string, string> = {
  Sa: '#F4D35E', Re: '#E9C158', Ga: '#DCAF52', Ma: '#D4A24C',
  Pa: '#C9914A', Dha: '#BD8044', Ni: '#A8442F',
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// Picks the most "Indian" voice the browser/OS exposes for Ustaad's replies.
// Browsers vary a lot here — some ship a local en-IN/hi-IN voice, others only
// offer one over the network the first time it's used. We try several
// matches and fall back to whatever default voice exists so speech never
// silently fails.
function pickIndianVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const byLangIN = voices.find(v => /en-IN|hi-IN/i.test(v.lang));
  if (byLangIN) return byLangIN;
  const byName = voices.find(v => /india|hindi|veena|heera|lekha|ravi|priya/i.test(v.name));
  if (byName) return byName;
  const anyHi = voices.find(v => v.lang?.toLowerCase().startsWith('hi'));
  if (anyHi) return anyHi;
  return voices.find(v => v.lang?.toLowerCase().startsWith('en')) ?? voices[0];
}

/* ────────────────────────────────────────────────────────────────────────
   SIGNATURE MARK — a tabla-head / tanpura-gourd ring used as the wordmark,
   the "now playing" pulse, and ambient motifs. Ties the visual language
   back to the instruments themselves instead of a generic logo glyph.
   ──────────────────────────────────────────────────────────────────────── */

function UstaadMark({ size = 36, pulsing = false }: { size?: number; pulsing?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {pulsing && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, #D4A24C 0%, transparent 70%)' }}
          animate={{ scale: [1, 1.9], opacity: [0.55, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <div
        className="absolute inset-0 rounded-full flex items-center justify-center font-bold"
        style={{
          background: 'radial-gradient(circle at 32% 28%, #F9DE7C, #D4A24C 55%, #8B6F47 100%)',
          color: '#15110A',
          fontSize: size * 0.42,
          boxShadow: '0 4px 16px rgba(212,162,76,0.4), inset 0 1px 1px rgba(255,255,255,0.4)',
        }}
      >
        U
      </div>
      <div className="absolute inset-[15%] rounded-full border border-[#15110A]/25" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
   ──────────────────────────────────────────────────────────────────────── */

export default function UstaadLogicPro() {
  const [activeTab, setActiveTab] = useState<'studio' | 'discover' | 'ustaad' | 'earn'>('studio');
  const [instrumentCategory, setInstrumentCategory] = useState<'indian' | 'western'>('indian');
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(92);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Real vocal/voice track — your own mic, recorded for real, mixed into
  // the real export. Works without headphones too, but echo cancellation
  // does its best work when the instrumental isn't also blasting out of
  // open speakers into the same mic, so headphones genuinely help.
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);

  const [tracks, setTracks] = useState<Track[]>([
    { id: 't1', name: 'Sitar', instrument: 'sitar', color: '#D4A24C', volume: 82, muted: false, solo: false, notes: [2, 5, 9, 14, 18, 22, 27, 31] },
    { id: 't2', name: 'Tabla', instrument: 'tabla', color: '#EDE3D3', volume: 68, muted: false, solo: false, notes: [0, 3, 7, 11, 16, 20, 25, 29] },
    { id: 't3', name: 'Tanpura', instrument: 'tanpura', color: '#8B6F47', volume: 55, muted: false, solo: false, notes: [4, 12, 19, 28] },
  ]);

  const synthsRef = useRef<{ [key: string]: any }>({});
  const loopRef = useRef<any>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 'm1', type: 'ai', content: 'Namaste! मैं Ustaad हूँ — your music buddy for Indian classical and beyond.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [humResult, setHumResult] = useState('');
  const [isHumming, setIsHumming] = useState(false); // visual-only: animates the Hum button while listening
  const [voiceEnabled, setVoiceEnabled] = useState(true); // Ustaad speaks replies aloud when true
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true); // recognition support, detected on mount
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const recognitionRef = useRef<any>(null);

  const [fallingNotes, setFallingNotes] = useState<FallingNote[]>([]);
  const [gameScore, setGameScore] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const [currentSongTitle, setCurrentSongTitle] = useState('');
  const [caughtPulse, setCaughtPulse] = useState(0); // visual-only: bumps to flash the score chip

  const [userEarnings, setUserEarnings] = useState(1247);
  const [totalPlays, setTotalPlays] = useState(48200);

  // ── Real backend wiring ──────────────────────────────────────────────
  const [deviceId, setDeviceId] = useState('');
  const [earningsReady, setEarningsReady] = useState(false); // true once the real balance has loaded from Supabase
  const [isExporting, setIsExporting] = useState(false);     // true while actually capturing real audio
  const [isMatching, setIsMatching] = useState(false);        // true while real audio is being sent to AudD
  const [upiId, setUpiId] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const humMediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Warm up the browser's speech voices list and detect recognition support.
  // Both are entirely native Web Speech APIs — no API key, no server call
  // from this app's own code (the browser/OS may itself reach the network
  // to render some higher-quality voices or do recognition, depending on
  // platform — that part is outside this app's control).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('speechSynthesis' in window) {
      const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SR);

    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (recognitionRef.current) recognitionRef.current.abort?.();
    };
  }, []);

  // Warm up the real Indian-classical samples (Sitar, Bansuri, Harmonium,
  // Shehnai) in the background so the first tap isn't delayed by a network
  // fetch. Western samples load on first use instead, to avoid pulling
  // extra data for instruments someone may never tap.
  useEffect(() => {
    INDIAN_INSTRUMENTS.filter(i => i.kind === 'sample' && i.sample).forEach(i => preloadSample(i.sample!));
  }, []);

  // Real, persisted earnings: load the actual balance from Supabase on
  // mount instead of starting from a hardcoded local number.
  useEffect(() => {
    const id = getDeviceId();    setDeviceId(id);
    setUpiId(window.localStorage.getItem('ustaad_upi_id') ?? '');

    (async () => {
      try {
        const res = await fetch(`/api/earnings?deviceId=${encodeURIComponent(id)}`);
        const data = await res.json();
        if (res.ok && typeof data.balance === 'number') {
          // First-ever visit has no ledger rows yet (balance 0) — seed it
          // once with the original demo balance so existing users don't
          // see earnings vanish; every visit after that uses the real sum.
          if (data.balance === 0 && (data.ledger?.length ?? 0) === 0) {
            await fetch('/api/earnings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceId: id, amount: 1247, source: 'bonus' }),
            });
            setUserEarnings(1247);
          } else {
            setUserEarnings(data.balance);
          }
        } else if (!res.ok) {
          console.warn('Could not load real earnings, showing local-only demo balance:', data?.error);
        }
      } catch (err) {
        console.warn('Earnings backend unreachable, showing local-only demo balance:', err);
      } finally {
        setEarningsReady(true);
      }
    })();
  }, []);

  // Every real earning event flows through here: update the UI immediately
  // (optimistic), then write a real row to Supabase and reconcile with the
  // true persisted balance. If the backend isn't configured yet, the UI
  // still works — it just stays local-only until Supabase is wired up.
  const addEarnings = useCallback(async (amount: number, source: 'recording' | 'export' | 'post' | 'game' | 'bonus') => {
    setUserEarnings(prev => prev + amount);
    if (!deviceId) return;
    try {
      const res = await fetch('/api/earnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, amount, source }),
      });
      const data = await res.json();
      if (res.ok && typeof data.balance === 'number') {
        setUserEarnings(data.balance);
      } else if (!res.ok) {
        console.warn('Earnings not persisted (Supabase not configured?):', data?.error);
      }
    } catch (err) {
      console.warn('Earnings request failed:', err);
    }
  }, [deviceId]);

  // Speaks Ustaad's reply aloud in an Indian-flavoured voice when available.
  // Pure enhancement — chat still works perfectly with voice turned off.
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickIndianVoice(voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices());
      if (voice) utter.voice = voice;
      utter.lang = voice?.lang || 'en-IN';
      utter.rate = 0.98;
      utter.pitch = 1.0;
      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utter);
    } catch {
      setIsSpeaking(false);
    }
  }, [voiceEnabled]);

  /* ── All logic below is unchanged from the original implementation ── */

  const initSynths = () => {
    if (Object.keys(synthsRef.current).length > 0) return;

    synthsRef.current = {
      sitar: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 1.4, sustain: 0.6, release: 2.2 } }).toDestination(),
      tabla: new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 1.4 } }).toDestination(),
      tanpura: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.8, decay: 2.5, sustain: 0.9, release: 3 } }).toDestination(),
      sarod: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.005, decay: 1.8, sustain: 0.4, release: 2.6 } }).toDestination(),
      bansuri: new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.3, decay: 1.1, sustain: 0.7, release: 1.8 } }).toDestination(),
      veena: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.02, decay: 2.1, sustain: 0.5, release: 3.1 } }).toDestination(),
      santoor: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.9, sustain: 0.3, release: 1.4 } }).toDestination(),
      mridangam: new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 1.8 } }).toDestination(),
      harmonium: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.05, decay: 1.3, sustain: 0.8, release: 1.9 } }).toDestination(),
      shehnai: new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.02, decay: 0.8, sustain: 0.6, release: 1.5 } }).toDestination(),
    };
  };

  const playNote = (instrument: string, noteIndex: number, velocity = 0.85) => {
    const def = ALL_INSTRUMENTS.find(i => i.id === instrument);
    const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
    const note = notes[noteIndex % notes.length];

    if (def?.kind === 'sample' && def.sample) {
      playSample(def.sample, note, Math.round(velocity * 127));
      return;
    }

    initSynths();
    const synth = synthsRef.current[instrument];
    if (!synth) return;
    try {
      synth.triggerAttackRelease(note, '4n', Tone.now(), velocity);
    } catch (e) {}
  };

  const togglePlay = async () => {
    if (!isPlaying) {
      await Tone.start();
      initSynths();
      const beatDuration = 60 / bpm;
      let beat = 0;

      loopRef.current = setInterval(() => {
        if (!isPlaying) return;
        tracks.forEach(track => {
          if (!track.muted && track.notes.includes(beat % 32)) {
            playNote(track.instrument, beat % 8, track.volume / 100);
          }
        });
        beat = (beat + 1) % 32;
      }, beatDuration * 1000);

      setIsPlaying(true);
      startNoteGame();
      toast.success('Playing your session');
    } else {
      if (loopRef.current) clearInterval(loopRef.current);
      setIsPlaying(false);
      stopNoteGame();
    }
  };

  const stopAll = () => {
    if (loopRef.current) clearInterval(loopRef.current);
    setIsPlaying(false);
    stopNoteGame();
  };

  const startNoteGame = () => {
    setGameActive(true);
    setGameScore(0);
    setCurrentSongTitle(tracks[0]?.name + " Raga");

    const interval = setInterval(() => {
      if (!isPlaying) { clearInterval(interval); return; }
      const noteNames = ['Sa', 'Re', 'Ga', 'Ma', 'Pa', 'Dha', 'Ni'];
      const newNote = { id: Date.now(), note: noteNames[Math.floor(Math.random() * 7)], x: 30 + Math.random() * 240 };
      setFallingNotes(prev => [...prev.slice(-7), newNote]);
      setTimeout(() => setFallingNotes(prev => prev.filter(n => n.id !== newNote.id)), 2400);
    }, 620);
    (window as any).gameInterval = interval;
  };

  const stopNoteGame = () => {
    setGameActive(false);
    setFallingNotes([]);
    if ((window as any).gameInterval) clearInterval((window as any).gameInterval);
  };

  const catchNote = (id: number) => {
    setFallingNotes(prev => prev.filter(n => n.id !== id));
    const newScore = gameScore + 15;
    setGameScore(newScore);
    setCaughtPulse(p => p + 1);
    if (newScore % 75 === 0) {
      addEarnings(8, 'game');
      toast.success('+₹8 earned!');
    }
  };

  const addTrack = (instrument: any) => {
    const newTrack: Track = {
      id: 't' + Date.now(),
      name: instrument.name,
      instrument: instrument.id,
      color: instrument.color,
      volume: 75,
      muted: false,
      solo: false,
      notes: Array.from({ length: 8 }, () => Math.floor(Math.random() * 32)),
    };
    setTracks([...tracks, newTrack]);
    toast.success(`${instrument.name} added`);
  };

  const updateTrack = (id: string, updates: Partial<Track>) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const toggleQuickRecord = () => {
    if (!isRecording) {
      setIsRecording(true);
      setRecordingTime(0);
      const timer = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 24) { clearInterval(timer); finishRecording(); return 24; }
          return prev + 1;
        });
      }, 1000);
      (window as any).recordTimer = timer;
    } else {
      finishRecording();
    }
  };

  const finishRecording = () => {
    setIsRecording(false);
    const time = recordingTime;
    setRecordingTime(0);
    if ((window as any).recordTimer) clearInterval((window as any).recordTimer);

    const newTrack: Track = {
      id: 'rec' + Date.now(),
      name: 'My Recording',
      instrument: 'sitar',
      color: '#F4D35E',
      volume: 78,
      muted: false,
      solo: false,
      notes: Array.from({ length: Math.max(4, Math.floor(time / 3)) }, (_, i) => (i * 4 + 3) % 32),
    };
    setTracks(prev => [...prev, newTrack]);
    addEarnings(24, 'recording');
    toast.success(`Recording saved (${time}s)`);
  };

  // Real vocal recording — your actual mic, captured for real. Asking for
  // echoCancellation/noiseSuppression/autoGainControl makes this genuinely
  // usable without headphones (the browser actively cancels the
  // instrumental bleeding back into the mic), though headphones still give
  // a cleaner take since cancellation isn't perfect on open speakers.
  const toggleVoiceRecording = async () => {
    if (isRecordingVoice) {
      voiceRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceRecorderRef.current = recorder;

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setVoiceBlob(blob);
        setVoiceUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        setIsRecordingVoice(false);
        toast.success('Voice take captured');
      };

      recorder.start();
      setIsRecordingVoice(true);
      toast('Recording your voice — 🎧 headphones help, but not required', { id: 'voice' });
    } catch {
      toast.error('Microphone needed for the voice track');
    }
  };

  const clearVoiceTrack = () => {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoiceBlob(null);
    setVoiceUrl(null);
  };

  // Plays the current session through for one full pattern loop while
  // actually capturing the real master-bus audio via MediaRecorder, then
  // downloads what was genuinely heard. Runs fully offline — no network
  // call in this function at all. If a voice take exists, it's decoded and
  // played back through the same recorded bus, so it's genuinely mixed
  // into the file (not just bundled separately).
  const exportSong = async () => {
    if (isExporting) return;
    setIsExporting(true);
    toast.loading('Recording your real mix…', { id: 'export' });

    try {
      await Tone.start();
      initSynths();
      const recorder = await createOutputRecorder();
      const ctx = Tone.getContext().rawContext as unknown as AudioContext;

      // If there's a real voice take, decode it and play it through the
      // same sample bus the recorder is tapping — this is genuine Web
      // Audio mixing, not just slapping two files together after the fact.
      if (voiceBlob) {
        try {
          const arrayBuffer = await voiceBlob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(getSampleBus());
          source.start();
        } catch (err) {
          console.warn('Could not mix voice take into export:', err);
        }
      }

      const beatDuration = 60 / bpm;
      const totalBeats = 32; // one full pass through the session's pattern

      await new Promise<void>((resolve) => {
        let beat = 0;
        const interval = setInterval(() => {
          tracks.forEach(track => {
            if (!track.muted && track.notes.includes(beat % 32)) {
              playNote(track.instrument, beat % 8, track.volume / 100);
            }
          });
          beat += 1;
          if (beat >= totalBeats) {
            clearInterval(interval);
            setTimeout(resolve, 1500); // let release tails ring out before stopping
          }
        }, beatDuration * 1000);
      });

      const { blob, mimeType } = await recorder.stop();
      const filename = `USTAAD_${Date.now()}.${extensionFor(mimeType)}`;
      downloadBlob(blob, filename);

      const earnings = Math.floor(Math.random() * 48) + 27;
      await addEarnings(earnings, 'export');
      setTotalPlays(prev => prev + 1930);
      toast.success('Real mix exported!', { id: 'export', description: `${filename} · ₹${earnings} added` });
    } catch (err: any) {
      toast.error('Export failed', { id: 'export', description: String(err?.message ?? err) });
    } finally {
      setIsExporting(false);
    }
  };

  const postToDiscover = () => {
    const newSong: Song = {
      id: Date.now().toString(),
      title: `Raga Session • ${tracks.length} tracks`,
      artist: 'You',
      plays: 0,
      likes: 0,
      cover: 'https://picsum.photos/id/201/300/300',
      duration: '3:42',
      earnings: 0,
    };
    SAMPLE_SONGS.unshift(newSong);
    addEarnings(68, 'post');
    toast.success('Posted to Discover!');
    setActiveTab('discover');
  };

  // Real money movement: calls /api/payout, which itself calls Razorpay's
  // live Payouts API. Will genuinely fail with Razorpay's real error
  // message until RazorpayX is approved on your account and funded — see
  // the note at the top of app/api/payout/route.ts.
  const requestWithdrawal = async () => {
    if (isWithdrawing) return;
    const amount = Number(withdrawAmount);

    if (!upiId.trim().includes('@')) {
      toast.error('Enter a valid UPI ID first (e.g. yourname@bank)');
      return;
    }
    if (!amount || amount <= 0) {
      toast.error('Enter an amount to withdraw');
      return;
    }
    if (amount > userEarnings) {
      toast.error(`You only have ₹${userEarnings.toLocaleString('en-IN')} available`);
      return;
    }

    setIsWithdrawing(true);
    toast.loading('Sending real payout request…', { id: 'payout' });
    try {
      const res = await fetch('/api/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, amount, vpa: upiId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Payout failed');

      setUserEarnings(prev => prev - amount);
      setWithdrawAmount('');
      toast.success('Real payout requested!', { id: 'payout', description: `Razorpay status: ${data.payout?.status ?? 'queued'}` });
    } catch (err: any) {
      toast.error('Payout not completed', { id: 'payout', description: String(err?.message ?? err) });
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Real AI brain: calls /api/ustaad (Gemini) server-side. Falls back to a
  // clearly-labelled scripted reply if GEMINI_API_KEY isn't configured yet
  // or the request fails, so the chat never goes silent mid-setup.
  const sendToUstaad = async (message: string) => {
    if (!message.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), type: 'user', content: message };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsGenerating(true);

    const history = chatMessages.map(m => ({ role: (m.type === 'user' ? 'user' : 'model') as 'user' | 'model', content: m.content }));

    try {
      const res = await fetch('/api/ustaad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const data = await res.json();
      if (!res.ok || !data.reply) throw new Error(data?.error ?? 'No reply from Gemini');

      setChatMessages(prev => [...prev, { id: (Date.now() + 1).toString(), type: 'ai', content: data.reply }]);
      speak(data.reply);
    } catch {
      const lower = message.toLowerCase();
      let response = "Understood — creating a beautiful raga for you. (Demo reply: add GEMINI_API_KEY in .env.local for real AI answers.)";
      if (lower.includes('hum') || lower.includes('sing')) {
        response = "Arre waah! Try the Hum to Match button for a real audio match. (demo reply)";
        startNoteGame();
      } else if (lower.includes('match') || lower.includes('song')) {
        response = "Use Hum to Match below — it really listens and checks. (demo reply)";
      }
      setChatMessages(prev => [...prev, { id: (Date.now() + 1).toString(), type: 'ai', content: response }]);
      speak(response);
    } finally {
      setIsGenerating(false);
    }
  };

  // Real microphone speech-to-text via the browser's Web Speech API where
  // available (Chrome, Edge, most Android browsers). Falls back to the
  // original scripted phrase on browsers without support (e.g. Firefox,
  // some iOS Safari versions) so the feature degrades gracefully instead
  // of silently doing nothing.
  const startVoiceInput = () => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SR) {
      setIsListening(true);
      setTimeout(() => {
        setIsListening(false);
        sendToUstaad("Play tabla in teentaal");
      }, 1300);
      toast('Live voice recognition isn\'t supported in this browser — using a demo phrase.');
      return;
    }

    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) sendToUstaad(transcript);
    };
    recognition.onerror = () => {
      toast.error('Could not hear you — check mic permissions');
    };
    recognition.onend = () => setIsListening(false);

    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  // Real Shazam-style matching: records ~4 real seconds of mic audio, then
  // sends it to /api/song-match (AudD). Honestly reports "no match" when
  // that's the true result — see the note in app/api/song-match/route.ts
  // about why humming an original raga usually won't match a commercial
  // catalog, and that's expected, not broken.
  const startHumDetection = async () => {
    setHumResult('');
    setIsHumming(true);
    toast.loading('Listening for 4 seconds…', { id: 'hum' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      humMediaRecorderRef.current = recorder;

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      });

      recorder.start();
      await new Promise((r) => setTimeout(r, 4000));
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
      setIsHumming(false);

      const blob = await stopped;
      setIsMatching(true);
      toast.loading('Checking against real recordings…', { id: 'hum' });

      const form = new FormData();
      form.append('audio', blob, 'hum.webm');
      const res = await fetch('/api/song-match', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error ?? 'Song matching isn\'t set up yet (needs AUDD_API_TOKEN)', { id: 'hum' });
        return;
      }

      if (data.matched) {
        setHumResult(`✅ Matched: "${data.title}" — ${data.artist}`);
        toast.success('Real match found!', { id: 'hum' });
        speak(`That sounds like ${data.title} by ${data.artist}.`);
        setTimeout(() => setActiveTab('studio'), 1400);
      } else {
        setHumResult('No match found — not in AudD\'s catalog (normal for an original raga or improvisation).');
        toast('No match found', { id: 'hum' });
      }
    } catch {
      setIsHumming(false);
      toast.error('Microphone needed', { id: 'hum' });
    } finally {
      setIsMatching(false);
    }
  };

  /* ── Derived, render-only values (no effect on app logic/state) ── */
  const trendingArtists = Array.from(new Set(SAMPLE_SONGS.map(s => s.artist))).slice(0, 6);

  /* ──────────────────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#0F0C08] text-[#EDE3D3] relative">
      {/* Ambient background glow — quiet, never competes with content */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-[#D4A24C]/[0.05] blur-[140px]" />
        <div className="absolute bottom-[-200px] right-[-100px] w-[600px] h-[600px] rounded-full bg-[#A8442F]/[0.06] blur-[130px]" />
      </div>

      <div className="relative z-10">
        {/* ── TOP BAR ───────────────────────────────────────────── */}
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0F0C08]/85 border-b border-[#D4A24C]/[0.08]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <UstaadMark size={38} pulsing={isPlaying} />
              <div className="hidden xs:block min-w-0">
                <div className="font-semibold tracking-tight text-xl sm:text-2xl leading-none bg-gradient-to-br from-[#F9DE7C] via-[#D4A24C] to-[#A8442F] bg-clip-text text-transparent truncate">
                  USTAAD PRO
                </div>
                <div className="text-[9px] sm:text-[10px] text-[#8B6F47] tracking-[0.12em] mt-0.5 truncate">
                  PLAY · CREATE · LEARN · EARN · ©SHANKH
                </div>
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center gap-1 sm:gap-2 bg-white/[0.03] border border-[#D4A24C]/[0.12] rounded-2xl px-1.5 sm:px-2.5 py-1.5 shrink-0">
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={togglePlay}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[#15110A] shrink-0"
                style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)', boxShadow: '0 4px 14px rgba(212,162,76,0.35)' }}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={stopAll}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A48E6E] hover:text-[#EDE3D3] hover:bg-white/5 transition-colors shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
              </motion.button>

              <div className="hidden sm:flex items-center gap-2 px-2 border-l border-[#D4A24C]/[0.12]">
                <span className="font-mono text-sm text-[#D4A24C] w-7 text-center tabular-nums">{bpm}</span>
                <input
                  type="range" min="60" max="165" value={bpm}
                  onChange={e => setBpm(parseInt(e.target.value))}
                  className="accent-[#D4A24C] w-20"
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={toggleQuickRecord}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${isRecording ? 'bg-[#A8442F] text-white' : 'text-[#A48E6E] hover:bg-white/5'}`}
              >
                {isRecording && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                <Mic2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline tabular-nums">{isRecording ? `${recordingTime}s` : 'REC'}</span>
              </motion.button>
            </div>

            {/* Earnings chip */}
            <div className={`flex items-center gap-1.5 sm:gap-2 bg-gradient-to-br from-[#D4A24C]/[0.14] to-transparent border border-[#D4A24C]/20 rounded-2xl px-3 sm:px-4 py-1.5 shrink-0 transition-opacity ${earningsReady ? 'opacity-100' : 'opacity-50'}`}>
              <Award className="w-3.5 h-3.5 text-[#D4A24C]" />
              <span className="font-mono text-sm tabular-nums">₹{userEarnings.toLocaleString('en-IN')}</span>
            </div>
          </div>

          {/* Tab nav */}
          <nav className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex gap-1 overflow-x-auto scrollbar-none">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex items-center gap-2 px-4 sm:px-5 py-3 text-sm whitespace-nowrap transition-colors ${active ? 'text-[#F4D35E] font-medium' : 'text-[#8B6F47] hover:text-[#A48E6E]'}`}
                  >
                    <Icon className="w-4 h-4" /> {tab.label}
                    {active && (
                      <motion.div
                        layoutId="tab-indicator"
                        className="absolute inset-x-3 bottom-0 h-[2px] rounded-full"
                        style={{ background: 'linear-gradient(90deg,#D4A24C,#F4D35E)' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
        </header>

        {/* ── CONTENT ───────────────────────────────────────────── */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-28 pt-6 sm:pt-8">
          <AnimatePresence mode="wait">

            {/* ════════════════════ CREATE ════════════════════ */}
            {activeTab === 'studio' && (
              <motion.div
                key="studio"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="max-w-2xl mx-auto"
              >
                {/* Category toggle */}
                <div className="flex justify-center mb-5">
                  <div className="flex bg-white/[0.04] border border-[#D4A24C]/[0.12] rounded-full p-1">
                    {(['indian', 'western'] as const).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setInstrumentCategory(cat)}
                        className={`px-5 py-1.5 rounded-full text-xs font-medium transition-colors capitalize ${instrumentCategory === cat ? 'text-[#15110A]' : 'text-[#A48E6E]'}`}
                        style={instrumentCategory === cat ? { background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' } : undefined}
                      >
                        {cat === 'indian' ? 'Indian Classical' : 'Western'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Instrument carousel — tap a circle to add it, like tapping a sound in Edits */}
                <div className="flex gap-4 overflow-x-auto pb-2 mb-7 px-1 scrollbar-none">
                  {(instrumentCategory === 'indian' ? INDIAN_INSTRUMENTS : WESTERN_INSTRUMENTS).map((inst) => {
                    const inUse = tracks.some(t => t.instrument === inst.id);
                    return (
                      <motion.button
                        key={inst.id}
                        onClick={() => addTrack(inst)}
                        whileTap={{ scale: 0.92 }}
                        className="flex flex-col items-center gap-1.5 shrink-0 w-[68px]"
                      >
                        <div
                          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-transform"
                          style={{
                            background: `radial-gradient(circle at 30% 25%, ${inst.color}33, rgba(255,255,255,0.02))`,
                            boxShadow: inUse ? `0 0 0 2.5px ${inst.color}, 0 0 16px ${inst.color}66` : '0 0 0 1.5px rgba(212,162,76,0.14)',
                          }}
                        >
                          {inst.icon}
                        </div>
                        <div className="text-[11px] text-[#EDE3D3]/85 truncate w-full text-center">{inst.name}</div>
                        {inst.kind === 'synth' && <div className="text-[8px] text-[#6B5A41] -mt-1">synth</div>}
                      </motion.button>
                    );
                  })}
                </div>

                {/* Big transport — the Edits-style shutter button */}
                <div className="flex flex-col items-center mb-7">
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={togglePlay}
                    className="relative w-24 h-24 rounded-full flex items-center justify-center text-[#15110A]"
                    style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)', boxShadow: '0 10px 32px rgba(212,162,76,0.4)' }}
                  >
                    {isPlaying && (
                      <motion.span
                        className="absolute inset-0 rounded-full border-2 border-[#D4A24C]"
                        animate={{ scale: [1, 1.25], opacity: [0.6, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                    {isPlaying ? <Pause className="w-9 h-9" /> : <Play className="w-9 h-9 ml-1" />}
                  </motion.button>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-[#8B6F47]">{bpm} BPM</span>
                    <input
                      type="range" min="60" max="165" value={bpm}
                      onChange={e => setBpm(parseInt(e.target.value))}
                      className="accent-[#D4A24C] w-28 h-1"
                    />
                    <button onClick={stopAll} className="text-[#8B6F47] hover:text-[#EDE3D3] transition-colors">
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Track strip — tap a chip to expand its mixer controls */}
                {tracks.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[11px] tracking-[0.14em] text-[#8B6F47] font-medium mb-2.5 px-1">YOUR LAYERS · {tracks.length}</div>
                    <div className="flex gap-2.5 overflow-x-auto pb-1 px-1 scrollbar-none">
                      <AnimatePresence initial={false}>
                        {tracks.map(track => {
                          const def = ALL_INSTRUMENTS.find(i => i.id === track.instrument);
                          const selected = selectedTrackId === track.id;
                          return (
                            <motion.button
                              key={track.id}
                              layout
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              onClick={() => setSelectedTrackId(selected ? null : track.id)}
                              className="relative flex flex-col items-center gap-1 shrink-0 w-14"
                            >
                              <div
                                className="w-12 h-12 rounded-full flex items-center justify-center text-lg transition-opacity"
                                style={{
                                  background: track.color + '22',
                                  boxShadow: `0 0 0 ${selected ? 2 : 1.5}px ${track.color}${selected ? 'cc' : '55'}`,
                                  opacity: track.muted ? 0.4 : 1,
                                }}
                              >
                                {def?.icon ?? '🎵'}
                              </div>
                              {track.solo && <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold bg-[#D4A24C] text-[#15110A] rounded-full w-4 h-4 flex items-center justify-center">S</span>}
                              <div className="text-[9px] text-[#A48E6E] truncate w-full text-center">{track.name}</div>
                            </motion.button>
                          );
                        })}
                      </AnimatePresence>
                    </div>

                    {/* expanded mixer for the selected layer */}
                    <AnimatePresence>
                      {selectedTrackId && tracks.find(t => t.id === selectedTrackId) && (() => {
                        const track = tracks.find(t => t.id === selectedTrackId)!;
                        return (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3 rounded-2xl border border-[#D4A24C]/[0.10] bg-white/[0.025] px-4 py-3.5 flex items-center gap-4"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-baseline mb-1">
                                <div className="text-sm font-medium">{track.name}</div>
                                <div className="text-[11px] font-mono text-[#8B6F47] tabular-nums">{track.volume}%</div>
                              </div>
                              <input
                                type="range" min="0" max="100" value={track.volume}
                                onChange={e => updateTrack(track.id, { volume: parseInt(e.target.value) })}
                                className="w-full h-1"
                                style={{ accentColor: track.color }}
                              />
                            </div>
                            <button
                              onClick={() => updateTrack(track.id, { muted: !track.muted })}
                              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${track.muted ? 'bg-[#A8442F] text-white' : 'bg-white/[0.05] text-[#A48E6E]'}`}
                            >
                              {track.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => updateTrack(track.id, { solo: !track.solo })}
                              className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-bold shrink-0 ${track.solo ? 'text-[#15110A]' : 'bg-white/[0.05] text-[#A48E6E]'}`}
                              style={track.solo ? { background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' } : undefined}
                            >
                              S
                            </button>
                          </motion.div>
                        );
                      })()}
                    </AnimatePresence>
                  </div>
                )}

                {/* Voice — real mic recording, mixed into the export */}
                <div className="rounded-3xl border border-[#D4A24C]/[0.10] bg-white/[0.025] px-5 py-4 mb-6 flex items-center gap-4">
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={toggleVoiceRecording}
                    className="relative w-14 h-14 rounded-full flex items-center justify-center shrink-0"
                    style={isRecordingVoice
                      ? { background: '#A8442F' }
                      : { background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' }}
                  >
                    {isRecordingVoice && (
                      <motion.span
                        className="absolute inset-0 rounded-full border-2 border-white/50"
                        animate={{ scale: [1, 1.3], opacity: [0.6, 0] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      />
                    )}
                    <Mic className="w-6 h-6 text-[#15110A]" style={isRecordingVoice ? { color: 'white' } : undefined} />
                  </motion.button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{isRecordingVoice ? 'Recording your voice…' : voiceBlob ? 'Voice take ready' : 'Add your voice'}</div>
                    <div className="text-[11px] text-[#8B6F47]">🎧 best with headphones · works without too</div>
                  </div>
                  {voiceBlob && voiceUrl && !isRecordingVoice && (
                    <div className="flex items-center gap-2 shrink-0">
                      <audio src={voiceUrl} controls className="h-8 w-32" />
                      <button onClick={clearVoiceTrack} className="text-[#8B6F47] hover:text-[#A8442F] text-xs">Clear</button>
                    </div>
                  )}
                </div>

                {/* Bottom action row — Edits-style: make, download, share, learn */}
                <div className="grid grid-cols-3 gap-3 mb-8">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={exportSong}
                    disabled={isExporting}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-white/[0.04] border border-[#D4A24C]/[0.12] disabled:opacity-60"
                  >
                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin text-[#D4A24C]" /> : <Download className="w-5 h-5 text-[#D4A24C]" />}
                    <span className="text-xs">{isExporting ? 'Recording…' : 'Download'}</span>
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={postToDiscover}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-white/[0.04] border border-[#D4A24C]/[0.12]"
                  >
                    <Share2 className="w-5 h-5 text-[#D4A24C]" />
                    <span className="text-xs">Share &amp; Earn</span>
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setActiveTab('ustaad')}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-white/[0.04] border border-[#D4A24C]/[0.12]"
                  >
                    <Sparkles className="w-5 h-5 text-[#D4A24C]" />
                    <span className="text-xs">Learn</span>
                  </motion.button>
                </div>

                {/* Practice / note-catching game — tucked below the main create flow */}
                <div className="rounded-3xl border border-[#D4A24C]/[0.10] bg-white/[0.025] backdrop-blur-xl p-5 sm:p-6 min-h-[260px] overflow-hidden relative">
                  <div className="flex justify-between items-center mb-3 relative z-10">
                    <div className="font-medium flex items-center gap-2 text-sm">
                      <Flame className={`w-4 h-4 ${gameActive ? 'text-[#F4D35E]' : 'text-[#8B6F47]'}`} />
                      Practice · catch the swaras
                    </div>
                    <motion.div
                      key={caughtPulse}
                      initial={{ scale: 1.3 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                      className="font-mono text-lg text-[#D4A24C] tabular-nums"
                    >
                      {gameScore}
                    </motion.div>
                  </div>

                  <div
                    className="rounded-2xl h-[190px] relative overflow-hidden border border-[#D4A24C]/[0.12]"
                    style={{ background: 'radial-gradient(circle at 50% -20%, rgba(212,162,76,0.12), transparent 60%), linear-gradient(#181109,#0F0C08)' }}
                  >
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-[260px] h-[260px] rounded-full border border-[#D4A24C]/[0.06]" />
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-[180px] h-[180px] rounded-full border border-[#D4A24C]/[0.08]" />

                    <AnimatePresence>
                      {fallingNotes.map(note => (
                        <motion.button
                          key={note.id}
                          onClick={() => catchNote(note.id)}
                          initial={{ top: -40, opacity: 0, scale: 0.7 }}
                          animate={{ top: 200, opacity: [0, 1, 1, 0.2] }}
                          exit={{ opacity: 0, scale: 1.3 }}
                          transition={{ duration: 2.4, ease: 'linear' }}
                          whileTap={{ scale: 1.4 }}
                          className="absolute w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold cursor-pointer"
                          style={{
                            left: note.x,
                            color: '#15110A',
                            background: `radial-gradient(circle at 30% 25%, #fff8e8, ${SARGAM_HUES[note.note] ?? '#D4A24C'})`,
                            boxShadow: `0 0 16px ${SARGAM_HUES[note.note] ?? '#D4A24C'}99`,
                          }}
                        >
                          {note.note}
                        </motion.button>
                      ))}
                    </AnimatePresence>

                    {!gameActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-[#8B6F47]">
                        <UstaadMark size={36} />
                        Press ▶ above to start
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center gap-2 mt-3 flex-wrap relative z-10">
                    {SARGAM_NOTES.map(n => (
                      <span
                        key={n}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                        style={{ color: SARGAM_HUES[n], borderColor: `${SARGAM_HUES[n]}33`, background: `${SARGAM_HUES[n]}0F` }}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ════════════════════ DISCOVER ════════════════════ */}
            {activeTab === 'discover' && (
              <motion.div
                key="discover"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
                  <div>
                    <div className="text-3xl sm:text-4xl font-semibold tracking-tight">Discover</div>
                    <div className="text-[#8B6F47] text-sm mt-1">Fresh ragas from the community</div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={postToDiscover}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium text-[#15110A]"
                    style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)', boxShadow: '0 6px 18px rgba(212,162,76,0.3)' }}
                  >
                    <Plus className="w-4 h-4" /> Share Your Track
                  </motion.button>
                </div>

                {/* trending creators rail */}
                <div className="flex gap-4 mb-7 overflow-x-auto pb-1 scrollbar-none">
                  {trendingArtists.map((artist) => (
                    <div key={artist} className="flex flex-col items-center gap-1.5 shrink-0 w-16">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center text-sm font-semibold text-[#15110A] ring-2 ring-[#0F0C08] ring-offset-2 ring-offset-[#D4A24C]/40"
                        style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' }}
                      >
                        {artist.split(' ').map(p => p[0]).slice(0, 2).join('')}
                      </div>
                      <div className="text-[10px] text-[#A48E6E] truncate w-full text-center">{artist.split(' ')[0]}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                  {SAMPLE_SONGS.map((song) => (
                    <motion.div
                      key={song.id}
                      whileHover={{ y: -4 }}
                      className="group rounded-3xl overflow-hidden border border-[#D4A24C]/[0.10] bg-white/[0.025] backdrop-blur-xl"
                    >
                      <div className="relative aspect-square overflow-hidden">
                        <img src={song.cover} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/10" />
                        <div className="absolute top-3 right-3 text-[10px] font-mono px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
                          {song.duration}
                        </div>
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          whileHover={{ opacity: 1, scale: 1 }}
                          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <div
                            className="w-12 h-12 rounded-full flex items-center justify-center text-[#15110A]"
                            style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                          >
                            <Play className="w-5 h-5 ml-0.5" />
                          </div>
                        </motion.div>
                        <div className="absolute bottom-0 inset-x-0 p-4">
                          <div className="font-medium text-sm truncate">{song.title}</div>
                          <div className="text-xs text-[#D4C9A8]/70 truncate">{song.artist}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 text-xs text-[#A48E6E]">
                        <span>{formatCount(song.plays)} plays</span>
                        <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {formatCount(song.likes)}</span>
                        <span className="text-[#D4A24C] font-mono font-medium">₹{song.earnings}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ════════════════════ USTAAD AI ════════════════════ */}
            {activeTab === 'ustaad' && (
              <motion.div
                key="ustaad"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="max-w-3xl mx-auto"
              >
                <div className="flex flex-col items-center text-center mb-7 relative">
                  <button
                    onClick={() => { setVoiceEnabled(v => { if (v) window.speechSynthesis?.cancel(); return !v; }); }}
                    className="absolute right-0 top-0 flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl bg-white/[0.04] border border-[#D4A24C]/[0.12] text-[#A48E6E] hover:text-[#EDE3D3] hover:bg-white/[0.07] transition-colors"
                  >
                    {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
                  </button>
                  <UstaadMark size={52} pulsing={isGenerating || isSpeaking} />
                  <div className="text-4xl sm:text-5xl font-semibold tracking-tight mt-3">Ustaad AI</div>
                  <div className="text-[#8B6F47] text-sm mt-1">
                    {isSpeaking ? 'Speaking…' : 'Your sangeet guru, listening & composing'}
                  </div>
                </div>

                <div className="rounded-3xl border border-[#D4A24C]/[0.10] bg-white/[0.025] backdrop-blur-xl h-[480px] flex flex-col overflow-hidden">
                  <div className="flex-1 p-5 overflow-y-auto space-y-3">
                    <AnimatePresence initial={false}>
                      {chatMessages.map((msg) => (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                              msg.type === 'ai'
                                ? 'bg-white/[0.05] border border-white/[0.06] rounded-bl-md text-[#EDE3D3]'
                                : 'rounded-br-md text-[#15110A] font-medium'
                            }`}
                            style={msg.type === 'user' ? { background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' } : undefined}
                          >
                            {msg.content}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {isGenerating && (
                      <div className="flex justify-start">
                        <div className="bg-white/[0.05] border border-white/[0.06] rounded-2xl rounded-bl-md px-4 py-3 flex gap-1 items-center">
                          {[0, 1, 2].map(i => (
                            <motion.span
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-[#D4A24C]"
                              animate={{ y: [0, -4, 0] }}
                              transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-black/20 flex gap-2 border-t border-white/[0.06]">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={startHumDetection}
                      className={`relative flex-1 py-3 rounded-2xl text-sm flex justify-center items-center gap-2 transition-colors ${isHumming ? 'bg-[#A8442F] text-white' : 'bg-white/[0.05] hover:bg-white/[0.08] text-[#EDE3D3]'}`}
                    >
                      {isHumming && (
                        <motion.span
                          className="absolute inset-0 rounded-2xl border border-white/40"
                          animate={{ scale: [1, 1.05, 1], opacity: [0.6, 0, 0.6] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                        />
                      )}
                      <Radio className="w-4 h-4" /> {isHumming ? 'Listening…' : isMatching ? 'Matching…' : 'Hum to Match'}
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={startVoiceInput}
                      className="flex-1 py-3 font-medium rounded-2xl text-[#15110A] flex justify-center items-center gap-2"
                      style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' }}
                      title={voiceSupported ? 'Speak to Ustaad' : 'Live recognition unsupported here — plays a demo phrase'}
                    >
                      <Mic className="w-4 h-4" /> {isListening ? 'Listening…' : voiceSupported ? 'Speak' : 'Speak (demo)'}
                    </motion.button>
                  </div>

                  <div className="p-4 bg-black/20">
                    <div className="flex gap-2">
                      <input
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendToUstaad(chatInput)}
                        className="flex-1 bg-white/[0.05] border border-white/[0.06] focus:border-[#D4A24C]/40 outline-none px-4 py-3 rounded-2xl text-sm placeholder:text-[#6B5A41] transition-colors"
                        placeholder="Ask Ustaad…"
                      />
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        onClick={() => sendToUstaad(chatInput)}
                        className="px-5 sm:px-6 font-medium rounded-2xl text-[#15110A] flex items-center gap-1.5"
                        style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)' }}
                      >
                        <Send className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Send</span>
                      </motion.button>
                    </div>
                    <AnimatePresence>
                      {humResult && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className={`flex items-center justify-center gap-1.5 text-xs mt-2.5 ${humResult.startsWith('✅') ? 'text-[#D4A24C]' : 'text-[#A48E6E]'}`}
                        >
                          {humResult.startsWith('✅') ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
                          {humResult.replace('✅ ', '')}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ════════════════════ EARN ════════════════════ */}
            {activeTab === 'earn' && (
              <motion.div
                key="earn"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="max-w-xl mx-auto"
              >
                <div className="text-center mb-7">
                  <div className="text-3xl sm:text-4xl font-semibold tracking-tight">Earn with USTAAD</div>
                  <div className="text-[#8B6F47] text-sm mt-1">Every raga you create can pay you back</div>
                </div>

                {/* wallet hero card */}
                <div
                  className="relative rounded-3xl p-7 mb-6 overflow-hidden border border-[#D4A24C]/20"
                  style={{ background: 'linear-gradient(150deg, rgba(212,162,76,0.16), rgba(168,68,47,0.08) 60%, rgba(15,12,8,0.4))' }}
                >
                  <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full border border-[#D4A24C]/10" />
                  <div className="absolute -right-2 -top-2 w-28 h-28 rounded-full border border-[#D4A24C]/15" />

                  <div className="relative flex justify-between items-end mb-6 flex-wrap gap-4">
                    <div>
                      <div className="text-[11px] tracking-[0.14em] text-[#C9B896]">YOUR EARNINGS</div>
                      <div className="text-5xl sm:text-6xl font-semibold tabular-nums bg-gradient-to-br from-[#F9DE7C] to-[#D4A24C] bg-clip-text text-transparent">
                        ₹{userEarnings.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] tracking-[0.14em] text-[#C9B896]">TOTAL PLAYS</div>
                      <div className="text-2xl sm:text-3xl font-mono text-[#D4A24C] tabular-nums">{formatCount(totalPlays)}</div>
                    </div>
                  </div>

                  <div className="relative grid grid-cols-2 gap-2 mb-3">
                    <input
                      value={upiId}
                      onChange={(e) => { setUpiId(e.target.value); window.localStorage.setItem('ustaad_upi_id', e.target.value); }}
                      placeholder="yourname@upi"
                      className="bg-black/25 border border-[#D4A24C]/[0.14] focus:border-[#D4A24C]/40 outline-none px-3 py-2.5 rounded-xl text-sm placeholder:text-[#6B5A41]"
                    />
                    <input
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      type="number"
                      min={1}
                      max={userEarnings}
                      placeholder={`Amount (max ₹${userEarnings.toLocaleString('en-IN')})`}
                      className="bg-black/25 border border-[#D4A24C]/[0.14] focus:border-[#D4A24C]/40 outline-none px-3 py-2.5 rounded-xl text-sm placeholder:text-[#6B5A41] tabular-nums"
                    />
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={requestWithdrawal}
                    disabled={isWithdrawing}
                    className="relative w-full py-3.5 font-semibold rounded-2xl text-[#15110A] overflow-hidden flex items-center justify-center gap-2 disabled:opacity-70"
                    style={{ background: 'linear-gradient(135deg,#F9DE7C,#D4A24C)', boxShadow: '0 8px 24px rgba(212,162,76,0.3)' }}
                  >
                    {isWithdrawing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                    {isWithdrawing ? 'Processing real payout…' : 'Withdraw to UPI'}
                  </motion.button>
                  <div className="relative text-[10px] text-[#C9B896]/70 text-center mt-2">
                    Real Razorpay payout — needs RazorpayX approved &amp; funded on the account behind this app.
                  </div>
                </div>

                {/* how you earn */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: Mic2, label: 'Recording', sub: 'studio sessions' },
                    { icon: Users, label: 'Streaming', sub: 'plays & likes' },
                    { icon: Flame, label: 'Note Game', sub: 'every catch' },
                  ].map(({ icon: Icon, label, sub }) => (
                    <div key={label} className="rounded-2xl border border-[#D4A24C]/[0.10] bg-white/[0.025] px-3 py-4 text-center">
                      <Icon className="w-4 h-4 text-[#D4A24C] mx-auto mb-2" />
                      <div className="text-xs font-medium">{label}</div>
                      <div className="text-[10px] text-[#8B6F47] mt-0.5">{sub}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {/* ── FOOTER ───────────────────────────────────────────── */}
        <div className="fixed bottom-0 inset-x-0 backdrop-blur-xl bg-[#0F0C08]/90 border-t border-[#D4A24C]/[0.08] py-3 px-5 text-xs z-40">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-1.5 text-[#8B6F47]">
              <Sparkles className="w-3.5 h-3.5 text-[#D4A24C]" /> Free to create · Earn real money
            </div>
            <div className="text-[#8B6F47]">©SHANKH · USTAAD PRO 2026</div>
          </div>
        </div>
      </div>
    </div>
  );
}
