import { Gamepad2, X } from 'lucide-react';
import { publish, useGame } from '../game/store';
import type { ControllerLayout } from '../input/gamepads';
import { useDialog } from './useDialog';
const LABELS = [
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
export function ControllerSetup({ close }: { close: () => void }) {
  const dialog = useDialog(close),
    { controller } = useGame(),
    status = controller.status;
  return (
    <div className="modal-scrim" onClick={close}>
      <section
        ref={dialog}
        data-controller-test
        data-block-game-input
        className="settings-modal controller-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="controller-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="icon-button modal-close"
          onClick={close}
          aria-label="Close controller setup"
        >
          <X size={20} />
        </button>
        <div className="eyebrow">GET CONNECTED</div>
        <h2 id="controller-title">Your controller. Live.</h2>
        <p className="controller-instructions">
          Keep this tab active and press <b>A</b> on your Xbox controller. Bluetooth pairing alone
          doesn’t tell us whether the browser can see it.
        </p>
        <div className={`controller-status ${status.connected ? 'connected' : ''}`} role="status">
          <Gamepad2 size={22} />
          <div>
            <strong>{status.name}</strong>
            <span>{status.detail}</span>
          </div>
        </div>
        {status.connected && (
          <p className="connection-note">
            {status.mapping} · Press B to close this test. Other buttons only light the indicators
            below.
          </p>
        )}
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
              <span>{i ? 'RIGHT STICK' : 'LEFT STICK'}</span>
            </div>
          ))}
        </div>
        <div className="button-tests">
          {LABELS.map((label, i) => (
            <span
              key={label}
              className={(status.buttons[i] ?? 0) > 0.5 ? 'pressed' : ''}
              aria-label={`${label} ${(status.buttons[i] ?? 0) > 0.5 ? 'pressed' : 'released'}`}
            >
              {label}
            </span>
          ))}
        </div>
        {status.axes.length > 4 && (
          <p className="connection-note">
            Raw axes: {status.axes.map((n) => n.toFixed(2)).join(' / ')}
          </p>
        )}
        <label htmlFor="controller-layout">
          Controller layout
          <select
            id="controller-layout"
            value={controller.layout}
            onChange={(e) => {
              controller.layout = e.target.value as ControllerLayout;
              controller.refresh();
              publish();
            }}
          >
            <option value="auto">Automatic</option>
            <option value="xbox">Xbox compatibility</option>
          </select>
        </label>
        <p className="connection-note">
          Xbox compatibility uses the usual four-axis Xbox layout when the browser omits its label.
          Check both sticks and triggers above before playing.
        </p>
        {!status.connected && (
          <div className="controller-help">
            <strong>Still no input in Arc?</strong>
            <ol>
              <li>Click inside this tab, then press a face button on the controller.</li>
              <li>Open the game directly on localhost or HTTPS, outside an embedded preview.</li>
              <li>
                If the browser still sees nothing, try the same address in Chrome or reconnect the
                controller by USB.
              </li>
            </ol>
            <button
              className="secondary-button"
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
    </div>
  );
}
