/**
 * The hill climb's "needs your eyes" queue: a ranked list of clips where Kenny's
 * input would help (bench/schemas/needs-eyes.v1.schema.json in the hill climb
 * checkout). The server reads it here, validates it against that schema, and hands
 * the page the open items. Answers need nothing extra: the hill climb reads
 * decisions.jsonl.
 *
 * The repo has no JSON Schema library, so `validate` covers the keywords this
 * schema uses (type, const, enum, required, properties, additionalProperties,
 * items, minItems, minLength, maxLength, minimum, exclusiveMinimum, pattern,
 * format: date-time). needsEyes.test.ts checks the vendored schema matches the
 * hill climb's when that checkout is present.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_NEEDS_EYES = '/home/kenny/.t3/worktrees/double-take/t3-45a3c420/build/hill/needs-eyes.v1.json';
export const DEFAULT_SCHEMA = '/home/kenny/.t3/worktrees/double-take/t3-45a3c420/bench/schemas/needs-eyes.v1.schema.json';
/** A copy of the schema, used when the hill climb's checkout isn't there. */
export const VENDORED_SCHEMA = join(resolve(import.meta.dirname), 'schemas', 'needs-eyes.v1.schema.json');

export interface NeedsEyesItem {
  id: string;
  rank: number;
  status: 'open';
  clipId: string;
  sourceClipId?: string;
  candidateRevision?: string;
  reason: 'conflicting_evidence' | 'unresolved_localization' | 'ambiguous_observation';
  question: string;
  whyHumanHelps: string;
  evidenceRefs: string[];
  attemptedChecks: string[];
  reviewUrl?: string;
  timeRange?: { t0: number; t1: number };
}

type Schema = Record<string, unknown>;

/** Errors (path: message) for `value` against a JSON Schema subset; empty when it's valid. */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t !== undefined) {
    const types = Array.isArray(t) ? t : [t];
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok = types.some((x) => x === kind || (x === 'integer' && Number.isInteger(value)) || (x === 'number' && kind === 'number'));
    if (!ok) return [`${path}: expected ${types.join(' or ')}`];
  }
  if ('const' in schema && value !== schema.const) errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errs.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errs.push(`${path}: too short`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errs.push(`${path}: too long`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: doesn't match ${schema.pattern}`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errs.push(`${path}: not a date-time`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errs.push(`${path}: must be above ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errs.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.items && typeof schema.items === 'object') value.forEach((v, i) => errs.push(...validate(schema.items as Schema, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) errs.push(`${path}.${r}: required`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errs.push(...validate(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
    }
  }
  return errs;
}

export interface NeedsEyesResult {
  /** The file was read and its envelope is valid (a missing file is ok, with no items). */
  ok: boolean;
  path: string;
  exists: boolean;
  generatedAt: string | null;
  /** Valid open items, by rank. */
  items: NeedsEyesItem[];
  /** Items left out because they don't match the schema. */
  invalid: { index: number; errors: string[] }[];
  error?: string;
}

/**
 * Parse and validate a needs-eyes file's text. The envelope must match; each item
 * is checked on its own, so one bad item doesn't hide the rest.
 */
export function parseNeedsEyes(text: string, schema: Schema, path = ''): NeedsEyesResult {
  const empty = { path, exists: true, generatedAt: null, items: [], invalid: [] };
  if (!text.trim()) return { ...empty, ok: true };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ...empty, ok: false, error: `not JSON: ${(e as Error).message}` };
  }
  const props = (schema.properties ?? {}) as Record<string, Schema>;
  const itemSchema = (props.items?.items ?? {}) as Schema;
  const envelope = { ...schema, properties: { ...props, items: { type: 'array' } } };
  const errs = validate(envelope, doc);
  if (errs.length) return { ...empty, ok: false, error: errs.slice(0, 5).join('; ') };
  const d = doc as { generatedAt: string; items: unknown[] };
  const items: NeedsEyesItem[] = [];
  const invalid: NeedsEyesResult['invalid'] = [];
  d.items.forEach((it, index) => {
    const e = validate(itemSchema, it, `$.items[${index}]`);
    if (e.length) invalid.push({ index, errors: e.slice(0, 5) });
    else items.push(it as NeedsEyesItem);
  });
  items.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return { ok: true, path, exists: true, generatedAt: d.generatedAt, items, invalid };
}

/** The clip key a needs-eyes item points at (the catalog's key). */
export const eyesKey = (it: Pick<NeedsEyesItem, 'clipId' | 'sourceClipId'>) => it.sourceClipId ?? it.clipId;

/** Reads the file on demand, re-parsing only when it changes (by mtime and size). */
export class NeedsEyesFile {
  readonly path: string;
  readonly schemaPath: string;
  private cache: { stamp: string; result: NeedsEyesResult } | null = null;
  constructor(path: string, schemaPath?: string) {
    this.path = path;
    this.schemaPath = schemaPath && existsSync(schemaPath) ? schemaPath : existsSync(DEFAULT_SCHEMA) ? DEFAULT_SCHEMA : VENDORED_SCHEMA;
  }

  read(): NeedsEyesResult {
    if (!existsSync(this.path)) return { ok: true, path: this.path, exists: false, generatedAt: null, items: [], invalid: [] };
    const st = statSync(this.path);
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (this.cache?.stamp === stamp) return this.cache.result;
    let result: NeedsEyesResult;
    try {
      const schema = JSON.parse(readFileSync(this.schemaPath, 'utf8')) as Schema;
      result = parseNeedsEyes(readFileSync(this.path, 'utf8'), schema, this.path);
    } catch (e) {
      result = { ok: false, path: this.path, exists: true, generatedAt: null, items: [], invalid: [], error: String(e) };
    }
    this.cache = { stamp, result };
    return result;
  }
}
