# Visual & gameplay reference notes

Source: YouTube `w7jTohI5h48` — "Arcade Game: Crazy Balloon (1980 Taito)", 12:29
longplay (silent). Frames extracted to `reference/w7jTohI5h48/frames/` (80 @
~0.1 fps). The raw video is gitignored; frames are kept.

These notes are ground truth for the look/feel; fold into `prd.md`.

## Screen & layout
- **Vertical (portrait) screen**, ~taller than wide. Black background.
- **HUD strip across the top:** `SCORE-1` (green, left) · `HI-SCORE` (white,
  centre) · `SCORE-2` (magenta, right), each with a numeric value beneath.
  In 1-player play, `SCORE-2` drops off and only `SCORE-1` + `HI-SCORE` show.
- **Playfield:** a grey-bordered rectangle filling the area below the HUD.

## The balloon (player)
- A **round balloon on a short string/tether with a small anchor box** at the
  string's end. The player moves the unit on a 4-way axis; the balloon **swings**
  on the tether (string angle visibly changes frame to frame).
- Balloon colour tracks the **per-level colour theme** (seen red, magenta,
  yellow across levels) — not a fixed colour.

## Thorns / maze
- Maze walls are dense clusters of **asterisk/snowflake "thorn" sprites** (✳),
  in **cyan, magenta (purple), and green**. Open black lanes wind between them.
- The whole maze **recolours each level** (cyan-dominant → mixed magenta/green →
  etc.). Green & magenta thorn sections correspond to the **bonus zones**.

## START / GOAL
- **START** = a green bar labelled `START`. **GOAL** = a red bar labelled `GOAL`,
  often with a **`1000`** bonus value shown next to it (goal-reach bonus).
- Their positions move per maze (e.g. Maze A: START bottom-right, GOAL mid-left;
  Maze B: START top-right, GOAL mid-right inside a red bracket enclosure).
- At least **two+ distinct maze layouts** observed; layouts cycle/recolour with
  rising level.

## Lives
- **Spare balloons** drawn as small balloon icons in a bottom corner; count =
  remaining lives (saw 2–3, increasing — extra life awarded).

## Interstitials / messages
- Attract: animated `CRAZY BALLOON` title (box traces letters), blinking
  `INSERT COIN`.
- Maze start: **`LET'S ATTACK !  PLAYER 1  LEVEL= N`** screen.
- `BONUS` tally shown top-left at maze completion; `1000` near GOAL = goal bonus.

## Scoring (from HUD progression)
- Score climbs while traversing toward the goal; reaching GOAL adds the `1000`
  (or shown) bonus. (Backtrack penalty per Wikipedia — to confirm on focused
  passes.) Score samples: 1300 → 4680 → 11000 (LVL6) → 18830 → 30130 → 47080.

## TODO — focused traces (next)
Re-run `/watch` with `--start/--end --resolution 1024` on individual mazes to
trace exact thorn geometry, START/GOAL cells, and bonus-zone placement into the
level format. The 12-min/80-frame pass is too sparse for cell-accurate layouts.
