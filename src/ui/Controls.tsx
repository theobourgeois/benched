import { ArrowDown, ArrowUp, Gamepad2, Keyboard, X } from 'lucide-react';
import { useState } from 'react';
import { ControllerSetup } from './ControllerSetup';
import { useDialog } from './useDialog';
export function ControllerDiagram() {
  return (
    <svg
      className="controller-diagram"
      viewBox="0 0 420 260"
      fill="none"
      aria-label="Xbox controller with left stick for skating and aiming, right stick for shooting"
    >
      <path
        d="M103 57C84 52 69 72 61 99L30 207C22 237 46 251 64 232L120 184H298L354 232C373 251 398 235 389 208L359 102C351 73 337 54 315 57L267 65H151Z"
        fill="#1c2d31"
        stroke="#506366"
        strokeWidth="2"
      />
      <path
        d="M97 49L103 36H152L156 58M268 58L272 36H320L326 49"
        stroke="#9caeaa"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <circle cx="122" cy="105" r="33" fill="#0c1c20" stroke="#d5fa64" strokeWidth="2" />
      <circle cx="122" cy="105" r="23" fill="#344444" />
      <circle cx="260" cy="159" r="33" fill="#0c1c20" stroke="#d5fa64" strokeWidth="2" />
      <circle cx="260" cy="159" r="23" fill="#344444" />
      <path d="M161 143H177V158H191V174H177V188H161V174H147V158H161Z" fill="#48585a" />
      <circle cx="310" cy="88" r="10" stroke="#cbbc59" strokeWidth="2" />
      <circle cx="333" cy="112" r="10" stroke="#d47164" strokeWidth="2" />
      <circle cx="287" cy="112" r="10" stroke="#6f9fc1" strokeWidth="2" />
      <circle cx="310" cy="136" r="10" stroke="#93b96c" strokeWidth="2" />
      <circle cx="210" cy="83" r="12" fill="#60716a" />
      <circle cx="186" cy="114" r="6" fill="#71827e" />
      <circle cx="234" cy="114" r="6" fill="#71827e" />
      <path
        d="M122 96V114M113 105H131M260 148V170M254 154L260 148L266 154"
        stroke="#d5fa64"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text x="108" y="26" fill="#acbcb9" fontSize="11" fontFamily="monospace">
        LT / BACKSKATE
      </text>
      <text x="266" y="26" fill="#acbcb9" fontSize="11" fontFamily="monospace">
        RT / PASS
      </text>
    </svg>
  );
}
export function Controls({ close }: { close: () => void }) {
  const [setup, setSetup] = useState(false);
  const dialog = useDialog(() => (setup ? setSetup(false) : close()));
  const [keyboard, setKeyboard] = useState(false);
  const rows = keyboard
    ? [
        ['W A S D', 'Skate & aim any corner / passes'],
        ['← / →', 'Forehand / backhand deke'],
        ['HOLD E + A / D', 'One-touch stride deke'],
        ['HOLD E + W / S', 'Burst ahead / protect'],
        ['HOLD E + ↑ / ↓', 'Jump deke / through the legs'],
        ['TAP E while ← / →', 'Windmill deke'],
        ['HOLD E + CTRL', 'Spin-o-rama'],
        ['↑', 'Flick for a wrist shot'],
        ['↓ then ↑', 'Wind up, then slap shot'],
        ['HOLD R', 'Lock top shelf'],
        ['HOLD C + ↓', 'Toe drag; ← / → to move the puck'],
        ['SPACE', 'Hold to aim a pass, release to send / switch on defense'],
        ['TAP E', 'Saucer pass with the puck / poke check without it'],
        ['HOLD E + ← / →', 'Chip / dump the puck; near the net it is a chip-in'],
        ['R + E or F', 'Dive to block a shot or pass'],
        ['ARROWS without puck', 'Body check in that direction'],
        ['Q next to a carrier', 'Stick lift; otherwise switch skater'],
        ['SHIFT / CTRL', 'Hustle / backskate'],
        ['ESC', 'Pause'],
        ['SPACE or E on drop', 'Win the faceoff'],
      ]
    : [
        ['LEFT STICK', 'Skate & aim any corner / passes'],
        ['RIGHT STICK ← →', 'Forehand / backhand deke'],
        ['HOLD RB + LS', 'One-touch dekes: ←/→ stride, ↑ burst, ↓ protect'],
        ['HOLD RB + RS ↑ / ↓', 'Jump deke / through the legs'],
        ['TAP RB with RS ← →', 'Windmill deke'],
        ['HOLD RB + LT', 'Spin-o-rama'],
        ['RIGHT STICK ↑', 'Flick for a wrist shot'],
        ['RIGHT STICK ↓ ↑', 'Wind up, then slap shot'],
        ['LEFT STICK AIM', 'Point at the corner you want — the whole net'],
        ['RS CLICK + RS ↓', 'Toe drag (or roll RS sideways → down)'],
        ['RT', 'Hold to aim a pass, release to send / switch on defense'],
        ['TAP RB', 'Saucer pass with the puck / poke check without it'],
        ['HOLD RB + RS ← →', 'Chip / dump; near the net it is a chip-in'],
        ['LB + RB', 'Dive / block when you do not have the puck'],
        ['RS without puck', 'Body check in the stick direction'],
        ['A next to a carrier', 'Stick lift; otherwise switch skater'],
        ['LB / LT', 'Top shelf with the puck / block or backskate'],
        ['LS CLICK', 'Hustle'],
        ['MENU', 'Pause'],
        ['RT or RB on drop', 'Win the faceoff'],
      ];
  if (setup) return <ControllerSetup close={() => setSetup(false)} />;
  return (
    <div className="modal-scrim" onClick={close}>
      <section
        ref={dialog}
        data-block-game-input
        className="controls-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="controls-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-button modal-close" onClick={close} aria-label="Close controls">
          <X size={20} />
        </button>
        <div className="eyebrow">HOW TO PLAY</div>
        <h2 id="controls-title">Controls</h2>
        <div className="control-tabs">
          <button className={!keyboard ? 'active' : ''} onClick={() => setKeyboard(false)}>
            <Gamepad2 size={16} /> Controller
          </button>
          <button className={keyboard ? 'active' : ''} onClick={() => setKeyboard(true)}>
            <Keyboard size={16} /> Keyboard
          </button>
        </div>
        {!keyboard && <ControllerDiagram />}
        <div className="control-rows">
          {rows.map(([key, label]) => (
            <div key={key}>
              <kbd>{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="control-tip">
          <ArrowDown size={17} />
          <ArrowUp size={17} />
          <p>
            Pull back to wind up, then flick the skill stick at the net. Aim with the left stick
            like NHL: the stick is a pointer on the net, so up-left is the top corner, down-right is
            the far post on the ice. Hold RT (Space) to pass. With the puck, tap RB (E) for a
            saucer, hold it and cut with the left stick to one-touch deke, or flick RS sideways to
            chip / dump. Without it, RB pokes, RS throws a hit, and both bumpers dive.
          </p>
        </div>
        {!keyboard && (
          <p className="connection-note">
            Connect your Xbox controller by USB or Bluetooth, then press any button. Keep this tab
            focused. Use the live input test below if it is not responding. Rumble depends on your
            browser.
          </p>
        )}
        {!keyboard && (
          <button className="secondary-button" onClick={() => setSetup(true)}>
            <Gamepad2 size={16} /> Connect / test controller
          </button>
        )}
        <button className="primary-button" onClick={close}>
          Done <ArrowUp size={18} className="diagonal-arrow" />
        </button>
      </section>
    </div>
  );
}
