import { pauseGame, runtime } from '../game/store';
/** Standard controller navigation lets a full match run without mouse interaction. */
export function navigateWithController() {
  const { controller, match } = runtime,
    ui = controller.ui;
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog?.hasAttribute('data-controller-test')) {
    if (ui.back) dialog.querySelector<HTMLButtonElement>('.modal-close')?.click();
    return true;
  }
  if (dialog) {
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button, select'));
    if (ui.back) {
      const close = dialog.querySelector<HTMLButtonElement>('.modal-close');
      if (close) close.click();
      else if (match.phase === 'paused') pauseGame();
    }
    if (ui.up || ui.down || ui.left || ui.right) {
      const current = items.indexOf(document.activeElement as HTMLElement),
        direction = ui.up || ui.left ? -1 : 1;
      const active = document.activeElement;
      if (active instanceof HTMLSelectElement && (ui.left || ui.right)) {
        active.selectedIndex =
          (active.selectedIndex + direction + active.options.length) % active.options.length;
        active.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const index = current < 0 ? 0 : (current + direction + items.length) % items.length;
        document.querySelector('.controller-focus')?.classList.remove('controller-focus');
        items[index]?.focus();
        items[index]?.classList.add('controller-focus');
      }
    }
    if (ui.confirm || ui.menu) {
      if (ui.menu && match.phase === 'paused' && !dialog.hasAttribute('data-block-game-input'))
        pauseGame();
      else {
        const focused = document.activeElement;
        const target =
          focused instanceof HTMLButtonElement && dialog.contains(focused)
            ? focused
            : dialog.querySelector<HTMLButtonElement>('.primary-button');
        target?.click();
      }
    }
    return Object.values(ui).some(Boolean);
  }
  if (match.phase === 'menu') {
    if (ui.prevMode || ui.nextMode) {
      const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-tab'));
      const selected = tabs.findIndex((t) => t.classList.contains('nav-active'));
      tabs[(selected + (ui.prevMode ? -1 : 1) + tabs.length) % tabs.length]?.click();
    }
    if (ui.left || ui.right) {
      const teams = Array.from(document.querySelectorAll<HTMLButtonElement>('.team-option'));
      const selected = teams.findIndex((t) => t.getAttribute('aria-pressed') === 'true');
      teams[(selected + 1) % teams.length]?.click();
    }
    if (ui.up || ui.down) {
      const slot = document
        .querySelector('.team-option[aria-pressed="true"]')
        ?.closest('.matchup-slot');
      slot
        ?.querySelector<HTMLButtonElement>(ui.up ? '.club-cycle.prev' : '.club-cycle.next')
        ?.click();
    }
    if (ui.prevLeague || ui.nextLeague) {
      const leagues = Array.from(document.querySelectorAll<HTMLButtonElement>('.league-option'));
      const selected = leagues.findIndex((l) => l.getAttribute('aria-pressed') === 'true');
      const step = ui.prevLeague ? -1 : 1;
      leagues[(selected + step + leagues.length) % leagues.length]?.click();
    }
    if (ui.confirm || ui.menu) document.querySelector<HTMLButtonElement>('.play-button')?.click();
    return true;
  }
  return false;
}
