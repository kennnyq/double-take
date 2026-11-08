import type { Box, Tell } from '../annotations/format.ts';
export type Component = 'visuals' | 'subject' | 'audio';
export interface ComponentAssessment {
  component: Component;
  assessment: 'supported_alteration' | 'no_supported_alteration' | 'unknown' | 'not_applicable';
  /** Probabilistic decision; no_indicators describes the checks, never camera origin. */
  decision?: 'likely_ai' | 'indicators_found' | 'no_indicators' | 'unresolved' | 'not_applicable';
  summary: string;
  evidenceIds: string[];
}
export interface InvestigationEvidence {
  id: string;
  component: Component;
  tell?: Tell;
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
export interface InvestigationInput {
  clipId: string;
  mediaPath: string;
  outputDir: string;
  track: 'signals-only' | 'evidence-assisted';
  sourceEvidence?: { text: string; url?: string; claim?: { component: Component; origin: 'generated' | 'camera'; basis: 'creator-disclosure' | 'documented-source'; quote: string } }[];
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
  budget: { maxHostedAttempts: number; hostedAttempts: number };
}
export interface OverallVerdict {
  label: 'likely_ai' | 'likely_real';
  /** Selected-label probability; absent when no matching empirical calibration is published. */
  confidence?: number;
  drivers: string[];
  calibration?: { version: string; scope: string };
}
export interface InvestigationResult {
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
  fusion?: { version: 1; selectedBy: 'nemotron' | 'rule_fallback'; signals: FusionSignal[] };
}
export interface FusionSignal {
  id: string;
  component: Component;
  kind: 'grounded-tell' | 'detector' | 'provenance' | 'source';
  polarity: 'positive' | 'negative';
  observationIds: string[];
  evidenceIds: string[];
  summary: string;
}
export interface InspectionReport {
  version: 1;
  components: { component: Component; checked: string[]; observed: string[]; missing: string[]; momentIds: string[] }[];
  signals: { id: string; kind: 'metadata' | 'provenance' | 'source'; summary: string; observationIds: string[] }[];
  moments: { id: string; component: Component; kind: 'coverage'; t0: number; t1: number; focusT: number; summary: string; observationIds: string[] }[];
}
export type ToolRunner = (request: ToolRequest, input: InvestigationInput) => Promise<ToolObservation>;
