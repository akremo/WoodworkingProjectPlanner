import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "clpv.theme.v1";

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_KEY)
      .then((raw) => {
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as { mode?: ThemeMode };
          if (parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "system") {
            setModeState(parsed.mode);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(THEME_KEY, JSON.stringify({ mode: next })).catch(() => {});
  };

  const resolvedTheme = useMemo<"light" | "dark">(() => {
    if (mode === "system") return system === "dark" ? "dark" : "light";
    return mode;
  }, [mode, system]);

  // Only report the resolved theme once persisted preference is known so the
  // first frame doesn't flash the wrong theme.
  const appliedTheme = loaded ? resolvedTheme : "light";

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme: appliedTheme,
      setMode,
      cycleMode: () => setMode(THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]),
    }),
    [mode, appliedTheme],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}