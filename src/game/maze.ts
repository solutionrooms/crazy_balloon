import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE, type RomMaze } from "../levels/mazes";
import { TILE } from "../engine/constants";
import { decodeTile } from "../gfx/tiles";
import { GFX1_CHARS } from "../gfx/romTiles";

export const MASK_W = MAZE_N * 8; // 256
export const MASK_H = MAZE_N * 8;

/** A maze prepared for play: lethal map + pixel positions + interior bounds. */
export interface PlayMaze {
  raw: RomMaze;
  lethal: Uint8Array; // MAZE_N*MAZE_N, 1 = lethal cell (start/goal pockets cleared)
  /** Pixel-perfect solid mask (MASK_W*MASK_H): 1 = a lit thorn/wall pixel. */
  mask: Uint8Array;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  /** GOAL is a zone (cell bounds): reaching any cell inside completes the maze. */
  goalZone: { c0: number; r0: number; c1: number; r1: number };
  bounds: { x0: number; y0: number; x1: number; y1: number }; // px, interior
}

// Cache decoded 8x8 glyph bitmaps (ON pixels) per tile index.
const GLYPH_CACHE = new Map<number, Uint8Array>();
function glyph(tile: number): Uint8Array {
  let g = GLYPH_CACHE.get(tile);
  if (!g) { g = decodeTile(GFX1_CHARS, tile); GLYPH_CACHE.set(tile, g); }
  return g;
}

/** ON-pixel offsets of the primary thorn glyph (0x39), for moving spikes. */
export const THORN_PIXELS: Array<[number, number]> = (() => {
  const g = glyph(0x39);
  const out: Array<[number, number]> = [];
  for (let py = 0; py < 8; py++)
    for (let px = 0; px < 8; px++)
      if (g[py * 8 + px]) out.push([px, py]);
  return out;
})();

// Thorns + wall bars are lethal (0x30..0x4F). Space/filler and the low marker
// glyphs (letters/digits of START/GOAL) are safe.
function isLethal(tile: number): boolean {
  return tile >= 0x30 && tile <= 0x4f;
}

export function loadMaze(index: number): PlayMaze {
  const raw = MAZES[index];
  const lethal = new Uint8Array(MAZE_N * MAZE_N);
  let minC = MAZE_N, minR = MAZE_N, maxC = 0, maxR = 0;
  for (let r = 0; r < MAZE_N; r++) {
    for (let c = 0; c < MAZE_N; c++) {
      const t = raw.tiles[r * MAZE_N + c];
      if (t !== SPACE_TILE && t !== FILLER_TILE) {
        if (c < minC) minC = c; if (c > maxC) maxC = c;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
      lethal[r * MAZE_N + c] = isLethal(t) ? 1 : 0;
    }
  }
  // Clear a small pocket around START/GOAL so the balloon can spawn/finish there.
  const clear = (cell: [number, number], drLo = -1, drHi = 1) => {
    const [cc, rr] = cell;
    for (let dr = drLo; dr <= drHi; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const c = cc + dc, r = rr + dr;
        if (c >= 0 && c < MAZE_N && r >= 0 && r < MAZE_N) lethal[r * MAZE_N + c] = 0;
      }
  };
  clear(raw.start, -1, 3); // extra room below START for the string + box (whole-rig collision)
  clear(raw.goal);

  // GOAL zone: a square around the GOAL marker. Reaching any cell inside wins.
  const GZ = 2; // half-size in tiles (5x5 square)
  const goalZone = {
    c0: Math.max(0, raw.goal[0] - GZ), r0: Math.max(0, raw.goal[1] - GZ),
    c1: Math.min(MAZE_N - 1, raw.goal[0] + GZ), r1: Math.min(MAZE_N - 1, raw.goal[1] + GZ),
  };

  // Build the pixel-perfect solid mask from each lethal cell's actual glyph pixels.
  const mask = new Uint8Array(MASK_W * MASK_H);
  for (let r = 0; r < MAZE_N; r++) {
    for (let c = 0; c < MAZE_N; c++) {
      if (!lethal[r * MAZE_N + c]) continue;
      const g = glyph(raw.tiles[r * MAZE_N + c]);
      const ox = c * 8, oy = r * 8;
      for (let py = 0; py < 8; py++)
        for (let px = 0; px < 8; px++)
          if (g[py * 8 + px]) mask[(oy + py) * MASK_W + (ox + px)] = 1;
    }
  }

  const ctr = (cell: [number, number]) => ({ x: cell[0] * TILE + TILE / 2, y: cell[1] * TILE + TILE / 2 });
  return {
    raw,
    lethal,
    mask,
    start: ctr(raw.start),
    goal: ctr(raw.goal),
    goalZone,
    // keep the balloon just inside the border rectangle
    bounds: { x0: (minC + 1) * TILE, y0: (minR + 1) * TILE, x1: (maxC) * TILE, y1: (maxR) * TILE },
  };
}

/** Clear a small pocket of lethal cells around a pixel position (spawn safety). */
export function clearAround(maze: PlayMaze, px: number, py: number, rc = 1, rr = 1) {
  const cc = Math.floor(px / TILE), cr = Math.floor(py / TILE);
  for (let dr = -rr; dr <= rr; dr++)
    for (let dc = -rc; dc <= rc; dc++) {
      const c = cc + dc, r = cr + dr;
      if (c >= 0 && c < MAZE_N && r >= 0 && r < MAZE_N) maze.lethal[r * MAZE_N + c] = 0;
    }
}

/** Is the solid (lethal) pixel mask set at pixel (x,y)? */
export function maskAt(maze: PlayMaze, x: number, y: number): boolean {
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || xi >= MASK_W || yi < 0 || yi >= MASK_H) return false;
  return maze.mask[yi * MASK_W + xi] === 1;
}

/** Pixel-perfect disc test: any solid pixel inside the circle (balloon/box). */
export function balloonHits(maze: PlayMaze, cx: number, cy: number, r: number): boolean {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MASK_W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(MASK_H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const row = y * MASK_W;
    for (let x = x0; x <= x1; x++) {
      if (!maze.mask[row + x]) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) return true;
    }
  }
  return false;
}

/** Pixel-perfect thin-line test for the string: any solid pixel on the segment. */
export function segmentHits(maze: PlayMaze, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (maskAt(maze, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
  }
  return false;
}

/** Pixel-perfect test of a moving spike's thorn pixels against a disc (balloon/box). */
export function spikeHitsDisc(sx: number, sy: number, cx: number, cy: number, r: number): boolean {
  const ox = sx - TILE / 2, oy = sy - TILE / 2; // spike glyph top-left
  const r2 = r * r;
  for (const [px, py] of THORN_PIXELS) {
    const dx = ox + px + 0.5 - cx, dy = oy + py + 0.5 - cy;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

export const MAZE_COUNT = MAZES.length;

/** A thorn that oscillates horizontally between cols c0..c1 on row r. */
export interface Spike {
  r: number; c0: number; c1: number; t: number; period: number;
}

/** Deterministically place `count` moving spikes in roomy open horizontal runs,
 * away from START/GOAL. Returns [] for count<=0. */
export function genSpikes(maze: PlayMaze, count: number, speedCellsPerSec: number): Spike[] {
  if (count <= 0) return [];
  const { lethal } = maze;
  const sCell = maze.raw.start, gCell = maze.raw.goal;
  const far = (c: number, r: number) =>
    Math.abs(c - sCell[0]) + Math.abs(r - sCell[1]) > 3 &&
    Math.abs(c - gCell[0]) + Math.abs(r - gCell[1]) > 3;

  const runs: Array<{ r: number; c0: number; c1: number }> = [];
  for (let r = 2; r < MAZE_N - 2; r++) {
    let c = 0;
    while (c < MAZE_N) {
      if (lethal[r * MAZE_N + c]) { c++; continue; }
      let e = c;
      while (e < MAZE_N && !lethal[r * MAZE_N + e]) e++;
      if (e - c >= 5 && far(c, r) && far(e - 1, r)) {
        runs.push({ r, c0: c + 1, c1: e - 2 }); // keep 1-cell pad from walls
      }
      c = e;
    }
  }
  // spread picks across the run list deterministically
  const spikes: Spike[] = [];
  for (let i = 0; i < count && runs.length; i++) {
    const run = runs[Math.floor((i * 0.618 + 0.13) * runs.length) % runs.length];
    const span = Math.max(2, run.c1 - run.c0);
    const period = (span / speedCellsPerSec) * 2; // there-and-back
    spikes.push({ r: run.r, c0: run.c0, c1: run.c0 + span, t: i * 0.4, period });
  }
  return spikes;
}

/** Current pixel centre of a moving spike at its phase. */
export function spikePos(s: Spike): { x: number; y: number } {
  const u = 0.5 - 0.5 * Math.cos((s.t / s.period) * Math.PI * 2);
  const col = s.c0 + (s.c1 - s.c0) * u;
  return { x: col * TILE + TILE / 2, y: s.r * TILE + TILE / 2 };
}
