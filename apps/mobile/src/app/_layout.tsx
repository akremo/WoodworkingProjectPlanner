import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeProvider, useTheme } from "@/lib/theme";

import "../global.css";

function ThemedTabs() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <View className={`flex-1 ${dark ? "dark" : ""}`}>
      <StatusBar style={dark ? "light" : "auto"} />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: "#b45309",
          headerTitleStyle: { fontWeight: "600" },
          headerRight: () => <ThemeToggle />,
          headerStyle: { backgroundColor: dark ? "#1c1917" : "#ffffff" },
          headerTintColor: dark ? "#e7e5e4" : "#1c1917",
          tabBarStyle: { backgroundColor: dark ? "#1c1917" : "#ffffff" },
          tabBarInactiveTintColor: dark ? "#a8a29e" : "#78716c",
        }}>
        <Tabs.Screen name="index" options={{ title: "Part List" }} />
        <Tabs.Screen name="stock" options={{ title: "Stock" }} />
        <Tabs.Screen name="layout" options={{ title: "Layout" }} />
        <Tabs.Screen name="photo" options={{ title: "Photo → Board-ft" }} />
      </Tabs>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedTabs />
    </ThemeProvider>
  );
}