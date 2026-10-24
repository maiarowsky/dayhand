// What a screen paints and where its clickable parts are. Hits use the
// screen's own rows (0 = its first row); the frame adds its offset.
import type { ViewName } from "../state.js";
import type { Row } from "../text.js";

export type Target =
  | { kind: "tab"; view: ViewName }
  | { kind: "task"; index: number; column?: number; day?: number }
  | { kind: "agent"; index: number }
  | { kind: "day"; day: number };

export type Hit = { y: number; x0: number; x1: number; target: Target };
export type Screen = { rows: Row[]; hits: Hit[] };

export const hitRow = (y: number, width: number, target: Target, x0 = 0): Hit => ({ y, x0, x1: x0 + width, target });

/** Shifts hits down by `dy` rows and right by `dx` columns. */
export const offsetHits = (hits: Hit[], dy: number, dx = 0): Hit[] => hits.map((h) => ({ ...h, y: h.y + dy, x0: h.x0 + dx, x1: h.x1 + dx }));
