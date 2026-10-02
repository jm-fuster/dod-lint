// Pruebas: empaqueta cada test/*.test.ts con esbuild (los mismos imports sin extensión y el mismo __DEV__
// que el plugin) y las pasa por el runner de Node. Uso: node scripts/test.mjs [parte del nombre del archivo]
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] ?? '';
const names = readdirSync(resolve(root, 'test')).filter((f) => f.endsWith('.test.ts') && f.includes(filter));
if (!names.length) {
  console.error(`No hay pruebas que contengan "${filter}" en test/`);
  process.exit(1);
}

const outdir = resolve(root, 'dist/test');
rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: names.map((f) => resolve(root, 'test', f)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir,
  outExtension: { '.js': '.mjs' },
  define: { __DEV__: 'false' },
  logLevel: 'warning',
});

const files = names.map((f) => resolve(outdir, f.replace(/\.ts$/, '.mjs')));
const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
