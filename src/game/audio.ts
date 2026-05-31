/** WebAudio chiptune engine for Crazy Balloon. Melodies are public-domain tunes
 * (Foster's "Oh! Susanna" at maze start; a short Bizet "Carmen" Toreador-march
 * phrase on losing a balloon), synthesized at runtime — no samples/assets. */

type Step = [note: string, beats: number]; // note like "C4", or "R" for rest

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToFreq(note: string): number {
  if (note[0] === "R") return 0; // rest
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) return 0;
  let s = SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const midi = (parseInt(m[3], 10) + 1) * 12 + s;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// "Oh! Susanna" opening phrase (do do re mi | sol sol la sol | mi do re mi | re)
const OH_SUSANNA: Step[] = [
  ["C4", 0.5], ["C4", 0.5], ["D4", 0.5], ["E4", 0.5],
  ["G4", 0.5], ["G4", 0.5], ["A4", 0.5], ["G4", 0.5],
  ["E4", 0.5], ["C4", 0.5], ["D4", 0.5], ["E4", 0.5],
  ["D4", 1.0], ["R", 0.25],
];

// Toreador march phrase (Carmen) — short, jaunty, public domain.
const TOREADOR: Step[] = [
  ["A4", 0.5], ["A4", 0.25], ["B4", 0.25], ["C5", 0.5], ["A4", 0.5],
  ["A4", 0.25], ["G4", 0.25], ["F4", 0.5], ["E4", 0.75],
];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noiseBuf: AudioBuffer | null = null;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    }
    this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }
  get isMuted() { return this.muted; }

  /** One enveloped oscillator note. */
  private osc(freq: number, t0: number, dur: number, type: OscillatorType, gain: number) {
    if (!this.ctx || !this.master || freq <= 0) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** White-noise burst (for the pop). */
  private noise(t0: number, dur: number, gain: number) {
    if (!this.ctx || !this.master) return;
    if (!this.noiseBuf) {
      const n = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  private melody(steps: Step[], bpm: number, type: OscillatorType, gain: number) {
    if (this.muted || !this.ctx) return;
    const beat = 60 / bpm;
    let t = this.ctx.currentTime + 0.02;
    for (const [note, beats] of steps) {
      const dur = beats * beat;
      this.osc(noteToFreq(note), t, dur * 0.92, type, gain);
      t += dur;
    }
  }

  // --- cues ---
  mazeStart() { this.melody(OH_SUSANNA, 200, "square", 0.16); }

  goal() { // bright rising fanfare
    this.melody([["C5", 0.5], ["E5", 0.5], ["G5", 0.5], ["C6", 1.0]], 260, "square", 0.16);
  }

  loss() { this.melody(TOREADOR, 150, "sawtooth", 0.13); }

  pop() { // noise burst + quick downward pitch drop
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    this.noise(t, 0.18, 0.22);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master!);
    o.start(t); o.stop(t + 0.22);
  }

  beep() { // goal-proximity blip
    if (this.muted || !this.ctx) return;
    this.osc(1320, this.ctx.currentTime + 0.005, 0.05, "square", 0.08);
  }
}
