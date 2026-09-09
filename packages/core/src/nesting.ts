import type { Grain, Part, Stock } from "./models";
import { boardFeet } from "./units";

/** A single part placed onto a single stock item. Coordinates are in inches:
 *  x runs along the stock's length, y along its width. */
export interface PlacedPart {
  partId: string;
  partName: string;
  stockId: string;
  x: number;
  y: number;
  /** Footprint along the stock's length (real inches, kerf excluded). */
  width: number;
  /** Footprint along the stock's width (real inches, kerf excluded). */
  height: number;
  rotated: boolean;
  grain: Grain;
  thickness: number;
}

/** A leftover region on a stock item (real inches). */
export interface Offcut {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a layout's stock item was produced from its physical source.
 *  - "exact": used at its own thickness (also sheets).
 *  - "plane": one layer planed down from thicker stock (thickness difference is waste).
 *  - "resaw": one of several layers sawn out of a thicker board. */
export type SourceMode = "exact" | "plane" | "resaw";

/** The filled layout of one stock item (one instance). */
export interface StockLayout {
  stockId: string;
  stock: Stock;
  parts: PlacedPart[];
  offcuts: Offcut[];
  sourceMode: SourceMode;
  /** The physical stock item this layout belongs to (=== stock for "exact"). */
  sourceStock: Stock;
  /** Total layers carved out of sourceStock (1 for exact/plane). */
  sourceLayers: number;
  /** Percent of this stock item's usable material consumed by placed parts (0–100). */
  usedPercent: number;
}

export interface Unplaced {
  partId: string;
  partName: string;
  quantity: number;
  reason: "no_stock" | "no_fit";
}

export interface NestStats {
  partsPlaced: number;
  partsUnplaced: number;
  board: { boughtBdFt: number; usedBdFt: number; wasteBdFt: number; wastePercent: number };
  sheet: { totalArea: number; usedArea: number; wastePercent: number };
  /** "plane" = one thinner layer from a thicker board (no extra layers). */
  plane: { boardsPlaned: number };
  /** "resaw" = a thicker board split into multiple thinner layers. */
  resaw: { boardsResawn: number; layersCreated: number };
}

export interface NestResult {
  layouts: StockLayout[];
  unplaced: Unplaced[];
  stats: NestStats;
  kerf: number;
  resawKerf: number;
}

interface Orientation {
  along: number;
  across: number;
  rotated: boolean;
}

interface Lane {
  width: number;
  x: number;
  used: number;
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function expandParts(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const n = Math.max(1, Math.round(p.quantity || 0));
    for (let i = 0; i < n; i++) out.push({ ...p, quantity: 1, id: `${p.id}#${i + 1}` });
  }
  return out;
}

function expandStock(items: Stock[]): Stock[] {
  const out: Stock[] = [];
  for (const s of items) {
    const n = Math.max(1, Math.round(s.qty || 0));
    for (let i = 0; i < n; i++) out.push({ ...s, qty: 1, id: `${s.id}#${i + 1}` });
  }
  return out;
}

/** How many layers of `partThickness` can be sawn (or planed) out of a board of
 *  `stockThickness`. Each resaw cut removes one `kerf`; exact-match stock yields
 *  one layer. Returns 0 when the stock is thinner than the part. */
export function resawLayers(stockThickness: number, partThickness: number, kerf: number): number {
  if (stockThickness < partThickness) return 0;
  return Math.floor((stockThickness + kerf) / (partThickness + kerf));
}

function exactMeta(parts: PlacedPart[], stock: Stock): { sourceMode: SourceMode; sourceStock: Stock; sourceLayers: number; usedPercent: number } {
  return { sourceMode: "exact", sourceStock: stock, sourceLayers: 1, usedPercent: layoutUsedPercent(parts, stock) };
}

function validateInput(opts: { parts: Part[]; stock: Stock[]; kerf: number }): void {
  if (!Number.isFinite(opts.kerf) || opts.kerf < 0) throw new RangeError(`kerf must be >= 0 (got ${opts.kerf}).`);
  for (const p of opts.parts) {
    if (p.quantity < 1) throw new RangeError(`part "${p.name}" has quantity < 1.`);
    for (const dim of [p.length, p.width, p.thickness]) {
      if (!Number.isFinite(dim) || dim <= 0) throw new RangeError(`part "${p.name}" has non-positive dimension (${dim}).`);
    }
  }
  for (const s of opts.stock) {
    if (s.qty < 1) throw new RangeError(`stock "${s.name}" has qty < 1.`);
    for (const dim of [s.length, s.width, s.thickness]) {
      if (!Number.isFinite(dim) || dim <= 0) throw new RangeError(`stock "${s.name}" has non-positive dimension (${dim}).`);
    }
  }
}

function sheetOrientation(p: Part, kerf: number): Orientation[] {
  const opts: Orientation[] = [];
  if (p.grain !== "along_width") opts.push({ along: p.length, across: p.width, rotated: false });
  if (p.grain !== "lengthwise") opts.push({ along: p.width, across: p.length, rotated: true });
  return opts;
}

function boardOrientation(p: Part, boardWidth: number): Orientation[] {
  const opts: Orientation[] = [];
  if (p.grain !== "along_width") opts.push({ along: p.length, across: p.width, rotated: false });
  if (p.grain !== "lengthwise") opts.push({ along: p.width, across: p.length, rotated: true });
  return opts.filter((o) => o.across <= boardWidth);
}

function pruneFreeRects(rects: FreeRect[]): FreeRect[] {
  return rects.filter(
    (r) =>
      r.w > 0 &&
      r.h > 0 &&
      !rects.some(
        (k) =>
          k !== r &&
          k.x <= r.x &&
          k.y <= r.y &&
          k.x + k.w >= r.x + r.w &&
          k.y + k.h >= r.y + r.h,
      ),
  );
}

/** Cut `placed` (the kerf-inflated footprint of a part just set down) out of
 *  every free rectangle it intersects, so no free rectangle ever overlaps a
 *  placed part. Each intersected rect is re-split into the maximal slabs
 *  outside the footprint (left/right at full height, top/bottom at full
 *  width); the overlaps between those slabs are harmless and the pruner
 *  collapses the redundant ones. This keeps MaxRects free-space consistent,
 *  which prevents phantom overlaps and lets later parts pack denser. */
function trimFreeRects(rects: FreeRect[], placed: { x: number; y: number; w: number; h: number }): FreeRect[] {
  const out: FreeRect[] = [];
  for (const F of rects) {
    const ox = Math.max(F.x, placed.x);
    const oy = Math.max(F.y, placed.y);
    const ox2 = Math.min(F.x + F.w, placed.x + placed.w);
    const oy2 = Math.min(F.y + F.h, placed.y + placed.h);
    if (ox2 - ox <= 1e-9 || oy2 - oy <= 1e-9) {
      out.push(F);
      continue;
    }
    const left = { x: F.x, y: F.y, w: ox - F.x, h: F.h };
    const right = { x: ox2, y: F.y, w: F.x + F.w - ox2, h: F.h };
    const top = { x: F.x, y: F.y, w: F.w, h: oy - F.y };
    const bottom = { x: F.x, y: oy2, w: F.w, h: F.y + F.h - oy2 };
    for (const s of [left, right, top, bottom]) {
      if (s.w > 1e-9 && s.h > 1e-9) out.push(s);
    }
  }
  return out;
}

function placedPart(p: Part, stock: Stock, o: Orientation, x: number, y: number): PlacedPart {
  return { partId: p.id, partName: p.name, stockId: stock.id, x, y, width: o.along, height: o.across, rotated: o.rotated, grain: p.grain, thickness: p.thickness };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Area of the union of axis-aligned rectangles (overlaps counted once). */
function rectUnionArea(rects: Box[]): number {
  if (rects.length === 0) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const w = x1 - x0;
    if (w <= 0) continue;
    const ys = rects
      .filter((r) => r.x <= x0 + 1e-9 && r.x + r.w >= x1 - 1e-9)
      .map((r) => [r.y, r.y + r.h])
      .sort((a, b) => a[0] - b[0]);
    let totalY = 0;
    let curStart = NaN;
    let curEnd = NaN;
    for (const [s, e] of ys) {
      if (Number.isNaN(curStart)) {
        curStart = s;
        curEnd = e;
      } else if (s <= curEnd + 1e-9) {
        curEnd = Math.max(curEnd, e);
      } else {
        totalY += curEnd - curStart;
        curStart = s;
        curEnd = e;
      }
    }
    if (!Number.isNaN(curStart)) totalY += curEnd - curStart;
    area += w * totalY;
  }
  return area;
}

/** The stock item a layout's utilization/waste is reported against. A planed
 *  board reports against the physical source (its thickness difference is
 *  sawdust), while an exact board or resawn layer reports against the actual
 *  stock cut into — so a full resawn layer is 100% used, not ciproportional to
 *  its thicker source. */
function reportBase(layout: StockLayout): Stock {
  return layout.sourceMode === "plane" ? layout.sourceStock : layout.stock;
}

/** Share of a stock item consumed by placed parts, relative to the given
 *  reporting base (see `reportBase`). Boards measure board-ft; sheets measure
 *  area. Overlapping parts count once (union of footprints), so a manual
 *  arrangement that doubles up parts shows up in the number instead of
 *  over-counting. Clamped to 0–100. */
function layoutUsedPercent(parts: PlacedPart[], source: Stock): number {
  if (parts.length === 0) return 0;
  const usedFootprint = rectUnionArea(parts.map((p) => ({ x: p.x, y: p.y, w: p.width, h: p.height })));
  if (source.type === "sheet") {
    const totalArea = source.length * source.width;
    if (totalArea <= 0) return 0;
    return Math.max(0, Math.min(100, (usedFootprint / totalArea) * 100));
  }
  // all parts on one board share the same thickness layer, so footage is
  // footprint area × layer thickness.
  const layerThickness = parts[0].thickness;
  const totalBdFt = boardFeet(source.length, source.width, source.thickness);
  if (totalBdFt <= 0) return 0;
  const usedBdFt = (usedFootprint * layerThickness) / 144;
  return Math.max(0, Math.min(100, (usedBdFt / totalBdFt) * 100));
}

export type LayoutViolation = "out_of_bounds" | "overlap" | "kerf" | "grain";

/** Free (uncovered) regions of a stock item after parts are placed, computed
 *  from the part footprints themselves so manual edits (moves, relocations,
 *  rotations) stay in sync. Bands between part top/bottom edges are decomposed
 *  into the uncovered x-intervals; overlapping parts count once. */
export function recomputeOffcuts(stock: Stock, parts: PlacedPart[]): Offcut[] {
  if (parts.length === 0) return [{ x: 0, y: 0, width: stock.length, height: stock.width }];
  const cl = (v: number) => Math.max(0, Math.min(v, stock.length));
  const ys = new Set<number>([0, stock.width]);
  for (const p of parts) {
    ys.add(Math.max(0, p.y));
    ys.add(Math.min(stock.width, p.y + p.height));
  }
  const bands = [...ys].filter((y) => y >= 0 && y <= stock.width).sort((a, b) => a - b);
  const offcuts: Offcut[] = [];
  for (let i = 0; i + 1 < bands.length; i++) {
    const y0 = bands[i];
    const y1 = bands[i + 1];
    if (y1 - y0 <= 1e-9) continue;
    const covered: { s: number; e: number }[] = [];
    for (const p of parts) {
      const py0 = p.y;
      const py1 = p.y + p.height;
      if (py1 <= y0 + 1e-9 || py0 >= y1 - 1e-9) continue;
      covered.push({ s: cl(p.x), e: cl(p.x + p.width) });
    }
    if (covered.length === 0) {
      offcuts.push({ x: 0, y: y0, width: stock.length, height: y1 - y0 });
      continue;
    }
    covered.sort((a, b) => a.s - b.s);
    const merged: { s: number; e: number }[] = [];
    for (const c of covered) {
      const last = merged[merged.length - 1];
      if (last && c.s <= last.e + 1e-9) last.e = Math.max(last.e, c.e);
      else merged.push({ s: c.s, e: c.e });
    }
    let x = 0;
    for (const m of merged) {
      if (m.s > x + 1e-9) offcuts.push({ x, y: y0, width: m.s - x, height: y1 - y0 });
      x = Math.max(x, m.e);
    }
    if (x < stock.length - 1e-9) offcuts.push({ x, y: y0, width: stock.length - x, height: y1 - y0 });
  }
  return offcuts.filter((o) => o.width > 1e-9 && o.height > 1e-9);
}

/** For each part already on a stock item, which rules a manual placement would
 *  break. Checks bounds, overlap, kerf separation between parts, and grain
 *  direction (lengthwise parts must stay un-rotated, along-width must stay
 *  rotated). */
export function layoutViolations(layout: StockLayout, kerf: number): Record<string, LayoutViolation[]> {
  const violations: Record<string, Set<LayoutViolation>> = {};
  const add = (partId: string, v: LayoutViolation) => {
    (violations[partId] ??= new Set()).add(v);
  };
  const { parts, stock } = layout;
  const eps = 1e-9;
  for (const p of parts) {
    if (p.x < -eps || p.y < -eps || p.x + p.width > stock.length + eps || p.y + p.height > stock.width + eps) {
      add(p.partId, "out_of_bounds");
    }
    if (p.grain === "lengthwise" && p.rotated) add(p.partId, "grain");
    if (p.grain === "along_width" && !p.rotated) add(p.partId, "grain");
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (overlapX > eps && overlapY > eps) {
        add(a.partId, "overlap");
        add(b.partId, "overlap");
      } else if (overlapX > eps) {
        const gapY = Math.abs(b.y - (a.y + a.height)) || Math.abs(a.y - (b.y + b.height));
        if (gapY < kerf - eps) {
          add(a.partId, "kerf");
          add(b.partId, "kerf");
        }
      } else if (overlapY > eps) {
        const gapX = Math.abs(b.x - (a.x + a.width)) || Math.abs(a.x - (b.x + b.width));
        if (gapX < kerf - eps) {
          add(a.partId, "kerf");
          add(b.partId, "kerf");
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(violations).map(([id, s]) => [id, [...s]]));
}

/** Returns a new layout with the given parts moved to new coordinates, and
 *  `usedPercent` recomputed from the resulting arrangement. */
export function applyPartMoves(layout: StockLayout, moves: Record<string, { x: number; y: number }>): StockLayout {
  const keys = Object.keys(moves);
  if (keys.length === 0) return layout;
  const parts = layout.parts.map((p) => {
    const m = moves[p.partId];
    return m ? { ...p, x: m.x, y: m.y } : p;
  });
  return { ...layout, parts, offcuts: recomputeOffcuts(layout.stock, parts), usedPercent: layoutUsedPercent(parts, reportBase(layout)) };
}

/** Rotate a part 90° about its center so it stays visually in place. Kept in
 *  bounds when it fits; clamped half-out-of-bounds (still grabbable) otherwise. */
function rotatedPlacement(p: PlacedPart, stock: Stock, rotated: boolean): PlacedPart {
  if (p.rotated === rotated) return p;
  // Grain-locked parts cannot flip (reproduces the optimizer's constraints).
  if (rotated && p.grain === "lengthwise") return p;
  if (!rotated && p.grain === "along_width") return p;
  const width = p.height;
  const height = p.width;
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const x = cx - width / 2;
  const y = cy - height / 2;
  const clampAlong = (v: number) => (width <= stock.length ? Math.max(0, Math.min(v, stock.length - width)) : Math.max(-width / 2, Math.min(v, stock.length - width / 2)));
  const clampAcross = (v: number) => (height <= stock.width ? Math.max(0, Math.min(v, stock.width - height)) : Math.max(-height / 2, Math.min(v, stock.width - height / 2)));
  return { ...p, x: clampAlong(x), y: clampAcross(y), width, height, rotated };
}

/** Returns a new layout with the given parts rotated to the requested
 *  orientation (true = footprint along the stock's width axis), recomputing
 *  `usedPercent`. Grain-locked parts are left alone. */
export function applyPartRotations(layout: StockLayout, rotations: Record<string, boolean>): StockLayout {
  const keys = Object.keys(rotations);
  if (keys.length === 0) return layout;
  let changed = false;
  const parts = layout.parts.map((p) => {
    const want = rotations[p.partId];
    if (want === undefined) return p;
    const next = rotatedPlacement(p, layout.stock, want);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...layout, parts, offcuts: recomputeOffcuts(layout.stock, parts), usedPercent: layoutUsedPercent(parts, reportBase(layout)) } : layout;
}

/** A manual override for one part: where it lives, where it sits, and whether
 *  it is rotated. `stockId` absent keeps the part on its original layout. */
export interface PartEdit {
  stockId?: string;
  x: number;
  y: number;
  rotated?: boolean;
}

/** Whether a dragged part could be dropped onto a stock layout. Thick boards
 *  could plane/resaw down to the part, but to keep per-layout thickness
 *  bookkeeping exact, transfers require matching thickness for now. */
export function canPlacePartOnStock(part: PlacedPart, stock: Stock): boolean {
  return Math.abs(part.thickness - stock.thickness) < 1e-9;
}

/** Resolve one edited part against a target layout. `x`/`y` are authoritative
 *  (final top-left); a requested rotation swaps the footprint and grain-locked
 *  parts stay put. Returns the resolved part or null if it left this layout. */
function applyOneEdit(p: PlacedPart, L: StockLayout, e: PartEdit): PlacedPart | null {
  // A part explicitly assigned to another layout leaves this one.
  if (e.stockId && e.stockId !== L.stockId) return null;
  let next: PlacedPart = { ...p, x: e.x, y: e.y };
  if (e.rotated !== undefined && e.rotated !== next.rotated) {
    const allowed = e.rotated ? p.grain !== "lengthwise" : p.grain !== "along_width";
    next = allowed ? { ...next, width: next.height, height: next.width, rotated: e.rotated } : next;
  }
  return next;
}

/** Applies manual edits (same-board moves, cross-board relocations, rotations)
 *  across all layouts, recomputing each affected layout's offcuts and
 *  `usedPercent`. Parts moved to another layout are removed from their origin
 *  and mounted on the target; edits for parts that no longer exist are ignored.
 *  Layouts with no effective edits keep their original identity (and offcuts),
 *  so unchanged boards are not rebuilt. */
export function applyPartEdits(layouts: StockLayout[], edits: Record<string, PartEdit>): StockLayout[] {
  if (Object.keys(edits).length === 0) return layouts;
  const base = new Map<string, PlacedPart>();
  for (const l of layouts) for (const p of l.parts) base.set(p.partId, p);
  return layouts.map((L) => {
    let changed = false;
    const parts = L.parts.flatMap((p) => {
      const e = edits[p.partId];
      if (!e) return [p];
      const next = applyOneEdit(p, L, e);
      if (next === null) {
        changed = true;
        return [];
      }
      if (next.x !== p.x || next.y !== p.y || next.rotated !== p.rotated) changed = true;
      return [next];
    });
    for (const [id, e] of Object.entries(edits)) {
      if (e.stockId !== L.stockId) continue;
      if (L.parts.some((p) => p.partId === id)) continue;
      const src = base.get(id);
      if (!src) continue;
      const moved = applyOneEdit({ ...src, stockId: L.stock.id }, L, e);
      if (moved) {
        parts.push(moved);
        changed = true;
      }
    }
    if (!changed) return L;
    return { ...L, parts, offcuts: recomputeOffcuts(L.stock, parts), usedPercent: layoutUsedPercent(parts, reportBase(L)) };
  });
}

/** Real material a layout consumes, computed directly from the placed parts:
 *  boards consume board-ft of the union of their footprints × part thickness
 *  (so a plane-loss-only gap over a planed board is excluded), sheets consume
 *  footprint area. Overlaps count once, so stacking parts shows the intended
 *  reduction instead of double-counting. */
export function layoutUsed(layout: StockLayout): { bdFt: number; area: number } {
  const footprint = rectUnionArea(layout.parts.map((p) => ({ x: p.x, y: p.y, w: p.width, h: p.height })));
  if (layout.stock.type === "sheet") {
    return { bdFt: 0, area: footprint };
  }
  const layerThickness = layout.parts.length > 0 ? layout.parts[0].thickness : 0;
  return { bdFt: (footprint * layerThickness) / 144, area: 0 };
}

/** Unused material on a stock item that actually received parts, relative to
 *  its `reportBase`: a planed board carries waste against its physical size
 *  (plane loss counts), while resawn layers and exact boards against the stock
 *  cut into — so an idle resawn layer is inventory, not waste, and only a board
 *  with pieces on it reports waste. Sheets report area; boards report bd-ft. */
export function layoutWaste(layout: StockLayout): { bdFt: number; area: number } {
  const used = layoutUsed(layout);
  if (layout.stock.type === "sheet") {
    return { bdFt: 0, area: Math.max(0, layout.stock.length * layout.stock.width - used.area) };
  }
  const base = reportBase(layout);
  return { bdFt: Math.max(0, boardFeet(base.length, base.width, base.thickness) - used.bdFt), area: 0 };
}

/** 2D bin packing onto sheet goods. Parts get a kerf margin on all four sides
 *  (effective size +kerf) inside a sheet inflated by one kerf, so adjacent
 *  parts keep a real kerf gap. Grain rotates a part to point its length along
 *  or across the sheet's grain. */
export function nestSheets(parts: Part[], sheets: Stock[], kerf: number): { layouts: StockLayout[]; leftover: Part[] } {
  const layouts: StockLayout[] = [];
  const remaining = [...parts].sort((a, b) => area(b) - area(a));
  for (const stock of expandStock(sheets)) {
    const freeRects: FreeRect[] = [{ x: 0, y: 0, w: stock.length + kerf, h: stock.width + kerf }];
    const placed: PlacedPart[] = [];
    const unplaced: Part[] = [];
    for (const p of remaining) {
      const oriented = sheetOrientation(p, kerf).map((o) => ({
        ...o,
        ew: o.along + kerf,
        eh: o.across + kerf,
      }));
      let best: { o: Orientation; ew: number; eh: number; rect: FreeRect } | null = null;
      for (const rect of freeRects) {
        for (const cand of oriented) {
          if (cand.ew > rect.w || cand.eh > rect.h) continue;
          if (!best || (rect.w * rect.h - cand.ew * cand.eh) < (best.rect.w * best.rect.h - best.ew * best.eh)) {
            best = { o: cand, ew: cand.ew, eh: cand.eh, rect };
          }
        }
      }
      if (best) {
        const { o, ew, eh, rect } = best;
        const px = rect.x;
        const py = rect.y;
        placed.push(placedPart(p, stock, o, px, py));
        // Split the hosting rect into the strips right of and below the part.
        // Order keeps the larger contiguous remainder first, which nudges
        // later scans toward the bigger hole instead of a sliver.
        const right: FreeRect = { x: px + ew, y: py, w: rect.w - ew, h: rect.h };
        const bottom: FreeRect = { x: px, y: py + eh, w: rect.w, h: rect.h - eh };
        const splits = right.w * right.h >= bottom.w * bottom.h ? [right, bottom] : [bottom, right];
        // Every other free rect the footprint touches must give up that area —
        // otherwise later placements could land on this part.
        const rest = freeRects.filter((r) => r !== rect);
        const next = pruneFreeRects([...splits, ...trimFreeRects(rest, { x: px, y: py, w: ew, h: eh })].filter((r) => r.w > 1e-9 && r.h > 1e-9));
        freeRects.length = 0;
        freeRects.push(...next);
      } else {
        unplaced.push(p);
      }
    }
    layouts.push({
      stockId: stock.id,
      stock,
      parts: placed,
      offcuts: freeRects.map((r) => ({ x: r.x, y: r.y, width: Math.max(0, Math.min(r.w, stock.length - r.x)), height: Math.max(0, Math.min(r.h, stock.width - r.y)) })),
      ...exactMeta(placed, stock),
    });
    remaining.length = 0;
    remaining.push(...unplaced);
  }
  return { layouts, leftover: remaining };
}

const area = (p: Part) => p.length * p.width;

/** Rough-lumber packing. A board is treated as a strip: parts are ripped along
 *  its length (lanes across the width) and crosscut within a lane. Kerf is
 *  applied between crosscuts and between lanes. A part only opens or joins a
 *  lane in an orientation that keeps it entirely inside the board — nothing
 *  ever overhangs the end. */
export function nestBoards(parts: Part[], boards: Stock[], kerf: number): { layouts: StockLayout[]; leftover: Part[] } {
  const layouts: StockLayout[] = [];
  // Largest parts first: by longest dimension, then by footprint.
  const remaining = [...parts].sort((a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length) || area(b) - area(a));
  for (const stock of expandStock(boards)) {
    const lanes: Lane[] = [];
    let widthUsed = 0;
    const placed: PlacedPart[] = [];
    const unplaced: Part[] = [];
    for (const p of remaining) {
      // An orientation only counts if it fits the board completely — a part
      // longer than the board could never be crosscut, so it is left for the
      // next board (or reported unplaced) rather than overhanging the edge.
      const oriented = boardOrientation(p, stock.width).filter((o) => o.along <= stock.length);
      if (oriented.length === 0) {
        unplaced.push(p);
        continue;
      }
      // Best lane × orientation: least end waste, tie-break toward unrotated
      // and toward the narrowest compatible lane (so a wide rip is not diluted
      // by a narrow part when a tighter lane also fits).
      let best: { o: Orientation; lane: Lane; leftover: number } | null = null;
      for (const o of oriented) {
        for (const candidate of lanes) {
          if (candidate.width < o.across) continue;
          const leadingKerf = candidate.used > 0 ? kerf : 0;
          if (stock.length - candidate.used < o.along + leadingKerf) continue;
          const leftover = stock.length - candidate.used - leadingKerf - o.along;
          if (
            !best ||
            leftover < best.leftover ||
            (leftover === best.leftover && (o.rotated !== best.o.rotated ? !o.rotated : candidate.width < best.lane.width))
          ) {
            best = { o, lane: candidate, leftover };
          }
        }
      }
      if (best) {
        const { o, lane } = best;
        const x = lane.used + (lane.used > 0 ? kerf : 0);
        placed.push(placedPart(p, stock, o, x, lane.x));
        lane.used = x + o.along;
        continue;
      }
      // No lane fits: open a new lane, using the orientation that keeps the
      // ripped lane narrowest when either orientation fits (grain still wins).
      const o = [...oriented].sort((a, b) => a.across - b.across || (a.rotated ? 1 : 0) - (b.rotated ? 1 : 0))[0];
      if (widthUsed + o.across + (lanes.length > 0 ? kerf : 0) <= stock.width) {
        const y = widthUsed + (lanes.length > 0 ? kerf : 0);
        widthUsed = y + o.across;
        lanes.push({ width: o.across, x: y, used: o.along });
        placed.push(placedPart(p, stock, o, 0, y));
      } else {
        unplaced.push(p);
      }
    }
    layouts.push({ stockId: stock.id, stock, parts: placed, offcuts: recomputeOffcuts(stock, placed), ...exactMeta(placed, stock) });
    remaining.length = 0;
    remaining.push(...unplaced);
  }
  return { layouts, leftover: remaining };
}

export function optimizeCutList(opts: { parts: Part[]; stock: Stock[]; kerf?: number; resawKerf?: number }): NestResult {
  const kerf = opts.kerf ?? 0.125;
  const resawKerf = opts.resawKerf ?? kerf;
  validateInput({ parts: opts.parts, stock: opts.stock, kerf });

  const parts = expandParts(opts.parts);
  const boardStock = expandStock(opts.stock.filter((s) => s.type === "board" || s.type === "scrap"));
  const sheetStock = expandStock(opts.stock.filter((s) => s.type === "sheet"));

  const sheetByThickness = new Map<number, Stock[]>();
  for (const s of sheetStock) {
    sheetByThickness.set(s.thickness, [...(sheetByThickness.get(s.thickness) ?? []), s]);
  }

  const layouts: StockLayout[] = [];
  const groupedUnplaced = new Map<string, Unplaced>();
  const record = (pp: Part, reason: "no_stock" | "no_fit") => {
    const key = `${pp.name}|${pp.length}|${pp.width}|${pp.thickness}`;
    const existing = groupedUnplaced.get(key);
    if (existing) existing.quantity += 1;
    else groupedUnplaced.set(key, { partId: pp.id, partName: pp.name, quantity: 1, reason });
  };

  const stats = {
    planeBoards: 0,
    resawBoards: 0,
    resawLayers: 0,
  };

  /** Boards already committed to a thickness bucket (exact, planed, or resawn). */
  const usedBoardIds = new Set<string>();

  /** Process thickest parts first so thick stock goes to thick parts. */
  const thicknesses = [...new Set(parts.map((p) => p.thickness))].sort((a, b) => b - a);

  for (const t of thicknesses) {
    const bucket = parts.filter((p) => p.thickness === t);
    const candidates = boardStock.filter((s) => !usedBoardIds.has(s.id) && s.thickness >= t);
    const hadBoardSource = candidates.length > 0;
    let leftovers: Part[] = [];

    if (hadBoardSource) {
      // Commit boards one at a time, and only when a part actually lands on
      // them. This keeps untouched boards available to thinner buckets instead
      // of burning them as empty (resawn/planed) layouts, and never emits an
      // empty layer card. Trailing empty layers of a committed board are
      // dropped too — we only resaw what the parts need.
      let curBucket = bucket;
      for (const s of candidates) {
        if (curBucket.length === 0) break;
        const L = resawLayers(s.thickness, t, resawKerf);
        if (L < 1) continue;
        const mode: SourceMode = s.thickness === t ? "exact" : L >= 2 ? "resaw" : "plane";
        const vstocks: Stock[] = [];
        for (let li = 1; li <= L; li++) vstocks.push({ ...s, id: `${s.id}:${t}:${li}`, thickness: t, qty: 1 });
        const { layouts: ls, leftover } = nestBoards(curBucket, vstocks, kerf);
        let keptLayers = 0;
        for (const l of ls) if (l.parts.length > 0) keptLayers += 1;
        if (keptLayers === 0) continue;
        usedBoardIds.add(s.id);
        if (mode === "plane") stats.planeBoards += 1;
        if (mode === "resaw") {
          stats.resawBoards += 1;
          stats.resawLayers += keptLayers;
        }
        for (const l of ls) {
          if (l.parts.length === 0) continue;
          const layered = { ...l, sourceMode: mode, sourceStock: s, sourceLayers: keptLayers };
          layouts.push({ ...layered, usedPercent: layoutUsedPercent(layered.parts, reportBase(layered)) });
        }
        curBucket = leftover;
      }
      leftovers = curBucket;
    } else {
      leftovers = bucket;
    }

    const sheets = sheetByThickness.get(t) ?? [];
    if (sheets.length > 0) {
      const { layouts: sls, leftover } = nestSheets(leftovers, sheets, kerf);
      layouts.push(...sls);
      leftovers = leftover;
    }
    for (const lp of leftovers) record(lp, hadBoardSource ? "no_fit" : "no_stock");
  }

  /** Boards that were never drawn on still produce an (empty) layout so they
   *  stay visible as unused inventory, but they no longer count toward
   *  "bought" — an untouched sheet/board is not waste. */
  for (const s of boardStock) {
    if (usedBoardIds.has(s.id)) continue;
    const { layouts: ls } = nestBoards([], [s], kerf);
    layouts.push(...ls);
  }

  const unplaced = [...groupedUnplaced.values()];

  let boughtBdFt = 0;
  let usedBdFt = 0;
  let wasteBdFt = 0;
  let totalArea = 0;
  let usedArea = 0;
  let partsPlaced = 0;
  const boardBdFtById = new Map<string, number>();
  for (const layout of layouts) {
    // An empty layout is a fully unused sheet/board; skip it so the waste
    // percentage only covers stock that actually received parts.
    if (layout.parts.length === 0) continue;
    if (layout.stock.type === "sheet") {
      totalArea += layout.stock.length * layout.stock.width;
    } else if (!boardBdFtById.has(layout.sourceStock.id)) {
      const bdFt = boardFeet(layout.sourceStock.length, layout.sourceStock.width, layout.sourceStock.thickness);
      boardBdFtById.set(layout.sourceStock.id, bdFt);
      boughtBdFt += bdFt;
    }
    for (const p of layout.parts) {
      partsPlaced += 1;
      if (layout.stock.type === "sheet") {
        usedArea += p.width * p.height;
      } else {
        usedBdFt += boardFeet(p.width, p.height, p.thickness);
      }
    }
    // Board waste is measured per stock item against its reporting base: a
    // resawn layer reports against the layer itself, so an idle layer is not
    // waste — only the board a piece was cut from can carry it. Sheets reuse
    // the totalArea/usedArea running totals above.
    if (layout.stock.type !== "sheet") wasteBdFt += layoutWaste(layout).bdFt;
  }

  const statsOut: NestStats = {
    partsPlaced,
    partsUnplaced: unplaced.reduce((sum, u) => sum + u.quantity, 0),
    board: {
      boughtBdFt,
      usedBdFt,
      wasteBdFt,
      wastePercent: boughtBdFt > 0 ? (wasteBdFt / boughtBdFt) * 100 : 0,
    },
    sheet: {
      totalArea,
      usedArea,
      wastePercent: totalArea > 0 ? (1 - usedArea / totalArea) * 100 : 0,
    },
    plane: { boardsPlaned: stats.planeBoards },
    resaw: { boardsResawn: stats.resawBoards, layersCreated: stats.resawLayers },
  };

  return { layouts, unplaced, stats: statsOut, kerf, resawKerf };
}