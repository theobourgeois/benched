import { useRef, useState } from 'react';
import { useDevice, useNav, type Device } from '../input/menuNavigation';
import { KeyChip, Prompts, TitleBar } from './kit';

/** Keys are space-separated; lowercase words and joiners read as text, the rest as buttons. */
type Group = { title: string; rows: [keys: string, action: string][] };

const PAD: Group[] = [
  {
    title: 'Skating',
    rows: [
      ['LS', 'Skate'],
      ['hold LS click', 'Hustle'],
      ['LT', 'Backskate'],
      ['A', 'Switch skater'],
      ['☰', 'Pause'],
    ],
  },
  {
    title: 'Shooting',
    rows: [
      ['RS ↑', 'Wrist shot'],
      ['RS ↓ then ↑', 'Slap shot'],
      ['LS', 'Aim — any corner'],
      ['hold LB', 'Top shelf'],
    ],
  },
  {
    title: 'Passing',
    rows: [
      ['hold RT', 'Aim pass, release to send'],
      ['tap RB', 'Saucer pass'],
      ['hold RB + RS ← →', 'Chip / dump'],
    ],
  },
  {
    title: 'Dekes',
    rows: [
      ['RS ← →', 'Forehand / backhand'],
      ['hold RB + LS', 'One-touch deke'],
      ['hold RB + RS ↑', 'Jump deke'],
      ['hold RB + RS ↓', 'Between the legs'],
      ['tap RB + RS ← →', 'Windmill'],
      ['hold RB + LT', 'Spin-o-rama'],
      ['RS click + RS ↓', 'Toe drag'],
    ],
  },
  {
    title: 'Defense',
    rows: [
      ['RS ↑', 'Body check'],
      ['RS ↓ then ↑', 'Loaded check'],
      ['RB', 'Poke check'],
      ['LB + RB', 'Dive block'],
      ['hold LB', 'Block the lane'],
      ['A', 'Stick lift, next to a carrier'],
      ['RT', 'Switch skater'],
    ],
  },
  { title: 'Faceoffs', rows: [['RT / RB', 'Win the draw as the puck drops']] },
];

const KEYBOARD: Group[] = [
  {
    title: 'Skating',
    rows: [
      ['W A S D', 'Skate'],
      ['Shift', 'Hustle'],
      ['Ctrl', 'Backskate'],
      ['Q', 'Switch skater'],
      ['Esc', 'Pause'],
    ],
  },
  {
    title: 'Shooting',
    rows: [
      ['↑', 'Wrist shot'],
      ['↓ then ↑', 'Slap shot'],
      ['W A S D', 'Aim — any corner'],
      ['hold R', 'Top shelf'],
    ],
  },
  {
    title: 'Passing',
    rows: [
      ['hold Space', 'Aim pass, release to send'],
      ['tap E', 'Saucer pass'],
      ['hold E + ← →', 'Chip / dump'],
    ],
  },
  {
    title: 'Dekes',
    rows: [
      ['← →', 'Forehand / backhand'],
      ['hold E + W A S D', 'One-touch deke'],
      ['hold E + ↑', 'Jump deke'],
      ['hold E + ↓', 'Between the legs'],
      ['tap E + ← →', 'Windmill'],
      ['hold E + Ctrl', 'Spin-o-rama'],
      ['hold C + ↓', 'Toe drag'],
    ],
  },
  {
    title: 'Defense',
    rows: [
      ['↑', 'Body check'],
      ['↓ then ↑', 'Loaded check'],
      ['E', 'Poke check'],
      ['F', 'Dive block'],
      ['hold R', 'Block the lane'],
      ['Q', 'Stick lift, next to a carrier'],
      ['Space', 'Switch skater'],
    ],
  },
  { title: 'Faceoffs', rows: [['Space / E', 'Win the draw as the puck drops']] },
];

const isWord = (token: string) => /^([a-z]+|[+/])$/.test(token);

export function ControlsScreen({ crumb, onClose }: { crumb: string; onClose: () => void }) {
  const device = useDevice();
  const [tab, setTab] = useState<Device>(device);
  const list = useRef<HTMLDivElement>(null);
  const flip = () => setTab((t) => (t === 'pad' ? 'keys' : 'pad'));
  useNav((a) => {
    if (a === 'back' || a === 'start' || a === 'confirm') onClose();
    else if (a === 'lb' || a === 'rb' || a === 'left' || a === 'right') flip();
    else if (a === 'up' || a === 'down')
      list.current?.scrollBy({ top: a === 'up' ? -160 : 160, behavior: 'smooth' });
  });
  return (
    <div className="screen controls-screen">
      <div className="stage-frame">
        <TitleBar crumb={crumb} title="Controls">
          <div className="tabs" role="tablist" aria-label="Input">
            {(['pad', 'keys'] as Device[]).map((d) => (
              <button key={d} role="tab" aria-selected={tab === d} onClick={() => setTab(d)}>
                {d === 'pad' ? 'Controller' : 'Keyboard'}
              </button>
            ))}
          </div>
        </TitleBar>
        <div className="plate controls-list" ref={list}>
          {(tab === 'pad' ? PAD : KEYBOARD).map((group) => (
            <section key={group.title} className="control-group">
              <h2>{group.title}</h2>
              {group.rows.map(([keys, action]) => (
                <div key={keys + action} className="control-row">
                  <span className="control-keys">
                    {keys.split(' ').map((token, i) =>
                      isWord(token) ? (
                        <span key={i} className="kw">
                          {token}
                        </span>
                      ) : (
                        <KeyChip key={i} label={token} device={tab} />
                      ),
                    )}
                  </span>
                  <span className="control-action">{action}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      <Prompts
        items={[
          { k: 'leftright', label: tab === 'pad' ? 'Keyboard' : 'Controller', onClick: flip },
          { k: 'updown', label: 'Scroll' },
          { k: 'back', label: 'Back', onClick: onClose },
        ]}
      />
    </div>
  );
}
