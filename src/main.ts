import "./style.css";
import { createDisplay } from "./engine/canvas";
import { startLoop } from "./engine/loop";
import { SCREEN_W, SCREEN_H, TILE, COLS } from "./engine/constants";
import { chars } from "./gfx/tiles";
import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE } from "./levels/mazes";

const app = document.getElementById("app")!;
const { ctx } = createDisplay(app);

// Show maze 0 for now (the level-1 / attract layout). 32-wide portrait grid;
// crop 4 overscan columns to the 28 visible. Tunable until it lines up.
let mazeIndex = 0;
const CROP_LEFT = 2; // drop 2 columns each side (32 -> 28 visible)

function drawMaze(idx: number) {
  const maze = MAZES[idx];
  for (let r = 0; r < MAZE_N; r++) {
    for (let c = 0; c < MAZE_N; c++) {
      const t = maze.tiles[r * MAZE_N + c];
      if (t === SPACE_TILE || t === FILLER_TILE) continue;
      const x = (c - CROP_LEFT) * TILE;
      if (x < 0 || x >= SCREEN_W) continue;
      chars.draw(ctx, t, maze.theme, x, r * TILE);
    }
  }
  // start (green) / goal (red) cell markers
  const mark = (cell: [number, number], color: string) => {
    const [c, r] = cell;
    ctx.fillStyle = color;
    ctx.fillRect((c - CROP_LEFT) * TILE + 2, r * TILE + 2, TILE - 4, TILE - 4);
  };
  mark(maze.goal, "#ff2020");
  mark(maze.start, "#36e000");
}

// Cycle mazes every few seconds so all three are visible.
let t = 0;
function update(dt: number) {
  t += dt;
  mazeIndex = Math.floor(t / 2.5) % MAZES.length;
}

function render() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawMaze(mazeIndex);
  // tiny index label dots top-left
  for (let i = 0; i < MAZES.length; i++) {
    ctx.fillStyle = i === mazeIndex ? "#ffe000" : "#444";
    ctx.fillRect(2 + i * 5, 2, 3, 3);
  }
  void COLS;
}

startLoop(update, render);
