import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

type Listener = () => void;

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

function publish(key: string): void {
  const set = listeners.get(key);
  if (set) for (const fn of set) fn();
}

function subscribe(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

function writeCache(key: string, value: unknown): void {
  cache.set(key, value);
  queueMicrotask(() => publish(key));
}

/** AsyncStorage-backed state shared in-memory across every screen that uses the
 *  same key: a write from one hook instance propagates immediately to all
 *  others (real-time cross-tab updates) and is persisted. */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  hydrate?: (raw: T) => T,
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  const hydrateRef = useRef(hydrate);
  hydrateRef.current = hydrate;

  useEffect(() => {
    let active = true;
    const finalize = (next: T) => {
      if (!active) return;
      setValue(next);
      cache.set(key, next);
      setLoaded(true);
    };
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = JSON.parse(raw) as T;
        finalize(hydrateRef.current ? hydrateRef.current(parsed) : parsed);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });

    const unsubscribe = subscribe(key, () => {
      if (cache.has(key)) setValue(cache.get(key) as T);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [key]);

  const setPersisted = useCallback(
    (update: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof update === "function" ? (update as (prev: T) => T)(prev) : update;
        writeCache(key, next);
        AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [key],
  );

  return [value, setPersisted, loaded];
}