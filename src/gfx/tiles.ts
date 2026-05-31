import { GFX1_CHARS, GFX2_SPRITES, TILE_W, TILE_H, TILE_COUNT } from "./romTiles";
import { PALETTE, type ColorName } from "../engine/constants";

/**
 * Decode one 8x8 tile from a Crazy Balloon gfx ROM into a 64-entry 0/1 mask.
 * MAME charlayout: bit 7 = leftmost pixel (MSB-first), yoffset {7*8..0*8} so the
 * 8 bytes are stored bottom row first — we reverse them to display upright.
 */
export function decodeTile(rom: Uint8Array, index: number): Uint8Array {
  const out = new Uint8Array(TILE_W * TILE_H);
  const base = index * 8;
  for (let r = 0; r < TILE_H; r++) {
    const byte = rom[base + (7 - r)]; // bottom-to-top
    for (let c = 0; c < TILE_W; c++) {
      out[r * TILE_W + c] = (byte >> (7 - c)) & 1;
    }
  }
  return out;
}

/** A tile renderer that caches per (rom, index, colour) coloured 8x8 canvases. */
export class TileSheet {
  private cache = new Map<string, HTMLCanvasElement>();
  constructor(private rom: Uint8Array) {}

  /** Coloured opaque-on-transparent 8x8 canvas for the given tile + colour. */
  tile(index: number, color: ColorName): HTMLCanvasElement {
    const key = `${index}:${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const mask = decodeTile(this.rom, index);
    const c = document.createElement("canvas");
    c.width = TILE_W;
    c.height = TILE_H;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(TILE_W, TILE_H);
    const [rr, gg, bb] = hexToRgb(PALETTE[color]);
    for (let i = 0; i < mask.length; i++) {
      const on = mask[i];
      img.data[i * 4 + 0] = rr;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = bb;
      img.data[i * 4 + 3] = on ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
    this.cache.set(key, c);
    return c;
  }

  draw(ctx: CanvasRenderingContext2D, index: number, color: ColorName, x: number, y: number): void {
    ctx.drawImage(this.tile(index, color), x, y);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const chars = new TileSheet(GFX1_CHARS); // cl07 — font, thorns, maze pieces
export const sprites = new TileSheet(GFX2_SPRITES); // cl08
export { TILE_COUNT };
