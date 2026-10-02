import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, audit, collection, color, library, node, place, reset, solid, useVariables, withTokens } from './figma';
import type { Color } from './figma';
import { IGNORED_KEY, readIgnored, writeIgnored } from '../src/ignore';

const INK: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const DARK: Color = { r: 0.12, g: 0.12, b: 0.12, a: 1 };

test('los ignorados se guardan en la raíz del archivo y se pueden quitar', () => {
  reset();
  writeIgnored(['color|1:2', 'spacing|1:3'], true);
  assert.deepEqual(Object.keys(readIgnored()).sort(), ['color|1:2', 'spacing|1:3']);
  writeIgnored(['color|1:2'], false);
  assert.deepEqual(Object.keys(readIgnored()), ['spacing|1:3']);
  writeIgnored(['spacing|1:3'], false);
  assert.equal(figma.root.getPluginData(IGNORED_KEY), '');
});

test('unos datos ilegibles no tumban nada: no hay ignorados', () => {
  reset();
  figma.root.setPluginData(IGNORED_KEY, '{roto');
  assert.deepEqual(readIgnored(), {});
});

test('ignorar una regla en una capa marca sus hallazgos de esa regla y no los de otras', async () => {
  reset();
  useVariables([collection('C3', 'Semantic')], [color('surface', 'surface/default', 'C3', { value: WHITE })]);
  const card = node('FRAME', { id: '3:1', name: 'Card', fills: [solid(WHITE)], layoutMode: 'HORIZONTAL', paddingLeft: 10 });
  place([node('FRAME', { id: '3:0', name: 'Pantalla' }, [card])]);
  writeIgnored(['color|3:1'], true);
  const result = await audit({}, withTokens);
  const of = (checkId: string) => result.findings.filter((f) => f.nodeId === '3:1' && f.checkId === checkId).map((f) => [f.ignoreKey, !!f.ignored]);
  assert.deepEqual(of('color'), [['color|3:1', true]]);
  assert.deepEqual(of('spacing'), [['spacing|3:1', false]]);
});

test('el texto de un componente en varias instancias se ignora en todas con una sola clave', async () => {
  reset();
  const main = node('COMPONENT', { id: '6:1', name: 'Button' }, [node('TEXT', { id: '6:2', name: 'Label', fills: [solid(INK)] })]);
  place([main], library);
  const instance = (id: string) => node('INSTANCE', { id, name: 'Button', main }, [node('TEXT', { id: `I${id};6:2`, name: 'Label', fills: [solid(INK)] })]);
  place([node('FRAME', { id: '7:0', name: 'Pantalla', fills: [solid(DARK)] }, [instance('7:1'), instance('7:2')])]);
  const contrast = async () => (await audit()).findings.filter((f) => f.checkId === 'contrast').map((f) => [f.ignoreKey, !!f.ignored]);
  assert.deepEqual(await contrast(), [['contrast|src:6:2', false]]);
  writeIgnored(['contrast|src:6:2'], true);
  assert.deepEqual(await contrast(), [['contrast|src:6:2', true]]);
});
