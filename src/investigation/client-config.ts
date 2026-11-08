/** Runtime-independent configuration and transport helpers; no implicit service discovery. */
export type ServiceConfig = { available: true; url: string } | { available: false; reason: 'missing' | 'invalid' | 'https_required' };
export const SERVICE_UNAVAILABLE = 'Upload service unavailable. Try again shortly.';
export class ClientServiceError extends Error {
  readonly recoverable = true;
  readonly code: 'unconfigured' | 'unavailable' | 'timeout' | 'invalid_response' | 'rejected';
  constructor(code: ClientServiceError['code'], message = SERVICE_UNAVAILABLE) {
    super(message); this.name = 'ClientServiceError'; this.code = code;
  }
}
export const isServiceUnavailable = (error: unknown): error is ClientServiceError => error instanceof ClientServiceError && ['unconfigured', 'unavailable', 'timeout'].includes(error.code);
export function serviceConfig(value: string | undefined, production: boolean): ServiceConfig {
  if (!value?.trim()) return { available: false, reason: 'missing' };
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) return { available: false, reason: 'invalid' };
    if (production && url.protocol !== 'https:') return { available: false, reason: 'https_required' };
    return { available: true, url: url.toString().replace(/\/+$/, '') };
  } catch { return { available: false, reason: 'invalid' }; }
}
export function serviceUrl(config: ServiceConfig, path: string): string {
  if (!config.available) throw new ClientServiceError('unconfigured');
  return config.url + path;
}
export const REQUEST_TIMEOUT_MS = 10_000;
// Includes server-side media validation; no automatic mutation retries.
export const UPLOAD_TIMEOUT_MS = 120_000;
export async function withRequestTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new ClientServiceError('timeout', 'Connection timed out. Retry to continue.')); controller.abort(); }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => run(controller.signal)), timeout]); }
  catch (error) {
    if (error instanceof ClientServiceError) throw error;
    throw new ClientServiceError('unavailable');
  } finally { clearTimeout(timer); }
}
/** Bound both headers and body consumption. Missing configuration never invokes transport. */
export async function serviceRequest<T>(config: ServiceConfig, path: string, run: (url: string, signal: AbortSignal) => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const url = serviceUrl(config, path);
  return withRequestTimeout(signal => run(url, signal), timeoutMs);
}
export function responseError(status: number, body: unknown, fallback: string, requestId?: string): ClientServiceError {
  if (status >= 500 || status === 408 || status === 429 || status === 401 || status === 403) return new ClientServiceError('unavailable');
  const rejection = body as { code?: unknown; error?: unknown; requestId?: unknown } | null;
  // Only a rejection explicitly bound to this request can replace local recovery copy.
  const message = requestId && rejection?.requestId === requestId && typeof rejection.code === 'string'
    && typeof rejection.error === 'string' && rejection.error.length <= 300 ? rejection.error : fallback;
  return new ClientServiceError('rejected', message);
}
export function validateJobResponse(value: unknown, id: string, prepared = false): void {
  const job = value as { id?: unknown; state?: unknown; sha256?: unknown; result?: { version?: unknown; clipId?: unknown; mediaSha256?: unknown; components?: unknown; evidence?: unknown; verdict?: unknown } } | null;
  const fail = () => { throw new ClientServiceError('invalid_response', 'Upload result unavailable. Retry to continue.'); };
  if (!job || job.id !== id || !['queued', 'running', 'complete', 'error'].includes(String(job.state))) return fail();
  if (job.state === 'running' && job.result !== undefined) {
    // A check in progress may carry its investigation so far: bound to this upload, marked partial, no verdict yet.
    const r = job.result as { version?: unknown; clipId?: unknown; mediaSha256?: unknown; verdict?: unknown; investigation?: { outcome?: unknown; steps?: unknown } } | null;
    if (!r || r.version !== 1 || typeof job.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(job.sha256) || r.mediaSha256 !== job.sha256
      || (!prepared && r.clipId !== id) || r.investigation?.outcome !== 'partial' || !Array.isArray(r.investigation.steps) || r.verdict !== undefined) return fail();
    return;
  }
  if (job.state === 'complete' || job.result !== undefined) {
    const r = job.result;
    if (job.state !== 'complete' || !r || r.version !== 1 || typeof job.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(job.sha256)
      || r.mediaSha256 !== job.sha256 || typeof r.clipId !== 'string' || !r.clipId
      || (!prepared && r.clipId !== id) || !Array.isArray(r.components) || !Array.isArray(r.evidence)) return fail();
    // Optional for older checks; a present headline must satisfy its runtime contract.
    if (r.verdict !== undefined) {
      const v = r.verdict as { label?: unknown; drivers?: unknown; confidence?: unknown; calibration?: { version?: unknown; scope?: unknown } } | null;
      if (!v || typeof v.label !== 'string' || !['likely_ai', 'likely_real'].includes(v.label) || !Array.isArray(v.drivers)
        || v.drivers.length > 8 || v.drivers.some(d => typeof d !== 'string' || !d.trim() || d.length > 400)) return fail();
      if (v.confidence !== undefined && (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)
        || v.confidence < 0 || v.confidence > 1 || typeof v.calibration?.version !== 'string'
        || !v.calibration.version.trim() || v.calibration.version.length > 100 || v.calibration.scope !== 'feed-domain')) return fail();
    }
  }
}
