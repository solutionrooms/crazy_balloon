import {
  SCREEN_W, SCREEN_H, TILE, CROP_LEFT_COLS, GOAL_BONUS, PROGRESS_POINTS,
  PALETTE, EXTRA_LIFE_SCORE, READY_SEC,
  SWING_AMP_PER_LOOP, MOVE_SPEED_PER_LOOP, SPIKE_SPEED_BASE, type ColorName,
} from "../engine/constants";
import { chars } from "../gfx/tiles";
import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE } from "../levels/mazes";
import {
  loadMaze, balloonHits, genSpikes, spikePos, MAZE_COUNT,
  type PlayMaze, type Spike,
} from "./maze";
import { Input } from "./input";
import { Audio } from "./audio";
import { Settings } from "./settings";
import { drawText, textWidth } from "./font";

type State = "title" | "ready" | "play" | "clear" | "dead" | "gameover";
const XOFF = -CROP_LEFT_COLS * TILE; // render translate for the visible window

// Settings-menu layout (shared by render + pointer hit-testing).
const MENU_Y0 = 46, MENU_ROWH = 16, MENU_MINUS = 150, MENU_VAL = 164, MENU_PLUS = 196;

// Crazy Balloon color-RAM palette index (low nibble) -> our colour. Derived from
// the ROM colour data + the arcade reference (1=cyan thorns, 2=magenta, 5/6=green,
// 4=red goal). Tunable as we compare against the original.
const COLOR_PALETTE: ColorName[] = [
  "cyan",    // 0
  "cyan",    // 1  cyan thorns (most of the maze)
  "magenta", // 2  magenta thorns
  "magenta", // 3
  "red",     // 4
  "green",   // 5  green thorns + START bar
  "red",     // 6  GOAL bar
  "yellow",  // 7
  "white",   // 8
  "white",   // 9
  "white", "white", "white", "white", "white", "white", // 10-15
];

export class Game {
  private state: State = "title";
  private level = 0;                  // maze index 0..2
  private stage = 1;                  // overall level number (1+)
  private loop = 0;                   // completed passes through the 3 mazes
  private score = 0;
  private hi = 0;
  private lives = 3;
  private extraLifeGiven = false;

  private maze!: PlayMaze;
  private spikes: Spike[] = [];
  private visited = new Set<number>();
  private px = 0; private py = 0;     // anchor (player-controlled) position
  private phase = 0;                  // swing phase
  private timer = 0;                  // state transition timer
  private beepCooldown = 0;
  private paused = false;
  private menu = false;               // settings overlay open
  private menuIndex = 0;

  constructor(private input: Input, private audio: Audio, private settings: Settings) {
    this.stage = 1;
    this.loadStage();
    this.state = "title";
  }

  private s(key: string) { return this.settings.get(key); }
  private theme() { return MAZES[this.level].theme; }
  private radius() { return this.s("balloonSize"); }

  /** Set up the current stage: pick maze, scale difficulty, place spikes,
   * then show the "LET'S ATTACK" interstitial. */
  private loadStage() {
    this.loop = Math.floor((this.stage - 1) / MAZE_COUNT);
    this.level = (this.stage - 1) % MAZE_COUNT;
    this.maze = loadMaze(this.level);
    const spikeCount = this.loop <= 0 ? 0 : 1 + this.loop;
    this.spikes = genSpikes(this.maze, spikeCount, SPIKE_SPEED_BASE + this.loop * 0.4);
    this.visited.clear();
    this.spawn();
    this.state = "ready";
    this.timer = READY_SEC;
  }

  private spawn() {
    // Spawn at the authentic START marker (loadMaze already cleared a safe
    // pocket around it). No nudging — that caused instant-pop in tight mazes.
    this.px = this.maze.start.x;
    this.py = this.maze.start.y;
    this.phase = 0;
  }

  private swingAmp() { return this.s("swingAmp") + this.loop * SWING_AMP_PER_LOOP; }
  private moveSpeed() { return this.s("moveSpeed") + this.loop * MOVE_SPEED_PER_LOOP; }

  /** Balloon swings as a pendulum on a string of length L from the box below it,
   * tracing an arc (and dipping at the extremes) rather than a flat line. The
   * control point (px,py) is the rest position (top of the arc). */
  private balloonPos() {
    const L = this.s("stringLen");
    // tilt from amplitude/string length, hard-capped at 45 degrees each way
    const thetaMax = Math.min(Math.PI / 4, Math.asin(Math.min(0.98, this.swingAmp() / Math.max(1, L))));
    const theta = thetaMax * Math.sin((this.phase / this.s("swingPeriod")) * Math.PI * 2);
    return { x: this.px + L * Math.sin(theta), y: this.py + L * (1 - Math.cos(theta)) };
  }

  // ---------------- update ----------------
  update(dt: number) {
    if (this.input.justPressed("KeyM")) this.audio.toggleMute();
    if (this.input.justPressed("KeyO")) { this.menu = !this.menu; this.audio.unlock(); }
    if (this.menu) { this.updateMenu(); this.input.endFrame(); return; }
    if (this.input.justPressed("KeyP") && this.state === "play") this.paused = !this.paused;
    if (this.paused && this.state === "play") { this.input.endFrame(); return; }

    switch (this.state) {
      case "title":
        if (this.input.justPressed("Space")) this.begin();
        break;
      case "ready":
        this.timer -= dt;
        if (this.timer <= 0) { this.state = "play"; this.audio.mazeStart(); }
        break;
      case "play":
        this.updatePlay(dt);
        break;
      case "clear":
        this.timer -= dt;
        if (this.timer <= 0) { this.stage += 1; this.loadStage(); }
        break;
      case "dead":
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.lives <= 0) { this.state = "gameover"; this.timer = 0; }
          else { this.spawn(); this.state = "play"; }
        }
        break;
      case "gameover":
        if (this.input.justPressed("Space")) this.begin();
        break;
    }
    this.input.endFrame();
  }

  private updateMenu() {
    const n = this.settings.defs.length;
    if (this.input.justPressed("ArrowUp") || this.input.justPressed("KeyW"))
      this.menuIndex = (this.menuIndex - 1 + n) % n;
    if (this.input.justPressed("ArrowDown") || this.input.justPressed("KeyS"))
      this.menuIndex = (this.menuIndex + 1) % n;
    if (this.input.justPressed("ArrowLeft") || this.input.justPressed("KeyA"))
      this.settings.adjust(this.menuIndex, -1);
    if (this.input.justPressed("ArrowRight") || this.input.justPressed("KeyD"))
      this.settings.adjust(this.menuIndex, +1);
    if (this.input.justPressed("KeyR")) this.settings.resetAll();
    if (this.input.justPressed("Escape")) this.menu = false;
  }

  begin() {
    this.audio.unlock();
    this.score = 0;
    this.lives = this.s("startLives");
    this.extraLifeGiven = false;
    this.stage = 1;
    this.loadStage(); // -> "ready" interstitial
  }

  /** Toggle the settings menu (used by the on-screen gear button). */
  toggleMenu() { this.menu = !this.menu; this.audio.unlock(); }

  /** Debug/screenshot helper: jump straight into play at a given stage + phase. */
  debugPlay(phase = 0, stage = 1) {
    this.begin();
    this.stage = stage;
    this.loadStage();
    this.state = "play";
    this.phase = phase;
  }

  /** Pointer (mouse/touch) in internal canvas coords — drives the menu. */
  handlePointer(x: number, y: number) {
    if (!this.menu) return;
    const n = this.settings.defs.length;
    const row = Math.floor((y - MENU_Y0 + 6) / MENU_ROWH);
    if (row >= 0 && row < n) {
      this.menuIndex = row;
      if (x >= MENU_MINUS - 8 && x <= MENU_MINUS + 12) this.settings.adjust(row, -1);
      else if (x >= MENU_PLUS - 6 && x <= MENU_PLUS + 14) this.settings.adjust(row, +1);
    }
  }

  private updatePlay(dt: number) {
    const d = this.input.dir();
    const moving = d.x !== 0 || d.y !== 0;
    if (moving) {
      const mag = Math.hypot(d.x, d.y) || 1; // normalize so diagonals aren't faster
      this.px += (d.x / mag) * this.moveSpeed() * dt;
      this.py += (d.y / mag) * this.moveSpeed() * dt;
    }
    const b = this.maze.bounds;
    this.px = Math.max(b.x0, Math.min(b.x1, this.px));
    this.py = Math.max(b.y0, Math.min(b.y1, this.py));
    this.phase += dt;

    const cell = Math.floor(this.py / TILE) * MAZE_N + Math.floor(this.px / TILE);
    if (!this.visited.has(cell)) { this.visited.add(cell); this.score += PROGRESS_POINTS; }

    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_SCORE) {
      this.extraLifeGiven = true;
      this.lives += 1;
      this.audio.goal();
    }

    const r = this.radius();
    const bp = this.balloonPos();
    for (const sp of this.spikes) {
      sp.t += dt;
      const p = spikePos(sp);
      if (Math.hypot(bp.x - p.x, bp.y - p.y) < r + 3) { this.die(); return; }
    }
    if (balloonHits(this.maze, bp.x, bp.y, r)) { this.die(); return; }

    const gx = this.maze.goal.x, gy = this.maze.goal.y;
    const gd = Math.hypot(bp.x - gx, bp.y - gy);
    this.beepCooldown -= dt;
    if (gd < TILE * 5 && this.beepCooldown <= 0) {
      this.audio.beep();
      this.beepCooldown = 0.12 + (gd / (TILE * 5)) * 0.5;
    }
    if (gd < TILE * 1.1) {
      this.score += GOAL_BONUS;
      if (this.score > this.hi) this.hi = this.score;
      this.audio.goal();
      this.state = "clear";
      this.timer = 1.4;
    }
  }

  private die() {
    this.audio.pop();
    this.audio.loss();
    this.lives -= 1;
    if (this.score > this.hi) this.hi = this.score;
    this.state = "dead";
    this.timer = 1.0;
  }

  // ---------------- render ----------------
  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    if (this.state !== "title" && this.state !== "gameover") {
      ctx.save();
      ctx.translate(XOFF, 0);
      this.drawMaze(ctx);
      this.drawSpikes(ctx);
      if (this.state === "play" || this.state === "dead") this.drawBalloon(ctx);
      ctx.restore();
    }
    this.drawHud(ctx);
    this.drawOverlays(ctx);
    if (this.menu) this.drawMenu(ctx);
  }

  private drawMaze(ctx: CanvasRenderingContext2D) {
    const m = this.maze.raw;
    for (let r = 0; r < MAZE_N; r++) {
      for (let c = 0; c < MAZE_N; c++) {
        const i = r * MAZE_N + c;
        const t = m.tiles[i];
        if (t === SPACE_TILE || t === FILLER_TILE) continue;
        const color = COLOR_PALETTE[m.colors[i]] ?? this.theme();
        chars.draw(ctx, t, color, c * TILE, r * TILE);
      }
    }
  }

  private drawSpikes(ctx: CanvasRenderingContext2D) {
    for (const sp of this.spikes) {
      const p = spikePos(sp);
      chars.draw(ctx, 0x39, "yellow", Math.round(p.x - TILE / 2), Math.round(p.y - TILE / 2));
    }
  }

  private drawBalloon(ctx: CanvasRenderingContext2D) {
    const bp = this.balloonPos();
    const boxX = Math.round(this.px);
    const boxY = Math.round(this.py + this.s("stringLen")); // pivot/handle below
    // string from balloon down to the box
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(bp.x) + 0.5, Math.round(bp.y) + 0.5);
    ctx.lineTo(boxX + 0.5, boxY + 0.5);
    ctx.stroke();
    // box (the player's handle / anchor)
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(boxX - 1, boxY - 1, 3, 3);
    // balloon
    ctx.fillStyle = PALETTE.red;
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, this.radius() + 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    drawText(ctx, 2, 1, "1UP", PALETTE.green, 1);
    drawText(ctx, 2, 9, pad(this.score, 6), PALETTE.white, 1);
    const hi = "HI " + pad(this.hi, 6);
    drawText(ctx, SCREEN_W - textWidth(hi, 1) - 2, 1, hi, PALETTE.cyan, 1);
    drawText(ctx, SCREEN_W - textWidth("LV" + this.stage, 1) - 2, 9, "LV" + this.stage, PALETTE.magenta, 1);
    for (let i = 0; i < this.lives; i++) {
      ctx.fillStyle = PALETTE.red;
      ctx.beginPath();
      ctx.arc(5 + i * 7, SCREEN_H - 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawOverlays(ctx: CanvasRenderingContext2D) {
    const center = (text: string, y: number, color: string, scale = 2) =>
      drawText(ctx, (SCREEN_W - textWidth(text, scale)) / 2, y, text, color, scale);
    if (this.state === "title") {
      center("CRAZY", 64, PALETTE.cyan, 3);
      center("BALLOON", 94, PALETTE.magenta, 3);
      center("PRESS SPACE", 150, PALETTE.white, 1);
      center("ARROWS WASD TO MOVE", 165, PALETTE.green, 1);
      center("O FOR SETTINGS", 180, PALETTE.yellow, 1);
    } else if (this.state === "ready") {
      center("LETS ATTACK !", 96, PALETTE.yellow, 2);
      center("PLAYER 1", 120, PALETTE.cyan, 1);
      center("LEVEL " + this.stage, 134, PALETTE.green, 1);
    } else if (this.state === "clear") {
      center("MAZE CLEAR", 120, PALETTE.yellow, 2);
    } else if (this.state === "dead") {
      center("POP !", 120, PALETTE.yellow, 2);
    } else if (this.state === "gameover") {
      center("GAME", 90, PALETTE.red, 3);
      center("OVER", 120, PALETTE.red, 3);
      center("SCORE " + pad(this.score, 6), 160, PALETTE.white, 1);
      center("PRESS SPACE", 180, PALETTE.cyan, 1);
    }
    if (this.paused && this.state === "play") center("PAUSED", 120, PALETTE.white, 2);
    if (this.audio.isMuted) drawText(ctx, SCREEN_W - textWidth("MUTE", 1) - 2, SCREEN_H - 7, "MUTE", PALETTE.border, 1);
  }

  private drawMenu(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#05080a";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    drawText(ctx, (SCREEN_W - textWidth("SETTINGS", 2)) / 2, 16, "SETTINGS", PALETTE.cyan, 2);
    this.settings.defs.forEach((def, i) => {
      const y = MENU_Y0 + i * MENU_ROWH;
      const sel = i === this.menuIndex;
      if (sel) {
        ctx.fillStyle = "#0a2a30";
        ctx.fillRect(4, y - 3, SCREEN_W - 8, MENU_ROWH - 3);
      }
      drawText(ctx, 8, y, def.label, sel ? PALETTE.yellow : PALETTE.white, 1);
      drawText(ctx, MENU_MINUS, y, "<", sel ? PALETTE.yellow : PALETTE.cyan, 1);
      drawText(ctx, MENU_VAL, y, this.settings.display(i).padStart(5), sel ? PALETTE.green : PALETTE.cyan, 1);
      drawText(ctx, MENU_PLUS, y, ">", sel ? PALETTE.yellow : PALETTE.cyan, 1);
    });
    const foot = MENU_Y0 + this.settings.defs.length * MENU_ROWH + 8;
    const hint = (t: string, y: number) => drawText(ctx, (SCREEN_W - textWidth(t, 1)) / 2, y, t, PALETTE.border, 1);
    hint("UP/DOWN SELECT", foot);
    hint("LEFT/RIGHT CHANGE", foot + 10);
    hint("R RESET   O CLOSE", foot + 20);
  }
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}
