import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TEST_ACCOUNTS, devAccountsAvailable, devSignIn, type TestAccount } from './devAccounts';
import { closeSignIn, useGate } from './gate';
import { CODE_LENGTH, looksLikeEmail, parseOtpInput } from './otp';
import { supabase } from './supabase';

type Step = { kind: 'email' } | { kind: 'code'; email: string };

/**
 * Sign in or create an account with a one-time email code (they're the same
 * flow). A bottom sheet on phones, a centred dialog on wide screens. Opened by
 * the auth gate when a guest tries to act, or by a "Log in" button; after
 * sign-in the gate runs whatever the guest was trying to do.
 */
export function SignInSheet() {
  const { open, reason } = useGate();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 760;
  if (!supabase) return null;

  return (
    <Modal
      visible={open}
      transparent
      animationType={wide ? 'fade' : 'slide'}
      onRequestClose={closeSignIn}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        style={[styles.backdrop, wide ? styles.backdropWide : styles.backdropPhone]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSignIn} accessibilityLabel="Close sign in" />
        <View
          style={[styles.panel, wide ? styles.panelWide : [styles.panelPhone, { paddingBottom: insets.bottom + 16 }]]}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label="Sign in"
        >
          {!wide && <View style={styles.grabber} />}
          <View style={styles.header}>
            <Pressable
              onPress={closeSignIn}
              hitSlop={8}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          {/* Keyed on open, so every opening starts at the email step. */}
          {open && <SignInBody key="body" reason={reason} />}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SignInBody({ reason }: { reason: string | null }) {
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [step.kind]);

  const sendCode = async (email: string) => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) {
      setError(e.status === 429 ? 'Too many emails sent. Wait a bit and try again.' : e.message);
      return;
    }
    setStep({ kind: 'code', email });
    setValue('');
  };

  const verify = async (email: string, raw: string) => {
    if (!supabase) return;
    const parsed = parseOtpInput(raw);
    if (!parsed) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the email, or paste its sign-in link.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: e } =
      parsed.kind === 'code'
        ? await supabase.auth.verifyOtp({ email, token: parsed.token, type: 'email' })
        : await supabase.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type });
    setBusy(false);
    // On success the auth store sees SIGNED_IN; the app loads your state and closes this.
    if (e) setError(e.message.includes('expired') || e.message.includes('invalid') ? 'That code is wrong or has expired.' : e.message);
  };

  const submit = () => {
    if (busy) return;
    if (step.kind === 'email') {
      const email = value.trim().toLowerCase();
      if (!looksLikeEmail(email)) {
        setError('Enter a valid email address.');
        return;
      }
      sendCode(email);
    } else {
      verify(step.email, value);
    }
  };

  const isEmail = step.kind === 'email';
  return (
    <View style={styles.body}>
      <Text style={styles.title} role="heading">
        {isEmail ? (reason ?? 'Sign in to Double Take') : 'Check your email'}
      </Text>
      <Text style={styles.sub}>
        {isEmail
          ? 'Use your email to sign in or create an account. Your likes, saves and reposts stay with you.'
          : `We sent a code to ${step.email}. Enter it below, or paste the sign-in link from the email.`}
      </Text>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(t) => {
          setValue(t);
          if (error) setError(null);
        }}
        onSubmitEditing={submit}
        placeholder={isEmail ? 'you@example.com' : `${CODE_LENGTH}-digit code or link`}
        placeholderTextColor="#777"
        style={styles.input}
        keyboardType={isEmail ? 'email-address' : 'default'}
        textContentType={isEmail ? 'emailAddress' : 'oneTimeCode'}
        autoComplete={isEmail ? 'email' : 'one-time-code'}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={isEmail ? 'next' : 'done'}
        keyboardAppearance="dark"
        editable={!busy}
        accessibilityLabel={isEmail ? 'Email' : 'Code'}
      />
      {error && (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      )}
      <Pressable
        onPress={submit}
        disabled={busy}
        style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>{isEmail ? 'Continue' : 'Sign in'}</Text>}
      </Pressable>
      {!isEmail && (
        <View style={styles.links}>
          <Pressable onPress={() => sendCode(step.email)} disabled={busy} hitSlop={6} accessibilityRole="button">
            <Text style={styles.link}>Send a new code</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setStep({ kind: 'email' });
              setValue(step.email);
              setError(null);
            }}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.link}>Use another email</Text>
          </Pressable>
        </View>
      )}
      {devAccountsAvailable() && <DevQuickSignIn onError={setError} />}
    </View>
  );
}

/** Dev builds: the Accounts tab's one-tap test accounts, right here, so a pending action can be tried quickly. */
function DevQuickSignIn({ onError }: { onError: (e: string) => void }) {
  const [busy, setBusy] = useState<TestAccount | null>(null);
  const go = async (a: TestAccount) => {
    setBusy(a);
    try {
      await devSignIn(a);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };
  return (
    <View style={styles.dev}>
      <Text style={styles.devTitle}>Dev · test accounts</Text>
      <View style={styles.devRow}>
        {[...TEST_ACCOUNTS, 'fresh' as const].map((a) => (
          <Pressable
            key={a}
            onPress={() => go(a)}
            disabled={busy !== null}
            style={({ pressed }) => [styles.devChip, (pressed || busy === a) && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Sign in as ${a}`}
          >
            <Text style={styles.devChipText}>{busy === a ? '…' : a}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const ACCENT = '#FFD60A';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  backdropPhone: { justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: { backgroundColor: '#1b1d21', overflow: 'hidden' },
  panelPhone: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  panelWide: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    paddingBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    ...(Platform.OS === 'web' ? { boxShadow: '0 24px 64px rgba(0,0,0,0.6)' } : null),
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.3)' },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 10, paddingTop: 8 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  body: { paddingHorizontal: 22, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  input: {
    marginTop: 6,
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#fff',
    fontSize: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  error: { color: '#ff6961', fontSize: 13 },
  primary: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT },
  primaryText: { color: '#111', fontSize: 16, fontWeight: '700' },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  link: { color: '#8ab4ff', fontSize: 14, fontWeight: '600' },
  dev: {
    marginTop: 6,
    padding: 10,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,214,10,0.45)',
  },
  devTitle: { color: ACCENT, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  devChip: { paddingHorizontal: 12, height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  devChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
