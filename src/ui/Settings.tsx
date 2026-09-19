import { Gamepad2, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { formatVolume, stepVolume } from '../audio/sound';
import { DIFFICULTIES, difficultyInfo } from '../game/difficulty';
import { publish, updateSettings, useGame } from '../app/store';
import type { GameStyle, RinkSize, Settings } from '../game/types';
import { step, useNav } from '../input/menuNavigation';
import { CAMERA_OPTIONS } from '../scene/camera';
import { OptionRow, Prompts, TitleBar, type OptionKind } from './kit';

type VolumeKey = 'masterVolume' | 'sfxVolume' | 'musicVolume';
interface Row {
  id: string;
  section?: string;
  label: string;
  kind: OptionKind;
  value: string;
  checked?: boolean;
  slider?: number;
  /** Shown under the list while the row is focused. */
  hint: string;
  select: () => void;
  step?: (dir: 1 | -1) => void;
  slide?: (value: number) => void;
}
type Toggle = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const STYLE_OPTIONS: { id: GameStyle; label: string; hint: string }[] = [
  { id: 'fast', label: 'Fast', hint: 'Arcade pace: quick feet, sharp cuts, a hard, fast puck.' },
  {
    id: 'classic',
    label: 'Classic',
    hint: 'Slower and heavier. Speed takes building, turns run wide, and a sprint has to be saved for when it counts.',
  },
];
const RINK_OPTIONS: { id: RinkSize; label: string; hint: string }[] = [
  {
    id: 'barn',
    label: 'Barn',
    hint: 'The house rink: 60 × 26 m, tight corners, room behind the net.',
  },
  { id: 'pro', label: 'Pro', hint: 'NHL ice: 200 × 85 ft, 28 ft corners, goal lines 11 ft out.' },
  {
    id: 'olympic',
    label: 'Olympic',
    hint: 'International ice: 60 × 30 m. Four metres wider, so more room on the wings.',
  },
  {
    id: 'bandy',
    label: 'Bandy',
    hint: 'A bandy field: 100 × 60 m of open ice, no zones, and the net against the end boards.',
  },
];
/** Moving the boards mid-game stops play; online, both are the host's call. */
const RESTARTS_PLAY = ' Changing it now restarts play from a faceoff.';
const HOSTS_CALL = ' Online, the host decides.';

const cycle = <T,>(list: readonly T[], current: T, dir: number) =>
  list[(list.indexOf(current) + dir + list.length) % list.length];

function useFullscreen() {
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return on;
}
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

export function SettingsScreen({ crumb, onClose }: { crumb: string; onClose: () => void }) {
  const runtime = useGame();
  const { settings, controller } = runtime;
  const [index, setIndex] = useState(0);
  const [testing, setTesting] = useState(false);
  const fullscreen = useFullscreen();
  const status = controller.status;
  const difficulty = difficultyInfo(settings.difficulty);
  const style = STYLE_OPTIONS.find((o) => o.id === settings.style) ?? STYLE_OPTIONS[0];
  const rink = RINK_OPTIONS.find((o) => o.id === settings.rink) ?? RINK_OPTIONS[0];
  const onIce = runtime.match.phase !== 'menu';
  const camera = CAMERA_OPTIONS.find((o) => o.value === settings.camera) ?? CAMERA_OPTIONS[0];
  const [cameraName, cameraDetail = ''] = camera.label.split(' · ');

  const toggle = (key: Toggle, label: string, hint: string, section?: string): Row => {
    const flip = () => updateSettings({ [key]: !settings[key] });
    return {
      id: key,
      section,
      label,
      kind: 'toggle',
      checked: settings[key],
      value: settings[key] ? 'On' : 'Off',
      hint,
      select: flip,
      step: flip,
    };
  };
  const setDifficulty = (dir: 1 | -1) =>
    updateSettings({ difficulty: cycle(DIFFICULTIES, difficulty, dir).id });
  const setStyle = (dir: 1 | -1) => updateSettings({ style: cycle(STYLE_OPTIONS, style, dir).id });
  const setRink = (dir: 1 | -1) => updateSettings({ rink: cycle(RINK_OPTIONS, rink, dir).id });
  const setCamera = (dir: 1 | -1) =>
    updateSettings({ camera: cycle(CAMERA_OPTIONS, camera, dir).value });
  const setQuality = () =>
    updateSettings({ quality: settings.quality === 'high' ? 'low' : 'high' });
  // Both seats, or forcing the layout would fix one player's unlabeled pad and not the other's.
  const setLayout = () => {
    const next = controller.layout === 'auto' ? 'xbox' : 'auto';
    for (const seat of [runtime.controller, runtime.controllerTwo]) {
      seat.layout = next;
      seat.refresh();
    }
    publish();
  };
  const volume = (key: VolumeKey, label: string, hint: string): Row => ({
    id: key,
    label,
    kind: 'slider',
    value: formatVolume(settings[key]),
    slider: Math.round(settings[key] * 100),
    hint,
    select: () => updateSettings({ [key]: stepVolume(settings[key], 1) }),
    step: (dir) => updateSettings({ [key]: stepVolume(settings[key], dir) }),
    slide: (n) => updateSettings({ [key]: n }),
  });

  const rows: Row[] = [
    {
      id: 'difficulty',
      section: 'Gameplay',
      label: 'CPU difficulty',
      kind: 'cycle',
      value: difficulty.label,
      hint: difficulty.hint,
      select: () => setDifficulty(1),
      step: setDifficulty,
    },
    {
      id: 'style',
      label: 'Game style',
      kind: 'cycle',
      value: style.label,
      hint: style.hint + (runtime.net ? HOSTS_CALL : ''),
      select: () => setStyle(1),
      step: setStyle,
    },
    {
      id: 'rink',
      label: 'Rink size',
      kind: 'cycle',
      value: rink.label,
      hint: rink.hint + (runtime.net ? HOSTS_CALL : onIce ? RESTARTS_PLAY : ''),
      select: () => setRink(1),
      step: setRink,
    },
    toggle(
      'beginner',
      'Beginner mode',
      'Shot target in the net and a pass-lane arrow while you aim.',
    ),
    toggle(
      'goalReplays',
      'Goal replays',
      'Replays the build-up after a goal. Any button skips it.',
    ),
    {
      id: 'camera',
      section: 'Video',
      label: 'Camera angle',
      kind: 'cycle',
      value: cameraName,
      hint: cameraDetail ? `${cameraName} — ${cameraDetail}.` : cameraName,
      select: () => setCamera(1),
      step: setCamera,
    },
    {
      id: 'quality',
      label: 'Graphics',
      kind: 'cycle',
      value: settings.quality === 'high' ? 'High' : 'Performance',
      hint:
        settings.quality === 'high'
          ? 'Shadows and full resolution.'
          : 'Shadows off for a steadier frame rate.',
      select: setQuality,
      step: setQuality,
    },
    toggle('showFps', 'FPS counter', 'Frame rate in the corner of the screen during play.'),
    {
      id: 'fullscreen',
      label: 'Fullscreen',
      kind: 'toggle',
      checked: fullscreen,
      value: fullscreen ? 'On' : 'Off',
      hint: 'Fill the whole screen.',
      select: toggleFullscreen,
      step: toggleFullscreen,
    },
    toggle('sound', 'Sound', 'Mute music and effects. Volume sliders keep their values.', 'Audio'),
    volume('masterVolume', 'Master volume', 'Scales music and effects together.'),
    volume('sfxVolume', 'Sound effects', 'Hits, skating, horn and whistle.'),
    volume('musicVolume', 'Music', 'The soundtrack that drops when a goal goes in.'),
    toggle('goalMusic', 'Goal music', 'Swells into the drop when a goal goes in.'),
    {
      id: 'credits',
      label: 'Sound credits',
      kind: 'link',
      value: '',
      hint: 'Who recorded the sounds. Opens in a new tab.',
      select: () =>
        window.open(`${import.meta.env.BASE_URL}audio/CREDITS.txt`, '_blank', 'noreferrer'),
    },
    toggle('hints', 'Button prompts', 'Button prompts along the bottom of menus.', 'Interface'),
    {
      id: 'controller',
      section: 'Controller',
      label: 'Test controller',
      kind: 'link',
      value: status.connected ? 'Connected' : status.unsupported ? 'Needs setup' : 'Not found',
      hint: status.connected ? status.name : status.detail,
      select: () => setTesting(true),
    },
    {
      id: 'layout',
      label: 'Controller layout',
      kind: 'cycle',
      value: controller.layout === 'auto' ? 'Automatic' : 'Xbox',
      hint: 'Xbox reads the usual four-axis layout when the browser leaves the pad unlabeled.',
      select: setLayout,
      step: setLayout,
    },
  ];
  const row = rows[index];

  useNav((a) => {
    if (testing) {
      // Every other button only lights its indicator.
      if (a === 'back') setTesting(false);
      return;
    }
    if (a === 'up' || a === 'down') setIndex(step(index, a === 'up' ? -1 : 1, rows.length));
    else if (a === 'left' || a === 'right') row.step?.(a === 'left' ? -1 : 1);
    else if (a === 'confirm' && row.kind !== 'slider') row.select();
    else if (a === 'back' || a === 'start') onClose();
  });

  return (
    <div className="screen settings-screen">
      <div className="stage-frame narrow">
        <TitleBar crumb={crumb} title={testing ? 'Controller' : 'Settings'} />
        {testing ? (
          <ControllerTest onClose={() => setTesting(false)} />
        ) : (
          <>
            <div className="plate option-list">
              {rows.map((r, i) => (
                <Fragment key={r.id}>
                  {r.section && <h2 className="option-section">{r.section}</h2>}
                  <OptionRow
                    label={r.label}
                    value={r.value}
                    kind={r.kind}
                    checked={r.checked}
                    slider={r.slider}
                    focused={i === index}
                    onFocus={() => setIndex(i)}
                    onSelect={r.select}
                    onStep={r.step}
                    onSlide={r.slide}
                  />
                </Fragment>
              ))}
            </div>
            <p className="option-hint">{row.hint}</p>
          </>
        )}
      </div>
      <Prompts
        items={
          testing
            ? [{ k: 'back', label: 'Back', onClick: () => setTesting(false) }]
            : [
                ...(row.kind === 'slider'
                  ? []
                  : [{ k: 'confirm' as const, label: 'Select', onClick: row.select }]),
                { k: 'leftright', label: 'Change' },
                { k: 'back', label: 'Back', onClick: onClose },
              ]
        }
      />
    </div>
  );
}

const BUTTONS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'VIEW',
  'MENU',
  'LS',
  'RS',
  '↑',
  '↓',
  '←',
  '→',
  'HOME',
];

/** Live readout of what the browser sees from the pad. */
function ControllerTest({ onClose }: { onClose: () => void }) {
  const runtime = useGame();
  // Each seat holds its own pad, so each is tested on its own. A second controller that the
  // browser has not seen yet shows up here rather than silently going missing on the ice.
  const [seat, setSeat] = useState(0);
  const controller = seat ? runtime.controllerTwo : runtime.controller;
  const status = controller.status;
  return (
    <section className="plate controller-test" aria-labelledby="controller-name">
      <button className="close-button" onClick={onClose} aria-label="Close controller test">
        <X size={18} />
      </button>
      <div className="tabs" role="tablist" aria-label="Seat">
        {['Player 1', 'Player 2'].map((label, i) => (
          <button key={label} role="tab" aria-selected={seat === i} onClick={() => setSeat(i)}>
            {label}
            <i
              className="seat-dot"
              data-on={
                (i ? runtime.controllerTwo : runtime.controller).status.connected || undefined
              }
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <div className={`pad-status ${status.connected ? 'connected' : ''}`} role="status">
        <Gamepad2 size={26} />
        <div>
          <strong id="controller-name">{status.name}</strong>
          <span>{status.connected ? status.mapping : status.detail}</span>
        </div>
      </div>
      <div className="stick-tests">
        {[0, 2].map((offset, i) => (
          <div key={offset}>
            <div className="stick-test" aria-label={i ? 'Right stick input' : 'Left stick input'}>
              <i
                style={{
                  transform: `translate(${(status.axes[offset] ?? 0) * 33}px, ${(status.axes[offset + 1] ?? 0) * 33}px)`,
                }}
              />
            </div>
            <span>{i ? 'Right stick' : 'Left stick'}</span>
          </div>
        ))}
      </div>
      <div className="button-tests">
        {BUTTONS.map((label, i) => {
          const down = (status.buttons[i] ?? 0) > 0.5;
          return (
            <span
              key={label}
              className={down ? 'pressed' : ''}
              aria-label={`${label} ${down ? 'pressed' : 'released'}`}
            >
              {label}
            </span>
          );
        })}
      </div>
      {status.axes.length > 4 && (
        <p className="fine">Raw axes: {status.axes.map((n) => n.toFixed(2)).join(' / ')}</p>
      )}
      {!status.connected && (
        <div className="pad-help">
          <ol>
            <li>
              Click inside this tab, then press a face button <strong>on this controller</strong>. A
              browser hides a pad until it has seen input from that exact one.
            </li>
            <li>Open the game directly on localhost or HTTPS, not in an embedded preview.</li>
            <li>Still nothing? Try Chrome, or reconnect the controller by USB.</li>
          </ol>
          <button
            className="ghost-button"
            onClick={() => {
              window.focus();
              controller.refresh();
              publish();
            }}
          >
            Check again
          </button>
          {status.state === 'insecure' && (
            <a href={`http://localhost:${location.port || '4173'}${location.pathname}`}>
              Open this game on localhost →
            </a>
          )}
        </div>
      )}
    </section>
  );
}
