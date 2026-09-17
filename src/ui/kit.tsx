import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Club, Uniform } from '../game/clubs';
import { useGame } from '../app/store';
import { useDevice, type Device, type NavAction } from '../input/menuNavigation';

export type PromptKey = NavAction | 'updown' | 'leftright';
const PAD: Record<PromptKey, string> = {
  confirm: 'A',
  back: 'B',
  x: 'X',
  y: 'Y',
  start: '☰',
  lb: 'LB',
  rb: 'RB',
  lt: 'LT',
  rt: 'RT',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  updown: '↕',
  leftright: '↔',
};
const KEYS: Record<PromptKey, string> = {
  confirm: 'Enter',
  back: 'Esc',
  x: 'X',
  y: 'R',
  start: 'Enter',
  lb: 'Q',
  rb: 'E',
  lt: 'Z',
  rt: 'C',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  updown: '↑↓',
  leftright: '←→',
};
/** Face buttons wear their Xbox colors. */
const FACE: Record<string, string> = { A: 'a', B: 'b', X: 'x', Y: 'y' };

/** One button, drawn for whichever input the player last used. */
export function Glyph({ k, device }: { k: PromptKey; device?: Device }) {
  const current = useDevice();
  const d = device ?? current;
  return <KeyChip label={d === 'pad' ? PAD[k] : KEYS[k]} device={d} />;
}
export function KeyChip({ label, device }: { label: string; device: Device }) {
  const face = device === 'pad' ? FACE[label] : undefined;
  return (
    <kbd className={`glyph ${device} ${face ? `face face-${face}` : ''}`} aria-hidden="true">
      {label}
    </kbd>
  );
}

export interface Prompt {
  k: PromptKey;
  label: string;
  onClick?: () => void;
}
/** The strip of button prompts along the bottom of a menu. Clickable, but kept out of the tab order. */
export function Prompts({ items }: { items: Prompt[] }) {
  const { settings } = useGame();
  if (!settings.hints) return null;
  return (
    <footer className="prompts" aria-hidden="true">
      {items.map((item) => (
        <button
          key={item.label}
          tabIndex={-1}
          className="prompt"
          onClick={item.onClick}
          disabled={!item.onClick}
        >
          <Glyph k={item.k} /> {item.label}
        </button>
      ))}
    </footer>
  );
}

/** Keeps the browser's focus on the item the pad is on, and scrolls it into view. */
function useFollowFocus<T extends HTMLElement>(focused: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!focused || !el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);
  return ref;
}

export function MenuItem({
  focused,
  onFocus,
  onSelect,
  disabled,
  className = '',
  children,
}: {
  focused: boolean;
  onFocus: () => void;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useFollowFocus<HTMLButtonElement>(focused);
  return (
    <button
      ref={ref}
      className={`menu-item ${className}`}
      data-focused={focused || undefined}
      disabled={disabled}
      onMouseEnter={disabled ? undefined : onFocus}
      onFocus={onFocus}
      onClick={onSelect}
    >
      <span>{children}</span>
      <i className="caret" aria-hidden="true" />
    </button>
  );
}

export type OptionKind = 'cycle' | 'toggle' | 'link' | 'slider';
/** A settings line: label on the left, value on the right. Left and right step a selector. */
export function OptionRow({
  label,
  value,
  kind,
  checked,
  focused,
  slider,
  onFocus,
  onSelect,
  onStep,
  onSlide,
}: {
  label: string;
  value: string;
  kind: OptionKind;
  checked?: boolean;
  focused: boolean;
  /** 0–100, for volume rows. */
  slider?: number;
  onFocus: () => void;
  onSelect: () => void;
  onStep?: (dir: 1 | -1) => void;
  onSlide?: (value: number) => void;
}) {
  const ref = useFollowFocus<HTMLButtonElement>(focused);
  const valueId = useId();
  const sliding = kind === 'slider';
  return (
    <div className="option" data-focused={focused || undefined} onMouseEnter={onFocus}>
      <button
        ref={ref}
        className="option-hit"
        role={kind === 'toggle' ? 'switch' : sliding ? 'slider' : undefined}
        aria-checked={kind === 'toggle' ? checked : undefined}
        aria-valuemin={sliding ? 0 : undefined}
        aria-valuemax={sliding ? 100 : undefined}
        aria-valuenow={sliding ? slider : undefined}
        aria-valuetext={sliding ? value : undefined}
        aria-label={label}
        aria-describedby={kind === 'toggle' ? undefined : valueId}
        onFocus={onFocus}
        onClick={onSelect}
      />
      <span className="option-label">{label}</span>
      <span className="option-value" data-kind={kind}>
        {kind === 'cycle' && (
          <button tabIndex={-1} aria-label={`Previous ${label}`} onClick={() => onStep?.(-1)}>
            <ChevronLeft size={18} />
          </button>
        )}
        {kind === 'toggle' ? (
          <i className="switch" data-on={checked || undefined} aria-hidden="true" />
        ) : null}
        {sliding && (
          <>
            <button tabIndex={-1} aria-label={`Decrease ${label}`} onClick={() => onStep?.(-1)}>
              <ChevronLeft size={18} />
            </button>
            <input
              className="volume-track"
              type="range"
              min={0}
              max={100}
              step={5}
              value={slider ?? 0}
              tabIndex={-1}
              aria-hidden="true"
              style={{ '--at': `${slider ?? 0}%` } as CSSProperties}
              onChange={(e) => onSlide?.(Number(e.target.value) / 100)}
            />
          </>
        )}
        <span id={valueId} className={sliding ? 'volume-pct' : undefined}>
          {value}
        </span>
        {(kind === 'cycle' || sliding) && (
          <button
            tabIndex={-1}
            aria-label={`${kind === 'cycle' ? 'Next' : 'Increase'} ${label}`}
            onClick={() => onStep?.(1)}
          >
            <ChevronRight size={18} />
          </button>
        )}
        {kind === 'link' && <ChevronRight size={18} aria-hidden="true" />}
      </span>
    </div>
  );
}

/** A page header: the glossy strip across the top of every menu. */
export function TitleBar({
  crumb,
  title,
  children,
}: {
  crumb: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="title-bar">
      <div className="crumb">
        <span>{crumb} /</span>
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      BENCHED{' '}
      <span
        style={{ fontSize: '25px', alignSelf: 'end', marginBottom: '10px' }}
        className="brand-version"
      >
        v0.0.0.0.0.0.0.1
      </span>
    </div>
  );
}

export function TeamLogo({ club, className = '' }: { club: Club; className?: string }) {
  return <img className={`team-logo ${className}`} src={club.logo} alt="" draggable={false} />;
}

/** A sweater drawn in the uniform's colors, crest on the chest. */
export function JerseyIcon({ uniform }: { uniform: Uniform }) {
  return (
    <svg className="jersey-icon" viewBox="0 0 100 92" aria-hidden="true">
      <path
        d="M36 4 L44 2 Q50 9 56 2 L64 4 L94 18 L88 46 L74 41 L74 88 L26 88 L26 41 L12 46 L6 18 Z"
        fill={uniform.jersey}
        stroke="#000a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M26 69 H74 V75 H26 Z M26 78 H74 V81 H26 Z" fill={uniform.trim} />
      <path
        d="M9.6 16.3 L13.8 14.4 L15.6 44.7 L13.7 45.4 Z M90.4 16.3 L86.2 14.4 L84.4 44.7 L86.3 45.4 Z"
        fill={uniform.trim}
      />
      <path d="M44 2 Q50 9 56 2" fill="none" stroke={uniform.trim} strokeWidth="3" />
      <image href={uniform.crest} x="35" y="27" width="30" height="30" />
    </svg>
  );
}
