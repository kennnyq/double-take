import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import Animated, { cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { InvestigationResult, InvestigationSummary, OverallVerdict } from '../investigation/contract';
import { ownLayer } from '../feed/layer';
import { useDevSettings } from '../devtools/store';
import { themed, usePalette } from '../ui/theme';
import { clockTime } from '../components/investigation/EvidencePlayer';
import { EASE_OUT, useEased } from './motion';
import './devSection';

/*
 * "How we checked": the check's own run (`result.investigation`), step by
 * step: planning, calling tools, changing the plan, making the call. When a
 * result has it, this is the body under the verdict, open from the start.
 * Steps link to the moments and evidence cards they produced. Model names
 * show only with Dev settings → Model → "Show models in How we checked".
 */

type Step = InvestigationSummary['steps'][number];
type Kind = Step['kind'];

/** Where a step's findings are in the clip: an evidence card (spotlight) or a moment the check looked at. */
export interface StepLink {
  key: string;
  t0: number;
  t1?: number;
  /** Set for an evidence card: open its card and spotlight instead of just scrubbing. */
  evidenceId?: string;
}

/** Each step's links: its evidence (by id or observation) with tells, and the inspected moments it observed. */
export function stepLinks(result: InvestigationResult | undefined): Map<string, StepLink[]> {
  const links = new Map<string, StepLink[]>();
  for (const step of result?.investigation?.steps ?? []) {
    const out: StepLink[] = [];
    const seen = new Set<string>();
    const add = (l: StepLink) => {
      const k = `${l.evidenceId ?? ''}@${l.t0.toFixed(1)}`;
      if (!seen.has(k) && out.length < 4) {
        seen.add(k);
        out.push(l);
      }
    };
    for (const e of result?.evidence ?? []) {
      if (!e.tell || !(step.evidenceIds.includes(e.id) || step.observationIds.includes(e.observationId))) continue;
      add({ key: `e:${e.id}`, t0: e.tell.t0, t1: e.tell.t1, evidenceId: e.id });
    }
    for (const m of result?.inspection?.moments ?? []) {
      if (!m.observationIds.some((o) => step.observationIds.includes(o))) continue;
      add({ key: `m:${m.id}`, t0: m.t1 - m.t0 > 2 ? m.t0 : m.focusT, t1: m.t1 - m.t0 > 2 ? m.t1 : undefined });
    }
    if (out.length) links.set(step.id, out);
  }
  return links;
}

const TOOL: Record<string, { title: string; icon: keyof typeof Ionicons.glyphMap }> = {
  probe_media: { title: 'Read the file details', icon: 'document-text-outline' },
  sample_frames: { title: 'Sampled frames across the clip', icon: 'film-outline' },
  detect_shots: { title: 'Found the cuts between shots', icon: 'cut-outline' },
  inspect_region: { title: 'Looked closely at one area', icon: 'scan-outline' },
  inspect_visuals: { title: 'Looked closely at the frames', icon: 'eye-outline' },
  ground_tells: { title: 'Pinned down visual tells', icon: 'locate-outline' },
  inspect_audio: { title: 'Listened to the audio', icon: 'ear-outline' },
  audio_window: { title: 'Listened to part of the audio', icon: 'ear-outline' },
  validate_provenance: { title: 'Checked for Content Credentials', icon: 'finger-print-outline' },
  synthetic_video_detector: { title: 'Ran a whole-video check', icon: 'pulse-outline' },
  source_evidence: { title: 'Looked for the original post', icon: 'link-outline' },
};
const KIND: Record<Kind, { title: string; icon: keyof typeof Ionicons.glyphMap }> = {
  plan: { title: 'Planned the check', icon: 'map-outline' },
  tool: { title: 'Ran a check', icon: 'search-outline' },
  replan: { title: 'Changed the plan', icon: 'git-branch-outline' },
  verdict: { title: 'Made the call', icon: 'flag-outline' },
};
const look = (s: Step) => (s.kind === 'tool' && s.tool && TOOL[s.tool]) || KIND[s.kind];

/** Model ids as people say them: nvidia/nemotron-3.5-bolt-e4b → Nemotron 3.5 Bolt. */
export function modelName(id: string) {
  const known: Record<string, string> = {
    'nvidia/nemotron-3.5-bolt-e4b': 'Nemotron 3.5 Bolt',
    'nvidia/nemotron-3.5-super-vl-120b-a12b': 'Nemotron 3.5 Super VL',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 'Nemotron 3 Nano Omni',
    'nvidia/Cosmos-Reason2-8B': 'Cosmos Reason 2',
  };
  return known[id] ?? id.replace(/^[^/]+\//, '');
}

const seconds = (ms: number) => (ms < 100 ? '<0.1 s' : `${(ms / 1000).toFixed(1)} s`);

/**
 * One timeline row. An adaptive check plans one step at a time: a `plan`
 * step names the tool it picked and the `tool` step right after runs it, so
 * the two show as one row, the check with the decision that led to it.
 * A plan without its tool, a change of plan and the verdict keep rows of their own.
 */
interface Row {
  step: Step;
  /** The planner's decision that picked this tool. */
  decision?: Step;
}
export function rowsOf(steps: readonly Step[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const next = steps[i + 1];
    if (step.kind === 'plan' && step.tool && next?.kind === 'tool' && next.tool === step.tool) {
      rows.push({ step: next, decision: step });
      i++;
    } else rows.push({ step });
  }
  return rows;
}

/** "5 checks · 11.0 s" */
function summaryOf(steps: readonly Step[], rows: Row[]) {
  const tools = rows.filter((r) => r.step.kind === 'tool').length;
  const ms = steps.reduce((sum, s) => sum + s.elapsedMs, 0);
  return [`${tools} ${tools === 1 ? 'check' : 'checks'}`, ms > 0 ? seconds(ms) : null].filter(Boolean).join(' · ');
}

/**
 * The timeline, open in the result under the verdict. When it first shows,
 * its rail draws down and the steps arrive one after another. Plans and
 * changes of plan stand out, each check carries a status pip (green when it
 * ran, warm when it couldn't), and the verdict's node takes the call's color.
 */
export function HowWeChecked({ trace, links, verdict, onLink }: { trace: InvestigationSummary; links: Map<string, StepLink[]>; verdict?: OverallVerdict; onLink: (link: StepLink) => void }) {
  const s = useTint();
  const c = usePalette();
  const { showModels } = useDevSettings();
  const rows = useMemo(() => rowsOf(trace.steps), [trace]);
  // Starts once the result has faded in, so the steps arrive where the eye already is.
  const open = useSharedValue(0);
  useEffect(() => {
    open.value = withDelay(380, withTiming(1, { duration: 900, easing: EASE_OUT }));
  }, [open]);
  const rail = useAnimatedStyle(() => ({ transform: [{ scaleY: interpolate(open.value, [0, 0.9], [0, 1], 'clamp') }] }));
  const notes = [trace.replay ? 'Replay of a prepared check' : null, trace.outcome === 'partial' ? 'Some checks didn’t finish' : null].filter(Boolean);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={s.heading}>How we checked</Text>
        <Text style={s.muted}>{summaryOf(trace.steps, rows)}</Text>
        {showModels && <Text style={s.meta}>Planned by {modelName(trace.plannerModel)}</Text>}
      </View>
      {notes.length > 0 && (
        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={14} color={c.textDim} />
          <Text style={s.muted}>{notes.join(' · ')}</Text>
        </View>
      )}
      <View>
        <Animated.View pointerEvents="none" style={[s.rail, ownLayer, rail]} />
        {rows.map(({ step, decision }, i) => (
          <StepRow key={step.id} step={step} decision={decision} index={i} count={rows.length} open={open} links={links.get(step.id)} onLink={onLink} verdict={verdict} showModels={showModels} />
        ))}
      </View>
    </View>
  );
}

function StepRow(props: { step: Step; decision?: Step; index: number; count: number; open: SharedValue<number>; links?: StepLink[]; onLink: (l: StepLink) => void; verdict?: OverallVerdict; showModels: boolean }) {
  const { step, decision, index, count, open, links, onLink, verdict, showModels } = props;
  const s = useTint();
  const c = usePalette();
  // One shared progress, staggered by position: the steps arrive in order.
  const enter = useAnimatedStyle(() => {
    const start = (index / Math.max(1, count)) * 0.62;
    const p = interpolate(open.value, [start, start + 0.3], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateY: (1 - p) * 10 }] };
  });
  const { title, icon } = look(step);
  const replan = step.kind === 'replan';
  const plan = step.kind === 'plan';
  const isVerdict = step.kind === 'verdict';
  const off = step.status !== 'ok';
  const call = isVerdict && verdict ? (verdict.label === 'likely_ai' ? c.danger : c.correct) : undefined;
  const models = [...(decision?.models ?? []), ...step.models].filter((m, i, all) => all.indexOf(m) === i);
  return (
    <Animated.View style={[s.step, ownLayer, enter]}>
      <View style={[s.node, plan ? { backgroundColor: c.accent } : isVerdict ? [s.nodeVerdict, call ? { borderColor: call } : null] : replan ? null : s.nodeTool]}>
        {replan && <View style={s.diamond} />}
        <Ionicons name={icon} size={14} color={plan || replan ? c.onAccent : call ?? (off ? c.textDim : c.text)} />
        {step.kind === 'tool' && <View style={[s.pip, { backgroundColor: off ? c.danger : c.correct }]} />}
      </View>
      <View style={[s.body, plan && s.bodyPlan, replan && s.bodyReplan]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          {(plan || replan) && <Text style={[s.tag, replan && s.tagReplan]}>{plan ? 'Plan' : 'New plan'}</Text>}
          {off && <Text style={[s.tagOff, { color: c.danger, borderColor: c.danger }]}>{step.status === 'skipped' ? 'Skipped' : 'Unavailable'}</Text>}
          <Text style={[s.title, { flex: 1 }, off && { color: c.textDim }]}>{title}</Text>
          {step.elapsedMs > 0 && <Text style={s.time}>{seconds(step.elapsedMs)}</Text>}
        </View>
        {decision && (
          <View style={s.decision}>
            <View style={s.decisionMark} />
            <Text style={s.decisionText}>Picked next by the planner{decision.elapsedMs > 0 ? ` · ${seconds(decision.elapsedMs)}` : ''}</Text>
          </View>
        )}
        <Text style={s.muted}>{step.why}</Text>
        <Text style={[s.result, off && { color: c.textDim }]}>
          <Text style={{ color: c.textDim }}>→ </Text>
          {step.result}
        </Text>
        {!!links?.length && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {links.map((l) => {
              const span = l.t1 !== undefined && l.t1 - l.t0 > 0.5 ? `${clockTime(l.t0)}–${clockTime(l.t1)}` : clockTime(l.t0);
              return (
                <Pressable key={l.key} accessibilityRole="button" accessibilityLabel={l.evidenceId ? `Show what it found at ${span}` : `Show ${span} in the video`} onPress={() => onLink(l)} hitSlop={6} style={({ pressed }) => [s.chip, l.evidenceId && s.chipEvidence, { opacity: pressed ? 0.7 : 1 }]}>
                  <Ionicons name={l.evidenceId ? 'eye-outline' : 'play'} size={11} color={c.text} />
                  <Text style={s.chipText}>{span}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {showModels && models.length > 0 && <Text style={s.meta}>{models.map(modelName).join(' · ')}</Text>}
      </View>
    </Animated.View>
  );
}

/**
 * The check as it runs: its steps arrive one by one in the card, each first
 * working (a soft pulse on its node), then its result fades in, until the
 * verdict lands. `done` rows are finished; `working` adds the step in hand.
 * For a live check that's the tool the planner just picked, if the last step
 * named one, or else a plain "Checking…". It scrolls itself to the newest step.
 */
export function LiveTrace({ steps, done = Infinity, working, replay, width, maxHeight }: { steps: readonly Step[]; done?: number; working: boolean; replay?: boolean; width: number; maxHeight: number }) {
  const s = useTint();
  const c = usePalette();
  const scroll = useRef<ScrollViewInstance>(null);
  const all = useMemo(() => rowsOf(steps), [steps]);
  const shown = all.slice(0, Math.min(done, all.length));
  // A live check: the planner's latest pick, still running, is the step in hand.
  const last = steps[steps.length - 1];
  const pending: Row | undefined =
    done < all.length ? all[done] : last?.kind === 'plan' && last.tool && shown[shown.length - 1]?.step === last ? { step: { ...last, kind: 'tool' }, decision: last } : undefined;
  const rows = pending && shown[shown.length - 1]?.step === last ? shown.slice(0, -1) : shown;
  const finished = steps.filter((st) => rows.some((r) => r.step === st || r.decision === st));
  return (
    <View style={{ width, maxHeight, gap: 8 }}>
      <View style={{ gap: 2 }}>
        <Text style={s.heading}>{working ? 'Checking…' : 'How we checked'}</Text>
        <Text style={s.muted}>{rows.length ? summaryOf(finished, rows) : replay ? 'Replay of a prepared check' : 'Starting the check'}</Text>
      </View>
      <ScrollView ref={scroll} style={{ flexGrow: 0 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} showsVerticalScrollIndicator={false}>
        <View>
          <View pointerEvents="none" style={s.rail} />
          {rows.map((r) => (
            <LiveRow key={r.step.id} row={r} />
          ))}
          {working && <LiveRow key={pending ? `${pending.step.id}:working` : 'working'} row={pending} working />}
        </View>
      </ScrollView>
      {replay && rows.length > 0 && (
        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={14} color={c.textDim} />
          <Text style={s.muted}>Replay of a prepared check</Text>
        </View>
      )}
    </View>
  );
}

function LiveRow({ row, working = false }: { row?: Row; working?: boolean }) {
  const s = useTint();
  const c = usePalette();
  const enter = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: 320, easing: EASE_OUT });
  }, [enter]);
  useEffect(() => {
    if (!working) return;
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [working, pulse]);
  const resultIn = useEased(working ? 0 : 1, 360);
  const rise = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 10 }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.35 + pulse.value * 0.65, transform: [{ scale: 1 + pulse.value * 0.25 }] }));
  const result = useAnimatedStyle(() => ({ opacity: resultIn.value }));
  const step = row?.step;
  const { title, icon } = step ? look(step) : { title: 'Checking', icon: 'search-outline' as const };
  const plan = step?.kind === 'plan';
  const replan = step?.kind === 'replan';
  const off = !!step && step.status !== 'ok' && !working;
  return (
    <Animated.View style={[s.step, ownLayer, rise]}>
      <View style={[s.node, plan ? { backgroundColor: c.accent } : step?.kind === 'verdict' ? s.nodeVerdict : replan ? null : s.nodeTool]}>
        {replan && <View style={s.diamond} />}
        <Ionicons name={icon} size={14} color={plan || replan ? c.onAccent : off ? c.textDim : c.text} />
        {working ? (
          <Animated.View style={[s.pip, { backgroundColor: c.accent }, ownLayer, glow]} />
        ) : (
          step?.kind === 'tool' && <View style={[s.pip, { backgroundColor: off ? c.danger : c.correct }]} />
        )}
      </View>
      <View style={[s.body, plan && s.bodyPlan, replan && s.bodyReplan]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          {(plan || replan) && <Text style={[s.tag, replan && s.tagReplan]}>{plan ? 'Plan' : 'New plan'}</Text>}
          {off && <Text style={[s.tagOff, { color: c.danger, borderColor: c.danger }]}>{step?.status === 'skipped' ? 'Skipped' : 'Unavailable'}</Text>}
          <Text style={[s.title, { flex: 1 }, off && { color: c.textDim }]}>{working ? `${title}…` : title}</Text>
          {!working && step && step.elapsedMs > 0 && <Text style={s.time}>{seconds(step.elapsedMs)}</Text>}
        </View>
        {row?.decision && (
          <View style={s.decision}>
            <View style={s.decisionMark} />
            <Text style={s.decisionText}>Picked next by the planner</Text>
          </View>
        )}
        {step && !working && (
          <Animated.Text style={[s.result, off && { color: c.textDim }, ownLayer, result]}>
            <Text style={{ color: c.textDim }}>→ </Text>
            {step.result}
          </Animated.Text>
        )}
      </View>
    </Animated.View>
  );
}

const NODE = 28;
const useTint = themed((c) => ({
  heading: { color: c.text, fontSize: 17, fontWeight: '600' },
  title: { color: c.text, fontSize: 15, fontWeight: '600' },
  muted: { color: c.textDim, fontSize: 13, lineHeight: 18 },
  meta: { color: c.textDim, fontSize: 11, lineHeight: 15, letterSpacing: 0.2 },
  result: { color: c.text, fontSize: 14, lineHeight: 20 },
  time: { color: c.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.surfaceRaised, alignSelf: 'flex-start' },
  tag: { color: c.onAccent, backgroundColor: c.accent, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  tagReplan: { color: c.text, backgroundColor: 'transparent', borderWidth: 1, borderColor: c.accent },
  tagOff: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  rail: { position: 'absolute', left: NODE / 2 - 1, top: NODE / 2, bottom: NODE / 2, width: 2, backgroundColor: c.accentSoft, transformOrigin: 'top' },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 5 },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  nodeTool: { backgroundColor: c.surfaceRaised },
  // A check's status: a small pip on its node.
  pip: { position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 4.5, borderWidth: 2, borderColor: c.surface },
  // A change of plan gets a diamond node: the turn in the path.
  diamond: { position: 'absolute', width: NODE - 6, height: NODE - 6, borderRadius: 6, backgroundColor: c.accent, transform: [{ rotate: '45deg' }] },
  nodeVerdict: { backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.text },
  // The planner's pick, at the top of the row it led to: an accent dot and a short line.
  decision: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  decisionMark: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.accent },
  decisionText: { color: c.text, fontSize: 12, fontWeight: '600' },
  body: { flex: 1, gap: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  bodyPlan: { backgroundColor: c.surfaceRaised },
  // A change of plan is the one step that isn't a straight line: an accent edge marks it.
  bodyReplan: { backgroundColor: c.surfaceRaised, borderLeftWidth: 3, borderLeftColor: c.accent, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.surfaceRaised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipEvidence: { backgroundColor: c.accentSoft },
  chipText: { color: c.text, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
}));
