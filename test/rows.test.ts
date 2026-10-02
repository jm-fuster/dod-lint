import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, GREY, audit, collection, color, node, place, reset, solid, useVariables, withTokens } from './figma';
import { rowsOf } from '../src/rows';
import type { Finding } from '../src/types';

test('la misma capa con el mismo hallazgo en varias variantes va en una fila; lo demás, aparte', () => {
  const f = (nodeId: string, message: string, variant?: string, layerPath = 'Label') =>
    ({
      checkId: 'color', nodeId, message, ignoreKey: `color|${nodeId}`,
      variantOf: variant ? { setId: 'S', setName: 'Button', variantId: variant, variants: 4, layerPath } : undefined,
    }) as Finding;
  const rows = rowsOf([
    f('a', 'Relleno #1A1A1A sin token', 'v1'),
    f('b', 'Relleno #1A1A1A sin token', 'v2'),
    f('c', 'Relleno #1A1A1A sin token', 'v3'),
    f('d', 'Relleno #333333 sin token', 'v4'),
    f('e', 'Relleno #1A1A1A sin token', 'v4', 'Icon'),
    f('x', 'Padding 16 sin token'),
    f('x', 'Padding 16 sin token'),
  ]);
  assert.deepEqual(rows.map((r) => [r.finding.message, r.nodeIds, r.variants, r.findings.length]), [
    ['Relleno #1A1A1A sin token', ['a', 'b', 'c'], 3, 3],
    ['Relleno #333333 sin token', ['d'], 1, 1],
    ['Relleno #1A1A1A sin token', ['e'], 1, 1],
    ['Padding 16 sin token', ['x'], 1, 2],
  ]);
});

/** Un set de botones: cada variante con su texto «Content / Label» del color que se pida. */
function buttons(colors: Array<{ r: number; g: number; b: number; a: number }>) {
  reset();
  useVariables([collection('C3', 'Semantic')], [color('ink', 'text/primary', 'C3', { value: GREY })]);
  const variants = colors.map((c, i) =>
    node('COMPONENT', { id: `2:${i + 1}`, name: `State=S${i + 1}`, layoutMode: 'HORIZONTAL' }, [
      node('FRAME', { id: `2:${i + 1}0`, name: 'Content' }, [node('TEXT', { id: `2:${i + 1}1`, name: 'Label', fills: [solid(c)] })]),
    ]),
  );
  place([node('COMPONENT_SET', { id: '2:0', name: 'Button', componentPropertyDefinitions: {} }, variants)]);
}

test('la auditoría marca cada hallazgo con su set, su variante y la ruta desde ella', async () => {
  buttons([GREY, GREY, WHITE]);
  const colorFindings = (await audit()).findings.filter((f) => f.checkId === 'color' && f.nodeName === 'Label');
  assert.deepEqual(colorFindings.map((f) => [f.variantOf?.setName, f.variantOf?.variantId, f.variantOf?.variants, f.variantOf?.layerPath]), [
    ['Button', '2:1', 3, 'Content / Label'],
    ['Button', '2:2', 3, 'Content / Label'],
    ['Button', '2:3', 3, 'Content / Label'],
  ]);
  // Dos variantes con el mismo gris, que tiene token: una fila «en 2 de 3», con las dos correcciones.
  const rows = rowsOf(colorFindings);
  assert.deepEqual(rows.map((r) => [r.finding.message, r.variants, r.nodeIds, r.fixes.length]), [
    ['Relleno #E6E6E6 sin token (coincide con text/primary)', 2, ['2:11', '2:21'], 2],
    ['Relleno #FFFFFF sin token', 1, ['2:31'], 0],
  ]);
});

test('lo que se señala en la propia variante se agrupa con ruta vacía, y el set no es variante de nada', async () => {
  buttons([GREY, GREY]);
  // Un padding escrito a mano en cada variante.
  for (const id of ['2:1', '2:2']) (await figma.getNodeByIdAsync(id) as any).paddingLeft = 12;
  const result = await audit({}, withTokens);
  const padding = result.findings.filter((f) => f.checkId === 'spacing' && f.nodeName.startsWith('State='));
  assert.deepEqual(padding.map((f) => [f.message, f.variantOf?.layerPath]), [
    ['Padding 12 sin token', ''],
    ['Padding 12 sin token', ''],
  ]);
  assert.deepEqual(rowsOf(padding).map((r) => [r.variants, r.nodeIds]), [[2, ['2:1', '2:2']]]);
  const onSet = result.findings.filter((f) => f.nodeName === 'Button');
  assert.ok(onSet.length > 0 && onSet.every((f) => f.variantOf === undefined));
});
