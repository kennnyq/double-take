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
/** Analyzer authors own public prose and inspection. Private trace never crosses HTTP. */
export function publicResult(r: AnalysisResult) {
  const stripTrace = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripTrace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'trace').map(([key, v]) => [key, stripTrace(v)]));
    return value;
  };
  return stripTrace({ version: r.version, clipId: r.clipId, mediaSha256: r.mediaSha256,
    mode: r.mode, components: r.components, evidence: r.evidence, limitations: r.limitations,
    elapsedMs: r.elapsedMs, ...(r.inspection ? { inspection: r.inspection } : {}) });
}
