import { useSyncExternalStore } from 'react';
import { createGate, type GateSnapshot } from './gateCore';
import { authStore } from './store';

/** The app's one auth gate (see gateCore.ts). */
export const authGate = createGate();

/** Whether the current user may write: a member, or anyone in local mode. */
export function canAct(): boolean {
  const { status } = authStore.getState();
  return status === 'member' || status === 'local';
}

/**
 * Run `action` now if the user can act; otherwise open sign-in with `reason`
 * and run it once they've signed in and their saved state has loaded.
 * Returns whether it ran now.
 */
export function requireAccount(reason: string, action: () => void): boolean {
  return authGate.request(canAct(), reason, action);
}

export const openSignIn = (reason?: string) => authGate.openSignIn(reason);
export const closeSignIn = () => authGate.dismiss();

export function useGate(): GateSnapshot {
  return useSyncExternalStore(authGate.subscribe, authGate.getSnapshot, authGate.getSnapshot);
}
