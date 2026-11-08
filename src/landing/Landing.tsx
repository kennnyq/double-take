import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { ArrowDown, ArrowRight, Play } from 'lucide-react';
import { Logo } from '@/desktop/Logo';
import { COPY, STEPS, TELLS } from './content';
import type { LandingValues } from './designs';
import { Gallery } from './Galleries';
import { Tile, useAtlasBoards, useGalleryClip, useTilePlayback } from './Tile';
import { launch } from './launch';
import { pickTier } from './tier';
import './landing.css';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Anton&family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700&family=Nunito:wght@700;800;900&display=swap';

function useFonts() {
  useEffect(() => {
    if (document.querySelector('link[data-landing-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS;
    link.dataset.landingFonts = '';
    document.head.append(link);
  }, []);
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const ACCENTS: Record<LandingValues['accent'], [string, string]> = {
  blue: ['#4f9cf9', '#04122a'],
  coral: ['#ff6b57', '#1f0602'],
  lime: ['#c6f432', '#0b0c0f'],
  white: ['#ffffff', '#000000'],
};

/**
 * The front page: a gallery of clips behind the words. Its button (or any
 * clip) starts the launch into the feed (`launch.ts`).
 */
export function Landing({
  values: v,
  ready,
  fullSrc,
  onLaunch,
  onDone,
}: {
  values: LandingValues;
  /** Settles once the feed's clips are in; a press before then launches when it does. */
  ready: Promise<unknown>;
  /** The full clip at a feed index. */
  fullSrc(clip: number): string | undefined;
  /** Mount the app beneath, opened on this clip. */
  onLaunch(clip: number): void;
  onDone(): void;
}) {
  useFonts();
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const latest = useRef({ v, ready, fullSrc, onLaunch, onDone });
  useLayoutEffect(() => {
    latest.current = { v, ready, fullSrc, onLaunch, onDone };
  });

  const go = useCallback((from: HTMLElement | null) => {
    const root = rootRef.current;
    if (started.current || !root) return;
    started.current = true;
    // Pressed before the feed loaded: launch once it has, and its tiles have their clips.
    void latest.current.ready.then(nextPaint).then(() => {
      const { v, fullSrc, onLaunch, onDone } = latest.current;
      return launch(root, v, from, { mountApp: onLaunch, done: onDone, fullSrc });
    });
  }, []);
  const press = useCallback((e: MouseEvent<HTMLElement>) => go(e.currentTarget), [go]);
  const pressTile = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-tile]');
      if (tile) go(tile);
    },
    [go],
  );

  useScan(rootRef, v.scan, `${v.gallery}:${v.scan}`);
  useLens(rootRef, v.blur === 'lens');

  // How much to ask of this device (tier.ts): read once, the screen doesn't change size class.
  const tier = useMemo(
    () =>
      pickTier(
        {
          shortSide: Math.min(window.screen.width, window.screen.height),
          coarse: window.matchMedia('(pointer: coarse)').matches,
          cores: navigator.hardwareConcurrency || undefined,
          memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        },
        v.tier,
      ),
    [v.tier],
  );

  const words = COPY[v.copy];
  const [accent, ink] = ACCENTS[v.accent];
  // In-page links scroll the landing (its own scroller) to the section in their href.
  const scrollTo = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const id = e.currentTarget.getAttribute('href')?.slice(1);
    if (id) rootRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div
      className="lt-root"
      ref={rootRef}
      data-type={v.type}
      data-cta={v.cta}
      data-tier={tier}
      style={{ '--accent': accent, '--accent-ink': ink, '--dim': Number(v.dim) / 100 } as CSSProperties}
    >
      {v.header !== 'none' && (
        <header className="lt-header" data-exit="">
          <a className="lt-brand" href="/" onClick={(e) => e.preventDefault()}>
            <Logo size={26} />
            <span>Double Take</span>
          </a>
          {v.header === 'full' && (
            <>
              <nav className="lt-nav">
                {v.below !== 'none' && (
                  <a href="#how" onClick={scrollTo}>
                    How it works
                  </a>
                )}
                {v.below === 'full' && (
                  <a href="#tells" onClick={scrollTo}>
                    The tells
                  </a>
                )}
                {(v.below === 'full' || v.below === 'quiz') && (
                  <a href="#try" onClick={scrollTo}>
                    Try one
                  </a>
                )}
              </nav>
              <button type="button" className="lt-header-cta" onClick={press}>
                Open the app
              </button>
            </>
          )}
        </header>
      )}

      <section className="lt-hero" data-layout={v.layout} data-gallery={v.gallery}>
        <div className="lt-gallery-hit" onClick={pressTile}>
          <Gallery design={v.gallery} speed={v.speed} reels={v.reels} turn={v.turn} tier={tier} />
        </div>
        {v.blur !== 'none' && <div className="lt-blur" data-mode={v.blur} />}
        <div className="lt-veil" data-mode={v.veil} />
        <div className="lt-hero-fade" data-exit="" />
        <div className="lt-content">
          <p className="lt-eyebrow" data-exit="">
            {words.eyebrow}
          </p>
          <h1 className="lt-title" data-exit="">
            {words.heading[0]}
            <Emphasis design={v.emphasis} word={words.heading[1]} />
            {words.heading[2]}
          </h1>
          <p className="lt-sub" data-exit="">
            {words.sub}
          </p>
          <div className="lt-actions" data-exit="">
            <button type="button" className="lt-cta" onClick={press}>
              {v.cta === 'play' && (
                <span className="lt-cta-disc">
                  <Play size={22} fill="currentColor" />
                </span>
              )}
              <span>{words.button}</span>
              {v.cta !== 'play' && <ArrowRight size={20} />}
            </button>
            {v.below !== 'none' && (
              <a className="lt-secondary" href={v.below === 'quiz' ? '#try' : '#how'} onClick={scrollTo}>
                {v.below === 'quiz' ? 'Try one first' : 'How it works'} <ArrowDown size={16} />
              </a>
            )}
          </div>
        </div>
      </section>

      {v.below !== 'none' && <Below design={v.below} press={press} pressTile={pressTile} button={words.button} />}
    </div>
  );
}

/** Gallery clip `clip`'s poster, once the feed has loaded. */
function Poster({ clip }: { clip: number }) {
  const c = useGalleryClip(clip);
  return c?.poster ? <img src={c.poster} alt="" /> : null;
}

function Emphasis({ design, word }: { design: LandingValues['emphasis']; word: string }) {
  switch (design) {
    case 'bracket':
      return (
        <span className="lt-em lt-em-bracket">
          <i />
          <i />
          <i />
          <i />
          {word}
        </span>
      );
    case 'strike':
      return (
        <span className="lt-em lt-em-strike">
          {word}
          <i />
        </span>
      );
    case 'glitch':
      return (
        <span className="lt-em lt-em-glitch" data-text={word}>
          {word}
        </span>
      );
    case 'underline':
      return (
        <span className="lt-em lt-em-underline">
          {word}
          <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M3 13 C 40 5, 90 3, 197 9 M 20 17 C 70 12, 130 11, 180 14" />
          </svg>
        </span>
      );
    case 'gradient':
      return <span className="lt-em lt-em-gradient">{word}</span>;
    default:
      return <span className="lt-em">{word}</span>;
  }
}

function Below({
  design,
  press,
  pressTile,
  button,
}: {
  design: LandingValues['below'];
  press(e: MouseEvent<HTMLElement>): void;
  pressTile(e: MouseEvent<HTMLElement>): void;
  button: string;
}) {
  const quizRef = useRef<HTMLElement>(null);
  useTilePlayback(quizRef, design);
  useAtlasBoards(quizRef, design);
  return (
    <>
      {(design === 'full' || design === 'steps') && (
        <section className="lt-section" id="how" data-exit="">
          <h2 className="lt-h2">How it works</h2>
          <ol className="lt-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="lt-step">
                <div className="lt-step-art" data-art={i}>
                  <Poster clip={i * 3 + 1} />
                  {i === 0 && (
                    <span className="lt-step-play">
                      <Play size={22} fill="currentColor" />
                    </span>
                  )}
                  {i === 1 && (
                    <span className="lt-step-call">
                      <b>Real</b>
                      <b>AI</b>
                    </span>
                  )}
                  {i === 2 && <span className="lt-step-box" />}
                </div>
                <span className="lt-step-n">0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {design === 'full' && (
        <section className="lt-section lt-tells" id="tells" data-exit="">
          <div className="lt-tells-frame">
            <Poster clip={6} />
            <span className="lt-tell-box" style={{ left: '18%', top: '30%', width: '34%', height: '22%' }}>
              <em>0:03</em>
            </span>
            <span className="lt-tell-box" style={{ left: '52%', top: '62%', width: '30%', height: '18%' }}>
              <em>0:05</em>
            </span>
          </div>
          <div>
            <h2 className="lt-h2">What gives it away</h2>
            <p className="lt-lede">
              Each clip can come with its tells: the moments to look at, boxed on the frame, with what to notice.
            </p>
            <ul className="lt-tell-list">
              {TELLS.map((t) => (
                <li key={t.title}>
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {(design === 'full' || design === 'quiz') && (
        <section className="lt-section lt-quiz" id="try" data-exit="" ref={quizRef}>
          <h2 className="lt-h2">Try one</h2>
          <p className="lt-lede">Which of these is AI? Pick one, and the feed opens on it.</p>
          <div className="lt-quiz-row" onClick={pressTile}>
            <Tile clip={2} className="lt-quiz-tile" />
            <span className="lt-quiz-or">or</span>
            <Tile clip={5} className="lt-quiz-tile" />
          </div>
        </section>
      )}

      <section className="lt-section lt-final" data-exit="">
        <h2 className="lt-h2">Ready for a double take?</h2>
        <button type="button" className="lt-cta" onClick={press}>
          <span>{button}</span>
          <ArrowRight size={20} />
        </button>
      </section>
      <footer className="lt-footer" data-exit="">
        <span className="lt-brand">
          <Logo size={20} /> Double Take
        </span>
        <span>A prototype. Clips belong to their creators.</span>
      </footer>
    </>
  );
}

/** Tell boxes or "Real?" / "AI?" chips flicker onto random clips on screen. */
function useScan(rootRef: React.RefObject<HTMLElement | null>, scan: LandingValues['scan'], key: string) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || scan === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let n = 0;
    const id = window.setInterval(() => {
      if (root.hasAttribute('data-launching')) return;
      const tiles = [...root.querySelectorAll<HTMLElement>('.lt-gallery [data-tile]')].filter((t) => {
        const r = t.getBoundingClientRect();
        return r.width > 60 && r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight;
      });
      const tile = tiles[Math.floor(Math.random() * tiles.length)];
      if (!tile) return;
      const mark = document.createElement('i');
      n++;
      if (scan === 'brackets') {
        mark.className = 'lt-scan lt-scan-box';
        Object.assign(mark.style, {
          left: `${10 + Math.random() * 35}%`,
          top: `${15 + Math.random() * 40}%`,
          width: `${30 + Math.random() * 25}%`,
          height: `${18 + Math.random() * 18}%`,
        });
      } else {
        mark.className = 'lt-scan lt-scan-chip';
        mark.textContent = n % 2 ? 'AI?' : 'Real?';
      }
      tile.append(mark);
      window.setTimeout(() => mark.remove(), 2400);
    }, 700);
    return () => {
      window.clearInterval(id);
      root.querySelectorAll('.lt-scan').forEach((el) => el.remove());
    };
  }, [rootRef, scan, key]);
}

/** Keeps the blur's clear spot under the pointer. */
function useLens(rootRef: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !on) return;
    const onMove = (e: PointerEvent) => {
      const lens = root.querySelector<HTMLElement>('.lt-blur');
      if (!lens) return;
      const r = lens.getBoundingClientRect();
      lens.style.setProperty('--lx', `${e.clientX - r.left}px`);
      lens.style.setProperty('--ly', `${e.clientY - r.top}px`);
    };
    root.addEventListener('pointermove', onMove);
    return () => root.removeEventListener('pointermove', onMove);
  }, [rootRef, on]);
}
