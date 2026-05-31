import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE, type RomMaze } from "../levels/mazes";
import { TILE } from "../engine/constants";

/** A maze prepared for play: lethal map + pixel positions + interior bounds. */
export interface PlayMaze {
  raw: RomMaze;
  lethal: Uint8Array; // MAZE_N*MAZE_N, 1 = pops the balloon
  start: { x: number; y: number };
  goal: { x: number; y: number };
  /** GOAL is a zone (cell bounds): reaching any cell inside completes the maze. */
  goalZone: { c0: number; r0: number; c1: number; r1: number };
  bounds: { x0: number; y0: number; x1: number; y1: number }; // px, interior
}

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
  const clear = (cell: [number, number]) => {
    const [cc, rr] = cell;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const c = cc + dc, r = rr + dr;
        if (c >= 0 && c < MAZE_N && r >= 0 && r < MAZE_N) lethal[r * MAZE_N + c] = 0;
      }
  };
  clear(raw.start);
  clear(raw.goal);

  // GOAL zone: a square around the GOAL marker. Reaching any cell inside wins.
  const GZ = 2; // half-size in tiles (5x5 square)
  const goalZone = {
    c0: Math.max(0, raw.goal[0] - GZ), r0: Math.max(0, raw.goal[1] - GZ),
    c1: Math.min(MAZE_N - 1, raw.goal[0] + GZ), r1: Math.min(MAZE_N - 1, raw.goal[1] + GZ),
  };

  const ctr = (cell: [number, number]) => ({ x: cell[0] * TILE + TILE / 2, y: cell[1] * TILE + TILE / 2 });
  return {
    raw,
    lethal,
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

/** Circle-vs-lethal-tiles test for the balloon. */
export function balloonHits(maze: PlayMaze, cx: number, cy: number, r: number): boolean {
  const c0 = Math.max(0, Math.floor((cx - r) / TILE));
  const c1 = Math.min(MAZE_N - 1, Math.floor((cx + r) / TILE));
  const r0 = Math.max(0, Math.floor((cy - r) / TILE));
  const r1 = Math.min(MAZE_N - 1, Math.floor((cy + r) / TILE));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!maze.lethal[row * MAZE_N + col]) continue;
      // closest point on the tile square to the circle centre
      const nx = Math.max(col * TILE, Math.min(cx, col * TILE + TILE));
      const ny = Math.max(row * TILE, Math.min(cy, row * TILE + TILE));
      const dx = cx - nx, dy = cy - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
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
