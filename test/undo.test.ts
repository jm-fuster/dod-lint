import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alias, node, reset } from './figma';
import { LastFix } from '../src/undo';
import type { FixHint } from '../src/types';

const PAD: FixHint = { kind: 'bind-float', field: 'paddingLeft', variableId: 'V16', from: 16 };
const noWait = async () => {};

/** Una capa con PAD ya puesta, como la deja applyFix. */
const fixedFrame = () => node('FRAME', { paddingLeft: 16, boundVariables: { paddingLeft: alias('V16') } });
/** Lo que hace el deshacer de Figma con la tanda: quita los enlaces. */
const unbindAll = (...frames: any[]) => {
  for (const f of frames) delete f.boundVariables.paddingLeft;
};

test('deshacer quita la tanda si sigue siendo lo último, y solo una vez', async () => {
  reset();
  const last = new LastFix();
  const [a, b] = [fixedFrame(), fixedFrame()];
  const id = last.remember([
    { node: a, fix: PAD },
    { node: b, fix: PAD },
  ])!;
  let calls = 0;
  const trigger = () => {
    calls++;
    unbindAll(a, b);
  };
  assert.equal(await last.undo(id, trigger, noWait), 'undone');
  assert.equal(await last.undo(id, trigger, noWait), 'expired');
  assert.equal(calls, 1);
});

test('sin capas no hay tanda, y una olvidada o anterior ya no se deshace', async () => {
  reset();
  const last = new LastFix();
  let calls = 0;
  const trigger = () => {
    calls++;
  };
  assert.equal(last.remember([]), undefined);
  const first = last.remember([{ node: fixedFrame(), fix: PAD }])!;
  const second = last.remember([{ node: fixedFrame(), fix: PAD }])!;
  assert.notEqual(first, second);
  assert.equal(await last.undo(first, trigger, noWait), 'expired');
  // Pedir la anterior no borra la última.
  assert.equal(last.forget(), second);
  assert.equal(last.forget(), undefined);
  assert.equal(await last.undo(second, trigger, noWait), 'expired');
  assert.equal(calls, 0);
});

test('si una capa ya no tiene su corrección, no se llama al deshacer de Figma', async () => {
  reset();
  const last = new LastFix();
  const [a, b, c] = [fixedFrame(), fixedFrame(), fixedFrame()];
  const layers = [a, b, c].map((n) => ({ node: n, fix: PAD }));
  let calls = 0;
  // Deshecha a mano con Ctrl+Z, o enlazada a otra cosa.
  let id = last.remember(layers)!;
  unbindAll(b);
  assert.equal(await last.undo(id, () => calls++, noWait), 'expired');
  // Borrada después.
  b.boundVariables.paddingLeft = alias('V16');
  c.removed = true;
  id = last.remember(layers)!;
  assert.equal(await last.undo(id, () => calls++, noWait), 'expired');
  assert.equal(calls, 0);
});

test('si Figma deshace otra cosa, las correcciones siguen puestas y se dice', async () => {
  reset();
  const last = new LastFix();
  const a = fixedFrame();
  const id = last.remember([{ node: a, fix: PAD }])!;
  let waits = 0;
  const result = await last.undo(
    id,
    () => {},
    async () => {
      waits++;
    },
  );
  assert.equal(result, 'other');
  assert.equal(waits, 10);
  assert.equal(a.boundVariables.paddingLeft?.id, 'V16');
});

test('un deshacer que tarda un poco en verse se espera', async () => {
  reset();
  const last = new LastFix();
  const a = fixedFrame();
  const id = last.remember([{ node: a, fix: PAD }])!;
  let waits = 0;
  const result = await last.undo(
    id,
    () => {},
    async () => {
      if (++waits === 3) unbindAll(a);
    },
  );
  assert.equal(result, 'undone');
  assert.equal(waits, 3);
});
