import { boardFeet, type Grain, type Part } from "@clpv/core";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useRef, useState } from "react";
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Polygon } from "react-native-svg";

import { ChipSelector } from "@/components/chips";
import { NumberCell, TextCell } from "@/components/inputs";
import { usePersistedState } from "@/hooks/use-persisted-state";

const GRAIN_OPTIONS: { value: Grain; label: string }[] = [
  { value: "lengthwise", label: "Lengthwise" },
  { value: "along_width", label: "Along width" },
  { value: "no_matter", label: "Any grain" },
];

const BOX_PALETTE = ["#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#ec4899"];

interface Pt {
  x: number;
  y: number;
}

/** Four corners in order top-left, top-right, bottom-right, bottom-left. */
interface Photobox {
  id: string;
  name: string;
  corners: [Pt, Pt, Pt, Pt];
  length: number;
  width: number;
  thickness: number;
  qty: number;
  grain: Grain;
}

const MIN_BOX = 0.02;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const norm = (v: number) => Math.max(0, Math.min(1, v));

function rectCorners(x0: number, y0: number, x1: number, y1: number): Photobox["corners"] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function newBoxAt(x: number, y: number): Photobox {
  return { id: uid(), name: "", corners: rectCorners(x, y, x, y), length: 0, width: 0, thickness: 1, qty: 1, grain: "no_matter" };
}

const bounds = (corners: Pt[]) => {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

const quadPoints = (cs: Pt[], W: number, H: number) => cs.map((c) => `${(c.x * W).toFixed(1)},${(c.y * H).toFixed(1)}`).join(" ");

function pointInQuad(px: number, py: number, pts: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export default function PhotoScreen() {
  const { width: winW } = useWindowDimensions();
  const [existingParts, setExistingParts] = usePersistedState<Part[]>("clpv.parts.v1", []);
  const [uri, setUri] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [boxes, setBoxes] = useState<Photobox[]>([]);
  const [drawing, setDrawing] = useState<Photobox | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const drawingRef = useRef<Photobox | null>(null);
  drawingRef.current = drawing;
  const displayRef = useRef({ w: 0, h: 0 });

  const availW = winW - 40;
  const maxH = 420;
  const display = useMemo(() => {
    if (!imgDims) return null;
    const scale = Math.min(1, availW / imgDims.w, maxH / imgDims.h);
    return { w: imgDims.w * scale, h: imgDims.h * scale };
  }, [imgDims, availW]);

  if (display) displayRef.current = { w: display.w, h: display.h };

  const mountPhoto = async (assetUri: string) => {
    setUri(assetUri);
    setBoxes([]);
    setSelectedId(null);
    setImgDims(null);
    Image.getSize(assetUri, (w, h) => setImgDims({ w, h }), () => setImgDims({ w: 1, h: 1 }));
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!result.canceled && result.assets[0]) await mountPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setFlash("Camera permission denied — use “Choose from library” instead.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled && result.assets[0]) await mountPhoto(result.assets[0].uri);
  };

  const updateBox = (id: string, patch: Partial<Photobox>) => setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const removeBox = (id: string) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    setSelectedId(null);
  };

  const drawPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const d = displayRef.current;
          if (d.w <= 0) return;
          const sx = norm(e.nativeEvent.locationX / d.w);
          const sy = norm(e.nativeEvent.locationY / d.h);
          const anchor = { ...newBoxAt(sx, sy), name: `Part ${boxesRef.current.length + 1}` };
          drawingRef.current = anchor;
          setDrawing(anchor);
        },
        onPanResponderMove: (e) => {
          const a = drawingRef.current;
          if (!a) return;
          const d = displayRef.current;
          const ex = norm(e.nativeEvent.locationX / d.w);
          const ey = norm(e.nativeEvent.locationY / d.h);
          const x0 = Math.min(a.corners[0].x, ex);
          const y0 = Math.min(a.corners[0].y, ey);
          const x1 = Math.max(a.corners[0].x, ex);
          const y1 = Math.max(a.corners[0].y, ey);
          const next = { ...a, corners: rectCorners(x0, y0, x1, y1) };
          drawingRef.current = next;
          setDrawing(next);
        },
        onPanResponderRelease: () => {
          const box = drawingRef.current;
          setDrawing(null);
          drawingRef.current = null;
          if (!box) return;
          const bb = bounds(box.corners);
          if (bb.x1 - bb.x0 >= MIN_BOX && bb.y1 - bb.y0 >= MIN_BOX) {
            setBoxes((prev) => [...prev, box]);
            setSelectedId(box.id);
          } else {
            const hit = boxesRef.current.find((b) => pointInQuad(box.corners[0].x, box.corners[0].y, b.corners));
            setSelectedId(hit ? hit.id : null);
          }
        },
        onPanResponderTerminate: () => {
          setDrawing(null);
          drawingRef.current = null;
        },
      }),
    [],
  );

  const addToPartList = () => {
    const complete = boxes.filter((b) => b.length > 0 && b.width > 0);
    if (complete.length === 0) {
      setFlash("Enter dimensions for at least one part first.");
      return;
    }
    const parts: Part[] = complete.map((b) => ({
      id: uid(),
      name: b.name || `Part ${b.id}`,
      quantity: Math.max(1, Math.round(b.qty)),
      length: b.length,
      width: b.width,
      thickness: b.thickness,
      grain: b.grain,
      woodType: "",
      costPerBdFt: 0,
    }));
    const total = existingParts.length + parts.length;
    setExistingParts((prev) => [...prev, ...parts]);
    setFlash(`Added ${parts.length} part${parts.length === 1 ? "" : "s"} to the Part List (now ${total} total).`);
  };

  const bdftTotal = boxes.filter((b) => b.length > 0 && b.width > 0).reduce((sum, b) => sum + b.qty * boardFeet(b.length, b.width, b.thickness), 0);

  return (
    <ScrollView className="flex-1 bg-stone-50 dark:bg-stone-950" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
      <View className="flex-row items-baseline justify-between">
        <Text className="text-2xl font-bold text-stone-900 dark:text-stone-100">Photo → Parts</Text>
        <Text className="text-sm text-stone-500 dark:text-stone-400">{boxes.length} part{boxes.length === 1 ? "" : "s"}</Text>
      </View>
      <Text className="mt-1 text-sm text-stone-500 dark:text-stone-400">Take or upload a photo, then drag a box around each part. Tap a box to select it — drag the top bar to move it, or pull any corner dot to reshape that corner on its own.</Text>

      {!uri ? (
        <View className="mt-4 flex-row gap-2">
          <Pressable onPress={takePhoto} className="flex-1 items-center rounded-xl border border-stone-300 bg-white py-3 dark:border-stone-700 dark:bg-stone-900">
            <Text className="text-sm font-medium text-stone-700 dark:text-stone-300">Take a photo</Text>
          </Pressable>
          <Pressable onPress={pickFromLibrary} className="flex-1 items-center rounded-xl border border-stone-300 bg-white py-3 dark:border-stone-700 dark:bg-stone-900">
            <Text className="text-sm font-medium text-stone-700 dark:text-stone-300">Choose from library</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {display && imgDims ? (
            <View className="mt-4 self-center rounded-xl bg-stone-900 p-2" style={{ width: availW, height: display.h + 16 }}>
              <View style={{ width: display.w, height: display.h, alignSelf: "center" }}>
                <View {...drawPan.panHandlers} style={[StyleSheet.absoluteFill, { pointerEvents: "box-none" }]}>
                  <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
                    <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </View>
                  <Svg width={display.w} height={display.h} style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
                    {boxes.map((b, i) => {
                      const color = BOX_PALETTE[i % BOX_PALETTE.length];
                      const sel = selectedId === b.id;
                      return (
                        <Polygon
                          key={`p-${b.id}`}
                          points={quadPoints(b.corners, display.w, display.h)}
                          fill={hexToRgba(color, sel ? 0.32 : 0.15)}
                          stroke={color}
                          strokeWidth={sel ? 2.5 : 1.5}
                        />
                      );
                    })}
                    {drawing && <Polygon points={quadPoints(drawing.corners, display.w, display.h)} fill="rgba(251,191,36,0.2)" stroke="#fbbf24" strokeWidth={1.5} />}
                  </Svg>
                  {boxes.map((b, i) => (
                    <Text
                      key={`l-${b.id}`}
                      style={{ position: "absolute", left: b.corners[0].x * display.w, top: b.corners[0].y * display.h, fontSize: 10, color: BOX_PALETTE[i % BOX_PALETTE.length], fontWeight: "700", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 3, borderBottomRightRadius: 3, pointerEvents: "none" }}>
                      {b.name || `#${i + 1}`}
                    </Text>
                  ))}
                </View>

                {boxes.map((b, i) =>
                  selectedId === b.id ? <BoxControls key={`c-${b.id}`} box={b} color={BOX_PALETTE[i % BOX_PALETTE.length]} displayW={display.w} displayH={display.h} onUpdate={updateBox} /> : null,
                )}
              </View>
            </View>
          ) : (
            <View className="mt-4 rounded-xl bg-white p-4 dark:bg-stone-900"><Text className="text-stone-500 dark:text-stone-400">Loading photo…</Text></View>
          )}

          <View className="mt-3 flex-row gap-2">
            <Pressable onPress={pickFromLibrary} className="flex-1 items-center rounded-lg border border-stone-300 bg-white py-2 dark:border-stone-700 dark:bg-stone-900">
              <Text className="text-xs font-medium text-stone-700 dark:text-stone-300">Choose</Text>
            </Pressable>
            <Pressable onPress={takePhoto} className="flex-1 items-center rounded-lg border border-stone-300 bg-white py-2 dark:border-stone-700 dark:bg-stone-900">
              <Text className="text-xs font-medium text-stone-700 dark:text-stone-300">Retake</Text>
            </Pressable>
            <Pressable onPress={() => { setUri(null); setBoxes([]); setSelectedId(null); setImgDims(null); }} className="flex-1 items-center rounded-lg border border-red-200 bg-red-50 py-2 dark:border-red-800/60 dark:bg-red-950/40">
              <Text className="text-xs font-medium text-red-600 dark:text-red-400">Clear</Text>
            </Pressable>
          </View>

          {boxes.length > 0 && (
            <>
              <View className="mt-5 flex-row items-baseline justify-between">
                <Text className="text-lg font-bold text-stone-900 dark:text-stone-100">Traced parts</Text>
                <Text className="text-sm text-stone-500 dark:text-stone-400">{boxes.length} box{boxes.length === 1 ? "" : "es"}</Text>
              </View>
              <Text className="mt-1 text-sm text-stone-500 dark:text-stone-400">Edit dimensions below — comments update live. Tap a row to find/select that box on the photo.</Text>

              {boxes.map((b, idx) => {
                const bb = bounds(b.corners);
                return (
                <View key={b.id} className={`mt-4 rounded-xl p-4 shadow-sm ${selectedId === b.id ? "bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-900/30 dark:ring-amber-500" : "bg-white dark:bg-stone-900"}`}>
                  <Pressable onPress={() => setSelectedId(b.id)}>
                    <View className="flex-row items-center">
                      <Text className="mr-2 text-xs font-semibold text-stone-400 dark:text-stone-500">#{idx + 1}</Text>
                      <View className="flex-1">
                        <TextCell label="Name" value={b.name} onChange={(name) => updateBox(b.id, { name })} />
                      </View>
                      <Pressable onPress={() => removeBox(b.id)} className="ml-3 self-end rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/60 dark:bg-red-950/40">
                        <Text className="text-xs font-medium text-red-600 dark:text-red-400">Remove</Text>
                      </Pressable>
                    </View>
                  </Pressable>

                  <View className="mt-2 flex-row justify-between">
                    <NumberCell label="Qty" value={b.qty} onChange={(qty) => updateBox(b.id, { qty })} />
                    <NumberCell label="Length" value={b.length} onChange={(length) => updateBox(b.id, { length })} placeholder="in" />
                    <NumberCell label="Width" value={b.width} onChange={(width) => updateBox(b.id, { width })} placeholder="in" />
                    <NumberCell label="Thickness" value={b.thickness} onChange={(thickness) => updateBox(b.id, { thickness })} placeholder="in" />
                  </View>

                  <View className="mt-3">
                    <ChipSelector label="Grain" options={GRAIN_OPTIONS} value={b.grain} onChange={(grain) => updateBox(b.id, { grain })} />
                    <Text className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                      {(b.qty * boardFeet(b.length, b.width, b.thickness)).toFixed(2)} bd-ft {b.length > 0 && b.width > 0 ? "per line" : "· add dims to count"}
                    </Text>
                  </View>

                  <Text className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                    Area {((bb.x1 - bb.x0) * 100).toFixed(0)}×{((bb.y1 - bb.y0) * 100).toFixed(0)}% of photo {selectedId === b.id ? "· selected on photo" : ""}
                  </Text>
                </View>
                );
              })}
            </>
          )}

          {boxes.length > 0 && (
            <View className="mt-4 rounded-xl bg-amber-100 p-4 dark:bg-amber-900/30">
              <View className="flex-row justify-between">
                <Text className="font-semibold text-stone-900 dark:text-stone-100">Annotated board-ft</Text>
                <Text className="font-semibold text-amber-800 dark:text-amber-300">{bdftTotal.toFixed(2)} bd-ft</Text>
              </View>
              <Text className="mt-1 text-xs text-stone-500 dark:text-stone-400">Select a box, drag its top bar to move it, or pull any of its four corner dots independently to match an angled edge, then edit its dims in the list above.</Text>
            </View>
          )}

          <Pressable onPress={addToPartList} disabled={boxes.length === 0} className={`mt-4 items-center rounded-xl py-3 ${boxes.length === 0 ? "bg-stone-200 dark:bg-stone-800" : "bg-amber-600 dark:bg-amber-500"}`}>
            <Text className={`font-semibold ${boxes.length === 0 ? "text-stone-400 dark:text-stone-500" : "text-white"}`}>Send traced parts to Part List</Text>
          </Pressable>
        </>
      )}

      {flash && (
        <View className="mt-3 rounded-lg border border-stone-300 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <Text className="text-sm text-stone-700 dark:text-stone-300">{flash}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function BoxControls({ box, color, displayW, displayH, onUpdate }: { box: Photobox; color: string; displayW: number; displayH: number; onUpdate: (id: string, patch: Partial<Photobox>) => void }) {
  return (
    <>
      <MoveHandle box={box} color={color} displayW={displayW} displayH={displayH} onUpdate={onUpdate} />
      {box.corners.map((_, idx) => (
        <CornerHandle key={idx} box={box} index={idx as 0 | 1 | 2 | 3} color={color} displayW={displayW} displayH={displayH} onUpdate={onUpdate} />
      ))}
    </>
  );
}

/** Drags the whole part; shown as a bar along the top edge. */
function MoveHandle({ box, color, displayW, displayH, onUpdate }: { box: Photobox; color: string; displayW: number; displayH: number; onUpdate: (id: string, patch: Partial<Photobox>) => void }) {
  const cfgRef = useRef({ box, displayW, displayH, onUpdate });
  cfgRef.current = { box, displayW, displayH, onUpdate };
  const grantRef = useRef({ px: 0, py: 0, corners: box.corners });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          grantRef.current = { px: e.nativeEvent.pageX, py: e.nativeEvent.pageY, corners: box.corners };
        },
        onPanResponderMove: (e) => {
          const { displayW, displayH, onUpdate } = cfgRef.current;
          const g = grantRef.current;
          const bb = bounds(g.corners);
          const dx = clamp((e.nativeEvent.pageX - g.px) / displayW, -bb.x0, 1 - bb.x1);
          const dy = clamp((e.nativeEvent.pageY - g.py) / displayH, -bb.y0, 1 - bb.y1);
          onUpdate(cfgRef.current.box.id, { corners: g.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })) as Photobox["corners"] });
        },
      }),
    [],
  );
  const tl = box.corners[0];
  const tr = box.corners[1];
  const ax = tl.x * displayW;
  const ay = tl.y * displayH;
  const bx = tr.x * displayW;
  const by = tr.y * displayH;
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  const len = Math.max(20, Math.hypot(bx - ax, by - ay));
  const ang = Math.atan2(by - ay, bx - ax);
  return (
    <View
      {...responder.panHandlers}
      style={{ position: "absolute", left: cx - len / 2, top: cy - 20, width: len, height: 20, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: len - 6, height: 5, borderRadius: 3, backgroundColor: color, transform: [{ rotate: `${ang}rad` }] }} />
    </View>
  );
}

/** Repositioning a single corner; the other three stay put. */
function CornerHandle({ box, index, color, displayW, displayH, onUpdate }: { box: Photobox; index: 0 | 1 | 2 | 3; color: string; displayW: number; displayH: number; onUpdate: (id: string, patch: Partial<Photobox>) => void }) {
  const cfgRef = useRef({ box, displayW, displayH, onUpdate });
  cfgRef.current = { box, displayW, displayH, onUpdate };
  const grantRef = useRef({ px: 0, py: 0, cx: 0, cy: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const c = box.corners[index];
          grantRef.current = { px: e.nativeEvent.pageX, py: e.nativeEvent.pageY, cx: c.x, cy: c.y };
        },
        onPanResponderMove: (e) => {
          const { box, displayW, displayH, onUpdate } = cfgRef.current;
          const g = grantRef.current;
          const dx = (e.nativeEvent.pageX - g.px) / displayW;
          const dy = (e.nativeEvent.pageY - g.py) / displayH;
          const nc = { x: clamp(g.cx + dx, 0, 1), y: clamp(g.cy + dy, 0, 1) };
          const corners = box.corners.map((c, j) => (j === index ? nc : c)) as Photobox["corners"];
          onUpdate(box.id, { corners });
        },
      }),
    [],
  );
  const c = box.corners[index];
  return (
    <View {...responder.panHandlers} style={{ position: "absolute", left: c.x * displayW - 11, top: c.y * displayH - 11, width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: "#fff", borderWidth: 2, borderColor: color }} />
    </View>
  );
}