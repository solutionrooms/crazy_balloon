import {
  SCREEN_W, SCREEN_H, TILE, CROP_LEFT_COLS, BALLOON_RADIUS, SWING_AMPLITUDE_PX,
  SWING_PERIOD_SEC, MOVE_SPEED_PX, START_LIVES, GOAL_BONUS, PROGRESS_POINTS,
  BLOWER_IDLE_SEC, BLOWER_PUSH_PX, PALETTE, EXTRA_LIFE_SCORE, READY_SEC,
  SWING_AMP_PER_LOOP, MOVE_SPEED_PER_LOOP, SPIKE_SPEED_BASE,
} from "../engine/constants";
import { chars } from "../gfx/tiles";
import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE } from "../levels/mazes";
import {
  loadMaze, balloonHits, genSpikes, spikePos, MAZE_COUNT,
  type PlayMaze, type Spike,
} from "./maze";
import { Input } from "./input";
import { Audio } from "./audio";
import { drawText, textWidth } from "./font";

type State = "title" | "ready" | "play" | "clear" | "dead" | "gameover";
const XOFF = -CROP_LEFT_COLS * TILE; // render translate for the visible window

export class Game {
  private state: State = "title";
  private level = 0;                  // maze index 0..2
  private stage = 1;                  // overall level number (1+)
  private score = 0;
  private hi = 0;
  private lives = START_LIVES;
  private extraLifeGiven = false;

  private maze!: PlayMaze;
  private spikes: Spike[] = [];
  private swingAmp = SWING_AMPLITUDE_PX;
  private moveSpeed = MOVE_SPEED_PX;
  private visited = new Set<number>();
  private px = 0; private py = 0;     // anchor (player-controlled) position
  private phase = 0;                  // swing phase
  private idle = 0;                   // idle seconds (for blower)
  private timer = 0;                  // state transition timer
  private blowing = false;
  private beepCooldown = 0;
  private paused = false;

  constructor(private input: Input, private audio: Audio) {
    this.stage = 1;
    this.loadStage();
    this.state = "title";
  }

  private theme() { return MAZES[this.level].theme; }

  /** Set up the current stage: pick maze, scale difficulty, place spikes,
   * then show the "LET'S ATTACK" interstitial. */
  private loadStage() {
    const loop = Math.floor((this.stage - 1) / MAZE_COUNT);
    this.level = (this.stage - 1) % MAZE_COUNT;
    this.maze = loadMaze(this.level);
    this.swingAmp = SWING_AMPLITUDE_PX + loop * SWING_AMP_PER_LOOP;
    this.moveSpeed = MOVE_SPEED_PX + loop * MOVE_SPEED_PER_LOOP;
    const spikeCount = loop <= 0 ? 0 : 1 + loop;
    this.spikes = genSpikes(this.maze, spikeCount, SPIKE_SPEED_BASE + loop * 0.4);
    this.visited.clear();
    this.spawn();
    this.state = "ready";
    this.timer = READY_SEC;
  }

  private spawn() {
    this.px = this.maze.start.x;
    this.py = this.maze.start.y;
    this.phase = 0;
    this.idle = 0;
    this.blowing = false;
  }

  private balloonPos() {
    const sx = Math.sin((this.phase / SWING_PERIOD_SEC) * Math.PI * 2) * this.swingAmp;
    return { x: this.px + sx, y: this.py };
  }

  update(dt: number) {
    if (this.input.justPressed("KeyM")) this.audio.toggleMute();
    if (this.input.justPressed("KeyP") && this.state === "play") this.paused = !this.paused;
    if (this.paused && this.state === "play") { this.input.endFrame(); return; }
    switch (this.state) {
      case "title":
        if (this.input.justPressed("Space")) { this.begin(); }
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
        if (this.input.justPressed("Space")) { this.begin(); }
        break;
    }
    this.input.endFrame();
  }

  begin() {
    this.audio.unlock();
    this.score = 0;
    this.lives = START_LIVES;
    this.extraLifeGiven = false;
    this.stage = 1;
    this.loadStage(); // -> "ready" interstitial
  }

  private updatePlay(dt: number) {
    const d = this.input.dir();
    const moving = d.x !== 0 || d.y !== 0;
    if (moving) {
      this.px += d.x * this.moveSpeed * dt;
      this.py += d.y * this.moveSpeed * dt;
      this.idle = 0;
      this.blowing = false;
    } else {
      this.idle += dt;
      if (this.idle > BLOWER_IDLE_SEC) {
        if (!this.blowing) this.audio.blower();
        this.blowing = true;
        this.py += BLOWER_PUSH_PX * dt; // blower nudges the balloon downward into danger
      }
    }
    // keep anchor inside the playfield interior
    const b = this.maze.bounds;
    this.px = Math.max(b.x0, Math.min(b.x1, this.px));
    this.py = Math.max(b.y0, Math.min(b.y1, this.py));

    this.phase += dt;

    // score progress for each newly-entered cell
    const cell = Math.floor(this.py / TILE) * MAZE_N + Math.floor(this.px / TILE);
    if (!this.visited.has(cell)) { this.visited.add(cell); this.score += PROGRESS_POINTS; }

    // award the extra balloon once
    if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_SCORE) {
      this.extraLifeGiven = true;
      this.lives += 1;
      this.audio.goal();
    }

    // animate moving spikes and test them too
    const bp = this.balloonPos();
    for (const s of this.spikes) {
      s.t += dt;
      const sp = spikePos(s);
      if (Math.hypot(bp.x - sp.x, bp.y - sp.y) < BALLOON_RADIUS + 3) { this.die(); return; }
    }
    if (balloonHits(this.maze, bp.x, bp.y, BALLOON_RADIUS)) {
      this.die();
      return;
    }
    // reached goal? (with proximity beeping as you approach)
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
  }

  private drawMaze(ctx: CanvasRenderingContext2D) {
    const m = this.maze.raw;
    const theme = this.theme();
    for (let r = 0; r < MAZE_N; r++) {
      for (let c = 0; c < MAZE_N; c++) {
        const t = m.tiles[r * MAZE_N + c];
        if (t === SPACE_TILE || t === FILLER_TILE) continue;
        chars.draw(ctx, t, theme, c * TILE, r * TILE);
      }
    }
  }

  private drawSpikes(ctx: CanvasRenderingContext2D) {
    for (const s of this.spikes) {
      const sp = spikePos(s);
      // draw the thorn glyph centred on the spike position, tinted yellow as a hazard
      chars.draw(ctx, 0x39, "yellow", Math.round(sp.x - TILE / 2), Math.round(sp.y - TILE / 2));
    }
  }

  private drawBalloon(ctx: CanvasRenderingContext2D) {
    const bp = this.balloonPos();
    // tether + anchor box
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(bp.x) + 0.5, Math.round(bp.y) + 0.5);
    ctx.lineTo(Math.round(this.px) + 0.5, Math.round(this.py + 6) + 0.5);
    ctx.stroke();
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(Math.round(this.px) - 1, Math.round(this.py + 6), 3, 3);
    // balloon
    ctx.fillStyle = this.blowing ? PALETTE.yellow : PALETTE.red;
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, BALLOON_RADIUS + 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    drawText(ctx, 2, 1, "1UP", PALETTE.green, 1);
    drawText(ctx, 2, 9, pad(this.score, 6), PALETTE.white, 1);
    const hi = "HI " + pad(this.hi, 6);
    drawText(ctx, SCREEN_W - textWidth(hi, 1) - 2, 1, hi, PALETTE.cyan, 1);
    drawText(ctx, SCREEN_W - textWidth("LV" + this.stage, 1) - 2, 9,
      "LV" + this.stage, PALETTE.magenta, 1);
    // lives as small balloon dots, bottom-left
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
      center("CRAZY", 70, PALETTE.cyan, 3);
      center("BALLOON", 100, PALETTE.magenta, 3);
      center("PRESS SPACE", 160, PALETTE.white, 1);
      center("ARROWS WASD TO MOVE", 175, PALETTE.green, 1);
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
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}
