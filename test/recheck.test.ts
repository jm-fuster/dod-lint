import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, addCollection, alias, collection, color, library, node, page, place, reset, settings, solid, useVariables } from './figma';
import type { Color } from './figma';
import { runAudit } from '../src/audit';
import { mergeRechecked, recheckTargets } from '../src/recheck';
import type { Finding, RecheckTarget } from '../src/types';

const INK: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const DARK: Color = { r: 0.12, g: 0.12, b: 0.12, a: 1 };

const audit = () => runAudit('page', settings(), { pages: [page], lang: 'es' });
const recheck = (targets: RecheckTarget[]) => runAudit('page', settings(), { recheck: targets, lang: 'es' });
const summary = (fs: Finding[], checkId: string) => fs.filter((f) => f.checkId === checkId).map((f) => [f.nodeId, f.message]);

function whiteToken() {
  reset();
  useVariables([collection('C3', 'Semantic')], [color('surface', 'surface/default', 'C3', { value: WHITE })]);
}

test('qué revisar: cada capa una vez, los textos de instancia con sus repetidos y lo suelto con su instancia', () => {
  const f = (nodeId: string, extra: Partial<Finding> = {}) => ({ checkId: 'color', nodeId, ignoreKey: `color|${nodeId}`, ...extra }) as Finding;
  const targets = recheckTargets([
    f('1:1'),
    f('1:1', { checkId: 'spacing' }),
    f('I7:1;6:2', { checkId: 'contrast', ignoreKey: 'contrast|src:6:2', alsoAt: ['I7:2;6:2'] }),
    f('4:171', { anchored: true }),
  ]);
  assert.deepEqual(targets, [
    { nodeId: '1:1' },
    { nodeId: 'I7:1;6:2', placed: true },
    { nodeId: 'I7:2;6:2', placed: true },
    { nodeId: '4:171', deep: true },
  ]);
});

test('lo nuevo sustituye a lo viejo en su sitio, y lo de capas sin hallazgo propio va al final', () => {
  const f = (nodeId: string, message: string) => ({ checkId: 'color', nodeId, message, ignoreKey: `color|${nodeId}` }) as Finding;
  const merged = mergeRechecked(
    [f('a', 'viejo a'), f('b', 'b se queda'), f('a', 'otro viejo a'), f('c', 'viejo c')],
    ['a', 'c', 'd'],
    [f('a', 'nuevo a'), f('d', 'nuevo d')],
  );
  assert.deepEqual(merged.map((m) => m.message), ['nuevo a', 'b se queda', 'nuevo d']);
});

test('revisar de nuevo mira solo la capa, sin bajar a sus hijos', async () => {
  whiteToken();
  const child = node('FRAME', { id: '3:2', name: 'Hijo', fills: [solid(WHITE)] });
  const parent = node('FRAME', { id: '3:1', name: 'Padre', fills: [solid(WHITE)] }, [child]);
  place([parent]);
  const first = await audit();
  assert.deepEqual(summary(first.findings, 'color').map(([id]) => id), ['3:1', '3:2']);
  // Se corrige el padre a mano: se enlaza su relleno.
  parent.fills = [solid(WHITE, { boundVariables: { color: alias('surface') } })];
  const again = await recheck([{ nodeId: '3:1' }]);
  assert.deepEqual(summary(again.findings, 'color'), []);
  assert.equal(again.scanned, 1);
  // En la lista, el hijo sigue con lo suyo.
  const merged = mergeRechecked(first.findings, ['3:1'], again.findings);
  assert.deepEqual(summary(merged, 'color').map(([id]) => id), ['3:2']);
});

test('un resultado repetido en varias instancias se revisa en todas y la cuenta se rehace', async () => {
  reset();
  const main = node('COMPONENT', { id: '6:1', name: 'Button' }, [node('TEXT', { id: '6:2', name: 'Label', fills: [solid(INK)] })]);
  place([main], library);
  const instance = (id: string) => node('INSTANCE', { id, name: 'Button', main }, [node('TEXT', { id: `I${id};6:2`, name: 'Label', fills: [solid(INK)] })]);
  const [one, two, three] = [instance('7:1'), instance('7:2'), instance('7:3')];
  place([node('FRAME', { id: '7:0', name: 'Pantalla', fills: [solid(DARK)] }, [one, two, three])]);
  const first = await audit();
  assert.deepEqual(summary(first.findings, 'contrast'), [['I7:1;6:2', 'Contraste 1.06:1, mínimo 4.5:1 para 14 px sobre Pantalla (#1F1F1F) (se repite en 3 instancias)']]);
  // Se arregla a mano el texto de la primera instancia.
  one.children[0].fills = [solid(WHITE)];
  const again = await recheck(recheckTargets(first.findings));
  assert.deepEqual(summary(again.findings, 'contrast'), [['I7:2;6:2', 'Contraste 1.06:1, mínimo 4.5:1 para 14 px sobre Pantalla (#1F1F1F) (se repite en 2 instancias)']]);
  // Los textos de las instancias, solo por contraste, como en la auditoría (el frame de la pantalla se revisa entero).
  assert.deepEqual([...new Set(again.findings.filter((f) => f.nodeId.startsWith('I')).map((f) => f.checkId))], ['contrast']);
});

test('un hallazgo de la propia página se revisa con su regla de página', async () => {
  reset();
  addCollection({ ...collection('VariableCollectionId:9:1018', 'Tokens', ['light']), remote: false });
  page.explicitVariableModes = { 'VariableCollectionId:9:1018': 'light' };
  place([node('FRAME', { id: '3:1', name: 'Pantalla' })]);
  const again = await recheck([{ nodeId: page.id }]);
  assert.deepEqual(summary(again.findings, 'broken'), [[page.id, 'Modo «light» de «Tokens», una colección que ya no existe']]);
  assert.equal(again.scanned, 0);
});

test('una capa que ya no existe se queda fuera y sus hallazgos desaparecen de la lista', async () => {
  whiteToken();
  const frame = node('FRAME', { id: '3:1', name: 'Borrada', fills: [solid(WHITE)] });
  place([frame]);
  const first = await audit();
  place([]);
  const again = await recheck([{ nodeId: 'no-existe' }]);
  assert.deepEqual(again.findings, []);
  assert.deepEqual(mergeRechecked(first.findings, ['3:1', 'no-existe'], again.findings), []);
});

test('lo suelto de un slot se revisa recorriendo su instancia entera', async () => {
  whiteToken();
  const layer = node('SLOT', { id: '4:150', name: 'Content', componentPropertyReferences: { slotContentId: 'Content#9:0' } });
  const definitions = { 'Content#9:0': { type: 'SLOT', description: 'Filas', slotSettings: { minChildren: null, maxChildren: 2 }, preferredValues: [] } };
  const main = node('COMPONENT', { id: '4:100', name: 'List', componentPropertyDefinitions: definitions }, [layer]);
  place([main], library);
  const rows = ['4:201', '4:202', '4:203'].map((id) => node('FRAME', { id, name: id }));
  const slot = node('SLOT', { id: 'I4:171;4:150', name: 'Content' }, rows);
  const instance = node('INSTANCE', { id: '4:171', name: 'List', main }, [slot]);
  slot.parent = null;
  place([instance]);
  const first = await audit();
  const again = await recheck(recheckTargets(first.findings));
  assert.deepEqual(summary(again.findings, 'slots'), summary(first.findings, 'slots'));
  assert.equal(again.looseNodes, 4);
});
