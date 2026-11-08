import { useEffect, useState, type ReactNode } from 'react';
import type { Trials, TrialsApi } from './trials';
import './trial-bar.css';

/** One tab of the bar: a set of designs on trial, and anything else to show with them. */
export interface TrialTab {
  id: string;
  label: string;
  /** Its designs and axes; a tab without one only shows `extra`. */
  api?: TrialsApi<Trials>;
  /** Shown above the axes, e.g. buttons that jump around the page. */
  extra?: ReactNode;
}

const TAB_KEY = 'dt-trial-bar:tab';

function readTab(): string | null {
  try {
    return window.localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function writeTab(id: string) {
  try {
    window.localStorage.setItem(TAB_KEY, id);
  } catch {
    // Private mode: the tab just isn't remembered.
  }
}

/**
 * Development only: ‹ › step through whole designs; the name opens every axis
 * to mix. `[` and `]` step too. The tabs along the bottom switch between the
 * sets of designs (the hero, the features below it, page-wide aids). Dark, so
 * it reads as a tool over the page rather than part of it.
 */
export function TrialBar({ tabs, actions }: { tabs: TrialTab[]; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tabId, setTabId] = useState(() => readTab() ?? tabs[0]?.id);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const api = tab?.api;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === '[') api?.step(-1);
      else if (e.key === ']') api?.step(1);
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  const pick = (id: string) => {
    setTabId(id);
    writeTab(id);
  };

  return (
    <div className="tb" data-trial-bar="">
      {open && tab && (
        <div className="tb-panel" data-own-wheel="">
          {tab.extra}
          {api && <Axes api={api} />}
        </div>
      )}
      <div className="tb-row">
        {actions}
        <div className="tb-pill">
          {api ? (
            <>
              <button type="button" className="tb-arrow" aria-label="Previous design" onClick={() => api.step(-1)}>
                ‹
              </button>
              <button type="button" className="tb-name" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <span className="tb-count">
                  {api.presetIndex + 1}/{api.presets.length}
                </span>
                {api.preset.label}
                {api.edited.length > 0 && <span className="tb-edited">+{api.edited.length}</span>}
              </button>
              <button type="button" className="tb-arrow" aria-label="Next design" onClick={() => api.step(1)}>
                ›
              </button>
            </>
          ) : (
            <button type="button" className="tb-name" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {tab?.label}
            </button>
          )}
        </div>
      </div>
      {tabs.length > 1 && (
        <div className="tb-tabs" role="tablist" aria-label="Options">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className="tb-tab" aria-selected={t.id === tab?.id} onClick={() => pick(t.id)}>
              {t.label}
              {t.api && t.api.edited.length > 0 && <span className="tb-dot" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The presets, then every axis grouped under its heading. */
function Axes({ api }: { api: TrialsApi<Trials> }) {
  const { trials, presets, preset, values, edited, select, applyPreset } = api;
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(trials)) {
    const g = trials[key].group;
    groups.set(g, [...(groups.get(g) ?? []), key]);
  }
  return (
    <>
      {presets.length > 1 && (
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
      )}
      {[...groups].map(([group, keys]) => (
        <section key={group} className="tb-section">
          <h3 className="tb-heading">{group}</h3>
          {keys.map((key) => {
            const trial = trials[key];
            return (
              <fieldset key={key} className="tb-group">
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
                      onClick={() => select(key, item.value)}
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
    </>
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

/** A plain button in a tab's panel (e.g. jump to a section). */
export function TrialButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="tb-choice" onClick={onClick}>
      {children}
    </button>
  );
}
