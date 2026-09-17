import { Copy, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PHYSICS } from '../game/config';
import {
  copyFeelTweaks,
  FEEL_GROUPS,
  FEEL_PARAMS,
  feelChanged,
  feelDefault,
  feelValue,
  formatFeel,
  resetFeel,
  resetFeelGroup,
  resetFeelParam,
  setFeelParam,
  useFeel,
  type FeelGroupId,
  type FeelParam,
} from '../dev/feel';
import { distance } from '../game/math';
import { mySide, useGame } from '../app/store';

function band(speed: number) {
  if (speed < 1.2) return 'still';
  if (speed < 3.2) return 'crawl';
  if (speed < 6) return 'stride';
  if (speed < PHYSICS.maxSpeed * 0.92) return 'pace';
  if (speed < PHYSICS.hustleSpeed * 0.98) return 'top end';
  return 'hustle';
}

function edges(lean: number) {
  const load = Math.abs(lean);
  if (load < 0.12) return 'straight';
  if (load < 0.4) return 'leaning';
  return 'carving';
}

function FeelSlider({ param }: { param: FeelParam }) {
  const value = feelValue(param);
  const fallback = feelDefault(param);
  const dirty = feelChanged(param);
  const id = `feel-${param.table}-${param.key}`;
  return (
    <label className={`feel-param ${dirty ? 'dirty' : ''}`} htmlFor={id}>
      <div className="feel-param-head">
        <span>{param.label}</span>
        <strong>
          {formatFeel(value, param.step)}
          {param.unit ? <small>{param.unit}</small> : null}
        </strong>
      </div>
      <div className="feel-param-row">
        <input
          id={id}
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-label={param.label}
          onDoubleClick={() => resetFeelParam(param)}
          onChange={(e) => setFeelParam(param, Number(e.target.value))}
        />
        <input
          type="number"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-label={`${param.label} value`}
          onChange={(e) => setFeelParam(param, Number(e.target.value))}
        />
        <button
          type="button"
          className="feel-reset-one"
          disabled={!dirty}
          aria-label={`Reset ${param.label} to ${formatFeel(fallback, param.step)}`}
          onClick={() => resetFeelParam(param)}
        >
          {dirty ? formatFeel(fallback, param.step) : '—'}
        </button>
      </div>
      <p>{param.meaning}</p>
      <small>
        <span>Higher: {param.higher}</span>
        <span>Lower: {param.lower}</span>
      </small>
    </label>
  );
}

export function FeelHud({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { changed } = useFeel();
  const { match } = useGame();
  const [group, setGroup] = useState<FeelGroupId>('skate');
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = FEEL_GROUPS.find((item) => item.id === group) ?? FEEL_GROUPS[0];
  const side = mySide(match).humans[0] ?? { controlled: -1 };
  const you = match.skaters[side.controlled];
  const speed = you ? Math.hypot(you.vx, you.vz) : 0;
  const puckDist = you ? distance(you, match.puck) : 0;

  let nearest = Infinity,
    closing = 0;
  if (you)
    for (const other of match.skaters) {
      if (other.team === you.team) continue;
      const gap = distance(you, other);
      if (gap >= nearest) continue;
      nearest = gap;
      if (gap < 0.001) {
        closing = 0;
        continue;
      }
      const nx = (other.x - you.x) / gap,
        nz = (other.z - you.z) / gap;
      closing = (you.vx - other.vx) * nx + (you.vz - other.vz) * nz;
    }

  const params = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FEEL_PARAMS.filter((param) => {
      if (param.group !== group) return false;
      if (onlyChanged && !feelChanged(param)) return false;
      if (!needle) return true;
      return `${param.label} ${param.key} ${param.meaning}`.toLowerCase().includes(needle);
    });
  }, [changed, group, onlyChanged, query]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Backquote') {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(!open);
        return;
      }
      if (e.code === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, onOpenChange]);

  const copy = async () => {
    const text = copyFeelTweaks();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy these feel tweaks', text);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (!open) return null;
  const state = !you
    ? '—'
    : you.diveTimer > 0
      ? 'diving'
      : you.downTimer > 0
        ? 'recovering'
        : you.stumbleTimer > 0
          ? 'off balance'
          : you.checkTimer > 0
            ? 'checking'
            : you.cellyKind
              ? `celly · ${you.cellyKind}`
              : you.dekeKind
                ? `deke · ${you.dekeKind}`
                : match.puck.owner === side.controlled
                  ? 'puck'
                  : 'open ice';
  const dirty = changed;

  return (
    <aside className="feel-hud" data-feel-hud>
      <header>
        <div>
          <div className="eyebrow">FEEL TUNER</div>
          <h2>
            <SlidersHorizontal size={16} /> How it feels
          </h2>
        </div>
        <button
          className="icon-button"
          onClick={() => onOpenChange(false)}
          aria-label="Close feel tuner"
        >
          <X size={16} />
        </button>
      </header>
      <p className="feel-hint">
        Gamepad still skates while you drag. Backtick toggles this. Double-click a slider to reset
        it.
        {dirty ? ` ${dirty} changed from shipped.` : ' All shipped defaults.'}
      </p>
      {you && (
        <dl className="feel-readout">
          <div>
            <dt>Speed</dt>
            <dd>
              {speed.toFixed(1)} m/s <span>{band(speed)}</span>
            </dd>
          </div>
          <div>
            <dt>Edges</dt>
            <dd>
              {you.edgeLean.toFixed(2)} <span>{edges(you.edgeLean)}</span>
            </dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{state}</dd>
          </div>
          <div>
            <dt>Puck</dt>
            <dd>{match.puck.owner === side.controlled ? 'on tape' : `${puckDist.toFixed(1)} m`}</dd>
          </div>
          <div>
            <dt>Closest</dt>
            <dd>
              {Number.isFinite(nearest) ? `${nearest.toFixed(1)} m` : '—'}
              {Number.isFinite(nearest) ? (
                <span>
                  {closing > 0.4
                    ? `closing ${closing.toFixed(1)}`
                    : closing < -0.4
                      ? 'separating'
                      : 'even'}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Stamina</dt>
            <dd>{Math.round(you.stamina * 100)}%</dd>
          </div>
        </dl>
      )}
      <div className="feel-tabs" role="tablist" aria-label="Feel groups">
        {FEEL_GROUPS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={group === item.id}
            className={group === item.id ? 'active' : ''}
            onClick={() => setGroup(item.id)}
          >
            {item.label}
            {FEEL_PARAMS.some((param) => param.group === item.id && feelChanged(param)) ? (
              <i />
            ) : null}
          </button>
        ))}
      </div>
      <p className="feel-try">Try this: {meta.tryThis}</p>
      <div className="feel-tools">
        <input
          type="search"
          value={query}
          placeholder="Filter this group"
          aria-label="Filter tunables"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="feel-changed">
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={(e) => setOnlyChanged(e.target.checked)}
          />
          Changed
        </label>
      </div>
      <div className="feel-params">
        {params.length === 0 ? (
          <p className="feel-empty">Nothing in this group matches.</p>
        ) : (
          params.map((param) => <FeelSlider key={`${param.table}.${param.key}`} param={param} />)
        )}
      </div>
      <footer className="feel-actions">
        <button type="button" onClick={() => resetFeelGroup(group)}>
          <RotateCcw size={14} /> Reset {meta.label.toLowerCase()}
        </button>
        <button type="button" onClick={resetFeel} disabled={dirty === 0}>
          Reset all
        </button>
        <button type="button" className="feel-copy" onClick={() => void copy()}>
          <Copy size={14} /> {copied ? 'Copied' : 'Copy tweaks'}
        </button>
      </footer>
    </aside>
  );
}
