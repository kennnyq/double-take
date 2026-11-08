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
import { continueAsGuest, useGuestChosen } from './guest';
import { supabase } from './supabase';
import {
  PASSWORD_MIN,
  USERNAME_MAX,
  authErrorMessage,
  normalizeUsername,
  passwordProblem,
  usernameEmail,
  usernameProblem,
} from './username';
import { themed, usePalette } from '@/ui/theme';

/**
 * Sign in or create an account with a username and password. A bottom sheet
 * on phones, a centred dialog on wide screens. Opened by
 * the auth gate when a guest tries to act, or by a "Log in" button; after
 * sign-in the gate runs whatever the guest was trying to do.
 */
export function SignInSheet() {
  const { open, reason } = useGate();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tint = useTint();
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
          style={[styles.panel, tint.panel, wide ? styles.panelWide : [styles.panelPhone, { paddingBottom: insets.bottom + 16 }]]}
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
          {/* Mounted while open, so every opening starts fresh. */}
          {open && <SignInBody key="body" reason={reason} />}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type Mode = 'signIn' | 'signUp';

function SignInBody({ reason }: { reason: string | null }) {
  const c = usePalette();
  const tint = useTint();
  // Already a guest (opened to sign in and save across devices): no guest option.
  const guest = useGuestChosen();
  const [mode, setMode] = useState<Mode>('signIn');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const userInput = useRef<TextInputInstance>(null);
  const passInput = useRef<TextInputInstance>(null);

  useEffect(() => {
    const t = setTimeout(() => userInput.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  const name = normalizeUsername(username);
  const signUp = mode === 'signUp';
  // While creating an account, say what's wrong with the username as it's typed.
  const nameHint = signUp && name ? (usernameProblem(name) ?? (taken === name ? 'That username is taken.' : null)) : null;

  /** Whether the handle is free (profiles are public, so this reveals nothing new). */
  const isTaken = async (u: string) => {
    if (!supabase) return false;
    const { data } = await supabase.from('profiles').select('id').eq('handle', u).maybeSingle();
    return !!data;
  };

  const submit = async () => {
    if (busy || !supabase) return;
    setError(null);
    const problem = signUp ? (usernameProblem(name) ?? passwordProblem(password)) : !name || !password ? 'Enter your username and password.' : null;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    if (signUp && (await isTaken(name))) {
      setTaken(name);
      setError('That username is taken.');
      setBusy(false);
      return;
    }
    const email = usernameEmail(name);
    const { error: e } = signUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    // On success the auth store sees SIGNED_IN; the app loads your state, runs
    // what you were doing, and closes this.
    if (e) setError(authErrorMessage(e, mode));
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <View style={styles.body}>
      <Text style={styles.title} role="heading">
        {reason ?? (signUp ? 'Create your account' : 'Sign in to Double Take')}
      </Text>
      <View style={styles.modes} role="tablist">
        {(['signIn', 'signUp'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => switchMode(m)}
            style={[styles.mode, mode === m && styles.modeOn]}
            role="tab"
            aria-selected={mode === m}
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{m === 'signIn' ? 'Sign in' : 'Create account'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        ref={userInput}
        value={username}
        onChangeText={(t) => {
          setUsername(t);
          if (error) setError(null);
        }}
        onBlur={() => {
          if (signUp && name && !usernameProblem(name)) isTaken(name).then((t) => t && setTaken(name));
        }}
        onSubmitEditing={() => passInput.current?.focus()}
        placeholder="Username"
        placeholderTextColor="#777"
        style={styles.input}
        textContentType="username"
        autoComplete={signUp ? 'username-new' : 'username'}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={USERNAME_MAX + 1}
        returnKeyType="next"
        keyboardAppearance="dark"
        editable={!busy}
        accessibilityLabel="Username"
      />
      {nameHint ? <Text style={styles.hint}>{nameHint}</Text> : null}
      <View>
        <TextInput
          ref={passInput}
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (error) setError(null);
          }}
          onSubmitEditing={submit}
          placeholder="Password"
          placeholderTextColor="#777"
          style={[styles.input, styles.passwordInput]}
          secureTextEntry={!showPassword}
          textContentType={signUp ? 'newPassword' : 'password'}
          autoComplete={signUp ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          keyboardAppearance="dark"
          editable={!busy}
          accessibilityLabel="Password"
        />
        <Pressable
          onPress={() => setShowPassword((v) => !v)}
          hitSlop={8}
          style={styles.eye}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
        >
          <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#aaa" />
        </Pressable>
      </View>
      {signUp && <Text style={styles.hint}>{PASSWORD_MIN}+ characters with letters and numbers. There’s no password reset yet, so keep it somewhere safe.</Text>}
      {/* The username hint already says "taken"; don't repeat it. */}
      {error && error !== nameHint && (
        <Text style={styles.error} role="alert">
          {error}
        </Text>
      )}
      <Pressable
        onPress={submit}
        disabled={busy}
        style={({ pressed }) => [styles.primary, tint.primary, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={[styles.primaryText, tint.primaryText]}>{signUp ? 'Create account' : 'Sign in'}</Text>}
      </Pressable>
      <Pressable onPress={() => switchMode(signUp ? 'signIn' : 'signUp')} hitSlop={6} accessibilityRole="button" style={styles.switch}>
        <Text style={styles.sub}>
          {signUp ? 'Have an account? ' : 'New here? '}
          <Text style={[styles.link, tint.link]}>{signUp ? 'Sign in' : 'Create an account'}</Text>
        </Text>
      </Pressable>
      {!guest && (
        <Pressable
          onPress={continueAsGuest}
          disabled={busy}
          style={({ pressed }) => [styles.guestButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.guestText}>Continue as guest</Text>
        </Pressable>
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
  const tint = useTint();
  return (
    <View style={[styles.dev, tint.dev]}>
      <Text style={[styles.devTitle, tint.devTitle]}>Dev · test accounts</Text>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  backdropPhone: { justifyContent: 'flex-end' },
  backdropWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: { overflow: 'hidden' },
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
  primary: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 16, fontWeight: '700' },
  modes: { flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  mode: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  modeText: { color: '#aaa', fontSize: 14, fontWeight: '600' },
  modeTextOn: { color: '#fff' },
  passwordInput: { paddingRight: 46 },
  eye: { position: 'absolute', right: 12, top: 6, bottom: 0, justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16, marginTop: -4 },
  switch: { alignItems: 'center', paddingVertical: 4 },
  guestButton: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  guestText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  link: { fontSize: 14, fontWeight: '600' },
  dev: {
    marginTop: 6,
    padding: 10,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  devTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  devChip: { paddingHorizontal: 12, height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  devChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});

const useTint = themed((c) => ({
  panel: { backgroundColor: c.surface },
  primary: { backgroundColor: c.accent },
  primaryText: { color: c.onAccent },
  link: { color: c.link },
  dev: { borderColor: c.accentSoft },
  devTitle: { color: c.accent },
}));
