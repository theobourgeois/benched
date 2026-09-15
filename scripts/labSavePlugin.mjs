// Dev-server endpoint for the animation lab: POST /__lab/save?path=<dir>/<file> writes the body
// under artifacts/anim-lab, so captures land where scripts and agents can read them.
// Loopback only: `npm run dev` listens on the LAN.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export function labSaves() {
  return {
    name: 'anim-lab-saves',
    apply: 'serve',
    configureServer(server) {
      const project = server.config.root;
      const root = resolve(project, 'artifacts/anim-lab');
      server.middlewares.use('/__lab/save', (req, res) => {
        const remote = req.socket.remoteAddress ?? '';
        const target = resolve(
          root,
          new URL(req.url ?? '', 'http://lab').searchParams.get('path') ?? '',
        );
        if (
          req.method !== 'POST' ||
          !/^(::1|127\.|::ffff:127\.)/.test(remote) ||
          !target.startsWith(root + sep)
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, Buffer.concat(chunks));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ path: relative(project, target) }));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        });
      });
    },
  };
}
