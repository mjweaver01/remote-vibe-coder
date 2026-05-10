import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name: string) => resolve(root, 'node_modules/.bin', name);

if (!existsSync(resolve(root, 'dist'))) {
  console.log('▶ no dist/ found — running initial build…');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}

function tag(label: string, color: string) {
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  return (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (line.trim()) process.stdout.write(prefix + line + '\n');
    }
  };
}

const client = spawn(bin('vite'), ['build', '--watch'], { cwd: root });

client.stdout.on('data', tag('client', '36'));
client.stderr.on('data', tag('client', '36'));

// Wait for the first successful build before starting the server so that
// dist/web/index.html exists when the server's locateStaticDir runs.
let serverStarted = false;
client.stdout.on('data', (data: Buffer) => {
  if (!serverStarted && data.toString().includes('built in')) {
    serverStarted = true;
    startServer();
  }
});

function startServer() {
  const server = spawn(bin('tsx'), ['watch', 'src/cli.ts'], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', tag('server', '32'));
  server.stderr!.on('data', tag('server', '32'));

  for (const sig of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
    process.on(sig, () => {
      client.kill(sig);
      server.kill(sig);
      process.exit(0);
    });
  }
}
