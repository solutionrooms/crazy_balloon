import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE, type RomMaze } from "../levels/mazes";
import { TILE } from "../engine/constants";

/** A maze prepared for play: lethal map + pixel positions + interior bounds. */
export interface PlayMaze {
  raw: RomMaze;
  lethal: Uint8Array; // MAZE_N*MAZE_N, 1 = pops the balloon
  start: { x: number; y: number };
  goal: { x: number; y: number };
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

  const ctr = (cell: [number, number]) => ({ x: cell[0] * TILE + TILE / 2, y: cell[1] * TILE + TILE / 2 });
  return {
    raw,
    lethal,
    start: ctr(raw.start),
    goal: ctr(raw.goal),
    // keep the balloon just inside the border rectangle
    bounds: { x0: (minC + 1) * TILE, y0: (minR + 1) * TILE, x1: (maxC) * TILE, y1: (maxR) * TILE },
  };
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
