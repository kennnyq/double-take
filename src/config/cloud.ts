import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/auth/supabase';

/**
 * Settings that can change without a release: rows of `app_config` in
 * Supabase (key → JSON value), edited by hand in the table editor
 * (supabase/migrations/20261108200000_app_config.sql). Read once per app run,
 * with a short timeout; until then, or if it fails, callers get their fallback,
 * so nothing waits on it.
 */
export type CloudConfig = Readonly<Record<string, unknown>>;

const TIMEOUT_MS = 3000;

let config: CloudConfig | null = null;
let started = false;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Fetch the config once per app run. Safe to call often; never throws. */
export function loadCloudConfig() {
  if (started || !supabase) return;
  started = true;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const fetched = Promise.resolve(supabase.from('app_config').select('key, value'))
    .then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
    })
    .catch((e) => {
      console.warn(`[config] using built-in defaults: ${e instanceof Error ? e.message : e}`);
      return null;
    });
  Promise.race([fetched, timeout]).then((c) => {
    if (!c) return;
    config = Object.freeze(c);
    listeners.forEach((l) => l());
  });
}

/**
 * One cloud setting: its value once loaded, if `accept` takes it; otherwise
 * `fallback`. Re-renders when the config arrives.
 */
export function useCloudConfig<T>(key: string, fallback: T, accept: (v: unknown) => v is T): T {
  useEffect(loadCloudConfig, []);
  const v = useSyncExternalStore(subscribe, () => config?.[key], () => config?.[key]);
  return accept(v) ? v : fallback;
}
