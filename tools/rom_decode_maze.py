#!/usr/bin/env python3
"""Experimental decoder for Crazy Balloon maze RLE chunks.

The maze renderer decompresses ROM chunks into 32-wide tile VRAM (0x4800+).
We don't yet know the exact opcode semantics, so this tool tries a configurable
(tile,count) interpretation with an optional newline token and prints an ASCII
preview so we can iterate against the reference frames.

  python3 tools/rom_decode_maze.py --start 0x2887 --width 32 --rows 32
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_prog() -> bytes:
    d = bytearray()
    for i in range(1, 7):
        d += (ROOT / "rom" / f"cl0{i}.bin").read_bytes()
    return bytes(d)


def glyph(tile: int) -> str:
    if tile == 0x00:
        return "."
    if 0x37 <= tile <= 0x4F:
        return "#"          # thorn / snowflake
    if 0x30 <= tile <= 0x36:
        return "="          # wall pieces
    if tile == 0x2E:
        return "*"          # thorn-B
    return "?"


def decode(prog: bytes, start: int, width: int, rows: int,
           order: str, newline_tok: bool, max_bytes: int):
    grid = [[0x00] * width for _ in range(rows)]
    x = y = 0
    i = start
    end = start + max_bytes
    placed = 0
    while i + 1 < end and y < rows:
        a, b = prog[i], prog[i + 1]
        if newline_tok and a == 0x39 and b == 0x00:
            # hypothesis: (39,00) = end of row; following byte = skip/advance
            x = 0
            y += 1
            i += 2
            continue
        tile, count = (a, b) if order == "tc" else (b, a)
        for _ in range(count):
            if x >= width:
                x = 0
                y += 1
            if y >= rows:
                break
            grid[y][x] = tile
            x += 1
            placed += 1
        i += 2
    return grid, placed, i - start


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=lambda x: int(x, 0), default=0x2887)
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--rows", type=int, default=32)
    ap.add_argument("--order", choices=["tc", "ct"], default="tc")
    ap.add_argument("--newline", action="store_true")
    ap.add_argument("--max", type=lambda x: int(x, 0), default=0x200)
    args = ap.parse_args()

    prog = load_prog()
    grid, placed, consumed = decode(prog, args.start, args.width, args.rows,
                                    args.order, args.newline, args.max)
    print(f"start=0x{args.start:04X} order={args.order} newline={args.newline} "
          f"width={args.width} -> placed {placed} tiles, consumed {consumed} bytes")
    for row in grid:
        print("".join(glyph(t) for t in row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
