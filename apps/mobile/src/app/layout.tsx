import { applyPartEdits, boardFeet, canPlacePartOnStock, layoutUsed, layoutViolations, layoutWaste, optimizeCutList, type Part, type PartEdit, type PlacedPart, type Stock, type StockLayout } from "@clpv/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { NumberInput } from "@/components/inputs";
import { usePersistedState } from "@/hooks/use-persisted-state";

const KERF_KEY = "clpv.settings.v1";
const DEFAULT_KERF = 0.125;
const DEFAULT_RESAW_KERF = 0.125;

const PALETTE = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#ec4899",
];

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** A part row keeps its color across quantity copies and stock items;
 *  the nesting engine suffixes ids with "#N", so key on the original id. */
function partColorKey(p: PlacedPart): string {
  return p.partId.split("#")[0];
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const s = Math.abs(n % 1) > 1e-6 ? n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(n));
  return s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Manual placements land on a fine 1/16″ grid. This kills sub-pixel jitter
 *  (pointer noise amplifying through 1/scale on big boards) and gives parts a
 *  stable "detented" feel — a piece holds still until you cross a grid step. */
const SNAP_IN = 1 / 16;
function snap(v: number): number {
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

/** Whether the part would fit on the stock, as-is or rotated 90° (when its
 *  grain allows flipping). */
function fitsOnStock(p: PlacedPart, s: Stock): boolean {
  const fits = (w: number, h: number) => w <= s.length + 1e-9 && h <= s.width + 1e-9;
  return fits(p.width, p.height) || (p.grain === "no_matter" && fits(p.height, p.width));
}

function partDims(p: PlacedPart): { length: number; width: number } {
  return p.rotated ? { length: p.height, width: p.width } : { length: p.width, width: p.height };
}

interface Settings {
  kerf: number;
  resawKerf: number;
}

export default function LayoutScreen() {
  const { width: winW } = useWindowDimensions();
  const [parts, , partsLoaded] = usePersistedState<Part[]>("clpv.parts.v1", []);
  const [stock, , stockLoaded] = usePersistedState<Stock[]>("clpv.stock.v1", []);
  const [settings, setSettings] = usePersistedState<Settings>(
    KERF_KEY,
    { kerf: DEFAULT_KERF, resawKerf: DEFAULT_RESAW_KERF },
    (s) => ({ kerf: s.kerf ?? DEFAULT_KERF, resawKerf: s.resawKerf ?? DEFAULT_RESAW_KERF }),
  );

  const kerf = settings.kerf;
  const resawKerf = settings.resawKerf;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Manual overrides (move / relocate / rotate) keyed by expanded part id,
  // applied on top of the optimizer output via applyPartEdits.
  const [edits, setEdits] = useState<Record<string, PartEdit>>({});
  // Parts whose drop would be invalid flash red on the source card.
  const [invalidFlash, setInvalidFlash] = useState<Record<string, boolean>>({});

  // The editors start new rows at 0 dimension, and the optimizer validates
  // strictly — only feed it rows that are actually placeable. Memoize so these
  // stay referentially stable between edits (a fresh array each render would
  // recompute `result` and reset manual edits on every drag tick).
  const validParts = useMemo(() => parts.filter((p) => p.quantity >= 1 && p.length > 0 && p.width > 0 && p.thickness > 0), [parts]);
  const validStock = useMemo(() => stock.filter((s) => s.qty >= 1 && s.length > 0 && s.width > 0 && s.thickness > 0), [stock]);

  const result = useMemo(
    () => optimizeCutList({ parts: validParts, stock: validStock, kerf, resawKerf }),
    [validParts, validStock, kerf, resawKerf],
  );

  // Apply manual edits on top of the optimizer output, recomputing each card's
  // utilization as parts move, transfer between boards, or flip.
  const editedLayouts = useMemo(() => applyPartEdits(result.layouts, edits), [result, edits]);

  // Manual overrides carry the source layout's coordinates and stock ids, so a
  // re-optimization (parts/stock/kerf changed) invalidates them. Wipe all edits
  // whenever the optimizer output changes — otherwise pieces stay pinned to
  // spots that no longer exist in the new layout.
  useEffect(() => {
    setEdits({});
  }, [result]);

  const invalidByStock = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of editedLayouts) {
      const ids = new Set(Object.keys(layoutViolations(l, kerf)));
      if (ids.size > 0) m.set(l.stockId, ids);
    }
    return m;
  }, [editedLayouts, kerf]);

  const editPart = useCallback((partId: string, e: PartEdit) => {
    setEdits((prev) => {
      const cur = prev[partId];
      if (cur && cur.x === e.x && cur.y === e.y && cur.stockId === e.stockId && cur.rotated === e.rotated) return prev;
      return { ...prev, [partId]: e };
    });
  }, []);

  const rotatePart = useCallback((part: PlacedPart, rotated: boolean) => {
    setEdits((prev) => {
      const cur = prev[part.partId];
      const e: PartEdit = { stockId: cur?.stockId ?? part.stockId, x: cur?.x ?? part.x, y: cur?.y ?? part.y, rotated };
      return cur && cur.rotated === rotated ? prev : { ...prev, [part.partId]: e };
    });
  }, []);

  const flashPart = useCallback((partId: string) => {
    setInvalidFlash((prev) => (prev[partId] ? prev : { ...prev, [partId]: true }));
    setTimeout(() => setInvalidFlash((prev) => (prev[partId] ? { ...prev, [partId]: false } : prev)), 400);
  }, []);

  const movePartTo = useCallback(
    (part: PlacedPart, stockId: string) => {
      const target = editedLayouts.find((l) => l.stockId === stockId);
      if (!target) return;
      const s = target.stock;
      let w = part.width;
      let h = part.height;
      let rotated = part.rotated;
      if (!(w <= s.length && h <= s.width) && part.grain === "no_matter" && h <= s.length && w <= s.width) {
        [w, h] = [h, w];
        rotated = !rotated;
      }
      const x = clamp((s.length - w) / 2, 0, Math.max(0, s.length - w));
      const y = clamp((s.width - h) / 2, 0, Math.max(0, s.width - h));
      editPart(part.partId, { stockId, x, y, rotated });
      setSelectedId(null);
    },
    [editedLayouts, editPart],
  );

  const loaded = partsLoaded && stockLoaded;
  if (!loaded) return <View className="flex-1 bg-stone-50 p-4 dark:bg-stone-950"><Text className="text-stone-500 dark:text-stone-400">Loading…</Text></View>;

  // The selected part snapshot tracks live edits (drags/rotations).
  const selectedPart =
    selectedId === null
      ? null
      : editedLayouts.flatMap((l) => l.parts).find((p) => p.partId === selectedId) ?? null;
  const selectedStock =
    selectedPart !== null
      ? editedLayouts.find((l) => l.stockId === selectedPart.stockId)?.stock.name
      : undefined;

  // Boards (same thickness, big enough) the selected piece can be moved to.
  // Limited to boards that already exist as layouts — the optimizer only
  // materializes used stock, so a part can only relocate to those.
  const moveTargets = useMemo(() => {
    if (!selectedPart) return [];
    const p = selectedPart;
    const seen = new Set<string>();
    const out: { stockId: string; label: string }[] = [];
    for (const l of result.layouts) {
      if (l.stockId === p.stockId) continue;
      if (Math.abs(l.stock.thickness - p.thickness) >= 1e-9) continue;
      if (seen.has(l.stockId)) continue;
      seen.add(l.stockId);
      if (!fitsOnStock(p, l.stock)) continue;
      out.push({ stockId: l.stockId, label: `${l.stock.name} (${fmt(l.stock.length)}×${fmt(l.stock.width)}″)` });
    }
    return out;
  }, [selectedPart, result]);

  const legend = [...new Map(result.layouts.flatMap((l) => l.parts.map((p) => [partColorKey(p), p.partName] as const))).entries()];

  return (
    <ScrollView className="flex-1 bg-stone-50 dark:bg-stone-950" contentContainerStyle={{ padding: 16 }}>
      <View className="flex-row items-baseline justify-between">
        <Text className="text-2xl font-bold text-stone-900 dark:text-stone-100">Layout</Text>
        <View className="flex-row">
          <View className="mr-3 items-end">
            <Text className="mb-1 text-xs text-stone-500 dark:text-stone-400">Table saw kerf (in)</Text>
            <NumberInput value={kerf} onChange={(v) => setSettings((prev) => ({ ...prev, kerf: v }))} />
          </View>
          <View className="items-end">
            <Text className="mb-1 text-xs text-stone-500 dark:text-stone-400">Band saw kerf (in)</Text>
            <NumberInput value={resawKerf} onChange={(v) => setSettings((prev) => ({ ...prev, resawKerf: v }))} />
          </View>
        </View>
      </View>
      <Text className="mt-1 text-sm text-stone-500 dark:text-stone-400">Live layout of your Part List on your Stock. Drag parts to rearrange, drag onto another sheet/board to move them there, or tap a piece and use "Move to board"; tap a part's ↻ corner to rotate it — invalid placements turn red and the % used adjusts.</Text>
      {parts.length !== validParts.length || stock.length !== validStock.length ? (
        <Text className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          {parts.length - validParts.length} part{(parts.length - validParts.length) === 1 ? "" : "s"} and {stock.length - validStock.length} stock item{(stock.length - validStock.length) === 1 ? "" : "s"} with missing dimensions are being skipped.
        </Text>
      ) : null}

      {validParts.length === 0 || validStock.length === 0 ? (
        <View className="mt-4 rounded-xl bg-white p-4 shadow-sm dark:bg-stone-900">
          <Text className="text-stone-600 dark:text-stone-300">Add parts to the Part List and items to Stock first — the optimizer runs on those.</Text>
        </View>
      ) : (
        <View className="mt-2">
          <Summary result={result} editedLayouts={editedLayouts} kerf={kerf} resawKerf={resawKerf} />

          {editedLayouts.map((layout) => (
            <DiagramCard
              key={layout.stockId}
              layout={layout}
              allLayouts={editedLayouts}
              scale={diagramScale(layout, winW)}
              invalidIds={invalidByStock.get(layout.stockId)}
              flashIds={invalidFlash}
              onEdit={editPart}
              onRotate={rotatePart}
              onFlash={flashPart}
              onSelect={setSelectedId}
            />
          ))}

          {result.layouts.length === 0 && (
            <Text className="mt-2 text-sm text-stone-500 dark:text-stone-400">No stock matched the parts. Check thickness values or add sheets.</Text>
          )}

          {result.unplaced.length > 0 && (
            <View className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/60 dark:bg-red-950/40">
              <Text className="font-semibold text-red-700 dark:text-red-400">Could not place</Text>
              {result.unplaced.map((u) => (
                <Text key={`${u.partId}-${u.quantity}`} className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {u.partName} ×{u.quantity} — {u.reason === "no_stock" ? "no stock thick enough (and no matching sheet)" : "does not fit any stock"}
                </Text>
              ))}
            </View>
          )}

          {legend.length > 0 && (
            <View className="mt-4 rounded-xl bg-white p-4 shadow-sm dark:bg-stone-900">
              <Text className="text-xs font-semibold uppercase text-stone-400 dark:text-stone-500">Legend</Text>
              <View className="mt-2 flex-row flex-wrap">
              {legend.map(([key, name]) => (
                <View key={key} className="mr-3 mb-1 flex-row items-center">
                  <View className="mr-1 h-3 w-3 rounded-sm" style={{ backgroundColor: colorFor(key) }} />
                  <Text className="text-xs text-stone-600 dark:text-stone-300">{name}</Text>
                </View>
              ))}
            </View>
            </View>
          )}
        </View>
      )}

      <PartModal
        part={selectedPart}
        stockName={selectedStock}
        moveTargets={moveTargets}
        onRotate={rotatePart}
        onMove={movePartTo}
        onClose={() => setSelectedId(null)}
      />
    </ScrollView>
  );
}

function diagramScale(layout: StockLayout, winW: number): number {
  const availW = Math.max(200, winW - 48);
  const maxH = 220;
  return Math.max(0.5, Math.min(availW / layout.stock.length, maxH / layout.stock.width));
}

function Summary({
  result,
  editedLayouts,
  kerf,
  resawKerf,
}: {
  result: ReturnType<typeof optimizeCutList>;
  editedLayouts: StockLayout[];
  kerf: number;
  resawKerf: number;
}) {
  const { stats } = result;
  const conversions: string[] = [];
  if (stats.resaw.boardsResawn > 0) conversions.push(`${stats.resaw.boardsResawn} board${stats.resaw.boardsResawn === 1 ? "" : "s"} resawn → ${stats.resaw.layersCreated} layers`);
  if (stats.plane.boardsPlaned > 0) conversions.push(`${stats.plane.boardsPlaned} board${stats.plane.boardsPlaned === 1 ? "" : "s"} planed`);
  // Live totals driven by the (possibly drag-edited) layouts, so waste
  // recomputes as parts move. Bought/total come from the optimizer output.
  // Board waste is summed per layout against its reporting base: a resawn
  // layer carries only its own leftover, so an idle layer is not waste.
  const liveUsed = editedLayouts.reduce(
    (acc, l) => {
      const used = layoutUsed(l);
      acc.bdFt += used.bdFt;
      acc.area += used.area;
      return acc;
    },
    { bdFt: 0, area: 0 },
  );
  const liveBoardWaste = editedLayouts.reduce((acc, l) => acc + (l.stock.type === "sheet" ? 0 : layoutWaste(l).bdFt), 0);
  const liveSheetWaste = editedLayouts.reduce((acc, l) => acc + (l.stock.type === "sheet" ? layoutWaste(l).area : 0), 0);
  const boardWastePct = stats.board.boughtBdFt > 0 ? Math.max(0, (liveBoardWaste / stats.board.boughtBdFt) * 100) : 0;
  const sheetWastePct = stats.sheet.totalArea > 0 ? Math.max(0, (liveSheetWaste / stats.sheet.totalArea) * 100) : 0;
  return (
    <View className="rounded-xl bg-amber-100 p-4 dark:bg-amber-900/30">
      <View className="flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-300">Parts placed</Text>
        <Text className="text-sm font-semibold text-stone-900 dark:text-stone-100">{stats.partsPlaced} / {stats.partsPlaced + stats.partsUnplaced}</Text>
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-300">Board stock ({fmt(stats.board.boughtBdFt)} bd-ft bought)</Text>
        <Text className="text-sm font-semibold text-amber-800 dark:text-amber-300">{fmt(liveUsed.bdFt)} used · {fmt(boardWastePct)}% waste</Text>
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-300">Sheet stock</Text>
        <Text className="text-sm font-semibold text-amber-800 dark:text-amber-300">{fmt(liveUsed.area)} in² used · {fmt(sheetWastePct)}% waste</Text>
      </View>
      {conversions.length > 0 && (
        <Text className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">{conversions.join(" · ")} — boards can plane down or resaw into thinner layers</Text>
      )}
      <Text className="mt-1 text-xs text-stone-500 dark:text-stone-400">Table saw kerf {fmt(kerf)}″ · band saw kerf {fmt(resawKerf)}″ · gaps between parts (and between resaw layers) are saw cuts; offcuts are shaded.</Text>
    </View>
  );
}

// Live host-element registry so a dragging part can be dropped onto another
// card. Kept at module scope to avoid threading refs through every card.
const cardEls = new Map<string, any>();
function registerCardEl(stockId: string, el: any) {
  if (el) cardEls.set(stockId, el);
  else cardEls.delete(stockId);
}
interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Window/client-space bounds of a card's diagram area (works on web + native).
 *  `getBoundingClientRect` and `measureInWindow` share the same coordinate
 *  space, so deltas computed against one rect stay valid for another. */
function rectInWindow(stockId: string): WinRect | null {
  const el = cardEls.get(stockId) as any;
  if (!el) return null;
  const gbc = el.getBoundingClientRect;
  if (typeof gbc === "function") {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  if (typeof el.measureInWindow === "function") {
    let out: WinRect | null = null;
    el.measureInWindow((x: number, y: number, w: number, h: number) => {
      out = { x, y, w, h };
    });
    return out;
  }
  return null;
}

interface DropTarget {
  stockId: string;
  rect: WinRect;
  scale: number;
  compatible: boolean;
}

function DiagramCard({
  layout,
  allLayouts,
  scale,
  invalidIds,
  flashIds,
  onEdit,
  onRotate,
  onFlash,
  onSelect,
}: {
  layout: StockLayout;
  allLayouts: StockLayout[];
  scale: number;
  invalidIds?: Set<string>;
  flashIds: Record<string, boolean>;
  onEdit: (partId: string, e: PartEdit) => void;
  onRotate: (part: PlacedPart, rotated: boolean) => void;
  onFlash: (partId: string) => void;
  onSelect: (partId: string) => void;
}) {
  const { stock } = layout;
  const len = stock.length * scale;
  const wid = stock.width * scale;
  const invalidCount = invalidIds ? layout.parts.filter((p) => invalidIds.has(p.partId)).length : 0;
  // Waste is relative to each layout's own reporting base; a board with no
  // parts on it carries none (it is unused inventory, counted when used later).
  const wastePct = layout.parts.length === 0 ? 0 : Math.max(0, 100 - layout.usedPercent);
  return (
    <View className="mt-4 rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
      <View className="flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-800 dark:text-stone-200">{stock.name}</Text>
        <Text className="text-xs text-stone-500 dark:text-stone-400">{fmt(stock.length)}×{fmt(stock.width)}″ {stock.type} · {fmt(stock.thickness)}″</Text>
      </View>
      <Text className={invalidCount > 0 ? "mt-0.5 text-xs font-semibold text-red-600 dark:text-red-400" : "mt-0.5 text-xs font-medium text-stone-500 dark:text-stone-400"}>
        ~{Math.round(layout.usedPercent)}% used · ~{Math.round(wastePct)}% waste{invalidCount > 0 ? ` · ${invalidCount} invalid` : ""}
      </Text>
      {layout.sourceMode !== "exact" && (
        <Text className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {layout.sourceMode === "plane" ? (
            <>planed from {fmt(layout.sourceStock.thickness)}″ stock</>
          ) : (
            <>resawn from {fmt(layout.sourceStock.thickness)}″ into {layout.sourceLayers}× {fmt(layout.stock.thickness)}″ layers</>
          )}
        </Text>
      )}
      <View ref={(el) => registerCardEl(layout.stockId, el)} className="mt-2 overflow-hidden rounded border border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-800" style={{ width: len, height: wid }}>
        {layout.offcuts.map((o, i) => (
          <View key={`off-${i}`} className="bg-stone-200/70 dark:bg-stone-950/60" style={{ position: "absolute", left: o.x * scale, top: o.y * scale, width: o.width * scale, height: o.height * scale }} />
        ))}
        {layout.parts.map((p) => (
          <PartThumb
            key={p.partId}
            part={p}
            stock={stock}
            allLayouts={allLayouts}
            scale={scale}
            invalid={!!invalidIds?.has(p.partId) || !!flashIds[p.partId]}
            onEdit={onEdit}
            onRotate={onRotate}
            onFlash={onFlash}
            onSelect={onSelect}
          />
        ))}
      </View>
      <Text className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        {layout.parts.length} piece{layout.parts.length === 1 ? "" : "s"} · {layout.offcuts.length} offcut region{layout.offcuts.length === 1 ? "" : "s"}
        {invalidCount > 0 && <Text className="font-semibold text-red-600 dark:text-red-400"> · {invalidCount} invalid</Text>}
      </Text>
    </View>
  );
}

/** If the pointer (approx. source board origin + drag delta) is over another
 *  card's diagram area, returns a drop option for transferring the part. */
function dropTargetFor(startRect: WinRect, part: PlacedPart, allLayouts: StockLayout[], dx: number, dy: number): DropTarget | null {
  const px = startRect.x + dx;
  const py = startRect.y + dy;
  for (const L of allLayouts) {
    if (L.stockId === part.stockId) continue;
    const rect = rectInWindow(L.stockId);
    if (!rect) continue;
    if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) {
      return { stockId: L.stockId, rect, scale: rect.w / L.stock.length, compatible: canPlacePartOnStock(part, L.stock) };
    }
  }
  return null;
}

function PartThumb({
  part,
  stock,
  allLayouts,
  scale,
  invalid,
  onEdit,
  onRotate,
  onFlash,
  onSelect,
}: {
  part: PlacedPart;
  stock: Stock;
  allLayouts: StockLayout[];
  scale: number;
invalid: boolean;
  onEdit: (partId: string, e: PartEdit) => void;
  onRotate: (part: PlacedPart, rotated: boolean) => void;
  onFlash: (partId: string) => void;
  onSelect: (partId: string) => void;
}) {
  const cfgRef = useRef({ part, stock, scale, allLayouts, onEdit, onFlash, onSelect, onRotate });
  cfgRef.current = { part, stock, scale, allLayouts, onEdit, onFlash, onSelect, onRotate };
  const isWeb = Platform.OS === "web";
  const grantRef = useRef({
    startPx: 0,
    startPy: 0,
    startRect: null as WinRect | null,
    sx: 0,
    sy: 0,
    dx: 0,
    dy: 0,
    moved: false,
  });
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const cancelRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
  const scheduleEdit = () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      pendingRef.current = false;
      const c = cfgRef.current;
      const g = grantRef.current;
      const p = c.part;
      c.onEdit(p.partId, { stockId: p.stockId, x: snap(g.sx + g.dx / c.scale), y: snap(g.sy + g.dy / c.scale), rotated: p.rotated });
    });
  };
  // Shared end-of-gesture logic: select (tap), transfer to another board
  // (drop), or clamp back into this board. Only touches refs, so the cached
  // gesture handlers may safely capture it.
  const commitDrag = (
    c: typeof cfgRef.current,
    g: typeof grantRef.current,
    dx: number,
    dy: number,
  ) => {
    if (!g.moved) {
      // On web the part itself is the only pointer-capture surface (the ↻
      // corner is drag-transparent), so a tap that starts and ends on the
      // handle rotates instead of opening the inspector.
      if (c.part.grain === "no_matter") {
        const hr: any = rotNodeRef.current;
        if (hr && typeof hr.getBoundingClientRect === "function") {
          const r = hr.getBoundingClientRect();
          const upX = g.startPx + dx;
          const upY = g.startPy + dy;
          if (upX >= r.left && upX <= r.right && upY >= r.top && upY <= r.bottom) {
            c.onRotate(c.part, !c.part.rotated);
            return;
          }
        }
      }
      c.onSelect(c.part.partId);
      return;
    }
    const target = dropTargetFor(g.startRect ?? { x: 0, y: 0, w: 0, h: 0 }, c.part, c.allLayouts, dx, dy);
    if (target) {
      if (!target.compatible) {
        c.onFlash(c.part.partId);
        return;
      }
      const s = g.startRect ?? { x: 0, y: 0, w: 0, h: 0 };
      const x = snap(
        clamp(
          (s.x + dx - target.rect.x) / target.scale - c.part.width / 2,
          -c.part.width * 0.5,
          target.rect.w / target.scale - c.part.width * 0.5,
        ),
      );
      const y = snap(
        clamp(
          (s.y + dy - target.rect.y) / target.scale - c.part.height / 2,
          -c.part.height * 0.5,
          target.rect.h / target.scale - c.part.height * 0.5,
        ),
      );
      c.onEdit(c.part.partId, { stockId: target.stockId, x, y, rotated: c.part.rotated });
      return;
    }
    // stay on this board — clamp back into a grabbable spot
    const w = c.part.width;
    const h = c.part.height;
    c.onEdit(c.part.partId, {
      stockId: c.part.stockId,
      x: snap(clamp(g.sx + dx / c.scale, -w * 0.5, c.stock.length - w * 0.5)),
      y: snap(clamp(g.sy + dy / c.scale, -h * 0.5, c.stock.width - h * 0.5)),
      rotated: c.part.rotated,
    });
  };

  const partNodeRef = useRef<View>(null);
  const rotNodeRef = useRef<View>(null);
  const dragActiveRef = useRef(false);
  const rotMoveRef = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  // Native: React Native's gesture responder system. We never release the
  // gesture to the enclosing ScrollView mid-drag.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          const c = cfgRef.current;
          grantRef.current = {
            startPx: evt.nativeEvent.pageX,
            startPy: evt.nativeEvent.pageY,
            startRect: rectInWindow(c.part.stockId),
            sx: c.part.x,
            sy: c.part.y,
            dx: 0,
            dy: 0,
            moved: false,
          };
        },
        onPanResponderMove: (evt) => {
          const g = grantRef.current;
          const dx = evt.nativeEvent.pageX - g.startPx;
          const dy = evt.nativeEvent.pageY - g.startPy;
          g.dx = dx;
          g.dy = dy;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) g.moved = true;
          scheduleEdit();
        },
        onPanResponderRelease: (evt) => {
          cancelRaf();
          const dx = evt.nativeEvent.pageX - grantRef.current.startPx;
          const dy = evt.nativeEvent.pageY - grantRef.current.startPy;
          commitDrag(cfgRef.current, grantRef.current, dx, dy);
        },
        onPanResponderTerminate: () => {
          cancelRaf();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Web/desktop: React Native Web's PanResponder has no pointer capture, so a
  // drag re-render or fast pointer moves can make it lose pointermove/up and
  // freeze mid-gesture. Use real Pointer Events + setPointerCapture instead.
  const webDown = (e: any) => {
    const pe = e?.nativeEvent ?? {};
    if (pe.button != null && pe.button !== 0) return;
    try {
      e.preventDefault?.();
    } catch {
      /* noop */
    }
    const c = cfgRef.current;
    const node: any = partNodeRef.current;
    if (pe.pointerId != null && node?.setPointerCapture) {
      try {
        node.setPointerCapture(pe.pointerId);
      } catch {
        /* noop */
      }
    }
    grantRef.current = {
      startPx: pe.clientX ?? pe.pageX ?? 0,
      startPy: pe.clientY ?? pe.pageY ?? 0,
      startRect: rectInWindow(c.part.stockId),
      sx: c.part.x,
      sy: c.part.y,
      dx: 0,
      dy: 0,
      moved: false,
    };
    dragActiveRef.current = true;
  };
  const webMove = (e: any) => {
    if (!dragActiveRef.current) return;
    const g = grantRef.current;
    const pe = e?.nativeEvent ?? {};
    const x = (pe.clientX ?? pe.pageX ?? 0) - g.startPx;
    const y = (pe.clientY ?? pe.pageY ?? 0) - g.startPy;
    g.dx = x;
    g.dy = y;
    if (Math.abs(x) > 2 || Math.abs(y) > 2) g.moved = true;
    scheduleEdit();
  };
  const webUp = (e: any, mode: "release" | "cancel") => {
    if (!dragActiveRef.current) return;
    dragActiveRef.current = false;
    const g = grantRef.current;
    const node: any = partNodeRef.current;
    const pe = mode === "release" ? (e?.nativeEvent ?? {}) : {};
    if (pe.pointerId != null && node?.releasePointerCapture) {
      try {
        node.releasePointerCapture(pe.pointerId);
      } catch {
        /* noop */
      }
    }
    cancelRaf();
    if (mode === "cancel") {
      const c = cfgRef.current;
      const w = c.part.width;
      const h = c.part.height;
      c.onEdit(c.part.partId, {
        stockId: c.part.stockId,
        x: snap(clamp(g.sx + g.dx / c.scale, -w * 0.5, c.stock.length - w * 0.5)),
        y: snap(clamp(g.sy + g.dy / c.scale, -h * 0.5, c.stock.width - h * 0.5)),
        rotated: c.part.rotated,
      });
      return;
    }
    const dx = (pe.clientX ?? pe.pageX ?? 0) - g.startPx;
    const dy = (pe.clientY ?? pe.pageY ?? 0) - g.startPy;
    commitDrag(cfgRef.current, g, dx, dy);
  };
  const webPartHandlers = useMemo(() => {
    if (!isWeb) return null;
    return {
      onPointerDown: (e: any) => webDown(e),
      onPointerMove: (e: any) => webMove(e),
      onPointerUp: (e: any) => webUp(e, "release"),
      onPointerCancel: (e: any) => webUp(e, "cancel"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rotRef = useRef({ part, onRotate });
  rotRef.current = { part, onRotate };
  const rotatePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          const pe = evt.nativeEvent;
          rotMoveRef.current = { px: pe.pageX, py: pe.pageY, moved: false };
        },
        onPanResponderMove: (evt, g) => {
          const r = rotMoveRef.current;
          if (r && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6)) r.moved = true;
        },
        onPanResponderRelease: () => {
          const { part: p, onRotate: rot } = rotRef.current;
          const r = rotMoveRef.current;
          rotMoveRef.current = null;
          if (p.grain === "no_matter" && (!r || !r.moved)) rot(p, !p.rotated);
        },
      }),
    [],
  );
  const canRotate = part.grain === "no_matter";
  const showHandle = part.width * scale >= 24 && part.height * scale >= 20;
  return (
    <View
      ref={partNodeRef}
      {...(isWeb ? (webPartHandlers ?? {}) : pan.panHandlers)}
      style={{
        position: "absolute",
        left: part.x * scale,
        top: part.y * scale,
        width: Math.max(1, part.width * scale),
        height: Math.max(1, part.height * scale),
        backgroundColor: colorFor(partColorKey(part)),
        borderColor: invalid ? "#dc2626" : "rgba(28,25,23,0.25)",
        borderWidth: invalid ? 2 : 1,
        userSelect: "none",
        touchAction: "none",
      }}>
      {part.width * scale > 34 && part.height * scale > 14 && (
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          style={{ position: "absolute", top: 1, left: 2, right: 20, fontSize: 9, fontWeight: "600", color: "#1c1917", transform: [{ rotate: part.rotated ? "-90deg" : "0deg" }], transformOrigin: "center" }}>
          {part.partName}
        </Text>
      )}
      {invalid && (
        <View className="absolute bottom-1 right-1 rounded bg-red-600 px-1">
          <Text className="text-[9px] font-bold text-white">!</Text>
        </View>
      )}
      {showHandle && (
        <View
          ref={rotNodeRef}
          {...(isWeb ? {} : rotatePan.panHandlers)}
          style={{
            position: "absolute",
            top: part.height * scale >= 22 ? 2 : -7,
            right: 2,
            width: 16,
            height: 16,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canRotate ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
            opacity: canRotate ? 1 : 0.55,
            userSelect: "none",
            touchAction: "none",
          }}>
          <Text style={{ fontSize: 11, fontWeight: "700", lineHeight: 13, color: canRotate ? "#1c1917" : "#78716c" }}>↻</Text>
        </View>
      )}
    </View>
  );
}

function PartModal({
  part,
  stockName,
  moveTargets,
  onRotate,
  onMove,
  onClose,
}: {
  part: PlacedPart | null;
  stockName?: string;
  moveTargets: { stockId: string; label: string }[];
  onRotate: (part: PlacedPart, rotated: boolean) => void;
  onMove: (part: PlacedPart, stockId: string) => void;
  onClose: () => void;
}) {
  if (!part) return null;
  const { length, width } = partDims(part);
  const bdft = boardFeet(length, width, part.thickness);
  const canRotate = part.grain === "no_matter";
  return (
    <Modal transparent animationType="fade" visible={!!part} onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 p-6" onPress={onClose}>
        <Pressable className="w-full rounded-xl bg-white p-4 shadow-lg dark:bg-stone-900" onPress={(e) => e.stopPropagation()}>
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-bold text-stone-900 dark:text-stone-100">{part.partName}</Text>
            <Pressable onPress={onClose} className="rounded-lg bg-stone-100 px-2 py-1 dark:bg-stone-800">
              <Text className="text-sm text-stone-600 dark:text-stone-300">Close</Text>
            </Pressable>
          </View>
          <View className="mt-3 gap-1">
            <Row label="Size" value={`${fmt(length)} × ${fmt(width)} × ${fmt(part.thickness)} in`} />
            <Row label="Board-ft" value={`${fmt(bdft)} per piece`} />
            <Row label="On stock" value={stockName ?? part.stockId} />
            <Row label="Position" value={`x=${fmt(part.x)}, y=${fmt(part.y)} in`} />
            <Row label="Grain" value={part.grain === "lengthwise" ? "lengthwise" : part.grain === "along_width" ? "along width" : "any"} />
            <Row label="Rotation" value={part.rotated ? "rotated 90°" : "as-is"} />
          </View>
          <Pressable
            disabled={!canRotate}
            onPress={() => onRotate(part, !part.rotated)}
            className="mt-3 items-center rounded-lg bg-stone-900 px-3 py-2 dark:bg-stone-100"
            style={{ opacity: canRotate ? 1 : 0.4 }}>
            <Text className="text-sm font-semibold text-white dark:text-stone-900">↻ Rotate 90°{part.rotated ? " (back)" : ""}</Text>
          </Pressable>
          {!canRotate && (
            <Text className="mt-1 text-center text-xs text-stone-500 dark:text-stone-400">Rotation is locked — grain direction matters for this part.</Text>
          )}
          <Text className="mt-3 text-xs font-semibold uppercase text-stone-400 dark:text-stone-500">Move to board</Text>
          {moveTargets.length > 0 ? (
            <View className="mt-1 flex-row flex-wrap">
              {moveTargets.map((t) => (
                <Pressable
                  key={t.stockId}
                  onPress={() => onMove(part, t.stockId)}
                  className="mr-1 mb-1 rounded-lg bg-stone-100 px-2 py-1 dark:bg-stone-800">
                  <Text className="text-xs font-medium text-stone-700 dark:text-stone-300">{t.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text className="mt-1 text-xs italic text-stone-500 dark:text-stone-400">No other boards of this thickness can fit this piece.</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm text-stone-500 dark:text-stone-400">{label}</Text>
      <Text className="text-sm font-medium text-stone-900 dark:text-stone-100">{value}</Text>
    </View>
  );
}