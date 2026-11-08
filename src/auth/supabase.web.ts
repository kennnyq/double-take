import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_OPTIONS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

/** The Supabase client, or null in local mode. On web the session lives in the browser's localStorage. */
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && typeof window !== 'undefined'
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: AUTH_OPTIONS })
    : null;
