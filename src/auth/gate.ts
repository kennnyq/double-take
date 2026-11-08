import { useSyncExternalStore } from 'react';
import { createGate, type GateSnapshot } from './gateCore';
import { isGuestChosen } from './guest';
import { authStore, signOut } from './store';

/** The app's one auth gate (see gateCore.ts). */
export const authGate = createGate();

/**
 * Whether the current user may write: a member, a guest who chose to continue
 * without an account (kept on this device), or anyone in local mode.
 */
export function canAct(): boolean {
  const { status } = authStore.getState();
  return status === 'member' || status === 'local' || (status === 'guest' && isGuestChosen());
}

/**
 * Run `action` now if the user can act; otherwise open sign-in with `reason`
 * and run it once they've signed in and their saved state has loaded.
 * Returns whether it ran now.
 */
export function requireAccount(reason: string, action: () => void): boolean {
  return authGate.request(canAct(), reason, action);
}

export const openSignIn = (reason?: string, membersOnly?: boolean) => authGate.openSignIn(reason, membersOnly);

/** Uploading needs a real account: members (or local mode, with no accounts at all), never guests. */
export function canUpload(status: ReturnType<typeof authStore.getState>['status']): boolean {
  return status === 'member' || status === 'local';
}

/** Like `requireAccount`, but only an account will do: sign-in leaves out "Continue as guest". */
export function requireMember(reason: string, action: () => void): boolean {
  return authGate.request(canUpload(authStore.getState().status), reason, action, true);
}
export const closeSignIn = () => authGate.dismiss();

/** Sign out of an account, back to the choice: sign in, or continue as a guest. */
export async function signOutToChoice() {
  await signOut();
  authGate.openSignIn();
}

export function useGate(): GateSnapshot {
  return useSyncExternalStore(authGate.subscribe, authGate.getSnapshot, authGate.getSnapshot);
}
