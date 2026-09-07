import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

function parseNumber(text: string): number {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function NumberInput({
  value,
  onChange,
  placeholder = "0",
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value === 0 ? "" : String(value));

  useEffect(() => {
    setDraft(value === 0 ? "" : String(value));
  }, [value]);

  return (
    <TextInput
      className="h-9 w-16 rounded-lg border border-stone-300 bg-white px-2 py-1 text-right text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
      value={draft}
      keyboardType="numeric"
      placeholder={placeholder}
      onChangeText={(text) => {
        setDraft(text);
        onChange(parseNumber(text));
      }}
      onEndEditing={() => setDraft(value === 0 ? "" : String(value))}
    />
  );
}

export function NumberCell({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  return (
    <View className="flex-1 items-center">
      <Text className="mb-1 text-xs text-stone-500 dark:text-stone-400">{label}</Text>
      <NumberInput value={value} onChange={onChange} placeholder={placeholder} />
    </View>
  );
}

export function TextCell({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <InputRow label={label}>
      <TextInput
        className="h-9 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
        value={value}
        placeholder={label}
        onChangeText={onChange}
      />
    </InputRow>
  );
}

function InputRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-1">
      <Text className="mb-1 text-xs text-stone-500 dark:text-stone-400">{label}</Text>
      {children}
    </View>
  );
}