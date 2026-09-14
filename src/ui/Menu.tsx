import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Keyboard,
  Maximize,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { cycleClub, LEAGUES, leagueOf, openingMatchup, uniformFor, type Club } from '../game/clubs';
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
export function TeamLogo({ club, small = false }: { club: Club; small?: boolean }) {
  return (
    <div className={`team-logo ${small ? 'logo-small' : ''}`}>
      <img src={club.logo} alt="" draggable={false} />
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
  const { controller, settings, match } = useGame();
  const [controllerSetup, setControllerSetup] = useState(false);
  const [team, setTeam] = useState<Team>(match.homeTeam),
    [teams, setTeams] = useState<[Club, Club]>(match.teams),
    [mode, setMode] = useState<GameMode>('exhibition'),
    [controls, setControls] = useState(false),
    [showSettings, setShowSettings] = useState(false);
  const info = modeInfo(mode);
  const league = leagueOf(teams[0]);
  const cycle = (side: Team, step: 1 | -1) =>
    setTeams((pair) => {
      const next: [Club, Club] = [...pair];
      next[side] = cycleClub(league, pair[side], pair[1 - side], step);
      return next;
    });
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
            {LEAGUES.length > 1 && (
              <div className="league-picker" role="group" aria-label="League">
                {LEAGUES.map((l) => (
                  <button
                    key={l.id}
                    className="league-option"
                    aria-pressed={l.id === league.id}
                    onClick={() => l.id !== league.id && setTeams(openingMatchup(l))}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="team-picker">
            {teams.map((club, i) => {
              const side = i as Team,
                sideName = side === 0 ? 'home' : 'away',
                uniform = uniformFor(club, side);
              return (
                <div
                  key={side}
                  className="matchup-slot"
                  style={{ '--club': club.accent } as CSSProperties}
                >
                  <button
                    className={`team-option matchup-team side-${side} ${team === side ? 'selected' : ''}`}
                    onClick={() => setTeam(side)}
                    aria-pressed={team === side}
                    aria-label={`${club.city} ${club.name}`}
                  >
                    <span className="side-label">{sideName.toUpperCase()}</span>
                    <TeamLogo club={club} />
                    <span className="team-option-name">
                      <small>{club.city}</small>
                      <strong>{club.name}</strong>
                    </span>
                    <span className="uniform-label">
                      <i style={{ background: uniform.jersey }} />
                      <i style={{ background: uniform.trim }} />
                      {sideName.toUpperCase()} JERSEY
                    </span>
                    <span className="team-assignment">
                      <Gamepad2 size={22} />
                      {team === side ? 'PLAYER 1' : info.practice ? 'GOALIE' : 'CPU'}
                    </span>
                  </button>
                  {league.clubs.length > 2 && (
                    <div className="club-switcher">
                      <button
                        className="club-cycle prev"
                        aria-label={`Previous ${sideName} team`}
                        onClick={() => cycle(side, -1)}
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <span className="club-switcher-label">CHANGE TEAM</span>
                      <button
                        className="club-cycle next"
                        aria-label={`Next ${sideName} team`}
                        onClick={() => cycle(side, 1)}
                      >
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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
          <button
            className="primary-button play-button"
            onClick={() => beginGame(team, mode, teams)}
          >
            {info.play} <ArrowRight size={22} />
          </button>
        </div>
      </main>
      <footer className="menu-footer">
        <div className="footer-left">
          <span className="button-cue">A</span> PLAY <span className="direction-cue">← →</span> SIDE{' '}
          <span className="direction-cue">↑ ↓</span> TEAM{' '}
          <span className="direction-cue">LB RB</span> MODE
          {LEAGUES.length > 1 && (
            <>
              {' '}
              <span className="direction-cue">LT RT</span> LEAGUE
            </>
          )}
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
