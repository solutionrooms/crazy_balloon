#!/usr/bin/env python3
"""Extract all base mazes by calling the ROM's maze-draw routine directly.

Boot the game until initialised (decompressor copied to RAM, HW set up), then
for each base maze sub-table pointer: poke RAM 0x40FE, CALL 0x235F (the maze
draw entry), and snapshot VRAM. Deterministic and complete — no reliance on the
attract AI (which stalls on the unemulated custom chips).
"""
from __future__ import annotations

import struct
import zlib
from collections import Counter
from pathlib import Path

from z80 import load_machine

ROOT = Path(__file__).resolve().parent.parent
VRAM, VLEN, COLS, ROWS = 0x4800, 0x400, 32, 32
DRAW_ENTRY = 0x235F
SUBTBL_PTR = 0x40FE
SENTINEL = 0xFFEE
SUBTABLES = {0: 0x2860, 1: 0x2A5D, 2: 0x2CA5}

_CL07 = (ROOT / "rom" / "cl07.bin").read_bytes()


def decode_tile(idx):
    m = [[0] * 8 for _ in range(8)]
    base = (idx & 0xFF) * 8
    for r in range(8):
        b = _CL07[base + (7 - r)]
        for c in range(8):
            m[r][c] = (b >> (7 - c)) & 1
    return m


_MASKS = [decode_tile(i) for i in range(256)]


def png(path, w, h, rgb):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = bytearray()
    for y in range(h):
        raw.append(0); raw += rgb[y * w * 3:(y + 1) * w * 3]
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def grid_of(vram):
    return [[vram[r * COLS + c] for c in range(COLS)] for r in range(ROWS)]


def rotate(grid, mode):
    R, C = len(grid), len(grid[0])
    if mode == "cw":
        return [[grid[R - 1 - r][c] for r in range(R)] for c in range(C)]
    if mode == "ccw":
        return [[grid[r][C - 1 - c] for r in range(R)] for c in range(C)]
    return grid


def render(grid, out, scale=4):
    Hc, Wc = len(grid), len(grid[0])
    W, H = Wc * 8 * scale, Hc * 8 * scale
    img = bytearray([0, 0, 0] * (W * H))
    for cy in range(Hc):
        for cx in range(Wc):
            t = grid[cy][cx] & 0xFF
            if t in (0x00, 0x2E):  # filler / open-space tiles -> blank
                continue
            m = _MASKS[t]
            for ry in range(8):
                for rx in range(8):
                    if not m[ry][rx]:
                        continue
                    for dy in range(scale):
                        for dx in range(scale):
                            i = (((cy * 8 + ry) * scale + dy) * W + (cx * 8 + rx) * scale + dx) * 3
                            img[i] = 0; img[i + 1] = 255; img[i + 2] = 255
    png(out, W, H, img)


def boot(cpu, steps=1_600_000):
    since = 0
    for _ in range(steps):
        cpu.step(); since += 1
        if since >= 8000 and cpu.iff1:
            cpu.interrupt(); since = 0


def call(cpu, addr, max_steps=3_000_000):
    cpu.iff1 = cpu.iff2 = 0
    cpu.sp = (cpu.sp - 2) & 0xFFFF
    cpu.ww(cpu.sp, SENTINEL)
    cpu.pc = addr
    for _ in range(max_steps):
        if cpu.pc == SENTINEL:
            return True
        cpu.step()
    return False


def main() -> int:
    cpu = load_machine(); cpu.io_in_default = 0xFF
    print("booting to initialised state...")
    boot(cpu)
    safe_sp = cpu.sp
    print(f"booted: PC={cpu.pc:04X} SP={cpu.sp:04X}")

    SPACE = 0x2E  # open/background tile; RLE skips these cells, so pre-fill them
    for idx, ptr in SUBTABLES.items():
        for a in range(VRAM, VRAM + VLEN):
            cpu.m[a] = SPACE
        cpu.m[SUBTBL_PTR] = ptr & 0xFF
        cpu.m[SUBTBL_PTR + 1] = (ptr >> 8) & 0xFF
        cpu.sp = safe_sp
        ok = call(cpu, DRAW_ENTRY)
        vram = bytes(cpu.m[VRAM:VRAM + VLEN])
        nb = sum(1 for v in vram if v)
        hist = Counter(vram)
        print(f"maze {idx} (sub-table ${ptr:04X}): returned={ok} non-blank={nb} "
              f"top={','.join(f'{t:02X}:{c}' for t, c in hist.most_common(5) if t)}")
        (ROOT / "reference" / f"base_maze{idx}.bin").write_bytes(vram)
        render(rotate(grid_of(vram), "ccw"), ROOT / "reference" / f"base_maze{idx}.png")
    print("wrote reference/base_maze{0,1,2}.png + .bin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
