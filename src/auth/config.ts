/**
 * Supabase settings from `.env.local`. Expo only inlines literal
 * `process.env.EXPO_PUBLIC_*` reads, so they're written out in full.
 * Without them the app runs in local mode: in-memory actions and no sign-in.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/** Where supabase-js keeps the session (localStorage on web, expo-sqlite's on native). */
export const AUTH_STORAGE_KEY = 'double-take-auth';

export const AUTH_OPTIONS = {
  storageKey: AUTH_STORAGE_KEY,
  autoRefreshToken: true,
  persistSession: true,
  // Email codes need no redirect, so there's never a session in the URL.
  detectSessionInUrl: false,
} as const;
