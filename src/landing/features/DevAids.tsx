import { useEffect, useRef } from 'react';
import { TrialButton } from '../TrialBar';
import { SECTION_WORDS } from './content';
import type { SectionId } from './timeline';

/** Development aids for the landing (the trial bar's Global tab). */
export const DevAids = { Meter, Jumps };

/**
 * Frame times, measured with requestAnimationFrame: the last second's
 * frames per second, its slowest frame and how many frames went over 20 ms.
 * Written as text four times a second, out of the way of the page.
 */
function Meter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let times: number[] = [];
    let shown = last;
    const frame = (now: number) => {
      times.push(now - last);
      last = now;
      if (now - shown > 250 && ref.current) {
        const second = times.slice(-120);
        const sum = second.reduce((a, b) => a + b, 0);
        const fps = (second.length * 1000) / Math.max(1, sum);
        const worst = Math.max(...second);
        const long = second.filter((t) => t > 20).length;
        ref.current.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(0)} ms · ${long} over 20 ms`;
        shown = now;
        times = second;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={ref} className="ft-meter" />;
}

/** Jumps around the landing: the hero, each features section, the end. */
function Jumps() {
  const go = (where: 'top' | 'end' | number) => {
    const root = document.querySelector<HTMLElement>('.lt-root');
    const track = document.querySelector<HTMLElement>('#features');
    if (!root) return;
    if (where === 'top') return root.scrollTo({ top: 0, behavior: 'smooth' });
    if (where === 'end') return root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' });
    if (!track) return;
    const starts = (track.dataset.starts ?? '').split(',').map(Number);
    const h = track.querySelector<HTMLElement>('.ft-stage')?.clientHeight ?? window.innerHeight;
    const top = track.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({ top: top + (starts[where] ?? 0) * h + (where ? 0.05 * h : 0), behavior: 'smooth' });
  };
  const ids = (document.querySelector<HTMLElement>('#features')?.dataset.ids ?? '').split(',').filter(Boolean) as SectionId[];
  return (
    <fieldset className="tb-group">
      <legend className="tb-legend">Go to</legend>
      <div className="tb-jumps">
        <TrialButton onClick={() => go('top')}>Hero</TrialButton>
        {ids.map((id, i) => (
          <TrialButton key={id} onClick={() => go(i)}>
            {SECTION_WORDS[id]?.name ?? id}
          </TrialButton>
        ))}
        <TrialButton onClick={() => go('end')}>End</TrialButton>
      </div>
    </fieldset>
  );
}
