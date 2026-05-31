#!/usr/bin/env python3
"""Structural analysis of the Crazy Balloon program ROM (cl01..cl06) to locate
maze/level data tables. No disassembly — purely statistical/structural hunting:

  - block scan: per 256-byte block, distinct-byte count + dominant byte
  - pointer-table scan: runs of little-endian 16-bit values inside ROM space
  - run scan: long runs of a single byte (tilemap fills / borders)
  - region guesser: contiguous low-entropy spans = likely data, not code
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROG_FILES = [f"cl0{i}.bin" for i in range(1, 7)]  # cl01..cl06 = 0x0000..0x2FFF
ROM_SPAN = 0x3000


def load_prog() -> bytes:
    data = bytearray()
    for f in PROG_FILES:
        data += (ROOT / "rom" / f).read_bytes()
    return bytes(data)


def block_scan(prog: bytes, block: int = 256) -> None:
    print(f"\n=== block scan ({block}B blocks) — distinct bytes & dominant ===")
    print("off     dist  topbyte:count  zero%  ascii%  guess")
    for off in range(0, len(prog), block):
        chunk = prog[off:off + block]
        c = Counter(chunk)
        distinct = len(c)
        top, topn = c.most_common(1)[0]
        zero = chunk.count(0) * 100 // len(chunk)
        asc = sum(1 for b in chunk if 32 <= b < 127) * 100 // len(chunk)
        # crude guess: low-distinct or high single-byte dominance => data/table
        guess = ""
        if distinct < 40:
            guess = "DATA?"
        elif topn > block // 3:
            guess = "fill/table?"
        print(f"{off:04X}    {distinct:3d}   0x{top:02X}:{topn:<5d}  {zero:3d}%   {asc:3d}%   {guess}")


def pointer_tables(prog: bytes, min_entries: int = 5) -> None:
    print(f"\n=== pointer-table candidates (>= {min_entries} consecutive LE16 in ROM space) ===")
    i = 0
    n = len(prog)
    while i + 2 <= n:
        entries = []
        j = i
        while j + 2 <= n:
            val = prog[j] | (prog[j + 1] << 8)
            if 0x0000 <= val < ROM_SPAN:
                entries.append(val)
                j += 2
            else:
                break
        if len(entries) >= min_entries:
            # show table; flag if values look like a sorted/clustered set of addrs
            lo, hi = min(entries), max(entries)
            print(f"  @0x{i:04X}: {len(entries)} entries, range 0x{lo:04X}..0x{hi:04X}: "
                  + " ".join(f"{e:04X}" for e in entries[:12])
                  + (" ..." if len(entries) > 12 else ""))
            i = j
        else:
            i += 1


def run_scan(prog: bytes, min_run: int = 12) -> None:
    print(f"\n=== single-byte runs (>= {min_run}) ===")
    i = 0
    n = len(prog)
    while i < n:
        b = prog[i]
        j = i
        while j < n and prog[j] == b:
            j += 1
        if j - i >= min_run:
            print(f"  @0x{i:04X}: byte 0x{b:02X} x{j - i}")
        i = j


def main() -> int:
    prog = load_prog()
    print(f"loaded {len(prog)} bytes (cl01..cl06)")
    block_scan(prog)
    pointer_tables(prog)
    run_scan(prog)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
