import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Link, router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { uploadId } from '../investigation/upload-id';
import { uuid } from '@/lib/uuid';
import { acceptUpload, sendOrRecover, uploadRoute, UploadGeneration } from '../investigation/upload-flow';
import { themed } from '../ui/theme';
import { Processing } from '../components/investigation/Processing';
import { EvidencePlayer } from '../components/investigation/EvidencePlayer';
import { deleteJob, getJob, listPrepared, mediaUrl, candidateMediaUrl, getCandidate, upload, type ClientJob } from '../investigation/client';
const labels = { supported_alteration: 'Evidence of alteration', no_supported_alteration: 'No supported alteration found', unknown: 'Not enough evidence', not_applicable: 'Not applicable' };
export default function Investigate() {
  const styles = useTint();
  const params = useLocalSearchParams<{ job?: string; pending?: string; prepared?: string; candidate?: string; fixture?: string }>();
  const { id, pendingId, prepared } = uploadRoute(params);
  const candidate = params.candidate === '1';
  const fixture = candidate && params.fixture === '1';
  const [examples, setExamples] = useState<{ id: string }[]>([]);
  useEffect(() => { if (!candidate) void listPrepared().then(setExamples).catch(() => {}); }, [candidate]);
  const [job, setJob] = useState<ClientJob>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempted = useRef(false);
  const generation = useRef(new UploadGeneration());
  useEffect(() => { const guard = generation.current; return () => { guard.next(); }; }, []);
  useEffect(() => {
    if (!pendingId || id || busy || attempted.current) return;
    attempted.current = true;
    let alive = true; const gen = generation.current.next();
    // Reload may happen after the PUT was stored but before its reply arrived.
    void getJob(pendingId).then(next => {
      if (alive && generation.current.isCurrent(gen)) {
        setJob(next); router.setParams({ job: next.id, pending: undefined, prepared: undefined });
      }
    }).catch(() => { if (alive && generation.current.isCurrent(gen)) setError('Upload interrupted. Choose the video again to continue.'); });
    return () => { alive = false; };
  }, [pendingId, id, busy]);
  useEffect(() => {
    if (!id || busy) return;
    let alive = true; const gen = generation.current.next();
    async function poll() {
      try { const next = await (candidate ? getCandidate(id!, fixture) : getJob(id!, prepared)); if (alive && generation.current.isCurrent(gen)) { setJob(next); setError(''); } }
      catch (e) { if (alive && generation.current.isCurrent(gen)) setError((e as Error).message); }
    }
    void poll(); const timer = candidate ? undefined : setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [id, busy, prepared, candidate, fixture]);
  async function choose() {
    const gen = generation.current.next(); attempted.current = true;
    setBusy(true); setError('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/quicktime'], copyToCacheDirectory: true, base64: false });
      if (picked.canceled || !generation.current.isCurrent(gen)) return;
      // A picker selection is a new intent, even if an older GET has not returned.
      const key = uploadId(uuid, bytes => Crypto.getRandomValues(bytes));
      router.setParams({ pending: key, job: undefined, prepared: undefined }); setJob(undefined);
      await acceptUpload(key, () => sendOrRecover(() => upload(key, picked.assets[0]), () => getJob(key)), next => {
        if (!generation.current.isCurrent(gen)) return;
        setJob(next); router.setParams({ job: key, pending: undefined, prepared: undefined });
      });
    } catch (e) { if (generation.current.isCurrent(gen)) setError((e as Error).message); }
    finally { if (generation.current.isCurrent(gen)) setBusy(false); }
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    {!candidate && <><Link href="/" style={styles.link}>← Back</Link>
    {!!process.env.EXPO_PUBLIC_DESIGN_SAMPLE && <Link href={{ pathname: '/investigate', params: { job: process.env.EXPO_PUBLIC_DESIGN_SAMPLE, prepared: '' } }} style={styles.link}>Try a sample</Link>}
    {examples.map((example, i) => <Link key={example.id} href={{ pathname: '/investigate', params: { job: example.id, prepared: '1' } }} style={styles.link}>Watch example {i + 1}</Link>)}
    <Pressable accessibilityRole="button" disabled={busy} onPress={choose} style={styles.button}><Text style={styles.buttonText}>Choose video</Text></Pressable>
    <Text style={styles.muted}>MP4 or MOV · 60 seconds · 100 MB{ '\n' }Private link · removed after 24 hours</Text></>}
    {(busy || (job?.id === id && (job?.state === 'queued' || job?.state === 'running'))) && <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(220)}><Processing uploading={busy} /></Animated.View>}
    {!!error && <Animated.Text key={error} entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} accessibilityRole="alert" style={styles.text}>{error}</Animated.Text>}
    {job && job.id === id && <Animated.View key={job.id} entering={FadeIn.duration(260)} exiting={FadeOut.duration(180)} style={{ gap: 22 }}>
      {job.state === 'error' && <Animated.Text key={job.state} entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={styles.text}>{job.error}</Animated.Text>}
      {job.state === 'complete' && job.result && <Animated.View entering={FadeIn.duration(260)} style={{ gap: 22 }}>
        {(fixture || job.result.mode === 'fixture') && <Text style={styles.muted}>{fixture ? 'Synthetic playback fixture · no assessment' : 'Preview · no assessment'}</Text>}
        <EvidencePlayer uri={candidate ? candidateMediaUrl(job.id, fixture) : mediaUrl(job.id, prepared)} width={job.width} height={job.height} duration={job.duration} preview={!candidate && job.result.mode === 'fixture'} evidence={job.result.evidence} />
        <View style={styles.components}>{job.result.components.map(c => <View key={c.component} style={styles.component}>
          <Text style={styles.muted}>{c.component === 'subject' ? 'Subject' : c.component === 'visuals' ? 'Visuals' : 'Audio'}</Text>
          <Text style={styles.text}>{labels[c.assessment]}</Text>
        </View>)}</View>
      </Animated.View>}
      {!candidate && !prepared && job.state !== 'running' && <Pressable accessibilityRole="button" onPress={async () => { try { await deleteJob(job.id); setJob(undefined); router.setParams({ job: '' }); } catch (e) { setError((e as Error).message); } }}><Text style={styles.link}>Delete upload</Text></Pressable>}
    </Animated.View>}
  </ScrollView>;
}
const useTint = themed(c => ({ page: { flex: 1, backgroundColor: c.bg }, content: { padding: 24, paddingTop: 64, paddingBottom: 80, gap: 22, maxWidth: 720, width: '100%', alignSelf: 'center' }, text: { color: c.text, fontSize: 16, lineHeight: 24 }, muted: { color: c.textDim, fontSize: 14, lineHeight: 22 }, link: { color: c.text, paddingVertical: 12, fontSize: 16 }, button: { backgroundColor: c.accent, padding: 20, borderRadius: 32, alignItems: 'center' }, buttonText: { color: c.onAccent, fontSize: 18, fontWeight: '600' }, components: { gap: 12 }, component: { padding: 16, borderRadius: 16, backgroundColor: c.surface, gap: 6 } }));
