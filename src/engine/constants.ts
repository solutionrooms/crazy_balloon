// Native display geometry. The arcade ran 256x224 landscape with the monitor
// rotated 90° (ROT90), so the player sees a 224x256 portrait image.
export const TILE = 8;
export const COLS = 28; // 224 / 8 — playfield width in tiles (portrait)
export const ROWS = 32; // 256 / 8 — playfield height in tiles (portrait)
export const SCREEN_W = COLS * TILE; // 224
export const SCREEN_H = ROWS * TILE; // 256

// Fixed simulation step (decoupled from render). 60 Hz like the original.
export const STEP_HZ = 60;
export const STEP_MS = 1000 / STEP_HZ;

// Crazy Balloon's colour overlay palette (approximated from reference frames).
export const PALETTE = {
  black: "#000000",
  cyan: "#00ffff",
  magenta: "#ff45c8",
  green: "#36e000",
  yellow: "#ffe000",
  red: "#ff2020",
  white: "#ffffff",
  border: "#5a5a64",
} as const;

export type ColorName = keyof typeof PALETTE;

// Crazy Balloon color-RAM palette index (low nibble) -> our colour.
export const COLOR_PALETTE: ColorName[] = [
  "cyan",    // 0
  "cyan",    // 1  cyan thorns
  "magenta", // 2  magenta thorns
  "magenta", // 3
  "red",     // 4
  "green",   // 5  green thorns + START
  "red",     // 6  GOAL
  "yellow",  // 7
  "white",   // 8
  "white", "white", "white", "white", "white", "white", "white", // 9-15
];

// Spike colours the editor cycles through (palette indices).
export const SPIKE_COLORS = [1, 2, 5, 4, 7, 8];

// --- Visible viewport: the 32x32 VRAM has 4 overscan columns; the maze content
// sits in cols 5..30, rows 3..29 (verified across all 3 base mazes). ---
export const CROP_LEFT_COLS = 4; // show cols 4..31 -> border ~1 col from edges
export const HUD_ROWS = 3; // top rows reserved for SCORE/HI-SCORE

// --- Gameplay constants. GOAL_BONUS is from the ROM/footage (1000); the swing
// and speed values are tuned to reference footage (flagged in ROM_NOTES.md as
// TODO: extract exact values via the emulator). ---
export const BALLOON_RADIUS = 3.3; // px; balloon ~7px, threads 8px lanes tightly
export const SWING_AMPLITUDE_PX = 7; // horizontal sway half-width
export const SWING_PERIOD_SEC = 1.5; // seconds per full left-right swing
export const MOVE_SPEED_PX = 46; // anchor move speed (px/s)
export const START_LIVES = 3;
export const GOAL_BONUS = 1000;
export const PROGRESS_POINTS = 10; // points per new cell entered (toward goal)
export const BLOWER_IDLE_SEC = 4; // idle time before the blower nudges you
export const BLOWER_PUSH_PX = 14; // blower drift strength (px/s)
export const EXTRA_LIFE_SCORE = 10000; // award a spare balloon at this score
export const READY_SEC = 1.6; // "LET'S ATTACK" interstitial duration
// Per-loop difficulty ramp (a loop = one pass through the 3 base mazes).
export const SWING_AMP_PER_LOOP = 1.6; // +px swing amplitude each loop
export const MOVE_SPEED_PER_LOOP = 5; // +px/s move speed each loop
export const SPIKE_SPEED_BASE = 1.4; // moving-spike cells/sec at loop 1
