import { boardFeet, serializePartsExportCsv, type Grain, type Part } from "@clpv/core";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ChipSelector } from "@/components/chips";
import { NumberCell, NumberInput, TextCell } from "@/components/inputs";
import { usePersistedState } from "@/hooks/use-persisted-state";

const GRAIN_OPTIONS: { value: Grain; label: string }[] = [
  { value: "lengthwise", label: "Lengthwise" },
  { value: "along_width", label: "Along width" },
  { value: "no_matter", label: "Any grain" },
];

const STORAGE_KEY = "clpv.parts.v1";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newPart(): Part {
  return { id: uid(), name: "", quantity: 1, length: 0, width: 0, thickness: 1, grain: "lengthwise", woodType: "", costPerBdFt: 0 };
}

function hydrate(p: Part): Part {
  return { ...p, woodType: p.woodType ?? "", costPerBdFt: p.costPerBdFt ?? 0 };
}

export default function CutListScreen() {
  const [parts, setParts, loaded] = usePersistedState<Part[]>(STORAGE_KEY, [], (raw) => raw.map(hydrate));

  const update = (id: string, patch: Partial<Part>) => {
    setParts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const remove = (id: string) => setParts((prev) => prev.filter((p) => p.id !== id));
  const add = () => setParts((prev) => [...prev, newPart()]);

  const lineBdFt = (p: Part) => p.quantity * boardFeet(p.length, p.width, p.thickness);
  const linePrice = (p: Part) => lineBdFt(p) * p.costPerBdFt;
  const totalBdFt = parts.reduce((sum, p) => sum + lineBdFt(p), 0);
  const totalPrice = parts.reduce((sum, p) => sum + linePrice(p), 0);

  const onExport = async () => {
    const csv = serializePartsExportCsv(parts);
    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cutlist.csv";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const file = new File(Paths.cache, "cutlist.csv");
    file.write(csv);
    await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "Export cut list" });
  };

  if (!loaded) return <View className="flex-1 bg-stone-50 p-4 dark:bg-stone-950"><Text className="text-stone-500 dark:text-stone-400">Loading…</Text></View>;

  return (
    <ScrollView className="flex-1 bg-stone-50 dark:bg-stone-950" keyboardShouldPersistTaps="handled">
      <View className="p-4">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-2xl font-bold text-stone-900 dark:text-stone-100">Part List</Text>
          <Pressable onPress={onExport} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 dark:border-stone-700 dark:bg-stone-900">
            <Text className="text-xs font-medium text-stone-700 dark:text-stone-300">Export CSV</Text>
          </Pressable>
        </View>
        <Text className="mt-1 text-sm text-stone-500 dark:text-stone-400">Editable — saved on this device.</Text>

        {parts.map((p, index) => (
          <View key={p.id} className="mt-4 rounded-xl bg-white p-4 shadow-sm dark:bg-stone-900">
            <View className="flex-row items-center">
              <Text className="mr-2 text-xs font-semibold text-stone-400 dark:text-stone-500">#{index + 1}</Text>
              <View className="flex-1">
                <TextCell label="Name" value={p.name} onChange={(name) => update(p.id, { name })} />
              </View>
              <Pressable
                onPress={() => remove(p.id)}
                className="ml-3 self-end rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/60 dark:bg-red-950/40">
                <Text className="text-xs font-medium text-red-600 dark:text-red-400">Remove</Text>
              </Pressable>
            </View>

            <View className="mt-2 flex-row justify-between">
              <NumberCell label="Qty" value={p.quantity} onChange={(quantity) => update(p.id, { quantity })} />
              <NumberCell label="Length" value={p.length} onChange={(length) => update(p.id, { length })} placeholder="in" />
              <NumberCell label="Width" value={p.width} onChange={(width) => update(p.id, { width })} placeholder="in" />
              <NumberCell label="Thickness" value={p.thickness} onChange={(thickness) => update(p.id, { thickness })} placeholder="in" />
            </View>

            <View className="mt-3 flex-row items-end gap-2">
              <View className="flex-1">
                <Text className="mb-1 text-xs text-stone-500 dark:text-stone-400">Wood</Text>
                <TextInput
                  className="h-9 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  value={p.woodType}
                  placeholder="e.g. walnut"
                  onChangeText={(woodTypeFinal) => update(p.id, { woodType: woodTypeFinal })}
                />
              </View>
              <View>
                <Text className="mb-1 text-right text-xs text-stone-500 dark:text-stone-400">$/bd-ft</Text>
                <NumberInput value={p.costPerBdFt} onChange={(costPerBdFt) => update(p.id, { costPerBdFt })} />
              </View>
            </View>

            <View className="mt-3">
              <ChipSelector
                label="Grain"
                options={GRAIN_OPTIONS}
                value={p.grain}
                onChange={(grain) => update(p.id, { grain })}
              />
              <Text className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                {lineBdFt(p).toFixed(2)} bd-ft · ${linePrice(p).toFixed(2)} per entry
              </Text>
            </View>
          </View>
        ))}

        <Pressable
          onPress={add}
          className="mt-4 items-center rounded-xl border border-dashed border-stone-400 py-3 dark:border-stone-600">
          <Text className="font-medium text-stone-600 dark:text-stone-300">+ Add part</Text>
        </Pressable>

        <View className="mt-4 rounded-xl bg-amber-100 p-4 dark:bg-amber-900/30">
          <View className="flex-row justify-between">
            <Text className="font-semibold text-stone-900 dark:text-stone-100">Total (all parts)</Text>
            <Text className="font-semibold text-stone-900 dark:text-stone-100">{totalBdFt.toFixed(2)} bd-ft</Text>
          </View>
          <View className="mt-1 flex-row justify-between">
            <Text className="font-semibold text-stone-900 dark:text-stone-100">Total price</Text>
            <Text className="font-semibold text-amber-800 dark:text-amber-300">${totalPrice.toFixed(2)}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}