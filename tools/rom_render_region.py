#!/usr/bin/env python3
"""Render a byte region of the program ROM as a tilemap, using cl07 as the tile
set (byte value = tile index). Lets us eyeball whether a region is maze data.

  python3 tools/rom_render_region.py --start 0x2800 --len 0x400 --width 32
Also: --label-tiles 0x30 0x40  renders that tile-index range with index labels.
"""
from __future__ import annotations

import argparse
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILE = 8


def png(path: Path, w: int, h: int, rgb: bytearray) -> None:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]
    path.write_bytes(b"\x89PNG\r\n\x1a\n"
                      + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                      + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
                      + chunk(b"IEND", b""))


def decode_tile(rom: bytes, idx: int):
    """8x8 0/1 mask, MSB-first, rows bottom-to-top (MAME yoffset)."""
    m = [[0] * 8 for _ in range(8)]
    base = idx * 8
    for r in range(8):
        b = rom[base + (7 - r)]
        for c in range(8):
            m[r][c] = (b >> (7 - c)) & 1
    return m


def load_prog() -> bytes:
    d = bytearray()
    for i in range(1, 7):
        d += (ROOT / "rom" / f"cl0{i}.bin").read_bytes()
    return bytes(d)


def render_grid(values, cols, tilerom, scale, out, on=(0, 255, 255), grid=True):
    rows = (len(values) + cols - 1) // cols
    gap = 1 if grid else 0
    cell = TILE * scale + gap
    W = cols * cell + gap
    H = rows * cell + gap
    img = bytearray([24, 24, 30] * (W * H)) if grid else bytearray([0, 0, 0] * (W * H))
    for k, v in enumerate(values):
        tx = (k % cols) * cell + gap
        ty = (k // cols) * cell + gap
        m = decode_tile(tilerom, v & 0xFF)
        for ry in range(8):
            for rx in range(8):
                color = on if m[ry][rx] else (0, 0, 0)
                for dy in range(scale):
                    for dx in range(scale):
                        px, py = tx + rx * scale + dx, ty + ry * scale + dy
                        i = (py * W + px) * 3
                        img[i:i + 3] = bytes(color)
    png(Path(out), W, H, img)
    return W, H


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=lambda x: int(x, 0), default=0x2800)
    ap.add_argument("--len", type=lambda x: int(x, 0), default=0x400)
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--scale", type=int, default=4)
    ap.add_argument("--out", default=str(ROOT / "reference" / "region.png"))
    ap.add_argument("--label-tiles", nargs=2, type=lambda x: int(x, 0))
    args = ap.parse_args()

    cl07 = (ROOT / "rom" / "cl07.bin").read_bytes()
    if args.label_tiles:
        a, b = args.label_tiles
        vals = list(range(a, b))
        w, h = render_grid(vals, 16, cl07, 8, args.out)
        print(f"labeled tiles 0x{a:02X}..0x{b:02X} -> {args.out} ({w}x{h})")
        return 0

    prog = load_prog()
    region = prog[args.start:args.start + args.len]
    w, h = render_grid(list(region), args.width, cl07, args.scale, args.out, grid=False)
    print(f"rendered 0x{args.start:04X}..0x{args.start + args.len:04X} "
          f"({len(region)}B) as {args.width}-wide tilemap -> {args.out} ({w}x{h})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
