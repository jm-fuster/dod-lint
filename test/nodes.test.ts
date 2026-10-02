import { test } from 'node:test';
import assert from 'node:assert/strict';
import { node, reset } from './figma';
import { findNode, findNodes } from '../src/nodes';

/** Una instancia con capas de dentro (una en una instancia anidada) que cuenta cómo se busca en ella. */
function screen() {
  reset();
  const inner = node('INSTANCE', { id: 'I2:1;1:5' }, [node('TEXT', { id: 'I2:1;1:5;3:1' })]);
  const inst = node('INSTANCE', { id: '2:1' }, [node('TEXT', { id: 'I2:1;1:2' }), node('FRAME', { id: 'I2:1;1:3' }, [node('TEXT', { id: 'I2:1;1:4' })]), inner]);
  const calls = { findAll: 0, findOne: 0 };
  const { findAll, findOne } = inst;
  inst.findAll = (fn: any) => (calls.findAll++, findAll(fn));
  inst.findOne = (fn: any) => (calls.findOne++, findOne(fn));
  return { inst, calls, plain: node('FRAME', { id: '5:1' }) };
}

test('varias capas de una instancia salen de un solo recorrido, también las de una anidada', async () => {
  const { calls } = screen();
  const ids = ['I2:1;1:2', 'I2:1;1:4', 'I2:1;1:5;3:1', '5:1'];
  const found = await findNodes(ids);
  assert.deepEqual(ids.map((id) => found.get(id)?.id), ids);
  assert.deepEqual(calls, { findAll: 1, findOne: 0 });
});

test('una sola capa de una instancia se busca parando al encontrarla, como findNode', async () => {
  const { calls } = screen();
  const found = await findNodes(['I2:1;1:4']);
  assert.equal(found.get('I2:1;1:4')?.id, 'I2:1;1:4');
  assert.deepEqual(calls, { findAll: 0, findOne: 1 });
  assert.equal((await findNode('I2:1;1:4'))?.id, 'I2:1;1:4');
});

test('lo que ya no existe sale como null, y una búsqueda que falla no tumba las demás', async () => {
  screen();
  const real = figma.getNodeByIdAsync;
  (figma as any).getNodeByIdAsync = async (id: string) => {
    if (id === '9:9') throw new Error('sin respuesta');
    return real(id);
  };
  try {
    const found = await findNodes(['I2:1;7:7', 'I8:8;1:1', '9:9', '5:1', 'I2:1;1:2']);
    assert.equal(found.get('I2:1;7:7'), null);
    assert.equal(found.get('I8:8;1:1'), null);
    assert.equal(found.get('9:9'), null);
    assert.equal(found.get('5:1')?.id, '5:1');
    assert.equal(found.get('I2:1;1:2')?.id, 'I2:1;1:2');
  } finally {
    (figma as any).getNodeByIdAsync = real;
  }
});
