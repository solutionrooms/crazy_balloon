import "./style.css";
import { SCREEN_W, SCREEN_H } from "./engine/constants";
import { createDisplay } from "./engine/canvas";
import { startLoop } from "./engine/loop";
import { Input } from "./game/input";
import { Audio } from "./game/audio";
import { Settings } from "./game/settings";
import { Game } from "./game/game";

const app = document.getElementById("app")!;
const { canvas, ctx } = createDisplay(app);

const input = new Input();
const audio = new Audio();
const settings = new Settings();
const game = new Game(input, audio, settings);

// Unlock audio on the first user gesture (browser autoplay policy).
const unlock = () => audio.unlock();
addEventListener("keydown", unlock, { once: true });
addEventListener("pointerdown", unlock, { once: true });

// Forward canvas taps/clicks to the game in internal pixel coords (for the menu).
canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * SCREEN_W;
  const y = ((e.clientY - rect.top) / rect.height) * SCREEN_H;
  game.handlePointer(x, y);
});

if (location.search.includes("play")) {
  const ph = location.search.match(/phase=([\d.]+)/);
  const st = location.search.match(/stage=([\d]+)/);
  (game as any).debugPlay(ph ? parseFloat(ph[1]) : 0, st ? parseInt(st[1]) : 1);
}
if (location.search.includes("menu")) game.toggleMenu();

buildControls(input, game);

startLoop(
  (dt) => game.update(dt),
  () => game.render(ctx),
);

/** On-screen gear (settings) button + D-pad for touch devices. */
function buildControls(input: Input, game: Game) {
  const gear = document.createElement("button");
  gear.className = "gear";
  gear.textContent = "⚙";
  gear.setAttribute("aria-label", "settings");
  gear.addEventListener("pointerdown", (e) => { e.preventDefault(); game.toggleMenu(); });
  document.body.appendChild(gear);

  const pad = document.createElement("div");
  pad.className = "touch";
  pad.innerHTML = `
    <div class="dpad">
      <button data-dir="up">▲</button>
      <div class="dpad-mid">
        <button data-dir="left">◀</button>
        <button data-dir="start" class="start">GO</button>
        <button data-dir="right">▶</button>
      </div>
      <button data-dir="down">▼</button>
    </div>`;
  document.body.appendChild(pad);

  const set = (x: number, y: number) => { input.touch.x = x; input.touch.y = y; };
  const clear = () => set(0, 0);
  for (const btn of Array.from(pad.querySelectorAll("button"))) {
    const dir = (btn as HTMLElement).dataset.dir!;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (dir === "left") set(-1, 0);
      else if (dir === "right") set(1, 0);
      else if (dir === "up") set(0, -1);
      else if (dir === "down") set(0, 1);
      else if (dir === "start") (game as any).begin();
    });
    btn.addEventListener("pointerup", clear);
    btn.addEventListener("pointerleave", clear);
    btn.addEventListener("pointercancel", clear);
  }
}
