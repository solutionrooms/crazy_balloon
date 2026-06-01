/** Keyboard input: held directions + edge-triggered action keys. */
export class Input {
  private held = new Set<string>();
  private edge = new Set<string>();
  /** On-screen/touch direction, merged into dir(). */
  touch = { x: 0, y: 0 };

  constructor() {
    addEventListener("keydown", (e) => {
      if (!this.held.has(e.code)) this.edge.add(e.code);
      this.held.add(e.code);
      if (HANDLED.has(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.held.delete(e.code));
    addEventListener("blur", () => this.held.clear());
  }

  /** 4-way intent from arrows/WASD as a unit-ish vector (-1/0/1 per axis). */
  dir(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.held.has("ArrowLeft") || this.held.has("KeyA")) x -= 1;
    if (this.held.has("ArrowRight") || this.held.has("KeyD")) x += 1;
    if (this.held.has("ArrowUp") || this.held.has("KeyW")) y -= 1;
    if (this.held.has("ArrowDown") || this.held.has("KeyS")) y += 1;
    if (this.touch.x) x = this.touch.x;
    if (this.touch.y) y = this.touch.y;
    return { x, y };
  }

  /** True once per physical press. */
  justPressed(code: string): boolean {
    if (this.edge.has(code)) {
      this.edge.delete(code);
      return true;
    }
    return false;
  }

  /** Call at end of frame to clear unconsumed edges. */
  endFrame() {
    this.edge.clear();
  }
}

const HANDLED = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space",
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyM", "KeyP", "KeyN",
  "KeyE", "KeyG", "KeyX", "KeyC", "Tab", "Minus", "Equal", "BracketLeft", "BracketRight",
]);
