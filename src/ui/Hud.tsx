import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Gamepad2,
  HelpCircle,
  History,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import { attackDirection } from '../game/config';
import { difficultyInfo } from '../game/difficulty';
import { modeInfo } from '../game/modes';
import {
  beginGame,
  canInstantReplay,
  continueGame,
  openInstantReplay,
  pauseGame,
  returnToMenu,
  updateSettings,
  useGame,
} from '../game/store';
import { cameraUsesAttackUp } from '../game/types';
import { Brand, SettingsPanel, TeamLogo } from './Menu';
import { Controls } from './Controls';
import { FeelHud } from './FeelHud';
import { FpsCounter } from './FpsCounter';
export function formatClock(seconds: number) {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function periodMark(period: number) {
  if (period === 1) return '1ST';
  if (period === 2) return '2ND';
  if (period === 3) return '3RD';
  return `${period}TH`;
}
function shootoutMark(round: number) {
  return round > 3 ? 'SD' : `RND ${round}`;
}
export function Hud() {
  const { match: s, settings, controller } = useGame();
  const [controls, setControls] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [feel, setFeel] = useState(false);
  const player = s.skaters[s.controlled],
    team = s.teams[s.homeTeam],
    dir = attackDirection(s.homeTeam, s.period);
  const info = modeInfo(s.mode);
  const practice = info.practice;
  const openControls = () => {
    if (s.phase !== 'paused') pauseGame();
    setControls(true);
  };
  return (
    <div className="hud">
      <FpsCounter />
      <header className="game-header">
        <Brand small />
        <div className="scoreboard">
          {practice ? (
            <div className="score-clock practice">
              <strong>SKATE</strong>
              <small>{s.phase === 'playing' ? '● LIVE' : s.phase.toUpperCase()}</small>
            </div>
          ) : (
            <>
              {s.teams.map((t, i) => (
                <div key={i} className={`score-team score-team-${i}`}>
                  <TeamLogo club={t} small />
                  <span>{t.abbr}</span>
                  <strong>{s.score[i]}</strong>
                  <i style={{ background: t.accent }} />
                </div>
              ))}
              <div className="score-clock">
                <span>
                  {s.mode === 'shootout' ? shootoutMark(s.shootoutRound) : periodMark(s.period)}
                </span>
                <strong>{formatClock(s.clock)}</strong>
                <small>{s.phase === 'playing' ? '● LIVE' : s.phase.toUpperCase()}</small>
              </div>
            </>
          )}
        </div>
        <div className="game-actions">
          <button className="icon-button" onClick={openControls} aria-label="Show controls">
            <HelpCircle size={19} />
          </button>
          <button
            className="icon-button"
            onClick={() => updateSettings({ sound: !settings.sound })}
            aria-label={settings.sound ? 'Mute sound' : 'Enable sound'}
          >
            {settings.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="icon-button"
            onClick={pauseGame}
            aria-label={s.phase === 'paused' ? 'Resume game' : 'Pause game'}
          >
            {s.phase === 'paused' ? <Play size={19} /> : <Pause size={19} />}
          </button>
          <button
            className={`icon-button ${feel ? 'active' : ''}`}
            onClick={() => setFeel((open) => !open)}
            aria-label={feel ? 'Hide feel tuner' : 'Show feel tuner'}
            title="Feel tuner (`)"
          >
            <SlidersHorizontal size={19} />
          </button>
        </div>
      </header>
      <div className="match-info">
        <span>NORTHSTAR ARENA</span>
        <span>{info.live}</span>
        <span>{difficultyInfo(s.difficulty).label.toUpperCase()}</span>
      </div>
      {s.phase === 'playing' && (
        <>
          <div className="attack-label">
            {s.mode === 'shootout' && player.role === 'G' ? (
              <>
                <ArrowUp size={15} /> THEIR SHOT
              </>
            ) : cameraUsesAttackUp(settings.camera) ? (
              <>
                <ArrowUp size={15} /> ATTACK
              </>
            ) : (
              <>
                {dir < 0 && <ArrowRight className="reverse" size={15} />} ATTACK{' '}
                {dir > 0 && <ArrowRight size={15} />}
              </>
            )}
          </div>
          {s.noticeTimer > 0 && (
            <div className="play-notice" key={s.notice}>
              {s.notice}
            </div>
          )}
        </>
      )}
      <footer className="game-footer">
        <div className="player-card">
          <span className="player-number" style={{ color: team.accent }}>
            {player.number}
          </span>
          <div>
            <small>
              {team.abbr} / {player.role} <span>YOU</span>
            </small>
            <strong>{player.name.toUpperCase()}</strong>
            <div className="stamina-track">
              <i
                style={{
                  width: `${player.stamina * 100}%`,
                  background: player.stamina < 0.25 ? '#fa644f' : team.accent,
                }}
              />
            </div>
          </div>
          <span className="possession-tag">
            {player.downTimer > 0
              ? 'RECOVERING'
              : player.diveTimer > 0
                ? 'DIVE'
                : player.stumbleTimer > 0
                  ? 'OFF BALANCE'
                  : s.puck.owner === s.controlled
                    ? 'PUCK'
                    : player.blockTimer > 0
                      ? 'BLOCK'
                      : player.role}
          </span>
        </div>
        {s.shotCharge > 0.05 && (
          <div className="shot-meter">
            <span>SHOT POWER</span>
            <div>
              <i style={{ width: `${s.shotCharge * 100}%` }} />
            </div>
          </div>
        )}
        <div className="ingame-controls">
          {s.puck.owner === s.controlled ? (
            <>
              <span>
                <kbd>{controller.status.connected ? 'LS AIM + RS ↑' : 'WASD + ↑'}</kbd> SHOOT
              </span>
              <span>
                <kbd>{controller.status.connected ? 'RB + RS' : 'E + ↑'}</kbd> CHIP / DUMP
              </span>
              <span>
                <kbd>{controller.status.connected ? 'TAP RB' : 'TAP E'}</kbd> SAUCER
              </span>
              <span>
                <kbd>{controller.status.connected ? 'HOLD RT' : 'HOLD SPACE'}</kbd> PASS
              </span>
              <span>
                <kbd>{controller.status.connected ? 'RS CLICK + ↓' : 'C + ↓'}</kbd> TOE DRAG
              </span>
            </>
          ) : (
            <>
              <span>
                <kbd>{controller.status.connected ? 'RB' : 'E'}</kbd> POKE
              </span>
              <span>
                <kbd>{controller.status.connected ? 'LB + RB' : 'R + E / F'}</kbd> DIVE
              </span>
              <span>
                <kbd>{controller.status.connected ? 'RS FLICK' : 'ARROWS'}</kbd> HIT
              </span>
              <span>
                <kbd>{controller.status.connected ? 'A' : 'Q'}</kbd> STICK LIFT / SWITCH
              </span>
              <span>
                <kbd>{controller.status.connected ? 'HOLD RT' : 'HOLD SPACE'}</kbd> SWITCH
              </span>
            </>
          )}
        </div>
      </footer>
      {s.phase === 'faceoff' && (
        <div className="faceoff-overlay">
          <span className="eyebrow">PERIOD {s.period} / GET READY</span>
          <strong key={Math.ceil(s.countdown)}>{Math.ceil(s.countdown) || 1}</strong>
          <span>{s.countdown < 0.5 ? 'DRAW NOW' : 'FACEOFF'}</span>
          <small>
            {controller.status.connected ? 'RT or RB' : 'Space or E'} as the puck drops to win the
            draw
          </small>
        </div>
      )}
      {s.phase === 'goal' && (
        <div className={`goal-overlay goal-team-${s.scoringTeam}`}>
          <span className="eyebrow">
            {practice
              ? info.eyebrow
              : s.scoringTeam === null
                ? info.eyebrow
                : `${s.teams[s.scoringTeam].city} ${s.teams[s.scoringTeam].name}`}
          </span>
          <strong>{s.scoringTeam === null ? s.notice || 'NO GOAL' : 'GOAL'}</strong>
          {!practice && (
            <div>
              {s.score[0]} <span>—</span> {s.score[1]}
            </div>
          )}
          <span>{s.mode === 'shootout' ? 'NEXT SHOOTER' : 'BACK TO CENTER ICE'}</span>
        </div>
      )}
      {s.phase === 'paused' && !controls && !showSettings && !feel && (
        <div className="modal-scrim">
          <section className="pause-modal" role="dialog" aria-modal="true" aria-label="Game paused">
            <div className="eyebrow">
              {info.eyebrow} / {difficultyInfo(s.difficulty).label.toUpperCase()}
            </div>
            <h2>Paused</h2>
            <p>
              {controller.status.connected
                ? 'Controller connected.'
                : 'Playing on keyboard. Connect a controller and press any button to use it.'}
            </p>
            <button className="primary-button" onClick={pauseGame}>
              {info.resume} <Play size={18} fill="currentColor" />
            </button>
            <button
              className="secondary-button"
              onClick={openInstantReplay}
              disabled={!canInstantReplay()}
            >
              <History size={18} /> Instant replay <ArrowUpRight size={16} />
            </button>
            <button className="secondary-button" onClick={() => setControls(true)}>
              <Gamepad2 size={18} /> Skill-stick controls <ArrowUpRight size={16} />
            </button>
            <button className="secondary-button" onClick={() => setShowSettings(true)}>
              <Settings2 size={18} /> Game settings <ArrowUpRight size={16} />
            </button>
            <button className="secondary-button" onClick={() => setFeel(true)}>
              <SlidersHorizontal size={18} /> Feel tuner <ArrowUpRight size={16} />
            </button>
            <button className="text-button" onClick={returnToMenu}>
              {info.endMatch}
            </button>
          </section>
        </div>
      )}
      {(s.phase === 'intermission' || s.phase === 'final') && (
        <div className="modal-scrim">
          <section
            className="results-modal"
            role="dialog"
            aria-modal="true"
            aria-label={s.phase === 'final' ? 'Final results' : 'Intermission'}
          >
            <div className="eyebrow">
              {s.phase === 'final' ? 'FINAL' : `END OF THE ${s.period === 1 ? 'FIRST' : 'SECOND'}`}
            </div>
            <h2>
              {s.phase === 'final'
                ? s.score[0] === s.score[1]
                  ? 'Draw'
                  : s.score[s.homeTeam] > s.score[1 - s.homeTeam]
                    ? 'You win'
                    : 'You lose'
                : 'Intermission'}
            </h2>
            <div className="results-score">
              <TeamLogo club={s.teams[0]} />
              <strong>
                {s.score[0]} <span>:</span> {s.score[1]}
              </strong>
              <TeamLogo club={s.teams[1]} />
            </div>
            <div className="stats-table">
              <div>
                <b>{s.teams[0].abbr}</b>
                <span>TEAM STATS</span>
                <b>{s.teams[1].abbr}</b>
              </div>
              <div>
                <strong>{s.shots[0]}</strong>
                <span>SHOTS</span>
                <strong>{s.shots[1]}</strong>
              </div>
              <div>
                <strong>{s.hits[0]}</strong>
                <span>HITS</span>
                <strong>{s.hits[1]}</strong>
              </div>
              <div>
                <strong>{Math.round(s.possession[0])}s</strong>
                <span>POSSESSION</span>
                <strong>{Math.round(s.possession[1])}s</strong>
              </div>
            </div>
            <p>
              {s.phase === 'intermission'
                ? `Switching ends. A fresh ${Math.round(info.periodSeconds / 60)} minutes on the clock.`
                : s.mode === 'shootout'
                  ? 'Best of three, then sudden death.'
                  : ''}
            </p>
            <button
              className="primary-button"
              onClick={() => (s.phase === 'final' ? beginGame(s.homeTeam, s.mode) : continueGame())}
            >
              {s.phase === 'final' ? 'REMATCH' : `START PERIOD ${s.period + 1}`}
              {s.phase === 'final' ? <RotateCcw size={18} /> : <ArrowRight size={18} />}
            </button>
            <button className="text-button" onClick={returnToMenu}>
              Return to menu
            </button>
          </section>
        </div>
      )}
      {controls && <Controls close={() => setControls(false)} />}
      {showSettings && <SettingsPanel close={() => setShowSettings(false)} />}
      <FeelHud open={feel} onOpenChange={setFeel} />
    </div>
  );
}
