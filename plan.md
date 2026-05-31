# Crazy Balloon — Implementation Plan

Stack: **TypeScript + Vite**, HTML5 Canvas 2D. Fidelity: **faithful recreation**
driven by **byte-exact data extracted from the ROM** (`/rom`) via a from-scratch
Z80 emulator, with reference footage for feel. Hosting: **GitHub Pages** via Actions.

Each phase ends in something runnable. The contracts between phases are the
`Level`/`RomMaze` data format (`src/levels/`) and the tuning constants
(`src/engine/constants.ts`). See `prd.md`, `reference/NOTES.md`, and
`tools/ROM_NOTES.md` for source-of-truth details.

---

## ✅ Phase 0 — Project scaffold  (DONE)
- Vite + TypeScript, zero-runtime-dep game code; `base: './'` for GitHub Pages.
- Portrait **224×256** canvas, integer-scaled, nearest-neighbour (pixel-crisp).
- Fixed-timestep loop (`src/engine/loop.ts`) decoupled from render.
- ROM tile renderer with per-tile colour tinting (`src/gfx/tiles.ts`).
- `npm run build` typechecks + bundles clean.

## ✅ Phase 1 — ROM extraction  (DONE — ahead of plan)
- **Graphics**: `cl07`/`cl08` decoded (8×8, 1bpp, bottom-to-top rows) →
  `src/gfx/romTiles.ts`. Font, thorns, walls, balloon all authentic.
- **Z80 toolchain**: disassembler (`tools/z80dasm.py`) + emulator (`tools/z80.py`).
- **Maze system reverse-engineered**: selector `0x283E` → 3 base sub-tables
  (`0x2860/0x2A5D/0x2CA5`); draw entry `0x235F`; thorn=`0x39`, space=`0x2E` (RLE
  skips open cells); start/goal from sub-table VRAM destinations.
- **All 3 base mazes extracted byte-exact** (`tools/draw_mazes.py`) and exported
  to `src/levels/mazes.ts` (`tools/export_levels.py`). Rendering in-browser.

---

## Phase 1.5 — Finish data extraction & render alignment  (NEXT, small)
Loose ends before gameplay; all low-risk, mostly tooling already in place.
- **Crop/viewport**: map the 32×32 VRAM to the 28×32 visible playfield (4 overscan
  columns). Lock the column offset so the full bordered playfield fits 224×256.
- **Tile semantics table**: classify every maze tile index → {empty, thorn(lethal),
  wall(lethal), start, goal} so collision/colour are data-driven, not guesses.
- **Per-level colour overlay**: extract or reconstruct the colour-PROM mapping so
  thorns recolour per level (cyan/magenta/green) as in the original.
- **Gameplay constants from ROM** (emulator makes this cheap): starting **lives**,
  **extra-life threshold**, **scoring** (progress points, goal bonus `1000`,
  green/purple bonus, backtrack penalty), **balloon swing** amplitude/period,
  **blower** idle delay, level→maze **sequence** + difficulty ramp. Capture into
  `src/engine/constants.ts` with ROM citations in `tools/ROM_NOTES.md`.
- **Done when**: a clean, correctly-cropped maze renders with correct colours, and
  all gameplay constants are pulled from ROM (or explicitly flagged as tuned).

## Phase 2 — Core engine: movement, swing, collision
- **Input**: keyboard 4-way (Arrows/WASD), abstracted for touch later.
- **Anchor + balloon**: move the anchor box on the 4-way axis; the balloon trails
  and **swings** continuously on its tether (pendulum from ROM amplitude/period).
- **Collision**: balloon circle vs. thorn/wall tile geometry, per the tile
  semantics table; precise and unforgiving → pop event.
- **Camera/scroll hook**: structure rendering so later scrolling-maze levels drop in.
- **Done when**: you can fly the balloon through maze 0, it swings, and it pops on
  any thorn/wall — running at 60 FPS.

## Phase 3 — Game rules & state machine
- **States**: attract → "LET'S ATTACK! PLAYER 1 LEVEL=N" → play → maze-clear →
  death → game-over, mirroring the original flow.
- **Goal/Start**: spawn at START; reaching GOAL completes the maze (+goal bonus).
- **Lives & respawn**: spare-balloon HUD, respawn at START, game-over at zero.
- **Scoring**: progress points, green/magenta **bonus zones**, **backtrack penalty**.
- **Blower face**: idle-timer mechanic that pushes the balloon toward thorns.
- **Level sequencing**: drive the ROM selector mapping (level → base maze + recolour).
- **Done when**: full single-life loop works: spawn → goal/death → next/respawn →
  game-over, with scoring and lives correct.

## Phase 4 — All mazes, recolour & advanced modifiers
- **Level set**: wire the full level→maze sequence with per-level recolour so the
  3 base layouts cycle exactly as the original does.
- **Moving spikes**: extract/define the moving-thorn behaviour for later levels.
- **Scrolling mazes**: implement maze scroll for the levels that use it.
- **Difficulty ramp**: speed/period/spawn tuning per level from ROM.
- **Done when**: progression through the full loop matches the original's
  escalation (moving spikes, scrolling), verified against reference footage.

## Phase 5 — Audio
- WebAudio cues (all source tunes are public domain): new-maze start jingle,
  balloon-loss sting, goal-proximity beeping, pop SFX.
- Unlock audio on first input; global mute (M). Optional: derive note/timing data
  from the ROM sound tables via the emulator.
- **Done when**: all cues fire at the right moments; mute works.

## Phase 6 — UI, mobile & polish
- Title/attract screen, HUD (SCORE-1/HI-SCORE), pause, game-over + high score
  (localStorage). Authentic interstitials.
- On-screen touch D-pad; responsive integer scaling; crisp pixels across browsers.
- **Done when**: complete, polished, playable on desktop + mobile.

## Phase 7 — Deploy to GitHub Pages
- `git init` + push; GitHub Actions workflow builds Vite → deploys `/dist` to Pages.
- Verify base path / asset loading on the live URL; `main` push auto-redeploys.
- **Done when**: the game is live and pushes redeploy automatically.

---

## Cross-cutting / nice-to-haves
- **Determinism**: keep update() fixed-step so swing/collision are reproducible.
- **Regression check**: a tool that renders extracted mazes to PNG for diffing
  against `reference/` after any extraction change.
- **ROM provenance**: `tools/ROM_NOTES.md` stays the canonical record of every
  address/constant we depend on.

## Status snapshot
| Phase | State |
|---|---|
| 0 Scaffold | ✅ done |
| 1 ROM extraction (gfx + 3 mazes) | ✅ done |
| 1.5 Data finish + render alignment | ✅ done |
| 2 Movement/swing/collision | ✅ done |
| 3 Rules & state machine | ✅ done |
| 4 Level cycle + recolour | ✅ done · moving spikes/scrolling deferred |
| 5 Audio | ✅ done |
| 6 UI/mobile/polish | ✅ done |
| 7 Deploy (GitHub Pages) | ✅ live: solutionrooms.github.io/crazy_balloon |

### Deferred / future refinements
- **Exact ROM constants**: lives, scoring values, swing amplitude/period, blower
  timing are currently tuned-to-reference; extract precise values via the emulator.
- **Moving spikes & scrolling mazes** for the higher difficulty loops (need ROM
  extraction of those behaviours).
- **ROM-font HUD**: HUD/overlays use a built-in 3×5 font; could swap to the
  authentic cl07 glyphs once the charset mapping is decoded.
- **Workflow**: bump GitHub Actions to Node 24 actions when convenient.
