/** Level editor + persistence (localStorage) for per-maze edits and high scores. */
import { MAZE_N } from "../levels/mazes";
import { TILE, PALETTE } from "../engine/constants";
import { chars } from "../gfx/tiles";
import type { PlayMaze } from "./maze";
import type { Input } from "./input";
import { drawText } from "./font";

export interface EditSpike {
  from: [number, number];
  to: [number, number];
  speed: number; // cells/sec
  on: boolean;
}
export interface MazeEdit {
  start: [number, number] | null; // override START cell
  goal: [number, number] | null;  // override GOAL cell
  spikes: EditSpike[];
}

const EDITS_KEY = "crazyballoon.edits.v1";
const SCORES_KEY = "crazyballoon.scores.v1";

export class Store {
  private edits: Record<number, MazeEdit> = {};
  scores: number[] = []; // descending top scores

  constructor() { this.load(); }

  edit(maze: number): MazeEdit {
    if (!this.edits[maze]) this.edits[maze] = { start: null, goal: null, spikes: [] };
    return this.edits[maze];
  }
  get hiScore(): number { return this.scores[0] ?? 0; }

  /** Record a finished game's score; keep the top 5. Returns true if it's a new best. */
  recordScore(score: number): boolean {
    if (score <= 0) return false;
    const best = this.hiScore;
    this.scores.push(score);
    this.scores.sort((a, b) => b - a);
    this.scores = this.scores.slice(0, 5);
    try { localStorage.setItem(SCORES_KEY, JSON.stringify(this.scores)); } catch { /* ignore */ }
    return score > best;
  }

  save() {
    try { localStorage.setItem(EDITS_KEY, JSON.stringify(this.edits)); } catch { /* ignore */ }
  }
  clearMaze(maze: number) { this.edits[maze] = { start: null, goal: null, spikes: [] }; this.save(); }

  private load() {
    try {
      const e = localStorage.getItem(EDITS_KEY);
      if (e) this.edits = JSON.parse(e);
      const s = localStorage.getItem(SCORES_KEY);
      if (s) this.scores = JSON.parse(s);
    } catch { /* ignore corrupt storage */ }
  }
}

const SPEED_DEFAULT = 2; // cells/sec

/** In-game level editor. Toggled with E; pauses play while active. */
export class Editor {
  active = false;
  private cur: [number, number] = [14, 16];
  private pendingFrom: [number, number] | null = null;
  private sel = 0; // selected spike index

  constructor(private store: Store) {}

  toggle() { this.active = !this.active; }

  /** Move the cursor to a cell (from a click/tap). */
  pointTo(col: number, row: number) {
    this.cur = [clamp(col), clamp(row)];
  }

  /** Handle a frame of editor input for the given maze. Returns true if edits changed. */
  handle(input: Input, mazeIndex: number) {
    const e = this.store.edit(mazeIndex);
    let changed = false;
    if (input.justPressed("ArrowUp")) this.cur[1] = clamp(this.cur[1] - 1);
    if (input.justPressed("ArrowDown")) this.cur[1] = clamp(this.cur[1] + 1);
    if (input.justPressed("ArrowLeft")) this.cur[0] = clamp(this.cur[0] - 1);
    if (input.justPressed("ArrowRight")) this.cur[0] = clamp(this.cur[0] + 1);

    if (input.justPressed("KeyS")) { e.start = [...this.cur] as [number, number]; changed = true; }
    if (input.justPressed("KeyG")) { e.goal = [...this.cur] as [number, number]; changed = true; }
    if (input.justPressed("KeyA")) {
      if (!this.pendingFrom) {
        this.pendingFrom = [...this.cur] as [number, number];
      } else {
        e.spikes.push({ from: this.pendingFrom, to: [...this.cur] as [number, number], speed: SPEED_DEFAULT, on: true });
        this.sel = e.spikes.length - 1;
        this.pendingFrom = null;
        changed = true;
      }
    }
    if (e.spikes.length) {
      if (input.justPressed("Tab")) this.sel = (this.sel + 1) % e.spikes.length;
      if (input.justPressed("Space")) { e.spikes[this.sel].on = !e.spikes[this.sel].on; changed = true; }
      if (input.justPressed("KeyX")) { e.spikes.splice(this.sel, 1); this.sel = 0; changed = true; }
      if (input.justPressed("Minus") || input.justPressed("BracketLeft"))
        { e.spikes[this.sel].speed = Math.max(0, +(e.spikes[this.sel].speed - 0.5).toFixed(1)); changed = true; }
      if (input.justPressed("Equal") || input.justPressed("BracketRight"))
        { e.spikes[this.sel].speed = +(e.spikes[this.sel].speed + 0.5).toFixed(1); changed = true; }
    }
    if (input.justPressed("KeyC")) { this.store.clearMaze(mazeIndex); this.pendingFrom = null; this.sel = 0; }

    if (changed) this.store.save();
    return changed;
  }

  render(ctx: CanvasRenderingContext2D, maze: PlayMaze, mazeIndex: number, xoff: number) {
    const e = this.store.edit(mazeIndex);
    ctx.save();
    ctx.translate(xoff, 0);
    // spikes: path + endpoints
    e.spikes.forEach((sp, i) => {
      const a = cellC(sp.from), b = cellC(sp.to);
      ctx.strokeStyle = sp.on ? (i === this.sel ? PALETTE.yellow : PALETTE.cyan) : PALETTE.border;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      chars.draw(ctx, 0x39, sp.on ? "yellow" : "border", a.x - TILE / 2, a.y - TILE / 2);
      box(ctx, sp.to, sp.on ? PALETTE.cyan : PALETTE.border);
    });
    if (this.pendingFrom) box(ctx, this.pendingFrom, PALETTE.green);
    // start (green) / goal (red) edited markers
    box(ctx, e.start ?? maze.startCell, PALETTE.green);
    box(ctx, e.goal ?? maze.goalCell, PALETTE.red);
    // cursor
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 1;
    ctx.strokeRect(this.cur[0] * TILE + 0.5, this.cur[1] * TILE + 0.5, TILE - 1, TILE - 1);
    ctx.restore();

    // help panel
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, ctx.canvas.width, 34);
    drawText(ctx, 2, 1, "EDIT MAZE " + (mazeIndex + 1), PALETTE.yellow, 1);
    drawText(ctx, 2, 9, "ARROWS MOVE  S START  G GOAL", PALETTE.white, 1);
    drawText(ctx, 2, 17, "A ADD SPIKE(x2)  TAB SEL  SPACE ON", PALETTE.cyan, 1);
    const sel = e.spikes[this.sel];
    const spd = sel ? "SPD " + sel.speed.toFixed(1) : "";
    drawText(ctx, 2, 25, "-/+ SPEED " + spd + "  X DEL  C CLEAR  E EXIT", PALETTE.green, 1);
  }
}

function clamp(v: number) { return Math.max(0, Math.min(MAZE_N - 1, v)); }
function cellC(c: [number, number]) { return { x: c[0] * TILE + TILE / 2, y: c[1] * TILE + TILE / 2 }; }
function box(ctx: CanvasRenderingContext2D, c: [number, number], color: string) {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.strokeRect(c[0] * TILE + 1.5, c[1] * TILE + 1.5, TILE - 3, TILE - 3);
}
