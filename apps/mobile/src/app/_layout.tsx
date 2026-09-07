import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";

import "../global.css";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: "#b45309",
          headerTitleStyle: { fontWeight: "600" },
        }}>
        <Tabs.Screen name="index" options={{ title: "Part List" }} />
        <Tabs.Screen name="stock" options={{ title: "Stock" }} />
        <Tabs.Screen name="layout" options={{ title: "Layout" }} />
        <Tabs.Screen name="photo" options={{ title: "Photo → Board-ft" }} />
      </Tabs>
    </>
  );
}