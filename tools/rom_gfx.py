#!/usr/bin/env python3
"""Decode Crazy Balloon graphics ROM (cl08) into an 8x8 tile sheet preview.

cl08.bin is 2048 bytes = 256 tiles * 8 bytes, 8x8 pixels, 1 bit per pixel.
This renders all 256 tiles into a PNG grid so we can confirm the format and
identify the thorn / balloon / font glyphs. Pure stdlib (zlib) PNG writer —
no PIL needed.

Usage:
  python3 tools/rom_gfx.py [--rom path/to/cl08.bin] [--out preview.png]
                           [--scale N] [--lsb] [--invert]
"""
from __future__ import annotations

import argparse
import struct
import zlib
from pathlib import Path

TILE_W = TILE_H = 8
BYTES_PER_TILE = 8


def write_png(path: Path, w: int, h: int, rgb: bytearray) -> None:
    """Write an RGB8 PNG using only the stdlib."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += rgb[y * w * 3:(y + 1) * w * 3]
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def decode_tiles(data: bytes, lsb: bool, flipy: bool) -> list[list[list[int]]]:
    """Return list of tiles, each an 8x8 matrix of 0/1.

    MAME crbaloon charlayout uses yoffset {7*8..0*8} → rows stored bottom-to-top,
    so flipy reverses byte order within a tile to display upright.
    """
    n = len(data) // BYTES_PER_TILE
    tiles = []
    for t in range(n):
        rows = []
        for r in range(TILE_H):
            byte = data[t * BYTES_PER_TILE + r]
            row = []
            for bit in range(8):
                mask = (1 << bit) if lsb else (1 << (7 - bit))
                row.append(1 if (byte & mask) else 0)
            rows.append(row)
        if flipy:
            rows.reverse()
        tiles.append(rows)
    return tiles


def main() -> int:
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent.parent
    ap.add_argument("--rom", default=str(here / "rom" / "cl08.bin"))
    ap.add_argument("--out", default=str(here / "reference" / "rom_cl08_tiles.png"))
    ap.add_argument("--scale", type=int, default=6)
    ap.add_argument("--cols", type=int, default=16)
    ap.add_argument("--lsb", action="store_true", help="LSB-first bit order")
    ap.add_argument("--no-flipy", dest="flipy", action="store_false",
                    help="disable bottom-to-top row order (MAME yoffset)")
    ap.add_argument("--invert", action="store_true")
    args = ap.parse_args()

    data = Path(args.rom).read_bytes()
    tiles = decode_tiles(data, args.lsb, args.flipy)
    n = len(tiles)
    cols = args.cols
    rows = (n + cols - 1) // cols
    s = args.scale
    gap = 1

    cell = TILE_W * s + gap
    W = cols * cell + gap
    H = rows * cell + gap
    # background dark grey, gap lines slightly lighter
    img = bytearray([40, 40, 48] * (W * H))

    def put(px: int, py: int, rgb3):
        if 0 <= px < W and 0 <= py < H:
            i = (py * W + px) * 3
            img[i:i + 3] = bytes(rgb3)

    on = (20, 20, 28) if args.invert else (0, 255, 255)   # cyan thorns vibe
    off = (0, 255, 255) if args.invert else (8, 8, 12)

    for idx, tile in enumerate(tiles):
        tx = (idx % cols) * cell + gap
        ty = (idx // cols) * cell + gap
        for ry in range(TILE_H):
            for rx in range(TILE_W):
                color = on if tile[ry][rx] else off
                for dy in range(s):
                    for dx in range(s):
                        put(tx + rx * s + dx, ty + ry * s + dy, color)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    write_png(Path(args.out), W, H, img)
    print(f"decoded {n} tiles from {args.rom}")
    print(f"wrote {args.out} ({W}x{H}, scale={s}, {'LSB' if args.lsb else 'MSB'}-first)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
