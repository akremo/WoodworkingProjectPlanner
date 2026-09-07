import { boardFeet, optimizeCutList, type Part, type PlacedPart, type Stock, type StockLayout } from "@clpv/core";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

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
  const [selected, setSelected] = useState<PlacedPart | null>(null);

  const result = useMemo(() => optimizeCutList({ parts, stock, kerf, resawKerf }), [parts, stock, kerf, resawKerf]);

  const loaded = partsLoaded && stockLoaded;
  if (!loaded) return <View className="flex-1 bg-stone-50 p-4 dark:bg-stone-950"><Text className="text-stone-500 dark:text-stone-400">Loading…</Text></View>;

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
      <Text className="mt-1 text-sm text-stone-500 dark:text-stone-400">Live layout of your Part List on your Stock. Tap a part for details.</Text>

      {parts.length === 0 || stock.length === 0 ? (
        <View className="mt-4 rounded-xl bg-white p-4 shadow-sm dark:bg-stone-900">
          <Text className="text-stone-600 dark:text-stone-300">Add parts to the Part List and items to Stock first — the optimizer runs on those.</Text>
        </View>
      ) : (
        <View className="mt-2">
          <Summary result={result} kerf={kerf} resawKerf={resawKerf} />

          {result.layouts.map((layout) => (
            <DiagramCard key={layout.stockId} layout={layout} scale={diagramScale(layout, winW)} onSelect={setSelected} />
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

      <PartModal part={selected} stockName={selected ? result.layouts.find((l) => l.stockId === selected.stockId)?.stock.name : undefined} onClose={() => setSelected(null)} />
    </ScrollView>
  );
}

function diagramScale(layout: StockLayout, winW: number): number {
  const availW = Math.max(200, winW - 48);
  const maxH = 220;
  return Math.max(0.5, Math.min(availW / layout.stock.length, maxH / layout.stock.width));
}

function Summary({ result, kerf, resawKerf }: { result: ReturnType<typeof optimizeCutList>; kerf: number; resawKerf: number }) {
  const { stats } = result;
  const conversions: string[] = [];
  if (stats.resaw.boardsResawn > 0) conversions.push(`${stats.resaw.boardsResawn} board${stats.resaw.boardsResawn === 1 ? "" : "s"} resawn → ${stats.resaw.layersCreated} layers`);
  if (stats.plane.boardsPlaned > 0) conversions.push(`${stats.plane.boardsPlaned} board${stats.plane.boardsPlaned === 1 ? "" : "s"} planed`);
  return (
    <View className="rounded-xl bg-amber-100 p-4 dark:bg-amber-900/30">
      <View className="flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-300">Parts placed</Text>
        <Text className="text-sm font-semibold text-stone-900 dark:text-stone-100">{stats.partsPlaced} / {stats.partsPlaced + stats.partsUnplaced}</Text>
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-300">Board stock ({fmt(stats.board.boughtBdFt)} bd-ft bought)</Text>
        <Text className="text-sm font-semibold text-amber-800 dark:text-amber-300">{fmt(stats.board.usedBdFt)} used · {fmt(stats.board.wastePercent)}% waste</Text>
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-700 dark:text-stone-300">Sheet stock</Text>
        <Text className="text-sm font-semibold text-amber-800 dark:text-amber-300">{fmt(stats.sheet.usedArea)} in² used · {fmt(stats.sheet.wastePercent)}% waste</Text>
      </View>
      {conversions.length > 0 && (
        <Text className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">{conversions.join(" · ")} — boards can plane down or resaw into thinner layers</Text>
      )}
      <Text className="mt-1 text-xs text-stone-500 dark:text-stone-400">Table saw kerf {fmt(kerf)}″ · band saw kerf {fmt(resawKerf)}″ · gaps between parts (and between resaw layers) are saw cuts; offcuts are shaded.</Text>
    </View>
  );
}

function DiagramCard({ layout, scale, onSelect }: { layout: StockLayout; scale: number; onSelect: (p: PlacedPart) => void }) {
  const { stock } = layout;
  const len = stock.length * scale;
  const wid = stock.width * scale;
  return (
    <View className="mt-4 rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
      <View className="flex-row justify-between">
        <Text className="text-sm font-semibold text-stone-800 dark:text-stone-200">{stock.name}</Text>
        <Text className="text-xs text-stone-500 dark:text-stone-400">{fmt(stock.length)}×{fmt(stock.width)}″ {stock.type} · {fmt(stock.thickness)}″</Text>
      </View>
      {layout.sourceMode !== "exact" && (
        <Text className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {layout.sourceMode === "plane" ? (
            <>planed from {fmt(layout.sourceStock.thickness)}″ stock</>
          ) : (
            <>resawn from {fmt(layout.sourceStock.thickness)}″ into {layout.sourceLayers}× {fmt(layout.stock.thickness)}″ layers</>
          )}
        </Text>
      )}
      <View className="mt-2 overflow-hidden rounded border border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-800" style={{ width: len, height: wid }}>
        {layout.offcuts.map((o, i) => (
          <View key={`off-${i}`} className="bg-stone-200/70 dark:bg-stone-950/60" style={{ position: "absolute", left: o.x * scale, top: o.y * scale, width: o.width * scale, height: o.height * scale }} />
        ))}
        {layout.parts.map((p) => (
          <Pressable
            key={p.partId}
            onPress={() => onSelect(p)}
            className="border border-stone-700/20"
            style={{ position: "absolute", left: p.x * scale, top: p.y * scale, width: Math.max(1, p.width * scale), height: Math.max(1, p.height * scale), backgroundColor: colorFor(partColorKey(p)) }}>
            {p.width * scale > 34 && p.height * scale > 14 && (
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                style={{ position: "absolute", top: 1, left: 2, right: 2, fontSize: 9, fontWeight: "600", color: "#1c1917", transform: [{ rotate: p.rotated ? "-90deg" : "0deg" }], transformOrigin: "center" }}>
                {p.partName}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
      <Text className="mt-1 text-xs text-stone-500 dark:text-stone-400">
        {layout.parts.length} piece{layout.parts.length === 1 ? "" : "s"} · {layout.offcuts.length} offcut region{layout.offcuts.length === 1 ? "" : "s"}
      </Text>
    </View>
  );
}

function PartModal({ part, stockName, onClose }: { part: PlacedPart | null; stockName?: string; onClose: () => void }) {
  if (!part) return null;
  const { length, width } = partDims(part);
  const bdft = boardFeet(length, width, part.thickness);
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