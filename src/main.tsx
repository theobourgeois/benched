import React from 'react';
import ReactDOM from 'react-dom/client';
import { GameScene } from './scene/GameScene';
import { Menu } from './ui/Menu';
import { Hud } from './ui/Hud';
import { ReplayHud } from './ui/ReplayHud';
import { useGame, runtime, publish, beginGame } from './game/store';
import { bootFeel, resetFeel } from './game/feel';
import { PHYSICS, STICK } from './game/config';
import './style.css';
bootFeel();
if (import.meta.env.DEV)
  Object.assign(window, {
    __BENCHED__: { runtime, publish, beginGame, PHYSICS, STICK, resetFeel },
  });
function App() {
  const { match, replay } = useGame();
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
