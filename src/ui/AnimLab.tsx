// Animation lab UI (dev only): clip list, transport, metric timeline, pose inspector, captures and
// reference footage. The 3D side lives in scene/LabScene.tsx; state and the API in dev/lab.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  allClips,
  bundle,
  CAMERA_ORDER,
  CAMERAS,
  clearReference,
  closeLab,
  FPS,
  lab,
  loadReference,
  RATES,
  screenshot,
  seek,
  selectClip,
  set,
  setCamera,
  setMode,
  setOverlay,
  setPlaying,
  setRate,
  setReference,
  shiftRate,
  startTake,
  stepFrames,
  stopTake,
  toggleVideo,
  useLab,
  type CameraId,
  type OverlayId,
} from '../dev/lab';
import {
  analyze,
  issueLabel,
  ISSUE_TEXT,
  reportText,
  type Analysis,
  type LabSample,
} from '../dev/labMetrics';
import './animLab.css';

const OVERLAYS: [OverlayId, string, string][] = [
  ['skeleton', 'Skeleton', 'K'],
  ['stick', 'Stick + palms', 'S'],
  ['contacts', 'Skate contact', 'C'],
  ['trails', 'Motion trails', 'T'],
  ['grid', 'Grid', 'G'],
];
const camLabel = (id: CameraId) =>
  id === 'orbit' ? 'Orbit' : id === 'game' ? 'Game' : CAMERAS[id].label;
const copy = (text: string) =>
  navigator.clipboard.writeText(text).catch(() => window.prompt('Copy', text));
const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

export function AnimLab() {
  const state = useLab();
  const [bundleCams, setBundleCams] = useState<CameraId[]>(['side', 'front', 'back']);
  const [frames, setFrames] = useState(10);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'F8') {
        e.preventDefault();
        return lab.recording ? stopTake() : startTake();
      }
      if (lab.mode === 'live') return; // The rest of the keyboard skates.
      const run: Record<string, () => unknown> = {
        Space: () => setPlaying(!lab.playing),
        ArrowLeft: () => stepFrames(e.shiftKey ? -10 : -1),
        ArrowRight: () => stepFrames(e.shiftKey ? 10 : 1),
        Home: () => seek(0),
        BracketLeft: () => shiftRate(-1),
        BracketRight: () => shiftRate(1),
        KeyL: () => set({ loop: !lab.loop }),
        KeyP: () => screenshot(),
        KeyB: () => bundle({ cameras: bundleCams, frames }),
        KeyV: () => toggleVideo(),
        ...Object.fromEntries(OVERLAYS.map(([id, , k]) => [`Key${k}`, () => setOverlay(id)])),
        ...Object.fromEntries(
          CAMERA_ORDER.map((id, i) => [`Digit${(i + 1) % 10}`, () => setCamera(id)]),
        ),
      };
      const fn = run[e.code];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [bundleCams, frames]);

  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file || !/^(video|image)\//.test(file.type)) return;
      e.preventDefault();
      loadReference(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="lab" data-block-game-input={state.mode === 'clip' || undefined}>
      <TopBar />
      <ClipList />
      <div className="lab-view">{state.ref && <Reference />}</div>
      <Inspector />
      <footer className="lab-bottom lab-panel">
        {state.mode === 'clip' ? <Transport /> : <LiveBar />}
        {state.mode === 'clip' && <TrackChart />}
        <div className="lab-capture">
          <button onClick={() => void screenshot()} disabled={!!state.busy}>
            Screenshot <kbd>P</kbd>
          </button>
          <button className={state.video.recording ? 'rec' : ''} onClick={() => void toggleVideo()}>
            {state.video.recording ? '■ Stop video' : '● Video'} <kbd>V</kbd>
          </button>
          <button
            className="primary"
            disabled={!!state.busy || state.mode === 'live'}
            onClick={() => void bundle({ cameras: bundleCams, frames })}
            title="Plays the clip at 60 Hz and saves report.md, metrics.json, contact sheets and frames"
          >
            Capture bundle <kbd>B</kbd>
          </button>
          <label>
            frames
            <input
              type="number"
              min={1}
              max={36}
              value={frames}
              onChange={(e) => setFrames(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <span className="lab-chips">
            {CAMERA_ORDER.filter((c) => c !== 'game').map((c) => (
              <button
                key={c}
                className={bundleCams.includes(c) ? 'on' : ''}
                onClick={() =>
                  setBundleCams((cams) =>
                    cams.includes(c) ? cams.filter((x) => x !== c) : [...cams, c],
                  )
                }
              >
                {camLabel(c)}
              </button>
            ))}
          </span>
          <label className="lab-file">
            Reference…
            <input
              type="file"
              accept="video/*,image/*"
              onChange={(e) => e.target.files?.[0] && loadReference(e.target.files[0])}
            />
          </label>
          <span className="lab-status">
            {state.busy ? `${state.busy}…` : state.status}
            {!state.busy && state.status.startsWith('Saved ') && (
              <button onClick={() => void copy(state.status.slice(6))}>copy path</button>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}

function TopBar() {
  const state = useLab();
  return (
    <header className="lab-top lab-panel">
      <strong className="lab-title">Anim Lab</strong>
      <span className="lab-seg">
        {(['clip', 'live'] as const).map((m) => (
          <button key={m} className={state.mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'clip' ? 'Clips' : 'Live'}
          </button>
        ))}
      </span>
      <span className="lab-seg">
        {CAMERA_ORDER.map((id, i) => (
          <button
            key={id}
            className={state.camera === id ? 'on' : ''}
            onClick={() => setCamera(id)}
            title={`${camLabel(id)} (${(i + 1) % 10})`}
          >
            {camLabel(id)}
          </button>
        ))}
      </span>
      <span className="lab-seg">
        {OVERLAYS.map(([id, label, k]) => (
          <button
            key={id}
            className={state.overlays[id] ? 'on' : ''}
            onClick={() => setOverlay(id)}
            title={`${label} (${k})`}
          >
            {label}
          </button>
        ))}
        <button
          className={state.travel ? 'on' : ''}
          onClick={() => set({ travel: !state.travel })}
          title="Skate across the ice instead of in place"
        >
          Travel
        </button>
      </span>
      <span className="lab-hint">
        drag orbit · wheel zoom · shift-drag height · dbl-click reset
      </span>
      <button className="lab-exit" onClick={closeLab}>
        Exit
      </button>
    </header>
  );
}

function ClipList() {
  const state = useLab();
  const [query, setQuery] = useState('');
  const clips = allClips().filter((c) =>
    `${c.id} ${c.label} ${c.group}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = [...new Set(clips.map((c) => c.group))];
  return (
    <nav className="lab-clips lab-panel">
      <input
        type="search"
        placeholder="Filter clips"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="lab-scroll">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            {clips
              .filter((c) => c.group === g)
              .map((c) => (
                <button
                  key={c.id}
                  className={state.mode === 'clip' && state.clip.id === c.id ? 'on' : ''}
                  onClick={() => selectClip(c.id)}
                >
                  <span>{c.label}</span>
                  <small>{c.duration.toFixed(2)}s</small>
                </button>
              ))}
          </section>
        ))}
      </div>
    </nav>
  );
}

function Transport() {
  const state = useLab();
  const d = state.clip.duration;
  return (
    <div className="lab-transport">
      <button onClick={() => stepFrames(-1)} title="Back a frame (←, shift ×10)">
        ◀︎|
      </button>
      <button className="play" onClick={() => setPlaying(!state.playing)} title="Space">
        {state.playing ? '❚❚' : '▶'}
      </button>
      <button onClick={() => stepFrames(1)} title="Forward a frame (→, shift ×10)">
        |▶︎
      </button>
      <button
        className={state.loop ? 'on' : ''}
        onClick={() => set({ loop: !state.loop })}
        title="L"
      >
        Loop
      </button>
      <span className="lab-seg">
        {RATES.map((r) => (
          <button key={r} className={state.rate === r ? 'on' : ''} onClick={() => setRate(r)}>
            {r}×
          </button>
        ))}
      </span>
      <output>
        {state.time.toFixed(3)} / {d.toFixed(2)} s · f{Math.round(state.time * FPS)}
      </output>
      <p className="lab-look">{state.clip.look}</p>
    </div>
  );
}

function LiveBar() {
  const state = useLab();
  return (
    <div className="lab-transport">
      <button
        className={state.recording ? 'rec' : 'primary'}
        onClick={() => (state.recording ? stopTake() : startTake())}
      >
        {state.recording ? `■ Stop take (${state.recording.t.toFixed(1)}s)` : '● Record take'}{' '}
        <kbd>F8</kbd>
      </button>
      <span className="lab-seg">
        {RATES.map((r) => (
          <button key={r} className={state.rate === r ? 'on' : ''} onClick={() => setRate(r)}>
            {r}×
          </button>
        ))}
      </span>
      <p className="lab-look">
        Skate it yourself (pad or keyboard); the rate slows the whole simulation. A take becomes a
        scrubbable clip under Takes, with the same metrics and captures.
      </p>
    </div>
  );
}

type Series = { label: string; color: string; get: (s: LabSample) => number; dash?: boolean };
const LANES: { title: string; min: number; max: number; series: Series[] }[] = [
  {
    title: 'angles °',
    min: 0,
    max: 150,
    series: [
      { label: 'knee L', color: '#4fd1ff', get: (s) => s.angles.kneeL },
      { label: 'knee R', color: '#ff9a3c', get: (s) => s.angles.kneeR },
      { label: 'elbow L', color: '#4fd1ff', get: (s) => s.angles.elbowL, dash: true },
      { label: 'elbow R', color: '#ff9a3c', get: (s) => s.angles.elbowR, dash: true },
    ],
  },
  {
    title: 'cm',
    min: -4,
    max: 16,
    series: [
      { label: 'grip L', color: '#4fd1ff', get: (s) => s.grip.L },
      { label: 'grip R', color: '#ff9a3c', get: (s) => s.grip.R },
      { label: 'lift L', color: '#4fd1ff', get: (s) => s.lift.L, dash: true },
      { label: 'lift R', color: '#ff9a3c', get: (s) => s.lift.R, dash: true },
    ],
  },
  {
    title: '0–1',
    min: 0,
    max: 1,
    series: [
      { label: 'crouch', color: '#f2f6ff', get: (s) => s.pose.crouch },
      { label: 'free hand', color: '#d5fa64', get: (s) => s.pose.freeHand },
      { label: 'stride', color: '#9d8cff', get: (s) => s.input.stridePhase, dash: true },
    ],
  },
];

/** Metric lanes over the clip, issue spans (red) and pops (yellow). Click or drag to scrub. */
function TrackChart() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useRef<{ size: number; clip: string; analysis: Analysis | null }>({
    size: -1,
    clip: '',
    analysis: null,
  });
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const el = canvas.current;
      if (!el) return;
      const w = el.clientWidth,
        h = el.clientHeight,
        dpr = devicePixelRatio;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      const ctx = el.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const d = lab.clip.duration,
        track = [...lab.track.values()].sort((a, b) => a.frame - b.frame);
      const c = cache.current;
      if (c.size !== track.length || c.clip !== lab.clip.id) {
        c.size = track.length;
        c.clip = lab.clip.id;
        c.analysis = track.length > 2 ? analyze(track) : null;
      }
      const x = (t: number) => (t / d) * w;
      const top = 12,
        laneH = (h - top) / LANES.length;
      ctx.font = '10px ui-monospace, Menlo, monospace';
      for (const span of c.analysis?.issues ?? []) {
        ctx.fillStyle = 'rgba(255, 66, 56, 0.85)';
        ctx.fillRect(x(span.from), 1, Math.max(2, x(span.to) - x(span.from)), 5);
      }
      for (const pop of c.analysis?.pops ?? []) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(x(pop.at) - 1, 0, 2, 10);
      }
      LANES.forEach((lane, li) => {
        const y0 = top + li * laneH;
        ctx.fillStyle = 'rgba(185, 212, 238, 0.05)';
        ctx.fillRect(0, y0 + 1, w, laneH - 2);
        const y = (v: number) =>
          y0 + laneH - 2 - ((v - lane.min) / (lane.max - lane.min)) * (laneH - 4);
        ctx.fillStyle = '#71859a';
        ctx.fillText(lane.title, 4, y0 + 11);
        lane.series.forEach((sr, si) => {
          ctx.strokeStyle = sr.color;
          ctx.setLineDash(sr.dash ? [3, 3] : []);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          let prev = -10;
          for (const s of track) {
            const px = x(s.t),
              py = Math.min(y0 + laneH, Math.max(y0, y(sr.get(s))));
            if (s.frame - prev > 2) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            prev = s.frame;
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = sr.color;
          ctx.fillText(sr.label, 60 + si * 62, y0 + 11);
        });
      });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x(lab.time) - 1, 0, 2, h);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  const scrub = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && !(e.buttons & 1)) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPlaying(false);
    seek(((e.clientX - r.left) / r.width) * lab.clip.duration);
  };
  return <canvas ref={canvas} className="lab-chart" onPointerDown={scrub} onPointerMove={scrub} />;
}

const Row = ({ k, v, bad }: { k: string; v: React.ReactNode; bad?: boolean }) => (
  <div className={bad ? 'bad' : ''}>
    <dt>{k}</dt>
    <dd>{v}</dd>
  </div>
);
const lr = (a: number, b: number, unit = '') => `${a}${unit} / ${b}${unit}`;

function Inspector() {
  const state = useLab();
  const s = state.current;
  const analysis = useMemo(
    () => (state.track.size > 2 ? analyze([...state.track.values()]) : null),
    // Re-analyse as frames arrive, a few times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.track.size, state.clip.id],
  );
  const copyReport = () =>
    copy(
      reportText({
        clip: state.clip,
        samples: [...state.track.values()],
        analysis: analysis ?? analyze([]),
        files: [],
        cameras: [state.camera],
        travel: state.travel,
      }),
    );
  if (!s) return <aside className="lab-inspect lab-panel">Waiting for the skater…</aside>;
  const bad = (where: string) => s.issues.some((i) => i.where.includes(where));
  return (
    <aside className="lab-inspect lab-panel">
      <div className="lab-inspect-actions">
        <button onClick={() => void copy(JSON.stringify(s, null, 1))}>Copy frame JSON</button>
        <button onClick={() => void copyReport()} disabled={!analysis}>
          Copy clip report
        </button>
      </div>
      <div className="lab-scroll">
        <h3>
          This frame{' '}
          {s.issues.length ? `· ${s.issues.length} issue${s.issues.length > 1 ? 's' : ''}` : ''}
        </h3>
        {s.issues.length ? (
          <ul className="lab-issues">
            {s.issues.map((i) => (
              <li key={i.kind + i.where}>{issueLabel(i)}</li>
            ))}
          </ul>
        ) : (
          <p className="lab-ok">Nothing past the limits.</p>
        )}
        {analysis && (
          <>
            <h3>
              Whole clip · {analysis.issues.length} issues · {analysis.pops.length} pops
            </h3>
            <ul className="lab-issues clip">
              {analysis.issues.map((i) => (
                <li
                  key={`${i.kind}${i.where}${i.from}`}
                  onClick={() => (setPlaying(false), seek(i.at))}
                >
                  {i.from.toFixed(2)}–{i.to.toFixed(2)}s {i.where}: {ISSUE_TEXT[i.kind]} ({i.worst})
                </li>
              ))}
              {analysis.pops.map((p) => (
                <li
                  key={`${p.joint}${p.at}`}
                  className="pop"
                  onClick={() => (setPlaying(false), seek(p.at))}
                >
                  {p.at.toFixed(3)}s {p.joint} jumped {p.cm} cm (~{p.around})
                </li>
              ))}
            </ul>
          </>
        )}
        <h3>Joints L / R</h3>
        <dl>
          <Row k="knee flex" v={lr(s.angles.kneeL, s.angles.kneeR, '°')} bad={bad('knee')} />
          <Row k="hip flex" v={lr(s.angles.hipL, s.angles.hipR, '°')} />
          <Row k="elbow flex" v={lr(s.angles.elbowL, s.angles.elbowR, '°')} bad={bad('elbow')} />
          <Row k="wrist bend" v={lr(s.angles.wristL, s.angles.wristR, '°')} bad={bad('wrist')} />
          <Row k="arm reach" v={lr(s.reach.armL, s.reach.armR)} bad={bad('arm')} />
          <Row k="leg reach" v={lr(s.reach.legL, s.reach.legR)} bad={bad('leg')} />
          <Row k="palm→shaft" v={lr(s.grip.L, s.grip.R, ' cm')} bad={bad('hand')} />
          <Row k="skate lift" v={lr(s.lift.L, s.lift.R, ' cm')} bad={bad('skate')} />
        </dl>
        <h3>Body and stick</h3>
        <dl>
          <Row k="torso pitch / roll" v={lr(s.angles.torsoPitch, s.angles.torsoRoll, '°')} />
          <Row k="shoulders vs hips" v={`${s.angles.torsoTwist}°`} />
          <Row k="pelvis height" v={`${(s.joints.pelvis[1] * 100).toFixed(0)} cm`} />
          <Row k="blade (hosel)" v={`${s.stick.blade} cm`} bad={bad('blade')} />
          <Row k="shaft tilt" v={`${s.stick.tilt}°`} />
          <Row k="shaft to torso" v={`${s.stick.torso} cm`} bad={bad('shaft')} />
          <Row k="hand spread" v={`${s.grip.spread} cm`} />
        </dl>
        <h3>Pose internals</h3>
        <dl>
          {(['crouch', 'stickBlend', 'twoHand', 'freeHand', 'release', 'swing'] as const).map(
            (k) => (
              <Row key={k} k={k} v={s.pose[k].toFixed(3)} />
            ),
          )}
          {Object.entries(s.pose.action).map(([k, v]) => (
            <Row key={k} k={`action.${k}`} v={v} />
          ))}
          <Row k="ragdoll" v={String(s.pose.ragdoll)} />
        </dl>
        <h3>Inputs</h3>
        <dl>
          {Object.entries(s.input).map(([k, v]) => (
            <Row key={k} k={k} v={v ?? '—'} />
          ))}
        </dl>
      </div>
    </aside>
  );
}

function Reference() {
  const state = useLab();
  const ref = state.ref!;
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    slot.current?.replaceChildren(ref.media);
  }, [ref.media]);
  return (
    <div className={`lab-ref ${ref.layout}`} style={{ opacity: ref.opacity }}>
      <div ref={slot} className="lab-ref-media" />
      <div className="lab-ref-bar lab-panel">
        <span title={ref.name}>{ref.name}</span>
        <label>
          offset
          <input
            type="number"
            step={0.01}
            value={ref.offset}
            onChange={(e) => setReference({ offset: Number(e.target.value) })}
          />
        </label>
        <label>
          rate
          <input
            type="number"
            step={0.05}
            value={ref.rate}
            onChange={(e) => setReference({ rate: Number(e.target.value) })}
          />
        </label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={ref.opacity}
          aria-label="Reference opacity"
          onChange={(e) => setReference({ opacity: Number(e.target.value) })}
        />
        <button onClick={() => setReference({ layout: ref.layout === 'pip' ? 'overlay' : 'pip' })}>
          {ref.layout === 'pip' ? 'Overlay' : 'Corner'}
        </button>
        <button onClick={clearReference}>✕</button>
      </div>
    </div>
  );
}
