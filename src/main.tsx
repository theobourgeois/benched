import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { GameScene } from './scene/GameScene';
import { Menu } from './ui/Menu';
import { Hud } from './ui/Hud';
import { ReplayHud } from './ui/ReplayHud';
import { useGame, runtime, publish, beginGame } from './game/store';
import { bootFeel, resetFeel } from './game/feel';
import { PHYSICS, STICK } from './game/config';
import { labHooks } from './scene/animationReview';
import './style.css';
bootFeel();
/** Dev-only animation lab. Open it from the main menu or with ?lab (or ?lab=<clip>). */
const AnimLab = import.meta.env.DEV
  ? lazy(() => import('./ui/AnimLab').then((m) => ({ default: m.AnimLab })))
  : null;
if (import.meta.env.DEV) {
  Object.assign(window, {
    __BENCHED__: { runtime, publish, beginGame, PHYSICS, STICK, resetFeel },
  });
  if (new URLSearchParams(location.search).has('lab'))
    void import('./dev/lab').then((m) => m.openLabFromUrl());
}
function App() {
  const { match, replay } = useGame();
  if (AnimLab && labHooks.active)
    return (
      <>
        <GameScene />
        <Suspense fallback={null}>
          <AnimLab />
        </Suspense>
      </>
    );
  return (
    <>
      <GameScene />
      {match.phase === 'menu' ? <Menu /> : replay ? <ReplayHud /> : <Hud />}
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
