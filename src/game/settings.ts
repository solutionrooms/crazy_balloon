/**
 * Tunable settings registry. To add a new knob, append one entry to DEFAULTS —
 * it shows up in the settings screen automatically and is persisted.
 * The game reads values live via Settings.get(key), so changes apply instantly.
 */
export interface SettingDef {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
  decimals?: number; // display precision (0 = integer)
}

export const DEFAULTS: SettingDef[] = [
  { key: "swingAmp", label: "SWING AMPLITUDE", def: 14, min: 0, max: 28, step: 1 },
  { key: "swingPeriod", label: "SWING PERIOD", def: 1.5, min: 0.4, max: 3.0, step: 0.1, decimals: 1 },
  { key: "moveSpeed", label: "MOVE SPEED", def: 46, min: 16, max: 110, step: 2 },
  { key: "balloonSize", label: "BALLOON SIZE", def: 3.3, min: 1.5, max: 6.0, step: 0.1, decimals: 1 },
  { key: "blowerDelay", label: "BLOWER DELAY", def: 4, min: 1, max: 12, step: 0.5, decimals: 1 },
  { key: "blowerPush", label: "BLOWER PUSH", def: 14, min: 0, max: 48, step: 2 },
  { key: "startLives", label: "START LIVES", def: 3, min: 1, max: 9, step: 1 },
];

const STORAGE_KEY = "crazyballoon.settings.v1";

export class Settings {
  readonly defs = DEFAULTS;
  private values = new Map<string, number>();

  constructor() {
    for (const d of DEFAULTS) this.values.set(d.key, d.def);
    this.load();
  }

  get(key: string): number {
    return this.values.get(key) ?? DEFAULTS.find((d) => d.key === key)?.def ?? 0;
  }

  /** Adjust the value at registry index by +/- steps, clamped, then persist. */
  adjust(index: number, dir: number) {
    const d = this.defs[index];
    if (!d) return;
    let v = this.get(d.key) + dir * d.step;
    v = Math.max(d.min, Math.min(d.max, v));
    v = Math.round(v / d.step) * d.step; // snap to step grid (avoids fp drift)
    this.values.set(d.key, v);
    this.save();
  }

  resetAll() {
    for (const d of DEFAULTS) this.values.set(d.key, d.def);
    this.save();
  }

  display(index: number): string {
    const d = this.defs[index];
    return this.get(d.key).toFixed(d.decimals ?? 0);
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, number>;
      for (const d of DEFAULTS) {
        if (typeof obj[d.key] === "number") {
          this.values.set(d.key, Math.max(d.min, Math.min(d.max, obj[d.key])));
        }
      }
    } catch { /* ignore corrupt storage */ }
  }

  private save() {
    try {
      const obj: Record<string, number> = {};
      for (const d of DEFAULTS) obj[d.key] = this.get(d.key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch { /* ignore */ }
  }
}
