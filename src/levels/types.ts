import type { ColorName } from "../engine/constants";

/**
 * Level (maze) data format — the contract between ROM extraction (tools/) and
 * the engine. A maze is a grid of tile cells plus metadata. Cell values index
 * a small semantic set; the renderer maps them to ROM tile indices + colours.
 *
 * Populated from the program ROM (cl01–cl06) where decodable, otherwise traced
 * from reference footage. See prd.md §6 and reference/NOTES.md.
 */

export type CellKind =
  | 0 // empty (open lane)
  | 1 // thorn / wall (lethal on balloon contact)
  | 2 // start marker
  | 3; // goal marker

export interface MovingSpike {
  /** Tile-grid path the spike oscillates along (inclusive endpoints). */
  from: [col: number, row: number];
  to: [col: number, row: number];
  /** Cells per second. */
  speed: number;
}

export interface Level {
  id: number;
  name: string;
  /** COLS x ROWS grid, row-major. Length must be COLS*ROWS. */
  cells: Uint8Array;
  start: [col: number, row: number];
  goal: [col: number, row: number];
  /** Colour theme for this maze (thorns recolour per level). */
  theme: ColorName;
  /** Bonus-zone tints keyed by region; magenta/green pay bonus points. */
  bonusZones?: Array<{ color: ColorName; cells: Array<[number, number]> }>;
  movingSpikes?: MovingSpike[];
  /** Goal-reach bonus value (e.g. 1000). */
  goalBonus: number;
  /** Per-level swing tuning, falling back to engine defaults. */
  swing?: { amplitudePx: number; periodSec: number };
}
