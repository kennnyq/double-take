import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_OPTIONS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

/** The Supabase client, or null in local mode (no Supabase configured). */
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { ...AUTH_OPTIONS, storage: localStorage } })
    : null;

// Refresh tokens only while the app is in the foreground (Expo's Supabase guide).
if (supabase) {
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}
