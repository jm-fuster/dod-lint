import { test } from 'node:test';
import assert from 'node:assert/strict';
import { node, page, place, reset, settings } from './figma';
import { runAudit } from '../src/audit';
import { uiPause } from '../src/pause';

/** ¿Se ha resuelto ya la promesa? */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => (done = true));
  await new Promise((r) => setImmediate(r));
  return done;
}

test('la pausa espera a que la UI conteste con su id, y lo demás no la suelta', async () => {
  const sent: number[] = [];
  const pauser = uiPause((id) => sent.push(id), 60_000);
  const first = pauser.pause();
  const second = pauser.pause();
  assert.deepEqual(sent, [1, 2]);
  pauser.resume(7);
  pauser.resume(2);
  assert.equal(await settled(first), false);
  assert.equal(await settled(second), true);
  pauser.resume(1);
  pauser.resume(1);
  assert.equal(await settled(first), true);
});

test('si la UI no contesta, la pausa sigue sola pasado un rato', async () => {
  const pauser = uiPause(() => {}, 5);
  const p = pauser.pause();
  assert.equal(await settled(p), false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await settled(p), true);
});

/** Una página con unas cuantas capas. */
function screen() {
  reset();
  place([node('FRAME', { name: 'Pantalla' }, [0, 1, 2, 3, 4].map((i) => node('FRAME', { name: `Caja ${i}` })))]);
}

test('la auditoría cede por tiempo, con la pausa que se le pase, y Cancelar se mira al volver', async () => {
  screen();
  let pauses = 0;
  const progress: number[] = [];
  const pause = async () => {
    pauses++;
  };
  // Con 0 ms cede tras cada capa.
  const all = await runAudit('page', settings(), { pages: [page], yieldMs: 0, pause, onProgress: (n) => progress.push(n) });
  assert.equal(all.scanned, 6);
  assert.equal(pauses, 6);
  assert.deepEqual(progress.slice(0, 3), [1, 2, 3]);
  // Sin tiempo de sobra no cede nunca.
  pauses = 0;
  await runAudit('page', settings(), { pages: [page], yieldMs: Infinity, pause });
  assert.equal(pauses, 0);
  // Cancelado en la primera vuelta: para ahí.
  const stopped = await runAudit('page', settings(), { pages: [page], yieldMs: 0, pause, shouldStop: () => true });
  assert.equal(stopped.cancelled, true);
  assert.equal(stopped.scanned, 1);
});
