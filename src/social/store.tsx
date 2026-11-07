import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { initialSocialState, socialReducer, type SocialAction, type SocialState } from './reducer';

/**
 * One reducer-backed store for the signed-in user's social state, provided
 * through context. `getState()` is always current, so action helpers can read
 * it synchronously (e.g. to pick a toast) without waiting for a re-render.
 */
export interface SocialStore {
  getState: () => SocialState;
  dispatch: (action: SocialAction) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSocialStore(): SocialStore {
  let state = initialSocialState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = socialReducer(state, action);
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const SocialContext = createContext<SocialStore | null>(null);

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createSocialStore);
  return <SocialContext.Provider value={store}>{children}</SocialContext.Provider>;
}

export function useSocialStore(): SocialStore {
  const store = useContext(SocialContext);
  if (!store) throw new Error('useSocialStore must be used inside <SocialProvider>');
  return store;
}

/** Current social state; re-renders when it changes. */
export function useSocial(): SocialState {
  const store = useSocialStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
