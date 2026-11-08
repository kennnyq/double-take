import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentAssessment, InvestigationResult, OverallVerdict } from '../investigation/contract';
import { ownLayer } from '../feed/layer';
import { themed, usePalette } from '../ui/theme';
import { useEased, usePresence } from './motion';

/*
 * Presentational pieces of the Create modal. They animate only opacity and
 * transforms; everything that comes or goes fades (and slides a little)
 * instead of mounting or unmounting abruptly.
 */

/** One of several things that share a slot (a header title, a header action): cross-fades with the others. */
export function Swap({ on, children, style }: { on: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = useEased(on ? 1 : 0, 220);
  const a = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.96 + p.value * 0.04 }] }));
  return (
    <Animated.View aria-hidden={!on} pointerEvents={on ? 'box-none' : 'none'} style={[{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }, style, ownLayer, a]}>
      {children}
    </Animated.View>
  );
}

/**
 * A step of the flow, stacked with the others. `pos` eases between step
 * indexes; a step is fully shown at its own index and slides out sideways
 * (forward to the left, back to the right) as `pos` moves past it.
 */
export function StepLayer({ index, pos, current, slide = 36, children }: { index: number; pos: SharedValue<number>; current: number; slide?: number; children: ReactNode }) {
  const a = useAnimatedStyle(() => {
    const d = index - pos.value;
    return { opacity: Math.max(0, Math.min(1, 1 - Math.abs(d) * 1.4)), transform: [{ translateX: d * slide }] };
  });
  return (
    <Animated.View aria-hidden={current !== index} pointerEvents={current === index ? 'box-none' : 'none'} style={[{ position: 'absolute', inset: 0 }, ownLayer, a]}>
      {children}
    </Animated.View>
  );
}

/** Fades and lifts its content in while `on`; keeps the last content while it fades out. */
export function Reveal({ on, children, style }: { on: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [mounted, p] = usePresence(on, 240);
  const [last, setLast] = useState<ReactNode>(children);
  if (on && last !== children) setLast(children);
  const a = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 12 }] }));
  if (!mounted) return null;
  return (
    <Animated.View pointerEvents={on ? 'box-none' : 'none'} style={[style, ownLayer, a]}>
      {on ? children : last}
    </Animated.View>
  );
}

export function IconButton({ icon, label, onPress, size = 26, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; size?: number; color?: string }) {
  const c = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={icon} size={size} color={color ?? c.text} />
    </Pressable>
  );
}

/** A header text action ("Next", "Check", "Done"), like a composer's. */
export function HeaderAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const s = useTint();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => ({ paddingHorizontal: 18, paddingVertical: 10, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={s.action}>{label}</Text>
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, wide }: { label: string; onPress: () => void; kind?: 'primary' | 'quiet'; disabled?: boolean; wide?: boolean }) {
  const s = useTint();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [kind === 'primary' ? s.primary : s.quiet, wide && s.wide, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
      <Text style={kind === 'primary' ? s.primaryText : s.quietText}>{label}</Text>
    </Pressable>
  );
}

/** What failed, in the server's or the client's own words, with what to do next right under it. */
export function ErrorNote({ text, actions }: { text: string; actions?: ReactNode }) {
  const c = usePalette();
  const s = useTint();
  return (
    <View accessibilityRole="alert" style={s.error}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Ionicons name="alert-circle" size={20} color={c.danger} style={{ marginTop: 1 }} />
        <Text style={[s.body, { flex: 1 }]}>{text}</Text>
      </View>
      {actions && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 30 }}>{actions}</View>}
    </View>
  );
}

const COMPONENT: Record<ComponentAssessment['component'], string> = { subject: 'Inserted subject', visuals: 'Visuals', audio: 'Audio' };
const VERDICT: Record<ComponentAssessment['assessment'], string> = {
  unknown: 'Not enough evidence',
  supported_alteration: 'Evidence of alteration',
  no_supported_alteration: 'No supported alteration found',
  not_applicable: 'Not applicable',
};

type Inspection = NonNullable<InvestigationResult['inspection']>;

/**
 * The fused call per part, announced by the pipeline as an optional
 * `component.decision` beside the older `assessment`. Read defensively until it
 * is in the contract; without it the row falls back to the assessment.
 */
type Decision = 'likely_ai' | 'indicators_found' | 'no_indicators' | 'unresolved' | 'not_applicable';
const DECISION: Record<Decision, string> = {
  likely_ai: 'Likely AI',
  indicators_found: 'Signs to look at',
  // Only about the frames that were inspected, never a claim that the clip is real.
  no_indicators: 'No anomalies seen',
  unresolved: 'Unresolved',
  not_applicable: 'Not applicable',
};
function decisionOf(part: ComponentAssessment): Decision | undefined {
  const d = (part as ComponentAssessment & { decision?: unknown }).decision;
  return typeof d === 'string' && d in DECISION ? (d as Decision) : undefined;
}

/**
 * The result's findings, one row per part of the clip: the decision, the
 * result's own summary, a quiet line on what was checked, and what would help
 * when the result says. What was checked is never a finding, so it stays a
 * muted note, never a moment to look at.
 */
export function Assessments({ components, fixture, inspection, title = 'What we can tell' }: { components: ComponentAssessment[]; fixture: boolean; inspection?: Inspection; title?: string }) {
  const s = useTint();
  const c = usePalette();
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.heading}>{title}</Text>
      {fixture && <Text style={s.muted}>Playback preview · no assessment</Text>}
      <View style={s.findings}>
        {[...components].sort((a, b) => rank(a) - rank(b)).map((part, i) => {
          const decision = decisionOf(part);
          const verdict = decision ? DECISION[decision] : VERDICT[part.assessment];
          const strong = decision === 'likely_ai' || decision === 'indicators_found';
          // The result's own words; without a decision, not when they only restate the old label.
          const summary = part.summary?.trim();
          const notes = inspection?.components.find((n) => n.component === part.component);
          const checked = notes ? [...notes.checked, ...notes.observed].join(' ') : '';
          const help = notes?.missing.join(' ') ?? '';
          return (
            <View key={part.component} style={[s.finding, i > 0 && s.findingRule]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Text style={s.label}>{COMPONENT[part.component]}</Text>
                {strong ? (
                  <View style={[s.decision, decision === 'likely_ai' ? { backgroundColor: c.ai } : s.decisionSoft]}>
                    {decision === 'likely_ai' && <Ionicons name="sparkles" size={12} color={c.onAi} />}
                    <Text style={[s.decisionText, { color: decision === 'likely_ai' ? c.onAi : c.text }]}>{verdict}</Text>
                  </View>
                ) : (
                  <Text style={[s.muted, { flexShrink: 1, textAlign: 'right' }]}>{verdict}</Text>
                )}
              </View>
              {!!summary && (decision || !summary.toLowerCase().startsWith(verdict.toLowerCase())) && <Text style={s.body}>{summary}</Text>}
              {!!checked && (
                <Text style={s.muted}>
                  <Text style={s.overline}>Checked · </Text>
                  {checked}
                </Text>
              )}
              {!!help && (
                <Text style={s.muted}>
                  <Text style={s.overline}>Would help · </Text>
                  {help}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Strongest calls first, so a likely-AI part leads the card. */
function rank(part: ComponentAssessment) {
  const d = decisionOf(part);
  return d === 'likely_ai' ? 0 : d === 'indicators_found' ? 1 : 2;
}

/**
 * The result's top line: the overall call, said plainly, with why in one or
 * two short lines. The per-part rows under it may still be unresolved; this
 * is the call the check makes. Confidence shows only when the result gives one.
 */
export function VerdictHeadline({ verdict }: { verdict: OverallVerdict }) {
  const s = useTint();
  const c = usePalette();
  const ai = verdict.label === 'likely_ai';
  const pct = verdict.confidence === undefined ? undefined : Math.round(verdict.confidence <= 1 ? verdict.confidence * 100 : verdict.confidence);
  const why = verdict.drivers.filter((d) => d.trim()).slice(0, 2);
  return (
    <View accessibilityRole="header" accessibilityLabel={`${ai ? 'Likely AI-generated' : 'Likely real'}${pct !== undefined ? `, ${pct}% confidence` : ''}`} style={s.headline}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[s.headlineIcon, ai ? { backgroundColor: c.ai } : s.headlineIconReal]}>
          <Ionicons name={ai ? 'sparkles' : 'checkmark-circle'} size={20} color={ai ? c.onAi : c.text} />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 }}>
          <Text style={s.headlineText}>{ai ? 'Likely AI-generated' : 'Likely real'}</Text>
          {pct !== undefined && <Text style={s.muted}>{pct}% confidence</Text>}
        </View>
      </View>
      {why.length > 0 && (
        <Text style={s.body}>
          <Text style={s.label}>Why: </Text>
          {why.map((d) => d.trim().replace(/([^.!?])$/, '$1.')).join(' ')}
        </Text>
      )}
    </View>
  );
}

/**
 * With "How we checked" in place of the per-part rows, what's still useful from
 * them: what would help settle each part, as a compact footer.
 */
export function WouldHelp({ inspection }: { inspection?: Inspection }) {
  const s = useTint();
  const items = (inspection?.components ?? []).filter((n) => n.missing.length > 0);
  if (!items.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.heading}>What would help</Text>
      <View style={[s.findings, { paddingVertical: 4 }]}>
        {items.map((n, i) => (
          <View key={n.component} style={[s.finding, { paddingVertical: 10, gap: 2 }, i > 0 && s.findingRule]}>
            <Text style={s.overline}>{COMPONENT[n.component]}</Text>
            <Text style={s.body}>{n.missing.join(' ')}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const SIGNAL_ICON: Record<Inspection['signals'][number]['kind'], keyof typeof Ionicons.glyphMap> = { metadata: 'document-text-outline', provenance: 'finger-print-outline', source: 'link-outline' };

/** What the check could tell about the file itself: its format, embedded credentials, where it came from. */
export function FileNotes({ signals }: { signals: Inspection['signals'] }) {
  const s = useTint();
  const c = usePalette();
  if (!signals.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.heading}>About the file</Text>
      <View style={s.findings}>
        {signals.map((sig, i) => (
          <View key={sig.id} style={[s.finding, i > 0 && s.findingRule, { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }]}>
            <Ionicons name={SIGNAL_ICON[sig.kind] ?? 'information-circle-outline'} size={18} color={c.textDim} style={{ marginTop: 1 }} />
            <Text style={[s.body, { flex: 1 }]}>{sig.summary}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export const useTint = themed((c) => ({
  surface: { backgroundColor: c.surface },
  title: { color: c.text, fontSize: 16, fontWeight: '600' },
  heading: { color: c.text, fontSize: 17, fontWeight: '600' },
  big: { color: c.text, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  body: { color: c.text, fontSize: 15, lineHeight: 21 },
  muted: { color: c.textDim, fontSize: 13, lineHeight: 18 },
  action: { color: c.link, fontSize: 15, fontWeight: '600' },
  primary: { backgroundColor: c.accent, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: c.onAccent, fontSize: 14, fontWeight: '600' },
  quiet: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  quietText: { color: c.text, fontSize: 14, fontWeight: '600' },
  error: { backgroundColor: c.surfaceRaised, borderRadius: 12, padding: 14, gap: 10 },
  findings: { backgroundColor: c.surfaceRaised, borderRadius: 12, paddingHorizontal: 14 },
  finding: { paddingVertical: 12, gap: 4 },
  findingRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.surface },
  label: { color: c.text, fontSize: 15, fontWeight: '600' },
  overline: { color: c.textDim, fontSize: 12, fontWeight: '600' },
  headline: { gap: 12, paddingBottom: 4 },
  headlineIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headlineIconReal: { backgroundColor: c.surfaceRaised },
  headlineText: { color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  decision: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 26, borderRadius: 13 },
  decisionSoft: { backgroundColor: c.surface },
  decisionText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  wide: { alignSelf: 'stretch', paddingVertical: 12 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceRaised, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  input: { flex: 1, color: c.text, fontSize: 15, height: 44 },
  rule: { flex: 1, height: 1, backgroundColor: c.surfaceRaised },
  hairline: { height: 1, backgroundColor: c.surfaceRaised },
  chip: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  linkIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  glow: { backgroundColor: c.surfaceRaised, borderRadius: 14 },
}));
