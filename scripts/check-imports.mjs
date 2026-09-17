// Checks that each folder under src/ only imports from the folders it is allowed to.
//
// The rule is what keeps the simulation testable without a browser and the network code free of
// rendering: game/ knows nothing about React, three.js, audio, pads or sockets; net/ knows nothing
// about the scene or the screens. See CLAUDE.md for the picture. Run with `npm run lint`; it is
// also part of `npm test` and `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Which src/ folders (and packages) each folder may import from. `*` is anything. */
const ALLOWED = {
  data: [],
  game: ['game', 'data'],
  input: ['input', 'game', 'react'],
  audio: ['audio', 'game'],
  net: ['net', 'game', 'input', 'partysocket'],
  scene: [
    'scene',
    'game',
    'input',
    'audio',
    'app',
    'dev',
    'three',
    'react',
    '@react-three/fiber',
    '@dimforge/rapier3d-compat',
  ],
  ui: ['*'],
  app: ['*'],
  dev: ['*'],
};
/**
 * The room worker is deployed alone, so it may only share the wire contract and plain types.
 * Its own files (the rooms and the directory that lists them) may of course use each other.
 */
const WORKER_ALLOWED = ['src/net/protocol', 'src/game/types', 'partyserver'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|mts)$/.test(name) && !name.endsWith('.d.ts')) yield path;
  }
}

const IMPORT =
  /(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function importsOf(source) {
  const out = [];
  for (const m of source.matchAll(IMPORT)) out.push(m[1] ?? m[2]);
  return out;
}

/** The src/ folder a relative import lands in, or the package name for a bare one. */
function targetOf(spec, fromDir) {
  if (spec.startsWith('.')) {
    const abs = join(fromDir, spec);
    const rel = relative(join(ROOT, 'src'), abs).split(sep);
    return rel[0] === '..' ? `../${rel.slice(1).join('/')}` : rel[0];
  }
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

const problems = [];
for (const path of files(join(ROOT, 'src'))) {
  const rel = relative(ROOT, path);
  const parts = rel.split(sep);
  const folder = parts.length > 2 ? parts[1] : null;
  if (!folder) continue; // src/main.tsx may import anything
  const allowed = ALLOWED[folder];
  if (!allowed) {
    problems.push(`${rel}: folder "${folder}" is not in scripts/check-imports.mjs`);
    continue;
  }
  if (allowed.includes('*')) continue;
  const dir = join(ROOT, rel, '..');
  for (const spec of importsOf(readFileSync(path, 'utf8'))) {
    const target = targetOf(spec, dir);
    if (spec.endsWith('.css') || spec.endsWith('.json')) continue;
    if (!allowed.includes(target))
      problems.push(`${rel} imports ${spec} (${folder}/ may not use ${target})`);
  }
}
for (const path of files(join(ROOT, 'workers'))) {
  const rel = relative(ROOT, path);
  for (const spec of importsOf(readFileSync(path, 'utf8'))) {
    const sibling = spec.startsWith('./');
    const ok = sibling || WORKER_ALLOWED.some((a) => spec === a || spec.endsWith(`/${a}`));
    if (!ok)
      problems.push(`${rel} imports ${spec} (workers/ may only use ${WORKER_ALLOWED.join(', ')})`);
  }
}

if (problems.length) {
  console.error('Import layering problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('imports ok');
