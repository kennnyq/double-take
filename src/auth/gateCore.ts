/**
 * The auth gate's state machine. Pure, so it runs under `node --test`.
 *
 * A write as a guest is held as one pending action and the sign-in surface
 * opens with a reason. Once the user is a member *and* their saved state has
 * been loaded, the pending action runs once, against the real server state.
 * Dismissing sign-in drops it. A newer request replaces an older one.
 */
export interface GateSnapshot {
  open: boolean;
  /** Why sign-in opened, e.g. "Sign in to like this Take". */
  reason: string | null;
  hasPending: boolean;
  /** Only an account will do (e.g. uploading): sign-in leaves out "Continue as guest". */
  membersOnly: boolean;
}

export interface Gate {
  getSnapshot: () => GateSnapshot;
  subscribe: (l: () => void) => () => void;
  /**
   * Run `action` now if `canAct`, else hold it and open sign-in.
   * Returns whether it ran.
   */
  request: (canAct: boolean, reason: string, action: () => void, membersOnly?: boolean) => boolean;
  /** Open sign-in with nothing pending (a "Log in" button); `membersOnly` leaves out the guest option. */
  openSignIn: (reason?: string, membersOnly?: boolean) => void;
  /** Close sign-in and drop any pending action. */
  dismiss: () => void;
  /** Call when the user can act (member, state loaded): runs the pending action once and closes. */
  ready: () => void;
}

export function createGate(): Gate {
  let pending: (() => void) | null = null;
  let snap: GateSnapshot = { open: false, reason: null, hasPending: false, membersOnly: false };
  const listeners = new Set<() => void>();
  const set = (open: boolean, reason: string | null, membersOnly = false) => {
    const next = { open, reason, hasPending: pending !== null, membersOnly };
    if (next.open === snap.open && next.reason === snap.reason && next.hasPending === snap.hasPending && next.membersOnly === snap.membersOnly) return;
    snap = next;
    listeners.forEach((l) => l());
  };

  return {
    getSnapshot: () => snap,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    request(canAct, reason, action, membersOnly) {
      if (canAct) {
        action();
        return true;
      }
      pending = action;
      set(true, reason, !!membersOnly);
      return false;
    },
    openSignIn(reason, membersOnly) {
      pending = null;
      set(true, reason ?? null, !!membersOnly);
    },
    dismiss() {
      pending = null;
      set(false, null);
    },
    ready() {
      const run = pending;
      pending = null;
      set(false, null);
      run?.();
    },
  };
}
