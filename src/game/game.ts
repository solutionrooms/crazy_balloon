import {
  SCREEN_W, SCREEN_H, TILE, CROP_LEFT_COLS, GOAL_BONUS, PROGRESS_POINTS,
  PALETTE, COLOR_PALETTE, EXTRA_LIFE_SCORE, READY_SEC,
  SWING_AMP_PER_LOOP, MOVE_SPEED_PER_LOOP,
} from "../engine/constants";
import { chars } from "../gfx/tiles";
import { MAZES, MAZE_N, SPACE_TILE, FILLER_TILE } from "../levels/mazes";
import {
  loadMaze, balloonHits, segmentHits, spikeHitsDisc, spikePos, MAZE_COUNT,
  type PlayMaze, type Spike,
} from "./maze";
import { Input } from "./input";
import { Audio } from "./audio";
import { Settings } from "./settings";
import { Store, Editor, type EditSpike, type MazeEdit } from "./editor";
import { Net, type NetMsg } from "../net/net";
import { drawText, textWidth } from "./font";

type State = "title" | "ready" | "play" | "clear" | "dead" | "gameover";
const XOFF = -CROP_LEFT_COLS * TILE; // render translate for the visible window

interface RaceState {
  net: Net;
  role: "host" | "join";
  remote: { x: number; y: number; bx: number; by: number } | null; // latest received
  shown: { x: number; y: number; bx: number; by: number } | null;  // eased for render
  sendAcc: number;   // throttle accumulator
  remoteFin: number; // race ms when peer finished (0 = still racing)
  localFin: number;
  result: "" | "win" | "lose";
  counting: boolean;
  countdown: number;
  live: boolean;
  raceMs: number;
}

// Settings-menu layout (shared by render + pointer hit-testing).
const MENU_Y0 = 46, MENU_ROWH = 16, MENU_MINUS = 150, MENU_VAL = 164, MENU_PLUS = 196;

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
  private goalArmed = false;          // must leave the goal zone before it can win
  private race: RaceState | null = null;
  private paused = false;
  private menu = false;               // settings overlay open
  private menuIndex = 0;

  constructor(
    private input: Input, private audio: Audio, private settings: Settings,
    private store: Store, private editor: Editor,
  ) {
    this.hi = store.hiScore;
    this.stage = 1;
    this.loadStage();
    this.state = "title";
  }

  private toSpike(es: EditSpike): Spike {
    const to = es.to ?? es.cell; // static spike: end = start
    const dist = Math.hypot(to[0] - es.cell[0], to[1] - es.cell[1]);
    return {
      fc: es.cell[0], fr: es.cell[1], tc: to[0], tr: to[1], t: 0,
      period: es.to && es.speed > 0 ? (2 * dist) / es.speed : 0,
      color: COLOR_PALETTE[es.color] ?? "yellow",
    };
  }

  private s(key: string) {
    const o = this.store.edit(this.level).options; // per-level override wins
    return o[key] !== undefined ? o[key] : this.settings.get(key);
  }
  private theme() { return MAZES[this.level].theme; }
  private radius() { return this.s("balloonSize"); }

  /** Set up the current stage: pick maze, scale difficulty, place spikes,
   * then show the "LET'S ATTACK" interstitial. */
  private loadStage() {
    this.loop = Math.floor((this.stage - 1) / MAZE_COUNT);
    this.level = (this.stage - 1) % MAZE_COUNT;
    this.reloadMaze();
    this.visited.clear();
    this.spawn();
    this.state = "ready";
    this.timer = READY_SEC;
  }

  /** (Re)load the current maze applying the editor's overrides + spikes. */
  private reloadMaze() {
    const e = this.store.edit(this.level);
    this.maze = loadMaze(this.level, {
      start: e.start ?? undefined,
      goal: e.goal ?? undefined,
    });
    this.spikes = e.spikes.filter((s) => s.on).map((s) => this.toSpike(s));
  }

  private spawn() {
    // Spawn at the authentic START marker (loadMaze already cleared a safe
    // pocket around it). No nudging — that caused instant-pop in tight mazes.
    // Edge-aware: bottom openings place the BASE/box at the marker (balloon floats
    // up into the maze); top openings place the BALLOON at the marker (box hangs down).
    const L = this.s("stringLen");
    this.px = this.maze.start.x + this.s("startOffX") * TILE;
    this.py = (this.maze.startBottom ? this.maze.start.y - L : this.maze.start.y) + this.s("startOffY") * TILE;
    this.phase = 0;
    this.goalArmed = false;
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
    if (this.race) { this.updateRace(dt); this.input.endFrame(); return; }
    if (this.input.justPressed("KeyO")) { this.menu = !this.menu; this.audio.unlock(); }
    if (this.menu) { this.updateMenu(); this.input.endFrame(); return; }
    const playing = this.state !== "title" && this.state !== "gameover";
    // level editor (E) — pauses play; applies edits on exit
    if (playing && this.input.justPressed("KeyE")) {
      this.editor.toggle();
      if (!this.editor.active) this.reloadMaze();
    }
    if (this.editor.active) {
      if (playing) this.editor.handle(this.input, this.level, this.settings);
      this.input.endFrame();
      return;
    }
    // level switching (testing): N = next, P = previous
    if (playing && this.input.justPressed("KeyN")) { this.stage += 1; this.loadStage(); }
    if (playing && this.input.justPressed("KeyP")) { this.stage = Math.max(1, this.stage - 1); this.loadStage(); }

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
          if (this.lives <= 0) {
            this.store.recordScore(this.score);
            this.hi = this.store.hiScore;
            this.state = "gameover"; this.timer = 0;
          } else { this.spawn(); this.state = "play"; }
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
    if (this.editor.active) {
      this.editor.pointTo(Math.floor((x - XOFF) / TILE), Math.floor(y / TILE));
      return;
    }
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
    const boxX = this.px, boxY = this.py + this.s("stringLen"); // anchor/handle below
    // moving spikes vs the rig (balloon or box)
    for (const sp of this.spikes) {
      sp.t += dt;
      const p = spikePos(sp);
      if (spikeHitsDisc(p.x, p.y, bp.x, bp.y, r) ||
          spikeHitsDisc(p.x, p.y, boxX, boxY, 2)) { this.die(); return; }
    }
    // pixel-perfect vs the WHOLE rig: balloon disc + string line + box
    if (balloonHits(this.maze, bp.x, bp.y, r) ||
        segmentHits(this.maze, boxX, boxY, bp.x, bp.y) ||
        balloonHits(this.maze, boxX, boxY, 2)) { this.die(); return; }

    // GOAL is reached when EITHER end of the rig (balloon or box) enters the zone.
    const gz = this.maze.goalZone;
    const inZone = (x: number, y: number) => {
      const c = Math.floor(x / TILE), rr = Math.floor(y / TILE);
      return c >= gz.c0 && c <= gz.c1 && rr >= gz.r0 && rr <= gz.r1;
    };
    const inGoal = inZone(bp.x, bp.y) || inZone(boxX, boxY);
    // nearest rig end to the goal centre (proximity beep + arming)
    const gd = Math.min(
      Math.hypot(bp.x - this.maze.goal.x, bp.y - this.maze.goal.y),
      Math.hypot(boxX - this.maze.goal.x, boxY - this.maze.goal.y),
    );
    this.beepCooldown -= dt;
    if (gd < TILE * 5 && this.beepCooldown <= 0) {
      this.audio.beep();
      this.beepCooldown = 0.12 + (gd / (TILE * 5)) * 0.5;
    }
    if (gd > TILE * 5) this.goalArmed = true; // travelled well clear of the goal
    if (inGoal && this.goalArmed) {
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

  // ---------------- 2-player race ----------------
  startRace(net: Net, role: "host" | "join") {
    this.audio.unlock();
    this.menu = false;
    if (this.editor.active) this.editor.toggle();
    this.race = {
      net, role, remote: null, shown: null, sendAcc: 0, remoteFin: 0, localFin: 0,
      result: "", counting: false, countdown: 3, live: false, raceMs: 0,
    };
    net.onData = (m) => this.onRaceData(m);
    net.onClose = () => { this.race = null; this.state = "title"; };
    this.score = 0;
    this.stage = 1;
    this.level = 0;
    this.reloadMaze();
    this.spawn();
    this.state = "play";
    if (role === "host") {
      net.send({ t: "cfg", level: 0, edits: this.store.edit(0) });
      net.send({ t: "go" });
      this.race.counting = true; this.race.countdown = 3;
    }
  }

  private onRaceData(m: NetMsg) {
    const r = this.race;
    if (!r) return;
    if (m.t === "cfg") {
      const e = this.store.edit(0), src = m.edits as MazeEdit;
      e.start = src.start; e.goal = src.goal; e.spikes = src.spikes;
      this.reloadMaze(); this.spawn();
    } else if (m.t === "go") {
      r.counting = true; r.countdown = 3;
    } else if (m.t === "p") {
      r.remote = { x: m.x, y: m.y, bx: m.bx, by: m.by };
    } else if (m.t === "fin") {
      r.remoteFin = m.ms;
      if (!r.localFin && !r.result) r.result = "lose";
    }
  }

  private updateRace(dt: number) {
    const r = this.race!;
    if (r.result) {
      if (this.input.justPressed("Space")) { r.net.destroy(); this.race = null; this.state = "title"; }
      return;
    }
    if (r.counting) {
      r.countdown -= dt;
      if (r.countdown <= 0) { r.counting = false; r.live = true; this.audio.mazeStart(); }
      return;
    }
    if (!r.live) return;

    r.raceMs += dt * 1000;
    const d = this.input.dir();
    if (d.x !== 0 || d.y !== 0) {
      const mag = Math.hypot(d.x, d.y) || 1;
      this.px += (d.x / mag) * this.moveSpeed() * dt;
      this.py += (d.y / mag) * this.moveSpeed() * dt;
    }
    const b = this.maze.bounds;
    this.px = Math.max(b.x0, Math.min(b.x1, this.px));
    this.py = Math.max(b.y0, Math.min(b.y1, this.py));
    this.phase += dt;
    for (const sp of this.spikes) sp.t += dt;

    const rad = this.radius();
    const bp = this.balloonPos();
    const boxX = this.px, boxY = this.py + this.s("stringLen");
    r.sendAcc += dt;
    if (r.sendAcc >= 1 / 30) { r.net.send({ t: "p", x: bp.x, y: bp.y, bx: boxX, by: boxY }); r.sendAcc = 0; }

    let hit = balloonHits(this.maze, bp.x, bp.y, rad) ||
      segmentHits(this.maze, boxX, boxY, bp.x, bp.y) || balloonHits(this.maze, boxX, boxY, 2);
    for (const sp of this.spikes) {
      const p = spikePos(sp);
      if (spikeHitsDisc(p.x, p.y, bp.x, bp.y, rad) || spikeHitsDisc(p.x, p.y, boxX, boxY, 2)) hit = true;
    }
    if (hit) { this.audio.pop(); this.spawn(); return; } // race: respawn, lose time

    const gz = this.maze.goalZone;
    const inZone = (x: number, y: number) => {
      const c = Math.floor(x / TILE), rr = Math.floor(y / TILE);
      return c >= gz.c0 && c <= gz.c1 && rr >= gz.r0 && rr <= gz.r1;
    };
    const gd = Math.min(
      Math.hypot(bp.x - this.maze.goal.x, bp.y - this.maze.goal.y),
      Math.hypot(boxX - this.maze.goal.x, boxY - this.maze.goal.y));
    if (gd > TILE * 5) this.goalArmed = true;
    if (!r.localFin && this.goalArmed && (inZone(bp.x, bp.y) || inZone(boxX, boxY))) {
      r.localFin = r.raceMs;
      r.net.send({ t: "fin", ms: r.raceMs });
      this.audio.goal();
      if (!r.result) r.result = (r.remoteFin && r.remoteFin < r.localFin) ? "lose" : "win";
    }
  }

  private renderRace(ctx: CanvasRenderingContext2D) {
    const r = this.race!;
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.save();
    ctx.translate(XOFF, 0);
    this.drawMaze(ctx);
    this.drawSpikes(ctx);
    if (r.remote) { // opponent shadow (eased toward the latest received position)
      if (!r.shown) r.shown = { ...r.remote };
      const k = 0.3;
      r.shown.x += (r.remote.x - r.shown.x) * k;
      r.shown.y += (r.remote.y - r.shown.y) * k;
      r.shown.bx += (r.remote.bx - r.shown.bx) * k;
      r.shown.by += (r.remote.by - r.shown.by) * k;
      const sh = r.shown;
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = PALETTE.white; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.bx, sh.by); ctx.stroke();
      ctx.fillStyle = PALETTE.white;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, this.radius() + 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.drawBalloon(ctx);
    ctx.restore();

    drawText(ctx, 2, 1, "RACE " + (r.role === "host" ? "P1" : "P2"), PALETTE.green, 1);
    drawText(ctx, 2, 9, (r.raceMs / 1000).toFixed(1), PALETTE.white, 1);
    const center = (t: string, y: number, c: string, s = 2) =>
      drawText(ctx, (SCREEN_W - textWidth(t, s)) / 2, y, t, c, s);
    if (r.counting) center(Math.max(1, Math.ceil(r.countdown)).toString(), 104, PALETTE.yellow, 4);
    if (r.result === "win") { center("YOU WIN", 100, PALETTE.green, 3); center("PRESS SPACE", 140, PALETTE.white, 1); }
    if (r.result === "lose") { center("YOU LOSE", 100, PALETTE.red, 3); center("PRESS SPACE", 140, PALETTE.white, 1); }
  }

  // ---------------- render ----------------
  render(ctx: CanvasRenderingContext2D) {
    if (this.race) { this.renderRace(ctx); return; }
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const onMaze = this.state !== "title" && this.state !== "gameover";
    if (onMaze) {
      ctx.save(); ctx.translate(XOFF, 0); this.drawMaze(ctx); ctx.restore();
    }
    if (this.editor.active && onMaze) {
      this.editor.render(ctx, this.maze, this.level, XOFF, this.settings);
      return;
    }
    if (onMaze) {
      ctx.save();
      ctx.translate(XOFF, 0);
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
      chars.draw(ctx, 0x39, sp.color, Math.round(p.x - TILE / 2), Math.round(p.y - TILE / 2));
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
      center("PRESS SPACE", 144, PALETTE.white, 1);
      center("ARROWS WASD TO MOVE", 158, PALETTE.green, 1);
      center("O SETTINGS   E EDIT LEVELS", 172, PALETTE.yellow, 1);
      if (this.store.hiScore > 0) center("HI " + pad(this.store.hiScore, 6), 192, PALETTE.cyan, 1);
    } else if (this.state === "ready") {
      center("LETS ATTACK !", 96, PALETTE.yellow, 2);
      center("PLAYER 1", 120, PALETTE.cyan, 1);
      center("LEVEL " + this.stage, 134, PALETTE.green, 1);
    } else if (this.state === "clear") {
      center("MAZE CLEAR", 120, PALETTE.yellow, 2);
    } else if (this.state === "dead") {
      center("POP !", 120, PALETTE.yellow, 2);
    } else if (this.state === "gameover") {
      center("GAME", 70, PALETTE.red, 3);
      center("OVER", 100, PALETTE.red, 3);
      center("SCORE " + pad(this.score, 6), 134, PALETTE.white, 1);
      center("BEST SCORES", 152, PALETTE.yellow, 1);
      this.store.scores.slice(0, 5).forEach((s, i) =>
        center(`${i + 1}. ` + pad(s, 6), 164 + i * 9, i === 0 ? PALETTE.cyan : PALETTE.white, 1));
      center("PRESS SPACE", 224, PALETTE.green, 1);
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
