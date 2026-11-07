/**
 * Minimal client for NVIDIA's hosted API catalog (OpenAI-compatible chat
 * completions at integrate.api.nvidia.com).
 *
 * The key is read from NVIDIA_API_KEY, or from the file named by
 * NVIDIA_API_KEY_FILE, at call time. It is never logged, written to disk or
 * included in errors. Developer-program access is a free, rate-limited trial
 * with no per-call billing; running out of credits returns an error, which
 * stops the run (no retries).
 */
import { readFileSync } from 'node:fs';

export const NIM_BASE = 'https://integrate.api.nvidia.com/v1';

export class NimError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(redact(message));
    this.name = 'NimError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** Remove anything that looks like a key or bearer token from text. */
export function redact(s: string): string {
  return s.replace(/(Bearer\s+)[\w.-]+/gi, '$1…').replace(/nvapi-[\w-]+/g, 'nvapi-…');
}

export function loadKey(env: Record<string, string | undefined> = process.env): string {
  if (env.NVIDIA_API_KEY?.trim()) return env.NVIDIA_API_KEY.trim();
  if (env.NVIDIA_API_KEY_FILE) {
    try {
      const k = readFileSync(env.NVIDIA_API_KEY_FILE, 'utf8').trim();
      if (k) return k;
    } catch {
      throw new NimError('NVIDIA_API_KEY_FILE is set but the file cannot be read');
    }
  }
  throw new NimError('No NVIDIA key: set NVIDIA_API_KEY_FILE (preferred) or NVIDIA_API_KEY');
}

export type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: Content;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  /** Constrained decoding. Top-level `guided_json` works on the hosted API; `nvext.guided_json` returns 400 (PoC). */
  guided_json?: object;
  chat_template_kwargs?: Record<string, unknown>;
}

export interface CallLog {
  model: string;
  status: number | 'error';
  ms: number;
  attempt: number;
  usage?: unknown;
}

export interface NimClient {
  chat(req: ChatRequest): Promise<unknown>;
  models(): Promise<string[]>;
  readonly log: CallLog[];
}

export interface ClientOptions {
  fetchImpl?: typeof fetch;
  /** Hard cap on HTTP calls for this process, to stay well inside free credits. */
  maxCalls?: number;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  key?: () => string;
}

export function createClient(opts: ClientOptions = {}): NimClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxCalls = opts.maxCalls ?? 40;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const key = opts.key ?? (() => loadKey());
  const log: CallLog[] = [];
  let calls = 0;

  async function request(path: string, body?: object, model = '-'): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      if (calls >= maxCalls) throw new NimError(`call budget of ${maxCalls} reached; raise --max-calls to continue`);
      calls++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const started = Date.now();
      let status: number | 'error' = 'error';
      try {
        const res = await fetchImpl(`${NIM_BASE}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            authorization: `Bearer ${key()}`,
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        status = res.status;
        const text = await res.text();
        if (res.ok) {
          const json = JSON.parse(text) as { usage?: unknown };
          log.push({ model, status, ms: Date.now() - started, attempt, usage: json.usage });
          return json;
        }
        log.push({ model, status, ms: Date.now() - started, attempt });
        const retryable = res.status === 429 || res.status >= 500;
        const err = new NimError(`${model}: HTTP ${res.status} ${text.slice(0, 300)}`, res.status, retryable);
        if (res.status === 402) throw new NimError(`${model}: HTTP 402 (free credits used up?) ${text.slice(0, 200)}`, 402, false);
        if (!retryable || attempt > retries) throw err;
      } catch (e) {
        if (e instanceof NimError && (!e.retryable || attempt > retries)) throw e;
        if (!(e instanceof NimError)) {
          if (status === 'error') log.push({ model, status, ms: Date.now() - started, attempt });
          const msg = ctrl.signal.aborted ? `timed out after ${timeoutMs} ms` : String(e);
          if (attempt > retries) throw new NimError(`${model}: ${msg}`, undefined, true);
        }
      } finally {
        clearTimeout(timer);
      }
      await sleep(Math.min(30_000, 2000 * 2 ** (attempt - 1)));
    }
  }

  return {
    log,
    chat: (req) => request('/chat/completions', { temperature: 0, max_tokens: 2048, ...req }, req.model),
    models: async () => {
      const d = (await request('/models')) as { data?: { id: string }[] };
      return (d.data ?? []).map((m) => m.id).sort();
    },
  };
}
