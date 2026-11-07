import { useEffect, useState, type ReactNode } from 'react';
import type { Trials, TrialsApi } from './trials';
import './trial-bar.css';

/**
 * Development only: ‹ › step through whole designs; the name opens every axis
 * to mix. `[` and `]` step too. Dark, so it reads as a tool over the page
 * rather than part of it.
 */
export function TrialBar<T extends Trials>({ api, actions }: { api: TrialsApi<T>; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { trials, presets, preset, presetIndex, values, edited, select, applyPreset, step } = api;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === '[') step(-1);
      else if (e.key === ']') step(1);
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const groups = new Map<string, (keyof T)[]>();
  for (const key of Object.keys(trials) as (keyof T)[]) {
    const g = trials[key].group;
    groups.set(g, [...(groups.get(g) ?? []), key]);
  }

  return (
    <div className="tb" data-trial-bar="">
      {open && (
        <div className="tb-panel" data-own-wheel="">
          <fieldset className="tb-group">
            <legend className="tb-legend">Design</legend>
            <div className="tb-choices">
              {presets.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="tb-choice"
                  aria-pressed={p.id === preset.id}
                  title={p.note}
                  onClick={() => applyPreset(p.id)}
                >
                  <span className="tb-n">{i + 1}</span> {p.label}
                </button>
              ))}
            </div>
            <p className="tb-note">{preset.note}</p>
          </fieldset>
          {[...groups].map(([group, keys]) => (
            <section key={group} className="tb-section">
              <h3 className="tb-heading">{group}</h3>
              {keys.map((key) => {
                const trial = trials[key];
                return (
                  <fieldset key={String(key)} className="tb-group">
                    <legend className="tb-legend">
                      {trial.label}
                      {edited.includes(key) && <span className="tb-dot" aria-label="changed from the design" />}
                    </legend>
                    <div className="tb-choices">
                      {trial.items.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          className="tb-choice"
                          aria-pressed={values[key] === item.value}
                          onClick={() => select(key, item.value as never)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </section>
          ))}
        </div>
      )}
      <div className="tb-row">
        {actions}
        <div className="tb-pill">
          <button type="button" className="tb-arrow" aria-label="Previous design" onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="tb-name" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="tb-count">
              {presetIndex + 1}/{presets.length}
            </span>
            {preset.label}
            {edited.length > 0 && <span className="tb-edited">+{edited.length}</span>}
          </button>
          <button type="button" className="tb-arrow" aria-label="Next design" onClick={() => step(1)}>
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

/** A round button that sits beside the pill, e.g. Replay. */
export function TrialAction({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="tb-action" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}
