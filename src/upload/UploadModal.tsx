import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, FadeIn, FadeOut } from 'react-native-reanimated';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { uploadId } from '../investigation/upload-id';
import { acceptUpload, sendOrRecover, uploadRoute } from '../investigation/upload-flow';
import { uuid } from '../lib/uuid';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themed } from '../ui/theme';
import { EvidencePlayer } from '../components/investigation/EvidencePlayer';
import { Processing } from '../components/investigation/Processing';
import { getJob, mediaUrl, upload, uploadLink, type ClientJob } from '../investigation/client';
import { DropZone } from './DropZone';
import { ownLayer } from '../feed/layer';
export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTint(); const { width, height } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const desktop = width >= 760; const [visible, setVisible] = useState(open);
  const [job, setJob] = useState<ClientJob>(); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [link, setLink] = useState(''); const [confirm, setConfirm] = useState(false);
  const generation = useRef(0); const locked = useRef(false); const p = useSharedValue(0); const expansion = useSharedValue(0);
  const params = useLocalSearchParams<{ check?: string }>();
  const handle = uploadRoute({ pending: params.check }).pendingId;
  const retry = useRef<{ id: string; send: () => Promise<ClientJob> } | undefined>(undefined);
  const [canRetry, setCanRetry] = useState(false);
  const complete = job?.state === 'complete' && !!job.result;
  const running = busy || job?.state === 'queued' || job?.state === 'running';
  if (open && !visible) setVisible(true);
  useEffect(() => { p.value = withTiming(open ? 1 : 0, { duration: 240 }); const t = setTimeout(() => { if (!open) setVisible(false); }, 250); return () => clearTimeout(t); }, [open, p]);
  useEffect(() => { expansion.value = withTiming(complete ? 1 : 0, { duration: 360 }); }, [complete, expansion]);
  const shade = useAnimatedStyle(() => ({ opacity: p.value }));
  const surface = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scaleX: desktop ? (Math.min(width - 48, 560) + expansion.value * (Math.min(width - 48, 980) - Math.min(width - 48, 560))) / Math.min(width - 48, 980) : 1 }, { scaleY: 0.97 + p.value * 0.03 }] }));
  const content = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 22 }] }));
  function close() { if (running) setConfirm(true); else onClose(); }
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); if (running) setConfirm(true); else onClose(); } };
    const unload = (e: BeforeUnloadEvent) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', handler); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('beforeunload', unload); };
  }, [open, running, onClose]);
  useEffect(() => {
    if (!open || !handle || busy || job) return;
    let alive = true; const gen = generation.current;
    const recover = () => { void acceptUpload(handle, () => getJob(handle), j => {
      if (alive && gen === generation.current) { setJob(j); setError(''); }
    }).catch(() => {}); };
    recover(); const timer = setInterval(recover, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [open, handle, busy, job]);
  useEffect(() => {
    if (!open || !job || !['queued', 'running'].includes(job.state)) return;
    let alive = true; const gen = generation.current;
    const timer = setInterval(() => { void getJob(job.id).then(j => { if (alive && gen === generation.current) { setJob(j); setError(''); } }).catch(e => { if (alive && gen === generation.current) setError(e.message); }); }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [open, job]);
  async function perform(request: { id: string; send: () => Promise<ClientJob> }) {
    if (locked.current) return; locked.current = true;
    const gen = ++generation.current; setBusy(true); setJob(undefined); setError('');
    retry.current = request; setCanRetry(true); router.setParams({ check: request.id });
    try { await acceptUpload(request.id, () => sendOrRecover(request.send, () => getJob(request.id)), j => { if (gen === generation.current) setJob(j); }); }
    catch (e) { if (gen === generation.current) setError((e as Error).message); }
    finally { if (gen === generation.current) { setBusy(false); locked.current = false; } }
  }
  async function submit(asset?: DocumentPicker.DocumentPickerAsset) {
    if (locked.current) return;
    const id = uploadId(uuid, bytes => Crypto.getRandomValues(bytes)); const url = link;
    await perform({ id, send: () => asset ? upload(id, asset) : uploadLink(id, url) });
  }
  async function choose() { try { const picked = await DocumentPicker.getDocumentAsync({ type: ['video/mp4', 'video/quicktime'], copyToCacheDirectory: true, base64: false }); if (!picked.canceled) await submit(picked.assets[0]); } catch { setError('Could not open the picker. Try again.'); } }
  return <Modal transparent visible={visible} animationType="none" onRequestClose={close}>
    {visible && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: desktop ? 24 : insets.top, paddingBottom: desktop ? 24 : insets.bottom }}>
      <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: '#000b' }, ownLayer, shade]}><Pressable accessibilityLabel="Close upload" onPress={close} style={{ flex: 1 }} /></Animated.View>
      <View accessibilityViewIsModal style={{ width: desktop ? Math.min(width - 48, 980) : width, height: desktop ? Math.min(height - 48, 820) : '100%' }}>
        <Animated.View style={[s.surface, { position: 'absolute', inset: 0, borderRadius: desktop ? 20 : 0 }, ownLayer, surface]} />
        <Animated.View style={[{ flex: 1, width: '100%', alignSelf: 'center' }, ownLayer, content]}>
          <View style={[s.header, { width: desktop ? Math.min(width - 48, 560) : '100%', alignSelf: 'center' }] }><Pressable accessibilityRole="button" onPress={close}><Text style={s.text}>Close</Text></Pressable><Text style={s.title}>Check a video</Text><View style={{ width: 40 }} /></View>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 22 }}>
            {!job && !busy && <Animated.View entering={FadeIn.duration(240)} exiting={FadeOut.duration(200)} style={{ gap: 24, width: '100%', maxWidth: 512, alignSelf: 'center' }}><DropZone onFile={submit}><View style={{ alignItems: 'center', gap: 22, paddingVertical: 36 }}><Text style={[s.title, { fontSize: 30 }]}>＋</Text><Text style={s.title}>{desktop ? 'Drop a video here' : 'Choose a video'}</Text><Pressable accessibilityRole="button" onPress={choose} style={s.button}><Text style={s.buttonText}>Select from device</Text></Pressable><Text style={s.muted}>MP4 or MOV · up to 60 seconds · 100 MB</Text></View></DropZone><TextInput accessibilityLabel="Video link" placeholder="Paste a video link" placeholderTextColor="#888" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} style={s.input} /><Pressable accessibilityRole="button" disabled={!link.trim()} onPress={() => submit()} style={s.button}><Text style={s.buttonText}>Check link</Text></Pressable></Animated.View>}
            {running && <Animated.View entering={FadeIn.duration(240)} exiting={FadeOut.duration(200)}><Processing uploading={busy} /><Text style={s.muted}>{busy ? 'Receiving video' : job?.state === 'queued' ? 'Waiting to check' : 'Checking available evidence'}</Text></Animated.View>}
            {!!error && <Animated.Text entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} accessibilityRole="alert" style={s.text}>{error}</Animated.Text>}
            {!!error && !busy && !job && canRetry && <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}><Pressable accessibilityRole="button" onPress={() => { if (retry.current) void perform(retry.current); }}><Text style={s.text}>Retry upload</Text></Pressable></Animated.View>}
            {job?.state === 'error' && <Text style={s.text}>{job.error}</Text>}
            {complete && job?.result && <Animated.View entering={FadeIn.duration(360)} exiting={FadeOut.duration(200)} style={{ flexDirection: desktop ? 'row' : 'column', gap: 28 }}><View style={{ flex: 1, minWidth: 0 }}><EvidencePlayer uri={mediaUrl(job.id)} width={job.width} height={job.height} duration={job.duration} preview={job.result.mode === 'fixture'} evidence={job.result.evidence} /></View><View style={{ width: desktop ? 280 : '100%', gap: 20 }}><Text style={s.title}>What we can tell</Text>{job.result.mode === 'fixture' && <Text style={s.muted}>Playback preview · no assessment</Text>}{job.result.components.map(c => <View key={c.component} style={s.assessment}><Text style={s.muted}>{c.component === 'subject' ? 'Inserted subject' : c.component === 'visuals' ? 'Visuals' : 'Audio'}</Text><Text style={s.text}>{c.summary}</Text></View>)}</View></Animated.View>}
            {job && !running && <Pressable onPress={() => { generation.current++; retry.current = undefined; setCanRetry(false); router.setParams({ check: undefined }); setJob(undefined); setError(''); }} accessibilityRole="button"><Text style={s.text}>Check another video</Text></Pressable>}
          </ScrollView>
          {confirm && <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[s.surface, { position: 'absolute', inset: 16, justifyContent: 'center', padding: 28, gap: 24 }]}><Text style={s.title}>Leave this check?</Text><Text style={s.muted}>Your upload may finish in the background. You can reopen this window to continue.</Text><Pressable accessibilityRole="button" onPress={() => setConfirm(false)} style={s.button}><Text style={s.buttonText}>Keep checking</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { setConfirm(false); onClose(); }}><Text style={s.text}>Leave</Text></Pressable></Animated.View>}
        </Animated.View>
      </View>
    </View>}
  </Modal>;
}
const useTint = themed(c => ({ surface: { backgroundColor: c.surface }, header: { padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: c.surfaceRaised }, title: { color: c.text, fontSize: 18, fontWeight: '600' }, text: { color: c.text, fontSize: 16, lineHeight: 23 }, muted: { color: c.textDim, fontSize: 13, lineHeight: 20 }, input: { color: c.text, borderWidth: 1, borderColor: c.surfaceRaised, padding: 16, borderRadius: 12, fontSize: 16 }, button: { backgroundColor: c.text, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }, buttonText: { color: c.bg, fontSize: 15, fontWeight: '600' }, assessment: { backgroundColor: c.surface, padding: 18, borderRadius: 12, gap: 8 } }));
