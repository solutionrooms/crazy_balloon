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
  startCell: [number, number];
  goalCell: [number, number];
  start: { x: number; y: number };
  goal: { x: number; y: number };
  /** GOAL is a zone (cell bounds): reaching any cell inside completes the maze. */
  goalZone: { c0: number; r0: number; c1: number; r1: number };
  startBottom: boolean;
  goalBottom: boolean;
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

// Thorns + wall bars are lethal (0x30..0x4F). Space/filler and low marker glyphs are safe.
function isLethal(tile: number): boolean {
  return tile >= 0x30 && tile <= 0x4f;
}

export interface MazeOverride { start?: [number, number]; goal?: [number, number]; }

export function loadMaze(index: number, ov?: MazeOverride): PlayMaze {
  const raw = MAZES[index];
  const startCell = ov?.start ?? raw.start;
  const goalCell = ov?.goal ?? raw.goal;

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
  const clear = (cell: [number, number], drLo = -1, drHi = 1) => {
    const [cc, rr] = cell;
    for (let dr = drLo; dr <= drHi; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const c = cc + dc, r = rr + dr;
        if (c >= 0 && c < MAZE_N && r >= 0 && r < MAZE_N) lethal[r * MAZE_N + c] = 0;
      }
  };
  const midR = (minR + maxR) / 2;
  const startBottom = startCell[1] > midR;
  const goalBottom = goalCell[1] > midR;
  clear(startCell, startBottom ? -3 : -1, startBottom ? 1 : 3);
  clear(goalCell, -2, 2);

  const GZ = 2; // half-size of the goal zone in tiles (5x5)
  const goalZone = {
    c0: Math.max(0, goalCell[0] - GZ), r0: Math.max(0, goalCell[1] - GZ),
    c1: Math.min(MAZE_N - 1, goalCell[0] + GZ), r1: Math.min(MAZE_N - 1, goalCell[1] + GZ),
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
    raw, lethal, mask,
    startCell, goalCell,
    start: ctr(startCell),
    goal: ctr(goalCell),
    goalZone, startBottom, goalBottom,
    bounds: { x0: (minC + 1) * TILE, y0: (minR + 1) * TILE, x1: maxC * TILE, y1: maxR * TILE },
  };
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

/** A moving spike/block: oscillates between cell (fc,fr) and (tc,tr). */
export interface Spike { fc: number; fr: number; tc: number; tr: number; t: number; period: number; }

/** Current pixel centre of a moving spike at its phase. */
export function spikePos(s: Spike): { x: number; y: number } {
  const u = s.period > 0 ? 0.5 - 0.5 * Math.cos((s.t / s.period) * Math.PI * 2) : 0;
  const c = s.fc + (s.tc - s.fc) * u, r = s.fr + (s.tr - s.fr) * u;
  return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
}

/** Pixel-perfect test of a moving spike's thorn pixels against a disc (balloon/box). */
export function spikeHitsDisc(sx: number, sy: number, cx: number, cy: number, r: number): boolean {
  const ox = sx - TILE / 2, oy = sy - TILE / 2;
  const r2 = r * r;
  for (const [px, py] of THORN_PIXELS) {
    const dx = ox + px + 0.5 - cx, dy = oy + py + 0.5 - cy;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
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

export const MAZE_COUNT = MAZES.length;
