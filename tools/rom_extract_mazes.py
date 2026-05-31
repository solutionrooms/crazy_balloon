#!/usr/bin/env python3
"""Boot Crazy Balloon in the Z80 emulator, run with periodic VBLANK interrupts,
and capture STABLE fully-drawn maze frames from VRAM (0x4800). Frames that are
mid-scroll/transition or showing title text are rejected; distinct stable maze
screens are deduped and rendered (rotated to portrait to match the ROT90 CRT).
"""
from __future__ import annotations

import argparse
import struct
import zlib
from collections import Counter
from pathlib import Path

from z80 import load_machine

ROOT = Path(__file__).resolve().parent.parent
VRAM = 0x4800
VRAM_LEN = 0x400  # 32x32
COLS = 32
ROWS = 32


def png(path, w, h, rgb):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = bytearray()
    for y in range(h):
        raw.append(0); raw += rgb[y * w * 3:(y + 1) * w * 3]
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def decode_tile(rom, idx):
    m = [[0] * 8 for _ in range(8)]
    base = (idx & 0xFF) * 8
    for r in range(8):
        b = rom[base + (7 - r)]
        for c in range(8):
            m[r][c] = (b >> (7 - c)) & 1
    return m


# Precompute tile masks for cl07
_CL07 = (ROOT / "rom" / "cl07.bin").read_bytes()
_MASKS = [decode_tile(_CL07, i) for i in range(256)]


def grid_of(vram):
    return [[vram[r * COLS + c] for c in range(COLS)] for r in range(ROWS)]


def rotate(grid, mode):
    """mode: 'cw' rotate 90 clockwise, 'ccw' counter-clockwise, 'none'."""
    if mode == "none":
        return grid
    R = len(grid); C = len(grid[0])
    if mode == "cw":
        return [[grid[R - 1 - r][c] for r in range(R)] for c in range(C)]
    return [[grid[r][C - 1 - c] for r in range(R)] for c in range(C)]


def render(grid, out, scale=4):
    H_cells = len(grid); W_cells = len(grid[0])
    W = W_cells * 8 * scale; H = H_cells * 8 * scale
    img = bytearray([0, 0, 0] * (W * H))
    for cy in range(H_cells):
        for cx in range(W_cells):
            m = _MASKS[grid[cy][cx] & 0xFF]
            for ry in range(8):
                for rx in range(8):
                    if not m[ry][rx]:
                        continue
                    for dy in range(scale):
                        for dx in range(scale):
                            px = (cx * 8 + rx) * scale + dx
                            py = (cy * 8 + ry) * scale + dy
                            i = (py * W + px) * 3
                            img[i] = 0; img[i + 1] = 255; img[i + 2] = 255
    png(out, W, H, img)


def is_maze_tile(v):
    # thorns (0x2E,0x39, 0x37-0x4F) + wall/bar pieces (0x30-0x36, incl start/goal bars)
    return v == 0x2E or v == 0x39 or 0x30 <= v <= 0x4F


def thorn_grid(vram):
    """VRAM with everything but static maze tiles blanked (drops balloon/text/score)."""
    return bytes(v if is_maze_tile(v) else 0 for v in vram)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=6_000_000)
    ap.add_argument("--int-every", type=int, default=8000)
    ap.add_argument("--rotate", choices=["none", "cw", "ccw"], default="ccw")
    args = ap.parse_args()

    cpu = load_machine()
    cpu.io_in_default = 0xFF

    # Dedupe on the static maze tiles only; count how many frames each persists.
    seen: dict[int, dict] = {}
    since_int = 0
    frames = 0
    for n in range(1, args.steps + 1):
        cpu.step()
        since_int += 1
        if since_int >= args.int_every and cpu.iff1:
            cpu.interrupt(); since_int = 0
            vram = bytes(cpu.m[VRAM:VRAM + VRAM_LEN])
            frames += 1
            tg = thorn_grid(vram)
            thorns = sum(1 for v in tg if v)
            if thorns < 150:
                continue
            h = hash(tg)
            if h in seen:
                seen[h]["count"] += 1
            else:
                seen[h] = {"count": 1, "thorns": thorns, "tg": tg,
                           "vram": vram, "step": n}

    print(f"ran {frames} frames; {len(seen)} distinct maze structures (thorns>=150)")
    # rank by persistence (frames shown) then thorn richness
    cands = sorted(seen.values(), key=lambda d: (-d["count"], -d["thorns"]))
    for i, d in enumerate(cands[:8]):
        out = ROOT / "reference" / f"maze_cand{i}.png"
        outfull = ROOT / "reference" / f"maze_cand{i}_full.png"
        render(rotate(grid_of(d["tg"]), args.rotate), out)
        render(rotate(grid_of(d["vram"]), args.rotate), outfull)
        # raw VRAM dump so orientation/crop can be re-derived without re-emulating
        (ROOT / "reference" / f"maze_cand{i}.bin").write_bytes(d["vram"])
        hist = Counter(d["tg"])
        print(f"  cand{i}: persisted {d['count']} frames, thorns={d['thorns']} "
              f"@step{d['step']} top={','.join(f'{t:02X}:{c}' for t, c in hist.most_common(4) if t)} "
              f"-> {out.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
