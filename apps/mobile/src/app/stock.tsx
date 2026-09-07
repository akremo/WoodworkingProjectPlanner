import { boardFeet, type Stock, type StockType } from "@clpv/core";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ChipSelector } from "@/components/chips";
import { NumberCell, NumberInput, TextCell } from "@/components/inputs";
import { usePersistedState } from "@/hooks/use-persisted-state";

const TYPE_OPTIONS: { value: StockType; label: string }[] = [
  { value: "board", label: "Board" },
  { value: "sheet", label: "Sheet" },
  { value: "scrap", label: "Scrap" },
];

const STORAGE_KEY = "clpv.stock.v1";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newStock(): Stock {
  return { id: uid(), type: "board", name: "", length: 0, width: 0, thickness: 1, qty: 1, price: 0, woodType: "", costPerBdFt: 0 };
}

function hydrate(s: Stock): Stock {
  return { ...s, woodType: s.woodType ?? "", costPerBdFt: s.costPerBdFt ?? 0 };
}

export default function StockScreen() {
  const [stock, setStock, loaded] = usePersistedState<Stock[]>(STORAGE_KEY, [], (raw) => raw.map(hydrate));

  const update = (id: string, patch: Partial<Stock>) => {
    setStock((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const remove = (id: string) => setStock((prev) => prev.filter((s) => s.id !== id));
  const add = () => setStock((prev) => [...prev, newStock()]);

  const linePrice = (s: Stock) => s.qty * s.price;
  const totalPrice = stock.reduce((sum, s) => sum + linePrice(s), 0);
  const boardFtd = stock.filter((s) => s.type === "board").reduce((sum, s) => sum + s.qty * boardFeet(s.length, s.width, s.thickness), 0);
  const lineValue = (s: Stock) => (s.type === "sheet" ? 0 : s.qty * boardFeet(s.length, s.width, s.thickness) * s.costPerBdFt);
  const totalValue = stock.reduce((sum, s) => sum + lineValue(s), 0);

  if (!loaded) return <View className="flex-1 bg-stone-50 p-4"><Text className="text-stone-500">Loading…</Text></View>;

  return (
    <ScrollView className="flex-1 bg-stone-50" keyboardShouldPersistTaps="handled">
      <View className="p-4">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-2xl font-bold text-stone-900">Stock</Text>
          <Text className="text-sm text-stone-500">{stock.length} item{stock.length === 1 ? "" : "s"}</Text>
        </View>
        <Text className="mt-1 text-sm text-stone-500">Editable — saved on this device.</Text>

        {stock.map((s, index) => (
          <View key={s.id} className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <View className="flex-row items-center">
              <Text className="mr-2 text-xs font-semibold text-stone-400">#{index + 1}</Text>
              <View className="flex-1">
                <TextCell label="Name" value={s.name} onChange={(name) => update(s.id, { name })} />
              </View>
              <Pressable
                onPress={() => remove(s.id)}
                className="ml-3 self-end rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <Text className="text-xs font-medium text-red-600">Remove</Text>
              </Pressable>
            </View>

            <View className="mt-2">
              <ChipSelector label="Type" options={TYPE_OPTIONS} value={s.type} onChange={(type) => update(s.id, { type })} />
            </View>

            <View className="mt-3 flex-row justify-between">
              <NumberCell label="Length" value={s.length} onChange={(length) => update(s.id, { length })} placeholder="in" />
              <NumberCell label="Width" value={s.width} onChange={(width) => update(s.id, { width })} placeholder="in" />
              <NumberCell label="Thick" value={s.thickness} onChange={(thickness) => update(s.id, { thickness })} placeholder="in" />
              <NumberCell label="Qty" value={s.qty} onChange={(qty) => update(s.id, { qty })} />
            </View>

            <View className="mt-3 flex-row items-end gap-2">
              <View className="flex-1">
                <Text className="mb-1 text-xs text-stone-500">Wood</Text>
                <TextInput
                  className="h-9 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900"
                  value={s.woodType}
                  placeholder="e.g. walnut"
                  onChangeText={(woodTypeFinal) => update(s.id, { woodType: woodTypeFinal })}
                />
              </View>
              <View>
                <Text className="mb-1 text-right text-xs text-stone-500">$/bd-ft</Text>
                <NumberInput value={s.costPerBdFt} onChange={(costPerBdFt) => update(s.id, { costPerBdFt })} />
              </View>
            </View>

            <View className="mt-3">
              <NumberCell label="Price (per item)" value={s.price} onChange={(price) => update(s.id, { price })} />
              <Text className="mt-1 text-xs text-stone-500">
                {s.type === "sheet"
                  ? `${linePrice(s).toFixed(2)} total`
                  : `${boardFeet(s.length, s.width, s.thickness).toFixed(2)} bd-ft per item · $${lineValue(s).toFixed(2)} value`}
              </Text>
            </View>
          </View>
        ))}

        <Pressable onPress={add} className="mt-4 items-center rounded-xl border border-dashed border-stone-400 py-3">
          <Text className="font-medium text-stone-600">+ Add stock</Text>
        </Pressable>

        <View className="mt-4 rounded-xl bg-amber-100 p-4">
          <View className="flex-row justify-between">
            <Text className="font-semibold text-stone-900">Board total</Text>
            <Text className="font-semibold text-amber-800">{boardFtd.toFixed(2)} bd-ft</Text>
          </View>
          <View className="mt-1 flex-row justify-between">
            <Text className="font-semibold text-stone-900">Total price (by $/bd-ft)</Text>
            <Text className="font-semibold text-amber-800">${totalValue.toFixed(2)}</Text>
          </View>
          <View className="mt-1 flex-row justify-between">
            <Text className="font-semibold text-stone-900">Purchase price</Text>
            <Text className="font-semibold text-amber-800">${totalPrice.toFixed(2)}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}