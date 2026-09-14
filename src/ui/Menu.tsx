import {
  ArrowRight,
  Gamepad2,
  Keyboard,
  Maximize,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { TEAMS, TEAM_MARKS } from '../game/config';
import { CAMERA_OPTIONS } from '../scene/camera';
import { beginGame, updateSettings, useGame } from '../game/store';
import { MODES, modeInfo } from '../game/modes';
import type { CameraMode, GameMode, Team } from '../game/types';
import { Controls } from './Controls';
import { ControllerSetup } from './ControllerSetup';
import { useDialog } from './useDialog';
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark">
        <i />
        <i />
      </span>
      <span>
        BENCHED<span className="brand-dot">®</span>
      </span>
    </div>
  );
}
export function TeamLogo({ team, small = false }: { team: Team; small?: boolean }) {
  const mark = TEAM_MARKS[team];
  return (
    <div className={`team-logo team-${team} ${small ? 'logo-small' : ''}`}>
      <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <path d={mark.body} fill="currentColor" />
        <path d={mark.inner} fill={mark.innerColor} />
        {mark.underline && <path d={mark.underline} stroke="currentColor" strokeWidth="4" />}
      </svg>
    </div>
  );
}
export function SettingsPanel({ close }: { close: () => void }) {
  const dialog = useDialog(close);
  const { settings } = useGame();
  return (
    <div className="modal-scrim" onClick={close}>
      <section
        ref={dialog}
        data-block-game-input
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Game settings"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={close} aria-label="Close settings">
          <X size={20} />
        </button>
        <div className="eyebrow">OPTIONS</div>
        <h2>Game settings</h2>
        <label>
          Sound{' '}
          <button
            className={`toggle ${settings.sound ? 'on' : ''}`}
            aria-label="Toggle sound"
            aria-pressed={settings.sound}
            onClick={() => updateSettings({ sound: !settings.sound })}
          >
            <span />
          </button>
        </label>
        <label>
          Beginner mode{' '}
          <button
            className={`toggle ${settings.beginner ? 'on' : ''}`}
            aria-label="Toggle beginner mode"
            aria-describedby="beginner-mode-hint"
            aria-pressed={settings.beginner}
            onClick={() => updateSettings({ beginner: !settings.beginner })}
          >
            <span />
          </button>
        </label>
        <p className="setting-hint" id="beginner-mode-hint">
          Shot target in the net and pass-lane arrow while you aim.
        </p>
        <label htmlFor="camera-setting">
          Camera angle{' '}
          <select
            id="camera-setting"
            value={settings.camera}
            onChange={(e) => updateSettings({ camera: e.target.value as CameraMode })}
          >
            {CAMERA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="quality-setting">
          Graphics{' '}
          <select
            id="quality-setting"
            value={settings.quality}
            onChange={(e) => updateSettings({ quality: e.target.value as 'high' | 'low' })}
          >
            <option value="high">High · shadows on</option>
            <option value="low">Performance · shadows off</option>
          </select>
        </label>
        <p className="connection-note">
          A local match against the computer. Exhibition is three five-minute periods. 3-on-3 and
          1-on-1 play three three-minute periods. Shootouts are best of three, then sudden death.
          Tied games finish as a draw.
        </p>
        <a className="audio-credits" href="/audio/CREDITS.txt" target="_blank" rel="noreferrer">
          Sound credits
        </a>
      </section>
    </div>
  );
}
export function Menu() {
  const { controller, settings } = useGame();
  const [controllerSetup, setControllerSetup] = useState(false);
  const [team, setTeam] = useState<Team>(0),
    [mode, setMode] = useState<GameMode>('exhibition'),
    [controls, setControls] = useState(false),
    [showSettings, setShowSettings] = useState(false);
  const info = modeInfo(mode);
  return (
    <div className="menu">
      <header className="site-header">
        <Brand />
        <nav>
          {MODES.map((item) => (
            <button
              key={item.id}
              className={`mode-tab ${mode === item.id ? 'nav-active' : ''}`}
              aria-current={mode === item.id ? 'page' : undefined}
              aria-label={item.eyebrow}
              onClick={() => setMode(item.id)}
            >
              {item.tab}
            </button>
          ))}
          <button onClick={() => setControls(true)}>HOW TO PLAY</button>
        </nav>
        <button
          onClick={() => setControllerSetup(true)}
          aria-label={controller.status.connected ? 'Test controller' : 'Connect controller'}
          className={`connection-pill ${controller.status.connected ? 'connected' : ''}`}
        >
          <span className="status-dot" />
          <Gamepad2 size={16} />
          <span>{controller.status.connected ? 'CONTROLLER CONNECTED' : 'CONNECT CONTROLLER'}</span>
        </button>
      </header>
      <main className="match-menu">
        <div className="selection-title">
          <span>PLAY NOW /</span>
          <h1>{info.title}</h1>
        </div>
        <div className="matchup-panel">
          <div className="matchup-topline">
            <span>{info.eyebrow}</span>
            <span>NORTHSTAR ARENA</span>
          </div>
          <div className="team-picker">
            {TEAMS.map((t, i) => (
              <button
                key={t.abbr}
                className={`team-option matchup-team side-${i} ${team === i ? 'selected' : ''}`}
                onClick={() => setTeam(i as Team)}
                aria-pressed={team === i}
                aria-label={`${t.city} ${t.name}`}
              >
                <span className="side-label">{i === 0 ? 'HOME' : 'AWAY'}</span>
                <TeamLogo team={i as Team} />
                <span className="team-option-name">
                  <small>{t.city}</small>
                  <strong>{t.name}</strong>
                </span>
                <span className="uniform-label">{i === 0 ? 'NAVY / WHITE' : 'RED / NAVY'}</span>
                <span className="team-assignment">
                  <Gamepad2 size={22} />
                  {team === i ? 'PLAYER 1' : info.practice ? 'GOALIE' : 'CPU'}
                </span>
              </button>
            ))}
            <div className="versus" aria-hidden="true">
              VS
            </div>
          </div>
          <div className="matchup-bottomline">
            <span>{info.format}</span>
            <span>{info.duration}</span>
            <span>{info.tag}</span>
          </div>
        </div>
        <div className="match-start">
          <span>{info.prompt}</span>
          <button className="primary-button play-button" onClick={() => beginGame(team, mode)}>
            {info.play} <ArrowRight size={22} />
          </button>
        </div>
      </main>
      <footer className="menu-footer">
        <div className="footer-left">
          <span className="button-cue">A</span> PLAY <span className="direction-cue">← →</span>{' '}
          SELECT SIDE <span className="direction-cue">↑ ↓</span> MODE
        </div>
        <div className="footer-actions">
          <button onClick={() => setControls(true)}>
            <Keyboard size={16} /> CONTROLS
          </button>
          <button onClick={() => setShowSettings(true)} aria-label="Open settings">
            <Settings2 size={17} /> SETTINGS
          </button>
          <button
            onClick={() => updateSettings({ sound: !settings.sound })}
            aria-label={settings.sound ? 'Mute sound' : 'Enable sound'}
          >
            {settings.sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => {});
            }}
            aria-label="Toggle fullscreen"
          >
            <Maximize size={16} />
          </button>
        </div>
      </footer>
      {controller.status.unsupported && (
        <div className="unsupported-notice">
          The browser sees your controller but its layout needs attention. Open Connect Controller
          to test it.
        </div>
      )}
      {controllerSetup && <ControllerSetup close={() => setControllerSetup(false)} />}
      {controls && <Controls close={() => setControls(false)} />}
      {showSettings && <SettingsPanel close={() => setShowSettings(false)} />}
    </div>
  );
}
