import { X } from 'lucide-react';
import { CommentsThread, useCommentTotal } from '@/comments/CommentsThread';
import type { Clip } from '@/data/clips';

interface Props {
  /** The active clip: the panel follows the feed as you move. */
  clip: Clip;
  onClose: () => void;
  /** Too narrow to dock: it lies over the right edge, with a shadow to lift it off the feed. */
  overlay?: boolean;
  ref?: React.Ref<HTMLElement>;
}

/**
 * Desktop comments: a rounded panel docked beside the active video, so the
 * clip keeps playing in view. It isn't modal, so the feed's wheel, keys and
 * up/down buttons keep working and the panel shows each clip's comments in
 * turn. `data-own-wheel` keeps wheeling over it to its own list.
 */
export function CommentsPanel({ clip, onClose, overlay = false, ref }: Props) {
  const total = useCommentTotal(clip);
  return (
    <aside
      className={`comments-panel ${overlay ? 'overlay' : ''}`}
      ref={ref}
      tabIndex={-1}
      aria-label="Comments"
      data-own-wheel
    >
      <header className="cp-header">
        <h2>
          Comments <span>{total.toLocaleString('en-US')}</span>
        </h2>
        <button className="cp-close" onClick={onClose} aria-label="Close comments">
          <X size={22} />
        </button>
      </header>
      <div className="cp-body">
        {/* Keyed by clip, so a half-written comment or reply doesn't follow you to the next one. */}
        <CommentsThread key={clip.id} clip={clip} bottomInset={6} desktop />
      </div>
    </aside>
  );
}
