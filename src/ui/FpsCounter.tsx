import { useEffect, useRef } from 'react';

/**
 * Frames drawn per second, sampled every half second. It counts its own animation frames, which
 * run in step with the renderer, and writes to the DOM directly so it never re-renders the HUD.
 */
export function FpsCounter() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let request = 0,
      frames = 0,
      since = performance.now();
    const tick = (now: number) => {
      frames++;
      const elapsed = now - since;
      if (elapsed >= 500) {
        const fps = Math.round((frames * 1000) / elapsed);
        if (el.current) {
          el.current.textContent = `${fps} FPS`;
          el.current.dataset.band = fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'low';
        }
        frames = 0;
        since = now;
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, []);
  return <div ref={el} className="fps-counter" aria-label="Frames per second" />;
}
