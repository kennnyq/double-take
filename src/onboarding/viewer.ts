import { useGuestChosen } from '@/auth/guest';
import { useAuth } from '@/auth/store';

/** Viewer identity stays separate from tutorial progress: every viewer must
 * actually open a walkthrough, and completion is remembered on this device. */
export function useHintViewer() {
  const { status } = useAuth();
  const guest = useGuestChosen();
  return { status, kind: status === 'member' ? 'member' : status === 'guest' && guest ? 'guest' : 'visitor' };
}
