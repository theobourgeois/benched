import React from 'react';
import ReactDOM from 'react-dom/client';
import { GameScene } from './scene/GameScene';
import { Menu } from './ui/Menu';
import { Hud } from './ui/Hud';
import { useGame, runtime, publish } from './game/store';
import { bootFeel, resetFeel } from './game/feel';
import { PHYSICS, STICK } from './game/config';
import './style.css';
bootFeel();
if (import.meta.env.DEV)
  Object.assign(window, { __BENCHED__: { runtime, publish, PHYSICS, STICK, resetFeel } });
function App() {
  const { match } = useGame();
  return (
    <>
      <GameScene />
      {match.phase === 'menu' ? <Menu /> : <Hud />}
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
