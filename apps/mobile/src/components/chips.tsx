import { Pressable, Text, View } from "react-native";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

export function ChipSelector<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <View>
      {label ? <Text className="mb-1 text-xs text-stone-500">{label}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              className={`rounded-full border px-3 py-1.5 ${
                active ? "border-amber-600 bg-amber-600" : "border-stone-300 bg-white"
              }`}>
              <Text className={`text-xs font-medium ${active ? "text-white" : "text-stone-700"}`}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}