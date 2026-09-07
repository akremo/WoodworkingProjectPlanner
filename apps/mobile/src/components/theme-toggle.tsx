import { Pressable, Text } from "react-native";

import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { resolvedTheme, cycleMode } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Pressable
      onPress={cycleMode}
      accessibilityLabel="Toggle theme"
      hitSlop={8}
      className={`mr-2 h-8 w-8 items-center justify-center rounded-full border ${
        dark ? "border-amber-400 bg-stone-700" : "border-amber-600 bg-amber-50"
      }`}>
      <Text className={dark ? "text-lg leading-none text-amber-300" : "text-lg leading-none text-amber-700"}>
        {dark ? "☾" : "☀"}
      </Text>
    </Pressable>
  );
}