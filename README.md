# Crazy Balloon

A faithful, browser-playable recreation of Taito's 1980 arcade maze game
**Crazy Balloon**, built with TypeScript + Vite and hosted on GitHub Pages.

You guide a continually-swinging balloon through thorn-filled mazes from START to
GOAL without popping it. Levels, graphics, and behaviour are reconstructed
**byte-exact from the original ROM** (see below).

## How it's built

- **Engine:** TypeScript + HTML5 Canvas, fixed-timestep loop, portrait 224×256
  (the original ran 256×224 rotated 90°), integer-scaled pixel-crisp rendering.
- **Graphics & levels from ROM:** the 8×8 tiles (`cl07`) and the three base maze
  layouts were extracted by a from-scratch **Z80 emulator** (`tools/z80.py`) that
  boots the real program ROM and runs its own maze-draw routine, capturing VRAM.
  See `tools/ROM_NOTES.md` for the reverse-engineering details and `plan.md` for
  the roadmap.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build to dist/
```

The extraction tools in `tools/` expect the original ROM in `rom/` (not included —
see below) and regenerate `src/gfx/romTiles.ts` and `src/levels/mazes.ts`.

## A note on the ROM / copyright

This is a fan recreation for educational purposes. The **original ROM binaries are
not included** in this repository and must be supplied locally to run the
extraction tools. The runtime contains graphics and level data derived from the
original ROM; all rights to the original *Crazy Balloon* belong to Taito.

## Status

Active development — see `plan.md` for phases and `prd.md` for the product spec.
