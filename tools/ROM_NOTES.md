# Crazy Balloon ROM — reverse-engineering notes

## ROM map (confirmed via MAME crbaloon driver + inspection)
- `cl01`–`cl06` (2 KB each) → **maincpu** program, mapped 0x0000–0x2FFF (12 KB Z80).
- `cl07` → **gfx1** (8×8 chars): font, digits, thorn/snowflake glyphs, wall pieces. ✅ decoded & rendering.
- `cl08` → **gfx2** (sprites): balloon etc. (different packing; secondary).
- Tile format: 8×8, 1bpp, MSB-first, **yoffset {7*8..0*8}** → 8 bytes stored bottom-row-first.
- Display: ROT90 → portrait 224×256. VRAM tilemap is 32 wide at **0x4800+**.

## Confirmed tile codes
- `0x39` = thorn/snowflake (primary). `0x2E` = thorn-B. `0x30`–`0x36` = wall bars
  (horizontal/vertical). `0x00` = blank.

## Maze data (located, format partially decoded)
- **Pointer/structure region: ~0x2840–0x2FFF.**
- `0x2840`–`0x2858`: a repeating selector referencing 3 base addresses
  **0x2860, 0x2A5D, 0x2CA5** in a pattern → likely **3 base maze layouts** cycled
  & recoloured across levels (matches reference footage showing few layouts).
- `0x2860` is a per-maze **sub-table**: e.g. `{0x2886 (ROM src), 0x29B8, 0x48D6
  (VRAM dest), 0x4B27, 0x29DC, 0x29DF, 0x29E2, 0x29ED ...}` → the renderer
  **decompresses ROM chunks into VRAM at 0x48xx**, plus small chunks (start/goal/
  features).
- **Compressed chunk @ 0x2886** (thorn field): stream of `0x39`/`0x2E` tile codes
  with run/count bytes and `0x39 0x00` separators, e.g.
  `14 39 01 33 00 04 39 08 2E 02 39 03 2E 03 39 00 03 39 0E 2E 03 39 00 03 ...`
  - A naive `(tile,count)` decode yields **real thorn runs** (`####****`) but also
    stray bytes that are not tiles → format includes **column positions / row
    headers**, not yet pinned down.

## Open problem
Exact decompression opcode semantics. Two ways to finish:
1. **Z80 disassembler/emulator** — disassemble/run the draw routine that consumes
   `0x2886` → exact, zero-guess mazes (larger build).
2. **Hybrid** — use the ROM-derived thorn/tile data + reference frames to finalize
   the 3 layouts in the `Level` format now (faster to a playable game).

## Tools
- `tools/rom_gfx.py` — gfx ROM → tile-sheet PNG.
- `tools/export_tiles.py` — gfx ROM bytes → `src/gfx/romTiles.ts`.
- `tools/rom_maze.py` — program ROM structural scan (blocks, pointer tables, runs).
- `tools/rom_render_region.py` — render a byte region as a tilemap PNG.
- `tools/rom_decode_maze.py` — experimental RLE decoder + ASCII preview.
