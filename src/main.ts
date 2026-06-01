import "./style.css";
import { SCREEN_W, SCREEN_H } from "./engine/constants";
import { createDisplay } from "./engine/canvas";
import { startLoop } from "./engine/loop";
import { Input } from "./game/input";
import { Audio } from "./game/audio";
import { Settings } from "./game/settings";
import { Store, Editor } from "./game/editor";
import { Net } from "./net/net";
import { Game } from "./game/game";

const app = document.getElementById("app")!;
const { canvas, ctx } = createDisplay(app);

const input = new Input();
const audio = new Audio();
const settings = new Settings();
const store = new Store();
const editor = new Editor(store);
const game = new Game(input, audio, settings, store, editor);

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
if (location.search.includes("touch")) document.body.classList.add("show-touch");
if (location.search.includes("edit")) (game as any).editor.toggle();

buildControls(input, game);
buildLobby(game);

startLoop(
  (dt) => game.update(dt),
  () => game.render(ctx),
);

/** DOM lobby for the 2-player race: host (shows a code) or join (enter a code). */
function buildLobby(game: Game) {
  const btn = document.createElement("button");
  btn.className = "p2btn";
  btn.textContent = "2P";
  document.body.appendChild(btn);

  const lobby = document.createElement("div");
  lobby.className = "lobby hidden";
  lobby.innerHTML = `
    <div class="lobby-box">
      <h2>2-PLAYER RACE</h2>
      <button data-act="host">HOST GAME</button>
      <div class="join-row">
        <input class="code-in" placeholder="PASTE CODE OR LINK" />
        <button data-act="join">JOIN</button>
      </div>
      <div class="lobby-status">Host a game and share the code, or join with a friend's code.</div>
      <button data-act="close">CANCEL</button>
    </div>`;
  document.body.appendChild(lobby);

  const status = lobby.querySelector(".lobby-status") as HTMLElement;
  const input = lobby.querySelector(".code-in") as HTMLInputElement;
  let net: Net | null = null;

  const show = () => lobby.classList.remove("hidden");
  const hide = () => lobby.classList.add("hidden");
  const cleanup = () => { net?.destroy(); net = null; };

  btn.addEventListener("click", show);

  lobby.querySelector('[data-act="close"]')!.addEventListener("click", () => { cleanup(); hide(); });

  lobby.querySelector('[data-act="host"]')!.addEventListener("click", async () => {
    cleanup();
    net = new Net();
    status.textContent = "Creating game…";
    net.onOpen = () => { game.startRace(net!, "host"); hide(); };
    try {
      const id = await net.host();
      const link = location.origin + location.pathname + "?join=" + encodeURIComponent(id);
      status.innerHTML = `Send this link to player 2:<br>
        <input class="share" readonly value="${link}">
        <button class="copy">COPY LINK</button><br>Waiting for player 2…`;
      const share = status.querySelector(".share") as HTMLInputElement;
      share.addEventListener("focus", () => share.select());
      status.querySelector(".copy")!.addEventListener("click", () => {
        navigator.clipboard?.writeText(link); share.select();
      });
    } catch { status.textContent = "Could not create game — try again."; }
  });

  const doJoin = async (value?: string) => {
    let code = (value ?? input.value).trim();
    const m = code.match(/[?&]join=([^&]+)/);
    if (m) code = decodeURIComponent(m[1]);
    if (!code) { status.textContent = "Paste a code or link to join."; return; }
    cleanup();
    net = new Net();
    status.textContent = "Connecting…";
    try {
      await net.join(code);
      game.startRace(net, "join");
      hide();
    } catch { status.textContent = "Could not connect — check the code/link."; }
  };
  lobby.querySelector('[data-act="join"]')!.addEventListener("click", () => doJoin());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });

  // Auto-open + join when arriving via a shared ?join=<id> link.
  const joinId = new URLSearchParams(location.search).get("join");
  if (joinId) { show(); doJoin(joinId); }
  if (location.search.includes("lobby")) show();
}

/** On-screen gear (settings), virtual joystick (8-way incl. diagonals), and a
 * GO/start button — shown on touch devices. */
function buildControls(input: Input, game: Game) {
  const gear = document.createElement("button");
  gear.className = "gear";
  gear.textContent = "⚙";
  gear.setAttribute("aria-label", "settings");
  gear.addEventListener("pointerdown", (e) => { e.preventDefault(); game.toggleMenu(); });
  document.body.appendChild(gear);

  const wrap = document.createElement("div");
  wrap.className = "touch";
  wrap.innerHTML = `<div class="stick"><div class="knob"></div></div><button class="gobtn">GO</button>`;
  document.body.appendChild(wrap);

  const go = wrap.querySelector(".gobtn") as HTMLButtonElement;
  go.addEventListener("pointerdown", (e) => { e.preventDefault(); (game as any).begin(); });

  // Virtual joystick: drag from the pad centre; 8-way with a small dead-zone so
  // a diagonal drag moves diagonally.
  const stick = wrap.querySelector(".stick") as HTMLElement;
  const knob = wrap.querySelector(".knob") as HTMLElement;
  const RADIUS = 42, DEAD = 11;
  let active = false, ox = 0, oy = 0;

  const move = (e: PointerEvent) => {
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const mag = Math.hypot(dx, dy);
    const clamp = mag > RADIUS ? RADIUS / mag : 1;
    knob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`;
    input.touch.x = Math.abs(dx) > DEAD ? Math.sign(dx) : 0;
    input.touch.y = Math.abs(dy) > DEAD ? Math.sign(dy) : 0;
  };
  const end = () => { active = false; input.touch.x = 0; input.touch.y = 0; knob.style.transform = ""; };

  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    active = true;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
    move(e);
  });
  stick.addEventListener("pointermove", (e) => { if (active) move(e); });
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);
}
