// Build del plugin: empaqueta el sandbox (dist/code.js) y la UI (dist/ui.html con CSS y JS incrustados).
// Uso: node scripts/build.mjs [--watch] [--prod]
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');
mkdirSync(resolve(root, 'dist'), { recursive: true });

const define = { __DEV__: prod ? 'false' : 'true' };

const codeOptions = {
  entryPoints: [resolve(root, 'src/code.ts')],
  bundle: true,
  outfile: resolve(root, 'dist/code.js'),
  target: 'es2019',
  format: 'iife',
  define,
  minify: prod,
  logLevel: 'info',
};

async function buildUI() {
  const result = await build({
    entryPoints: [resolve(root, 'src/ui/ui.ts')],
    bundle: true,
    write: false,
    target: 'es2019',
    format: 'iife',
    define,
    minify: prod,
  });
  const js = result.outputFiles[0].text;
  const css = readFileSync(resolve(root, 'src/ui/ui.css'), 'utf8');
  const template = readFileSync(resolve(root, 'src/ui/ui.html'), 'utf8');
  // Se usan funciones como reemplazo para que los "$" del código no se interpreten como patrones.
  const html = template.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
  writeFileSync(resolve(root, 'dist/ui.html'), html, 'utf8');
}

// Bundle independiente para probar las comprobaciones desde la consola o desde figma-console:
// expone window.__dodlint = { runAuditStandalone } sin UI ni pagos.
async function buildStandalone() {
  await build({
    entryPoints: [resolve(root, 'src/standalone.ts')],
    bundle: true,
    outfile: resolve(root, 'dist/standalone.js'),
    target: 'es2019',
    format: 'iife',
    globalName: '__dodlint',
    define,
    minify: true,
  });
}

if (watch) {
  const ctx = await context({
    ...codeOptions,
    plugins: [{ name: 'ui', setup(b) { b.onEnd(async () => { await buildUI(); console.log('ui.html regenerado'); }); } }],
  });
  await ctx.watch();
  console.log('Observando cambios en src/ (la UI se regenera al cambiar el sandbox)…');
} else {
  await build(codeOptions);
  await buildUI();
  await buildStandalone();
  console.log(`Listo: dist/code.js, dist/ui.html y dist/standalone.js (${prod ? 'producción' : 'desarrollo'})`);
}
