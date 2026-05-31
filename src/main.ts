import "./style.css";
import { createDisplay } from "./engine/canvas";
import { startLoop } from "./engine/loop";
import { Input } from "./game/input";
import { Audio } from "./game/audio";
import { Game } from "./game/game";

const app = document.getElementById("app")!;
const { ctx } = createDisplay(app);

const input = new Input();
const audio = new Audio();
const game = new Game(input, audio);

// Unlock audio on the first user gesture (browser autoplay policy).
const unlock = () => audio.unlock();
addEventListener("keydown", unlock, { once: true });
addEventListener("pointerdown", unlock, { once: true });

if (location.search.includes("play")) (game as any).begin();

buildTouchControls(input, () => (game as any).begin());

startLoop(
  (dt) => game.update(dt),
  () => game.render(ctx),
);

/** On-screen D-pad + start button for touch devices. */
function buildTouchControls(input: Input, start: () => void) {
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
    const press = (e: Event) => {
      e.preventDefault();
      if (dir === "left") set(-1, 0);
      else if (dir === "right") set(1, 0);
      else if (dir === "up") set(0, -1);
      else if (dir === "down") set(0, 1);
      else if (dir === "start") start();
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", clear);
    btn.addEventListener("pointerleave", clear);
    btn.addEventListener("pointercancel", clear);
  }
}
