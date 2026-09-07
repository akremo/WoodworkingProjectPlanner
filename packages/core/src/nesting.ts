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

function exactMeta(stock: Stock): { sourceMode: SourceMode; sourceStock: Stock; sourceLayers: number } {
  return { sourceMode: "exact", sourceStock: stock, sourceLayers: 1 };
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

function placedPart(p: Part, stock: Stock, o: Orientation, x: number, y: number): PlacedPart {
  return { partId: p.id, partName: p.name, stockId: stock.id, x, y, width: o.along, height: o.across, rotated: o.rotated, grain: p.grain, thickness: p.thickness };
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
        placed.push(placedPart(p, stock, o, rect.x, rect.y));
        const right: FreeRect = { x: rect.x + ew, y: rect.y, w: rect.w - ew, h: rect.h };
        const bottom: FreeRect = { x: rect.x, y: rect.y + eh, w: rect.w, h: rect.h - eh };
        freeRects.splice(freeRects.indexOf(rect), 1, right, bottom);
        pruneFreeRects(freeRects);
      } else {
        unplaced.push(p);
      }
    }
    layouts.push({
      stockId: stock.id,
      stock,
      parts: placed,
      offcuts: freeRects.map((r) => ({ x: r.x, y: r.y, width: Math.max(0, Math.min(r.w, stock.length - r.x)), height: Math.max(0, Math.min(r.h, stock.width - r.y)) })),
      ...exactMeta(stock),
    });
    remaining.length = 0;
    remaining.push(...unplaced);
  }
  return { layouts, leftover: remaining };
}

const area = (p: Part) => p.length * p.width;

/** Rough-lumber packing. A board is treated as a strip: parts are ripped along
 *  its length (lanes across the width) and crosscut within a lane. Kerf is
 *  applied between crosscuts and between lanes. */
export function nestBoards(parts: Part[], boards: Stock[], kerf: number): { layouts: StockLayout[]; leftover: Part[] } {
  const layouts: StockLayout[] = [];
  const remaining = [...parts].sort((a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length) || area(b) - area(a));
  for (const stock of expandStock(boards)) {
    const lanes: Lane[] = [];
    let widthUsed = 0;
    const placed: PlacedPart[] = [];
    const unplaced: Part[] = [];
    for (const p of remaining) {
      const oriented = boardOrientation(p, stock.width);
      if (oriented.length === 0) {
        unplaced.push(p);
        continue;
      }
      const o = oriented.find((it) => !it.rotated) ?? oriented[0];
      let lane: Lane | null = null;
      for (const candidate of lanes) {
        if (candidate.width >= o.across && stock.length - candidate.used >= o.along + (candidate.used > 0 ? kerf : 0)) {
          lane = candidate;
          break;
        }
      }
      if (lane) {
        const x = lane.used + (lane.used > 0 ? kerf : 0);
        placed.push(placedPart(p, stock, o, x, lane.x));
        lane.used = x + o.along;
      } else if (widthUsed + o.across + (lanes.length > 0 ? kerf : 0) <= stock.width) {
        const y = widthUsed + (lanes.length > 0 ? kerf : 0);
        widthUsed = y + o.across;
        lanes.push({ width: o.across, x: y, used: o.along });
        placed.push(placedPart(p, stock, o, 0, y));
      } else {
        unplaced.push(p);
      }
    }
    const offcuts: Offcut[] = [
      ...lanes.map((l) => ({ x: l.used, y: l.x, width: Math.max(0, stock.length - l.used), height: l.width })),
      ...(stock.width - widthUsed > 0 ? [{ x: 0, y: widthUsed, width: stock.length, height: stock.width - widthUsed }] : []),
    ].filter((o) => o.width > 0 && o.height > 0);
    layouts.push({ stockId: stock.id, stock, parts: placed, offcuts, ...exactMeta(stock) });
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
      interface VB { stock: Stock; mode: SourceMode; source: Stock; layers: number }
      const vboards: VB[] = [];
      for (const s of candidates) {
        const L = resawLayers(s.thickness, t, resawKerf);
        if (L < 1) continue;
        usedBoardIds.add(s.id);
        const mode: SourceMode = s.thickness === t ? "exact" : L >= 2 ? "resaw" : "plane";
        if (mode === "plane") stats.planeBoards += 1;
        if (mode === "resaw") {
          stats.resawBoards += 1;
          stats.resawLayers += L;
        }
        for (let li = 1; li <= L; li++) {
          vboards.push({ stock: { ...s, id: `${s.id}:${t}:${li}`, thickness: t, qty: 1 }, mode, source: s, layers: L });
        }
      }
      const { layouts: ls, leftover } = nestBoards(bucket, vboards.map((v) => v.stock), kerf);
      // nestBoards emits one layout per (expanded) virtual board, in order.
      layouts.push(
        ...ls.map((l, idx) => {
          const v = vboards[idx];
          return v ? { ...l, sourceMode: v.mode, sourceStock: v.source, sourceLayers: v.layers } : l;
        }),
      );
      leftovers = leftover;
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
   *  count toward "bought"; same as before planing/resawing existed. */
  for (const s of boardStock) {
    if (usedBoardIds.has(s.id)) continue;
    const { layouts: ls } = nestBoards([], [s], kerf);
    layouts.push(...ls);
  }

  const unplaced = [...groupedUnplaced.values()];

  let boughtBdFt = 0;
  let usedBdFt = 0;
  let totalArea = 0;
  let usedArea = 0;
  let partsPlaced = 0;
  const boardBdFtById = new Map<string, number>();
  for (const layout of layouts) {
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
  }

  const wasteBdFt = boughtBdFt - usedBdFt;
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