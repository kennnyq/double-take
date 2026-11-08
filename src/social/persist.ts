import { supabase } from '@/auth/supabase';
import { authStore, currentUserId } from '@/auth/store';
import { createWriteQueue, planWrite, runPlan, type SocialWrite } from './sync';

const rollbacks = new WeakMap<SocialWrite, () => void>();

const queue = createWriteQueue(
  async (w) => {
    const uid = currentUserId();
    if (!supabase || !uid) throw new Error('signed out');
    await runPlan(supabase, planWrite(w, uid));
  },
  (w, e) => {
    console.warn(`[social] couldn't save ${w.kind}: ${e instanceof Error ? e.message : e}`);
    // Signed out meanwhile: the state was reset already, nothing to undo.
    if (authStore.getState().status === 'member') rollbacks.get(w)?.();
  },
);

/** Whether writes are saved to Supabase now (a member, with Supabase configured). */
export const persisting = () => !!supabase && authStore.getState().status === 'member';

/**
 * Save a write in the background. The UI has already applied it; `rollback`
 * undoes that if the save fails. Does nothing in local mode or for guests.
 */
export function persist(w: SocialWrite, rollback: () => void) {
  if (!persisting()) return;
  rollbacks.set(w, rollback);
  queue.push(w);
}

/** Drop queued writes (on sign-out or account switch). */
export const clearPendingWrites = () => queue.clear();
