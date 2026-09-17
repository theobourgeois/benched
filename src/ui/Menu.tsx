import { useState } from 'react';
import type { Club } from '../game/clubs';
import { runtime, useGame } from '../app/store';
import type { GameMode, Jersey, Team } from '../game/types';
import { step, useNav } from '../input/menuNavigation';
import { ControlsScreen } from './Controls';
import { Brand, MenuItem, Prompts } from './kit';
import { SettingsScreen } from './Settings';
import { TeamSelect } from './TeamSelect';
import { OnlineScreen } from './Online';
import { normaliseCode } from '../net/protocol';

/**
 * Invites are a query string rather than a path, because the game is a static build with no
 * server to rewrite deep links: `/play/7K2M` would simply be a missing file.
 */
function inviteCode() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('join');
  const code = raw ? normaliseCode(raw) : '';
  // Consume it. Left in the address bar, quitting to the menu would walk straight back in.
  if (raw !== null) {
    params.delete('join');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
  }
  return code.length === 4 ? code : '';
}

type Entry = GameMode | 'twoPlayer' | 'online' | 'settings' | 'controls' | 'lab';
const ENTRIES: { id: Entry; label: string }[] = [
  { id: 'exhibition', label: 'Play Now' },
  { id: 'twoPlayer', label: '2 Players' },
  { id: 'online', label: 'Online' },
  { id: 'threeOnThree', label: '3 on 3' },
  { id: 'oneOnOne', label: '1 on 1' },
  { id: 'shootout', label: 'Shootout' },
  { id: 'freeSkate', label: 'Free Skate' },
  { id: 'settings', label: 'Settings' },
  { id: 'controls', label: 'Controls' },
  ...(import.meta.env.DEV ? [{ id: 'lab' as const, label: 'Animation Lab' }] : []),
];
type Screen = 'main' | 'teams' | 'online' | 'settings' | 'controls';

export function Menu() {
  const { match } = useGame();
  // An invite link lands straight in the room rather than on the main menu.
  const [invite] = useState(() => inviteCode());
  // So does coming back off the ice from a match the room called off: the room is still open.
  const [screen, setScreen] = useState<Screen>(
    invite || (runtime.net && !runtime.net.setup) ? 'online' : 'main',
  );
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<GameMode>('exhibition');
  /** A second person on the other bench, sharing the screen. */
  const [guests, setGuests] = useState(false);
  // The matchup outlives the screens, so backing out to change modes keeps your picks.
  const [teams, setTeams] = useState<[Club, Club]>(match.teams);
  const [side, setSide] = useState<Team>(runtime.myTeam);
  const [jersey, setJersey] = useState<Jersey>(match.jerseys[runtime.myTeam]);
  const pick = (id: Entry) => {
    if (id === 'settings' || id === 'controls' || id === 'online') return setScreen(id);
    // Guarded so the lab is not even a chunk in a production build.
    if (id === 'lab') {
      if (import.meta.env.DEV) void import('../dev/lab').then((m) => m.openLab());
      return;
    }
    setGuests(id === 'twoPlayer');
    setMode(id === 'twoPlayer' ? 'exhibition' : id);
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
          guests={guests}
          onBack={home}
        />
      )}
      {screen === 'online' && <OnlineScreen join={invite} onBack={home} />}
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
