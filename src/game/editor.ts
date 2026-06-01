/** Level editor + persistence (localStorage): per-maze spikes, start/goal,
 * per-level option overrides, and high scores. */
import { MAZE_N } from "../levels/mazes";
import { TILE, SCREEN_W, PALETTE, COLOR_PALETTE, SPIKE_COLORS } from "../engine/constants";
import { chars } from "../gfx/tiles";
import type { PlayMaze } from "./maze";
import type { Input } from "./input";
import type { Settings } from "./settings";
import { cloudLoadLevels, cloudSaveLevels, cloudTopScores, cloudAddScore, cloudEnabled, type CloudScore } from "../net/cloud";
import { drawText, textWidth } from "./font";

export interface EditSpike {
  cell: [number, number];       // home (and moving start) cell
  to: [number, number] | null;  // moving end, or null = static
  speed: number;                // cells/sec
  color: number;                // palette index
  on: boolean;
}
export interface MazeEdit {
  start: [number, number] | null;
  goal: [number, number] | null;
  spikes: EditSpike[];
  options: Record<string, number>; // per-level setting overrides
}

const EDITS_KEY = "crazyballoon.edits.v2";
const SCORES_KEY = "crazyballoon.scores.v1";

export class Store {
  private edits: Record<number, MazeEdit> = {};
  scores: number[] = [];
  cloudScores: CloudScore[] = [];
  cloudMsg = "";

  constructor() { this.load(); }

  edit(maze: number): MazeEdit {
    const e = this.edits[maze];
    if (!e) return (this.edits[maze] = { start: null, goal: null, spikes: [], options: {} });
    e.spikes ??= []; e.options ??= {}; // tolerate older saves
    return e;
  }
  get hiScore(): number {
    const localBest = this.scores[0] ?? 0;
    const cloudBest = this.cloudScores[0]?.score ?? 0;
    return Math.max(localBest, cloudBest);
  }

  recordScore(score: number): boolean {
    if (score <= 0) return false;
    const best = this.scores[0] ?? 0;
    this.scores.push(score);
    this.scores.sort((a, b) => b - a);
    this.scores = this.scores.slice(0, 5);
    try { localStorage.setItem(SCORES_KEY, JSON.stringify(this.scores)); } catch { /* ignore */ }
    return score > best;
  }

  save() { try { localStorage.setItem(EDITS_KEY, JSON.stringify(this.edits)); } catch { /* ignore */ } }

  // ---- cloud (Supabase) ----
  get cloudOn() { return cloudEnabled(); }

  /** On startup: always refresh the published levels from the cloud (the DB is the
   * source of truth); cache the global scores. Falls back to local if unreachable. */
  async initCloud() {
    if (!cloudEnabled()) return;
    const lv = await cloudLoadLevels();
    if (lv) { this.edits = lv as Record<number, MazeEdit>; this.save(); this.cloudMsg = "levels loaded from cloud"; }
    this.cloudScores = await cloudTopScores(10);
  }
  /** Publish the current levels to the cloud (explicit, from the editor). */
  async publish() {
    this.cloudMsg = "publishing…";
    this.cloudMsg = (await cloudSaveLevels(this.edits as Record<string, unknown>))
      ? "published to cloud ✓" : "publish failed";
  }
  /** Pull the published levels from the cloud (overwrites local working copy). */
  async pull() {
    const lv = await cloudLoadLevels();
    if (lv) { this.edits = lv as Record<number, MazeEdit>; this.save(); this.cloudMsg = "loaded from cloud ✓"; }
    else this.cloudMsg = "no cloud levels found";
  }
  /** Submit a finished score to the global board + local table. */
  async submitScore(name: string, score: number) {
    this.recordScore(score);
    await cloudAddScore(name, score);
    this.cloudScores = await cloudTopScores(10);
  }

  private load() {
    try {
      const e = localStorage.getItem(EDITS_KEY);
      if (e) this.edits = JSON.parse(e);
      const s = localStorage.getItem(SCORES_KEY); if (s) this.scores = JSON.parse(s);
    } catch { /* ignore */ }
  }
}

const SPEED_DEFAULT = 2;

export class Editor {
  active = false;
  private cur: [number, number] = [14, 16];
  private moving = false;       // setting a spike's move-end
  private movingSpike: EditSpike | null = null;
  private optMode = false;      // per-level options panel
  private optIndex = 0;

  constructor(private store: Store) {}

  toggle() { this.active = !this.active; this.moving = false; this.optMode = false; }
  pointTo(col: number, row: number) { this.cur = [clamp(col), clamp(row)]; }

  private spikeAt(e: MazeEdit): EditSpike | undefined {
    return e.spikes.find((s) => s.cell[0] === this.cur[0] && s.cell[1] === this.cur[1]);
  }

  handle(input: Input, mazeIndex: number, settings: Settings) {
    const e = this.store.edit(mazeIndex);

    if (this.optMode) { this.handleOptions(input, e, settings); return; }
    if (input.justPressed("KeyO")) { this.optMode = true; this.optIndex = 0; return; }

    let changed = false;
    if (input.justPressed("ArrowUp")) this.cur[1] = clamp(this.cur[1] - 1);
    if (input.justPressed("ArrowDown")) this.cur[1] = clamp(this.cur[1] + 1);
    if (input.justPressed("ArrowLeft")) this.cur[0] = clamp(this.cur[0] - 1);
    if (input.justPressed("ArrowRight")) this.cur[0] = clamp(this.cur[0] + 1);

    if (input.justPressed("KeyS")) { e.start = [...this.cur] as [number, number]; changed = true; }
    if (input.justPressed("KeyG")) { e.goal = [...this.cur] as [number, number]; changed = true; }

    if (input.justPressed("Space")) {
      const sp = this.spikeAt(e);
      if (sp) sp.on = !sp.on;
      else e.spikes.push({ cell: [...this.cur] as [number, number], to: null, speed: SPEED_DEFAULT, color: 1, on: true });
      changed = true;
    }
    if (input.justPressed("KeyC")) {
      const sp = this.spikeAt(e);
      if (sp) { sp.color = SPIKE_COLORS[(SPIKE_COLORS.indexOf(sp.color) + 1) % SPIKE_COLORS.length]; changed = true; }
    }
    if (input.justPressed("KeyM")) {
      if (this.moving && this.movingSpike) {
        this.movingSpike.to = [...this.cur] as [number, number];
        this.moving = false; this.movingSpike = null; changed = true;
      } else {
        const sp = this.spikeAt(e);
        if (sp) { this.moving = true; this.movingSpike = sp; }
      }
    }
    if (this.moving && this.movingSpike) {
      if (input.justPressed("Minus") || input.justPressed("BracketLeft"))
        { this.movingSpike.speed = Math.max(0.5, +(this.movingSpike.speed - 0.5).toFixed(1)); changed = true; }
      if (input.justPressed("Equal") || input.justPressed("BracketRight"))
        { this.movingSpike.speed = +(this.movingSpike.speed + 0.5).toFixed(1); changed = true; }
    }
    if (input.justPressed("KeyX")) { const sp = this.spikeAt(e); if (sp) { e.spikes.splice(e.spikes.indexOf(sp), 1); changed = true; } }
    if (input.justPressed("KeyU")) { void this.store.publish(); }     // upload to cloud
    if (input.justPressed("KeyL")) { void this.store.pull(); }        // load from cloud

    if (changed) this.store.save();
  }

  private handleOptions(input: Input, e: MazeEdit, settings: Settings) {
    const defs = settings.defs;
    if (input.justPressed("KeyO") || input.justPressed("Escape")) { this.optMode = false; return; }
    if (input.justPressed("ArrowUp")) this.optIndex = (this.optIndex - 1 + defs.length) % defs.length;
    if (input.justPressed("ArrowDown")) this.optIndex = (this.optIndex + 1) % defs.length;
    const d = defs[this.optIndex];
    const cur = e.options[d.key] ?? settings.get(d.key);
    const set = (v: number) => { e.options[d.key] = clampN(v, d.min, d.max, d.step); this.store.save(); };
    if (input.justPressed("ArrowLeft")) set(cur - d.step);
    if (input.justPressed("ArrowRight")) set(cur + d.step);
    if (input.justPressed("KeyR")) { delete e.options[d.key]; this.store.save(); } // back to global
  }

  render(ctx: CanvasRenderingContext2D, maze: PlayMaze, mazeIndex: number, xoff: number, settings: Settings) {
    const e = this.store.edit(mazeIndex);
    if (this.optMode) { this.renderOptions(ctx, e, settings); return; }

    ctx.save();
    ctx.translate(xoff, 0);
    e.spikes.forEach((sp) => {
      const a = cellC(sp.cell);
      const col = sp.on ? COLOR_PALETTE[sp.color] : "border";
      chars.draw(ctx, 0x39, col, a.x - TILE / 2, a.y - TILE / 2);
      if (sp.to) {
        const b = cellC(sp.to);
        ctx.strokeStyle = sp.on ? PALETTE[col] : PALETTE.border; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        box(ctx, sp.to, sp.on ? PALETTE[col] : PALETTE.border);
      }
    });
    box(ctx, e.start ?? maze.startCell, PALETTE.green);
    box(ctx, e.goal ?? maze.goalCell, PALETTE.red);
    ctx.strokeStyle = this.moving ? PALETTE.yellow : PALETTE.white;
    ctx.lineWidth = 1;
    ctx.strokeRect(this.cur[0] * TILE + 0.5, this.cur[1] * TILE + 0.5, TILE - 1, TILE - 1);
    ctx.restore();

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, ctx.canvas.width, 34);
    drawText(ctx, 2, 1, "EDIT MAZE " + (mazeIndex + 1), PALETTE.yellow, 1);
    if (this.store.cloudMsg)
      drawText(ctx, SCREEN_W - textWidth(this.store.cloudMsg, 1) - 2, 1, this.store.cloudMsg, PALETTE.green, 1);
    drawText(ctx, 2, 9, "S START  G GOAL  SPACE SPIKE  C COLOR", PALETTE.white, 1);
    const sp = this.spikeAt(e);
    const spd = this.moving && this.movingSpike ? "  SPD " + this.movingSpike.speed.toFixed(1) : (sp ? "  SPD " + sp.speed.toFixed(1) : "");
    drawText(ctx, 2, 17, (this.moving ? "M SET END  -/+ SPEED" + spd : "M MOVE" + spd) + "  X DEL  O OPTS", PALETTE.cyan, 1);
    drawText(ctx, 2, 25, this.store.cloudOn ? "U PUBLISH  L LOAD CLOUD  E EXIT" : "E EXIT  (cloud off)", PALETTE.green, 1);
  }

  private renderOptions(ctx: CanvasRenderingContext2D, e: MazeEdit, settings: Settings) {
    ctx.fillStyle = "#05080a";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawText(ctx, (ctx.canvas.width - textWidth("LEVEL OPTIONS", 2)) / 2, 12, "LEVEL OPTIONS", PALETTE.cyan, 2);
    settings.defs.forEach((d, i) => {
      const y = 42 + i * 16;
      const sel = i === this.optIndex;
      const over = e.options[d.key] !== undefined;
      if (sel) { ctx.fillStyle = "#0a2a30"; ctx.fillRect(4, y - 3, ctx.canvas.width - 8, 13); }
      drawText(ctx, 8, y, d.label, sel ? PALETTE.yellow : PALETTE.white, 1);
      const val = (e.options[d.key] ?? settings.get(d.key)).toFixed(d.decimals ?? 0);
      drawText(ctx, 150, y, "<", sel ? PALETTE.yellow : PALETTE.cyan, 1);
      drawText(ctx, 164, y, val.padStart(5), over ? PALETTE.yellow : PALETTE.border, 1);
      drawText(ctx, 196, y, ">", sel ? PALETTE.yellow : PALETTE.cyan, 1);
    });
    const f = 42 + settings.defs.length * 16 + 6;
    const hint = (t: string, y: number) => drawText(ctx, (ctx.canvas.width - textWidth(t, 1)) / 2, y, t, PALETTE.border, 1);
    hint("YELLOW = THIS LEVEL   GREY = GLOBAL", f);
    hint("LEFT/RIGHT CHANGE   R RESET TO GLOBAL", f + 10);
    hint("O / ESC BACK", f + 20);
  }
}

function clamp(v: number) { return Math.max(0, Math.min(MAZE_N - 1, v)); }
function clampN(v: number, min: number, max: number, step: number) {
  v = Math.max(min, Math.min(max, v));
  return Math.round(v / step) * step;
}
function cellC(c: [number, number]) { return { x: c[0] * TILE + TILE / 2, y: c[1] * TILE + TILE / 2 }; }
function box(ctx: CanvasRenderingContext2D, c: [number, number], color: string) {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.strokeRect(c[0] * TILE + 1.5, c[1] * TILE + 1.5, TILE - 3, TILE - 3);
}
