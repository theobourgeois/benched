import { useState } from 'react';
import type { Club } from '../game/clubs';
import { runtime, useGame } from '../game/store';
import type { GameMode, Jersey, Team } from '../game/types';
import { step, useNav } from '../input/menuNavigation';
import { ControlsScreen } from './Controls';
import { Brand, MenuItem, Prompts } from './kit';
import { SettingsScreen } from './Settings';
import { TeamSelect } from './TeamSelect';

type Entry = GameMode | 'settings' | 'controls' | 'lab';
const ENTRIES: { id: Entry; label: string }[] = [
  { id: 'exhibition', label: 'Play Now' },
  { id: 'threeOnThree', label: '3 on 3' },
  { id: 'oneOnOne', label: '1 on 1' },
  { id: 'shootout', label: 'Shootout' },
  { id: 'freeSkate', label: 'Free Skate' },
  { id: 'settings', label: 'Settings' },
  { id: 'controls', label: 'Controls' },
  ...(import.meta.env.DEV ? [{ id: 'lab' as const, label: 'Animation Lab' }] : []),
];
type Screen = 'main' | 'teams' | 'settings' | 'controls';

export function Menu() {
  const { match } = useGame();
  const [screen, setScreen] = useState<Screen>('main');
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<GameMode>('exhibition');
  // The matchup outlives the screens, so backing out to change modes keeps your picks.
  const [teams, setTeams] = useState<[Club, Club]>(match.teams);
  const [side, setSide] = useState<Team>(runtime.myTeam);
  const [jersey, setJersey] = useState<Jersey>(match.jerseys[runtime.myTeam]);
  const pick = (id: Entry) => {
    if (id === 'settings' || id === 'controls') return setScreen(id);
    if (id === 'lab') return void import('../dev/lab').then((m) => m.openLab());
    setMode(id);
    setScreen('teams');
  };
  const home = () => setScreen('main');
  return (
    <div className="menu" data-screen={screen}>
      {screen === 'main' && <MainMenu index={index} setIndex={setIndex} onPick={pick} />}
      {screen === 'teams' && (
        <TeamSelect
          mode={mode}
          teams={teams}
          setTeams={setTeams}
          side={side}
          setSide={setSide}
          jersey={jersey}
          setJersey={setJersey}
          onBack={home}
        />
      )}
      {screen === 'settings' && <SettingsScreen crumb="Main Menu" onClose={home} />}
      {screen === 'controls' && <ControlsScreen crumb="Main Menu" onClose={home} />}
    </div>
  );
}

function MainMenu({
  index,
  setIndex,
  onPick,
}: {
  index: number;
  setIndex: (i: number) => void;
  onPick: (id: Entry) => void;
}) {
  useNav((a) => {
    if (a === 'up' || a === 'down') setIndex(step(index, a === 'up' ? -1 : 1, ENTRIES.length));
    else if (a === 'confirm' || a === 'start') onPick(ENTRIES[index].id);
  });
  return (
    <div className="screen main-menu">
      <div className="main-column">
        <Brand />
        <nav className="plate menu-list" aria-label="Main menu">
          {ENTRIES.map((entry, i) => (
            <MenuItem
              key={entry.id}
              focused={i === index}
              onFocus={() => setIndex(i)}
              onSelect={() => onPick(entry.id)}
              className={entry.id === 'settings' ? 'gap' : ''}
            >
              {entry.label}
            </MenuItem>
          ))}
        </nav>
      </div>
      <Prompts
        items={[{ k: 'confirm', label: 'Select', onClick: () => onPick(ENTRIES[index].id) }]}
      />
    </div>
  );
}
