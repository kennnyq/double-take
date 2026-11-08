import { supabase } from '@/auth/supabase';
import { lookupDemoCheckStatusWith, lookupDemoCheckWith, type DemoCheck, type DemoLookup, type DemoQuery } from './lookupCore';

export type { DemoCheck, DemoLookup, DemoQuery } from './lookupCore';
export { DEMO_LOOKUP_TIMEOUT_MS } from './lookupCore';

/**
 * Prepared stage-demo checks stored in Supabase (`demo_checks` + the public
 * `demo-media` bucket; supabase/migrations/20261108210000_demo_checks.sql),
 * loaded with scripts/demo/import-demo-checks.ts.
 *
 * The prepared check for a file (by its SHA-256, hex) or a link (any form of
 * it), or null: no match, no Supabase configured, offline, or slower than the
 * timeout (2.5 s by default). Never throws.
 */
export function lookupDemoCheck(q: DemoQuery, opts?: { timeoutMs?: number }): Promise<DemoCheck | null> {
  return lookupDemoCheckWith(supabase, q, opts);
}

/** Like `lookupDemoCheck`, but says whether an empty answer was "not found" or "couldn't reach the cloud". */
export function lookupDemoCheckStatus(q: DemoQuery, opts?: { timeoutMs?: number }): Promise<DemoLookup> {
  return lookupDemoCheckStatusWith(supabase, q, opts);
}
