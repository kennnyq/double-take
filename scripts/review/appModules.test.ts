import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { APP_MODULES, appFile, readModule, runtimeImports, toBrowserModule } from './appModules.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const WEB_DIR = join(ROOT, 'scripts/review/web');
const WEB = (existsSync(WEB_DIR) ? readdirSync(WEB_DIR) : [])
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => `scripts/review/web/${f}`);

test('every module the review page loads strips to plain JS and only imports servable modules', () => {
  for (const rel of [...APP_MODULES, ...WEB]) {
    const file = appFile(ROOT, rel);
    assert.ok(file, `${rel} is servable`);
    const js = readModule(file.path);
    for (const spec of runtimeImports(js)) {
      assert.ok(spec.startsWith('.'), `${rel} imports ${spec}: the browser can only load relative modules`);
      const target = posix.normalize(posix.join(posix.dirname(rel), spec));
      assert.ok(appFile(ROOT, target), `${rel} imports ${target}, which isn't on the allowlist`);
    }
    // No React Native or other package imports slipped in.
    assert.doesNotMatch(js, /from\s+['"](react|react-native|expo)/, rel);
  }
});

test('appFile serves only the allowlist and the spotlight masks', () => {
  assert.equal(appFile(ROOT, 'src/feed/spotlight.ts')?.kind, 'module');
  assert.equal(appFile(ROOT, 'assets/spotlight/spot-soft.png')?.kind, 'png');
  for (const bad of ['src/feed/Feed.tsx', '.env.local', 'worker/.dev.vars', '../etc/passwd', 'src/feed/../../.env.local', 'assets/spotlight/hole-soft.png'])
    assert.equal(appFile(ROOT, bad), null, bad);
});

test('toBrowserModule drops types and keeps runtime code', () => {
  const js = toBrowserModule("import type { A } from './a.ts';\nexport const f = (x: number): number => x + 1;\n");
  assert.doesNotMatch(js, /: number|import type/);
  assert.equal(runtimeImports(js).length, 0);
  assert.deepEqual(runtimeImports("import { a } from './a.ts';\nexport { b } from '../b.ts';\n"), ['./a.ts', '../b.ts']);
});
