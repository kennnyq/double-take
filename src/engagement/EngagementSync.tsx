import { useEffect, useRef } from 'react';
import { useSocial } from '@/social/store';
import { signals } from './store';

const FIELD = { like: 'likes', save: 'saves', share: 'shares' } as const;

/**
 * Feeds the ranker's signals from what the app already tracks: likes, saves,
 * reposts and sends, as they happen (each counted once per clip). Renders
 * nothing; mounted beside SocialSync.
 */
export function EngagementSync() {
  const social = useSocial();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set<string>();
    const lists = [
      ['like', social.liked],
      ['save', social.saved],
      ['share', social.reposted],
      ['share', social.sent],
    ] as const;
    for (const [kind, list] of lists) for (const e of list) now.add(`${kind}:${e.id}`);
    // The first pass only learns what was already there.
    if (seen.current)
      for (const k of now) {
        if (seen.current.has(k)) continue;
        const kind = k.slice(0, k.indexOf(':')) as 'like' | 'save' | 'share';
        const id = k.slice(k.indexOf(':') + 1);
        // Once per clip and kind, ever: a member's saved likes arriving after a reload aren't new.
        if (signals.get(id)[FIELD[kind]] > 0) continue;
        signals.note(id, { kind });
      }
    seen.current = now;
  }, [social.liked, social.saved, social.reposted, social.sent]);
  return null;
}
