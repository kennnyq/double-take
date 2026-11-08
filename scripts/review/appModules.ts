/**
 * The review page runs the app's own double take logic (spotlight geometry, card
 * placement, eased scrubbing, the tells format and walkthrough, the palettes)
 * instead of a copy, so what Kenny reviews is what a user sees. These modules are
 * pure TypeScript with `.ts` imports; the server strips their types per request
 * (Node's `stripTypeScriptTypes`), so there is no build step and no stale bundle.
 *
 * Only the allowlisted files (and the review page's own helpers in
 * scripts/review/web/) are served, never anything else from the repo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, normalize } from 'node:path';

/** App modules the review page imports. Each must be free of React Native imports. */
export const APP_MODULES = [
  'src/feed/spotlight.ts',
  'src/feed/card.ts',
  'src/feed/scrub.ts',
  'src/feed/tells.ts',
  'src/feed/reveal.ts',
  'src/feed/shrink.ts',
  'src/annotations/format.ts',
  'src/annotations/walkthrough.ts',
  'src/ui/theme/palettes.ts',
] as const;

/** The spotlight's soft-edged masks (assets/spotlight/spot-*.png). */
const ASSET = /^assets\/spotlight\/spot-[a-z]+\.png$/;
/** The review page's own typed helpers. */
const WEB = /^scripts\/review\/web\/[\w-]+\.ts$/;

/**
 * The repo file behind `/app/<rel>`, or null when it isn't servable. `rel` is the
 * URL path after `/app/`.
 */
export function appFile(root: string, rel: string): { path: string; kind: 'module' | 'png' } | null {
  const clean = normalize(rel).replace(/\\/g, '/');
  if (clean.startsWith('..') || clean.startsWith('/') || clean.includes('\0')) return null;
  const kind = ASSET.test(clean) ? 'png' : (APP_MODULES as readonly string[]).includes(clean) || WEB.test(clean) ? 'module' : null;
  if (!kind) return null;
  const path = join(root, clean);
  return existsSync(path) ? { path, kind } : null;
}

/** TypeScript source as a browser ES module: types stripped, line numbers kept. */
export function toBrowserModule(source: string): string {
  return stripTypeScriptTypes(source, { mode: 'strip' });
}

/** Relative specifiers a module imports or re-exports at runtime (type-only imports are gone once stripped). */
export function runtimeImports(js: string): string[] {
  return [...js.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm), ...js.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1],
  );
}

export function readModule(path: string): string {
  return toBrowserModule(readFileSync(path, 'utf8'));
}
