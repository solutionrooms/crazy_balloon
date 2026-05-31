#!/usr/bin/env python3
"""Investigate the Crazy Balloon Color RAM (0x5000-0x53FF) — per-tile colours.

Boots the ROM, draws each base maze via the maze-draw routine, and dumps the
parallel color RAM so we can see the per-tile colour index pattern.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from z80 import load_machine

ROOT = Path(__file__).resolve().parent.parent
VRAM, CRAM, N = 0x4800, 0x5000, 32
DRAW_ENTRY, SUBTBL_PTR, SENTINEL = 0x235F, 0x40FE, 0xFFEE
SUBTABLES = {0: 0x2860, 1: 0x2A5D, 2: 0x2CA5}
SPACE = 0x2E


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
    boot(cpu)
    safe_sp = cpu.sp
    for idx, ptr in SUBTABLES.items():
        for a in range(VRAM, VRAM + 0x400):
            cpu.m[a] = SPACE
        cpu.m[SUBTBL_PTR] = ptr & 0xFF
        cpu.m[SUBTBL_PTR + 1] = (ptr >> 8) & 0xFF
        cpu.sp = safe_sp
        call(cpu, DRAW_ENTRY)
        vram = cpu.m[VRAM:VRAM + 0x400]
        cram = cpu.m[CRAM:CRAM + 0x400]
        chist = Counter(cram)
        # colour index only where there's a thorn (vram!=SPACE), to see maze colouring
        thorn_colours = Counter(cram[i] for i in range(0x400) if vram[i] != SPACE and vram[i] != 0)
        print(f"\n=== maze {idx} (sub ${ptr:04X}) ===")
        print("  colorram全 distinct:", ", ".join(f"{v:02X}:{c}" for v, c in chist.most_common(8)))
        print("  colours under thorns:", ", ".join(f"{v:02X}:{c}" for v, c in thorn_colours.most_common(8)))
        if idx == 0:
            # spatial map of colour index for maze 0 (CCW to portrait for readability)
            def ch(v):
                return "0123456789ABCDEF"[v & 0xF]
            print("  colour map (unrotated 32x32, hex index, '.'=under space):")
            for r in range(N):
                row = "".join(
                    ch(cram[r * N + c]) if vram[r * N + c] not in (SPACE, 0) else "."
                    for c in range(N)
                )
                print("   " + row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
