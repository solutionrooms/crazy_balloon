import { SCREEN_W, SCREEN_H } from "./constants";

export interface Display {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Create the fixed-resolution portrait canvas and keep it integer-scaled. */
export function createDisplay(mount: HTMLElement): Display {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  mount.appendChild(canvas);

  const fit = () => {
    // Largest integer scale that fits the viewport.
    const scale = Math.max(
      1,
      Math.floor(Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H)),
    );
    canvas.style.width = `${SCREEN_W * scale}px`;
    canvas.style.height = `${SCREEN_H * scale}px`;
  };
  fit();
  window.addEventListener("resize", fit);
  return { canvas, ctx };
}
