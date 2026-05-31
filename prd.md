# Crazy Balloon — Product Requirements Document

## 1. Overview

A faithful, browser-playable recreation of Taito's 1980 arcade maze game
**Crazy Balloon**, hosted as a static site on GitHub Pages.

The player guides a balloon (a box on a string with a continually swinging
balloon attached) through a series of thorn-filled mazes to reach the goal,
without letting the balloon touch any spike. Levels, layouts, timings, and
behaviour are recreated to match the original as closely as practical, using
the original ROM (`/rom`) and reference footage as source material.

- **Genre:** Single-screen maze / arcade action
- **Original:** Taito, 1980, Z80 hardware, 256×224 display, 8 mazes
- **Target:** Modern desktop & mobile browsers, served from GitHub Pages
- **Fidelity goal:** Faithful recreation (look, feel, level set, rules) — not a
  cycle-exact emulator.

## 2. Goals & Non-Goals

### Goals
- Recreate the 8 original mazes and their progression/difficulty escalation.
- Reproduce the signature mechanic: a balloon that **continuously swings** while
  the player moves the anchor box on a 4-way axis.
- Faithful collision: the balloon pops on any spike/thorn/wall contact.
- Reproduce the **blower face** idle mechanic, scoring, lives, bonus zones, and
  the maze-loop with rising difficulty (moving spikes, scrolling mazes).
- Authentic-feeling audio cues (all source tunes are public domain).
- Smooth 60 FPS, crisp pixel-art scaling, keyboard + touch controls.
- One-command local dev and an automated deploy to GitHub Pages.

### Non-Goals
- Not a MAME-style Z80 emulator. We do not execute the ROM.
- No online multiplayer / leaderboards in v1 (local high score only).
- No exact reproduction of proprietary artwork; we redraw assets in the same
  style and resolution.

## 3. Source Material

| Asset | Location | Use |
|---|---|---|
| Program ROM `cl01–cl07` (2KB each, Z80) | `/rom` | Extract maze layouts, spike positions, timing constants, scoring tables where feasible |
| Graphics data `cl08` | `/rom` | Reference for balloon/box/spike/goal sprite shapes (balloon bitmap confirmed present) |
| Wikipedia + reference footage | external | Behaviour, audio cues, difficulty curve, level appearance |

Extraction is best-effort: where ROM bytes are decodable into clean layouts we
use them; otherwise we recreate the maze from reference footage at the original
grid resolution. Either path must produce data in our own level format (§6).

## 4. Gameplay Requirements

### 4.1 Core loop
1. Maze loads; intro jingle plays; balloon spawns at the start.
2. Player moves the anchor box with 4-way input; the balloon trails and **swings
   left↔right continuously** on a pendulum, independent of input.
3. Reaching the goal completes the maze → score tally → next maze.
4. Balloon touching any spike/wall = pop → lose a life → respawn or game over.
5. After the final maze the set loops with increased difficulty.

### 4.2 Mechanics (faithful)
- **Balloon swing:** constant horizontal oscillation of the balloon relative to
  its anchor; amplitude/period are tuning constants seeded from ROM analysis.
- **Collision:** circle (balloon) vs. maze thorn geometry; precise, unforgiving.
- **Blower face:** if the player idles too long, an on-screen face appears and
  blows the balloon toward the spikes, forcing movement (no hard timer).
- **Bonus zones:** safely traversing green and purple maze sections awards bonus
  points; **backtracking removes points**.
- **Difficulty escalation:** later mazes / loop iterations introduce moving
  spikes and scrolling mazes.
- **Lives & scoring:** starting lives, extra-life threshold, and point values
  recreated from ROM/reference.

### 4.3 Controls
- **Keyboard:** Arrow keys / WASD (4-way). Enter/Space = start. P = pause. M = mute.
- **Touch:** on-screen D-pad for mobile.
- 4-way movement only (no diagonals), matching the original joystick.

### 4.4 Audio (all public-domain source tunes)
- New-maze start jingle ("Oh! Susanna").
- Balloon-loss sting (Toreador chorus from Bizet's *Carmen*).
- Proximity beeping near the goal; pop SFX.
- WebAudio synthesis or short samples; global mute.

## 5. Technical Requirements

- **Stack:** TypeScript + Vite; HTML5 Canvas 2D rendering.
- **Rendering:** fixed internal resolution matching the original **portrait**
  aspect (224×256, vertical monitor), integer-scaled to the viewport,
  nearest-neighbour (pixel-crisp). See `reference/NOTES.md` for the verified
  visual spec (HUD, thorn sprites, per-level recolour, START/GOAL, lives).
- **Loop:** fixed-timestep update (decoupled from render) for deterministic
  swing/collision; `requestAnimationFrame` render.
- **No runtime deps** beyond what Vite needs; game code dependency-free.
- **Performance:** sustained 60 FPS on mid-range laptop & phone.
- **Hosting:** GitHub Pages via GitHub Actions building the Vite app to `/dist`.
  Base path configured for project-page hosting.
- **Browser support:** latest Chrome/Firefox/Safari/Edge, desktop + mobile.

## 6. Data / Level Format

Mazes stored as versioned JSON/TS describing, per level:
- Grid dimensions and tile scale.
- Wall/thorn geometry (line segments or tile grid).
- Start position, goal position, bonus (green/purple) zones.
- Per-level modifiers: moving-spike definitions, scroll behaviour, swing tuning.

This format is the contract between the ROM-extraction tooling and the engine,
so levels can be authored/extracted independently of game code.

## 7. Success Criteria

- All 8 mazes playable, visually recognizable, in the original order.
- Swing + collision feel matches reference footage.
- Blower, bonus zones, lives, scoring, and difficulty loop all functioning.
- Runs at 60 FPS; playable on keyboard and touch.
- Live on GitHub Pages from a single `main` push.

## 8. Risks

| Risk | Mitigation |
|---|---|
| ROM maze data not cleanly decodable without full Z80 disassembly | Faithful recreation from reference footage at original resolution; keep extraction time-boxed |
| Swing/collision tuning "feel" hard to match | Iterate against side-by-side reference video; expose tuning constants |
| GitHub Pages base-path / asset issues | Configure Vite `base`, verify with a preview build before launch |
| Audio autoplay restrictions | Start audio on first user input; provide mute |

## 9. Milestones
See `plan.md` for the phased implementation plan.
