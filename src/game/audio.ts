/** Tiny WebAudio synth for arcade SFX/jingles. All cues are simple original
 * note sequences synthesized at runtime — no samples, no external assets. */
type Note = [freqHz: number, startSec: number, durSec: number];

export class Audio {
  private ctx: AudioContext | null = null;
  private muted = false;

  /** Lazily create/resume the context on a user gesture (autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    this.ctx?.resume();
  }

  toggleMute() { this.muted = !this.muted; return this.muted; }
  get isMuted() { return this.muted; }

  private tone(freq: number, t0: number, dur: number, type: OscillatorType, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private play(notes: Note[], type: OscillatorType = "square", gain = 0.12) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [f, s, d] of notes) this.tone(f, now + s, d, type, gain);
  }

  // --- cues ---
  mazeStart() { // bright ascending arpeggio
    this.play([[392, 0, .12], [523, .12, .12], [659, .24, .12], [784, .36, .2]]);
  }
  goal() { // win chime
    this.play([[659, 0, .1], [784, .1, .1], [988, .2, .25]], "triangle", 0.14);
  }
  pop() { // quick descending pop/burst
    this.play([[440, 0, .05], [220, .05, .08], [110, .13, .12]], "sawtooth", 0.15);
  }
  loss() { // descending sting
    this.play([[523, 0, .14], [392, .14, .14], [262, .28, .28]], "square", 0.13);
  }
  beep() { // goal-proximity blip
    this.play([[1320, 0, .04]], "square", 0.06);
  }
  blower() { // airy noise-ish puff (low detuned tone)
    this.play([[140, 0, .18]], "sawtooth", 0.08);
  }
}
