import { STEP_MS } from "./constants";

export type UpdateFn = (step: number) => void;
export type RenderFn = (alpha: number) => void;

/**
 * Fixed-timestep loop: update() runs at a deterministic 60 Hz (good for the
 * balloon's pendulum swing and collision), render() runs every animation frame
 * with an interpolation alpha. Spiral-of-death guarded by a max catch-up.
 */
export function startLoop(update: UpdateFn, render: RenderFn): () => void {
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let running = true;

  const frame = (now: number) => {
    if (!running) return;
    acc += now - last;
    last = now;
    let steps = 0;
    while (acc >= STEP_MS && steps < 5) {
      update(STEP_MS / 1000);
      acc -= STEP_MS;
      steps++;
    }
    if (steps === 5) acc = 0; // drop backlog if we fell far behind
    render(acc / STEP_MS);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}
