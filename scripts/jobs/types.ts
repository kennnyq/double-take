/** Portable analyzer boundary. Original bytes, not a playback proxy, define identity. */
export interface AnalysisInput {
  clipId: string; mediaSha256: string; mediaPath: string;
  duration: number; width: number; height: number; hasAudio: boolean;
}
export interface AnalysisContext {
  outputDir: string; deadline: number; signal: AbortSignal;
}
export interface Box { x: number; y: number; w: number; h: number }
export interface DisplayMoment {
  id: string; category: string; label: string; detail?: string; t0: number; t1: number;
  focusT?: number; compareT?: number; box?: Box; placement?: 'top' | 'bottom';
}
export type Component = 'visuals' | 'subject' | 'audio';
export interface ComponentAssessment {
  component: Component;
  assessment: 'supported_alteration' | 'no_supported_alteration' | 'unknown' | 'not_applicable';
  summary: string;
  decision?: 'likely_ai' | 'indicators_found' | 'no_indicators' | 'unresolved' | 'not_applicable';
  evidenceIds: string[];
}
export interface InvestigationEvidence {
  id: string;
  component: Component;
  tell?: DisplayMoment;
  summary: string;
  tool: string;
  observationId: string;
  /** Review-only source context. Never implies human verification or authenticity. */
  grounding?: {
    mediaSha256: string;
    scope: 'visible-region' | 'source-timed' | 'whole-clip';
    reviewability?: 'supported-observation' | 'context-only';
    quote: string;
    url: string;
    sourceArtifactSha256: string;
    frameArtifactSha256: string;
    times: number[];
    observation: string;
    limitations: string[];
  };
}
export interface ToolRequest {
  name: string;
  args: { t0?: number; t1?: number; box?: Box; claim?: string };
}
export interface ToolObservation {
  id: string;
  tool: string;
  status: 'ok' | 'unavailable' | 'error';
  data: unknown;
  limitations: string[];
}
export interface TraceEntry {
  step: number;
  request: ToolRequest;
  observation: ToolObservation;
  elapsedMs: number;
}
/** Public action log, not model chain-of-thought or raw tool output. */
export interface InvestigationSummary {
  version: 1;
  strategy: 'adaptive' | 'fixed';
  replay: boolean;
  plannerModel: string;
  outcome: 'complete' | 'partial';
  steps: {
    id: string;
    kind: 'plan' | 'tool' | 'replan' | 'verdict';
    tool?: string;
    why: string;
    result: string;
    status: 'ok' | 'unavailable' | 'skipped';
    models: string[];
    elapsedMs: number;
    observationIds: string[];
    evidenceIds: string[];
  }[];
  /** recorded:false means historical totals are unavailable; hide numeric placeholders. */
  budget: { maxHostedAttempts: number; hostedAttempts: number; recorded?: boolean };
}
export interface OverallVerdict {
  label: 'likely_ai' | 'likely_real';
  drivers: string[];
  confidence?: number;
  calibration?: { version: string; scope: 'feed-domain' };
}
export interface AnalysisResult {
  version: 1;
  clipId: string;
  mediaSha256: string;
  mode: 'prepared' | 'fresh' | 'fixture';
  components: ComponentAssessment[];
  evidence: InvestigationEvidence[];
  limitations: string[];
  trace: TraceEntry[];
  elapsedMs: number;
  /** Factual inspection coverage; never evidence of authenticity or a clean bill. */
  inspection?: InspectionReport;
  verdict?: OverallVerdict;
  investigation?: InvestigationSummary;
}
export interface InspectionReport {
  version: 1;
  components: { component: Component; checked: string[]; observed: string[]; missing: string[]; momentIds: string[] }[];
  signals: { id: string; kind: 'metadata' | 'provenance' | 'source'; summary: string; observationIds: string[] }[];
  moments: { id: string; component: Component; kind: 'coverage'; t0: number; t1: number; focusT: number; summary: string; observationIds: string[] }[];
}
export type Analyzer = (input: AnalysisInput, context: AnalysisContext) => Promise<AnalysisResult>;
export function isBoundResult(value: unknown, clipId: string, sha256: string): value is AnalysisResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as AnalysisResult;
  return r.version === 1 && r.clipId === clipId && r.mediaSha256 === sha256
    && ['prepared','fresh','fixture'].includes(r.mode)
    && Array.isArray(r.components) && r.components.every(x => x && typeof x === 'object' && !Array.isArray(x))
    && Array.isArray(r.evidence) && r.evidence.every(x => x && typeof x === 'object' && !Array.isArray(x))
    && Array.isArray(r.limitations) && r.limitations.every(x => typeof x === 'string')
    && Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0;
}
/** Explicit public verdict allowlist. Extra analyzer fields are never spread into output.
 * Invalid label/drivers omit the verdict; invalid confidence/calibration omit only those
 * optional fields. This boundary validates the envelope, not empirical calibration quality.
 * Driver strings are already-public operator prose, never raw scorer explanations.
 */
export function publicVerdict(value: unknown): OverallVerdict | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (!['likely_ai','likely_real'].includes(v.label as string) || !Array.isArray(v.drivers) ||
      v.drivers.length < 1 || v.drivers.length > 8 || !v.drivers.every(d => typeof d === 'string' &&
        d.trim().length > 0 && d.length <= 240 && !/[\u0000-\u001f\u007f]/.test(d))) return undefined;
  const verdict: OverallVerdict = { label: v.label as OverallVerdict['label'], drivers: v.drivers.map(d => (d as string).trim()) };
  const c = v.calibration && typeof v.calibration === 'object' && !Array.isArray(v.calibration)
    ? v.calibration as Record<string, unknown> : {};
  if (typeof v.confidence === 'number' && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1 &&
      c.scope === 'feed-domain' && typeof c.version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(c.version)) {
    verdict.confidence = v.confidence;
    verdict.calibration = { version: c.version, scope: 'feed-domain' };
  }
  return verdict;
}
/** Closed, bounded action log. Reject unsafe prose and never spread analyzer objects. */
export function publicInvestigation(value: unknown): InvestigationSummary | undefined {
  const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 240 &&
    !/[\u0000-\u001f\u007f]|nvapi-|Bearer\s|(?:https?|file|data):|(?:\/home\/|\/private\/|\/tmp\/|[A-Z]:\\)/i.test(v);
  const id = (v: unknown) => typeof v === 'string' && /^[a-z][a-z0-9_.:-]{0,79}$/i.test(v);
  const ids = (v: unknown) => Array.isArray(v) && v.length <= 24 && v.every(id);
  const models = new Set(['nvidia/nemotron-3.5-bolt-e4b','nvidia/nemotron-3.5-super-vl-120b-a12b',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning','nvidia/Cosmos-Reason2-8B']);
  const tools = new Set(['probe_media','sample_frames','detect_shots','inspect_region','inspect_visuals','ground_tells',
    'inspect_audio','audio_window','validate_provenance','synthetic_video_detector','source_evidence']);
  const v = object(value), budget = object(v?.budget);
  if (!v || v.version !== 1 || !['adaptive','fixed'].includes(v.strategy as string) || typeof v.replay !== 'boolean' ||
      v.plannerModel !== 'nvidia/nemotron-3.5-bolt-e4b' || !['complete','partial'].includes(v.outcome as string) ||
      !Array.isArray(v.steps) || v.steps.length < 1 || v.steps.length > 24 || !budget ||
      (budget.recorded !== undefined && typeof budget.recorded !== 'boolean') ||
      !Number.isInteger(budget.maxHostedAttempts) || (budget.maxHostedAttempts as number) < 0 || (budget.maxHostedAttempts as number) > 40 ||
      !Number.isInteger(budget.hostedAttempts) || (budget.hostedAttempts as number) < 0 || (budget.hostedAttempts as number) > (budget.maxHostedAttempts as number)) return undefined;
  const steps: InvestigationSummary['steps'] = [], seen = new Set<string>();
  for (const raw of v.steps) {
    const step = object(raw);
    if (!step || !id(step.id) || seen.has(step.id as string) || !['plan','tool','replan','verdict'].includes(step.kind as string) ||
        !text(step.why) || !text(step.result) || !['ok','unavailable','skipped'].includes(step.status as string) ||
        !Array.isArray(step.models) || step.models.length > 3 || !step.models.every(m => typeof m === 'string' && models.has(m)) ||
        typeof step.elapsedMs !== 'number' || !Number.isFinite(step.elapsedMs) || step.elapsedMs < 0 || step.elapsedMs > 600000 ||
        !ids(step.observationIds) || !ids(step.evidenceIds) || (step.tool !== undefined && !tools.has(step.tool as string))) return undefined;
    seen.add(step.id as string);
    steps.push({id:step.id as string,kind:step.kind as InvestigationSummary['steps'][number]['kind'],
      ...(step.tool === undefined ? {} : {tool:step.tool as string}),why:(step.why as string).trim(),result:(step.result as string).trim(),
      status:step.status as InvestigationSummary['steps'][number]['status'],models:[...step.models] as string[],elapsedMs:step.elapsedMs,
      observationIds:[...step.observationIds as string[]],evidenceIds:[...step.evidenceIds as string[]]});
  }
  return {version:1,strategy:v.strategy as InvestigationSummary['strategy'],replay:v.replay,plannerModel:v.plannerModel,
    outcome:v.outcome as InvestigationSummary['outcome'],steps,
    budget:{maxHostedAttempts:budget.maxHostedAttempts as number,hostedAttempts:budget.hostedAttempts as number,...(typeof budget.recorded==='boolean'?{recorded:budget.recorded}:{})}};
}
/** Analyzer authors own public prose and inspection. Private trace never crosses HTTP. */
export function publicResult(r: AnalysisResult) {
  const verdict = publicVerdict(r.verdict);
  const investigation = publicInvestigation(r.investigation);
  const stripTrace = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripTrace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'trace').map(([key, v]) => [key, stripTrace(v)]));
    return value;
  };
  return stripTrace({ version: r.version, clipId: r.clipId, mediaSha256: r.mediaSha256,
    mode: r.mode, components: r.components, evidence: r.evidence, limitations: r.limitations,
    elapsedMs: r.elapsedMs, ...(r.inspection ? { inspection: r.inspection } : {}), ...(verdict ? { verdict } : {}), ...(investigation ? { investigation } : {}) });
}
