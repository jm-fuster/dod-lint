import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GREY, WHITE, alias, audit, collection, color, library, node, place, reset, settings, solid, useVariables, withTokens } from './figma';
import { runAudit } from '../src/audit';
import { recheckTargets } from '../src/recheck';
import type { Finding } from '../src/types';

const NOTE = ' (override en instancia)';

/** Un blanco semántico, para que los rellenos blancos escritos a mano tengan corrección. */
function whiteToken() {
  reset();
  useVariables([collection('C3', 'Semantic')], [color('surface', 'surface/default', 'C3', { value: WHITE })]);
}

/** El componente Button, en otra página: lo que hereda cada instancia se audita en él, no en ella. */
function button(layers: any[] = []) {
  const main = node('COMPONENT', { id: '1:1', name: 'Button' }, layers);
  place([main], library);
  return main;
}

/** Una instancia con sus capas de dentro y lo que les sobrescribe, como `InstanceNode.overrides`. */
function instance(id: string, main: any, layers: any[], overrides: Array<[string, string[]]>) {
  return node('INSTANCE', { id, name: 'Button', main, overrides: overrides.map(([layer, overriddenFields]) => ({ id: layer, overriddenFields })) }, layers);
}

const label = (id: string, props: Record<string, unknown> = {}) => node('TEXT', { id, name: 'Label', fills: [solid(WHITE)], ...props });
const of = (fs: Finding[], checkId: string) => fs.filter((f) => f.checkId === checkId).map((f) => [f.nodeId, f.message]);

test('un color escrito a mano en una capa de una instancia sale como override, con corrección', async () => {
  whiteToken();
  const main = button();
  place([instance('2:1', main, [label('I2:1;1:2')], [['I2:1;1:2', ['fills']]]), instance('2:2', main, [label('I2:2;1:2')], [])]);
  const { findings } = await audit();
  const colors = findings.filter((f) => f.checkId === 'color');
  // La segunda instancia hereda el relleno del componente: se audita en él.
  assert.deepEqual(of(colors, 'color'), [['I2:1;1:2', `Relleno #FFFFFF sin token (coincide con surface/default)${NOTE}`]]);
  assert.equal(colors[0].fix?.kind, 'bind-color');
  assert.equal(colors[0].overridden, true);
  assert.equal(colors[0].ignoreKey, 'color|I2:1;1:2');
});

test('solo cuenta lo sobrescrito: cambiar el contenido de un texto no hace revisar su color ni su estilo', async () => {
  whiteToken();
  const main = button();
  place([
    instance('2:1', main, [label('I2:1;1:2', { characters: 'Lorem ipsum dolor' }), label('I2:1;1:3', { characters: 'Comprar' })], [
      ['I2:1;1:2', ['characters', 'styledTextSegments']],
      ['I2:1;1:3', ['characters', 'styledTextSegments']],
    ]),
  ]);
  const { findings } = await audit();
  assert.deepEqual(of(findings, 'placeholder'), [['I2:1;1:2', `Contenido de relleno: "Lorem ipsum dolor"${NOTE}`]]);
  assert.deepEqual([...of(findings, 'color'), ...of(findings, 'text')], []);
});

test('la tipografía y el padding sobrescritos cuentan cada uno por su lado', async () => {
  whiteToken();
  const main = button();
  const text = label('I2:1;1:2', { fills: [], textAutoResize: 'NONE' });
  const box = node('FRAME', { id: 'I2:1;1:4', name: 'Box', layoutMode: 'HORIZONTAL', paddingLeft: 12, itemSpacing: 8 });
  place([instance('2:1', main, [text, box], [['I2:1;1:2', ['fontSize', 'textStyleId']], ['I2:1;1:4', ['paddingLeft']]])]);
  const { findings } = await audit({}, withTokens);
  // La caja fija sin truncado viene del componente: la instancia solo cambió la tipografía.
  assert.deepEqual(of(findings, 'text'), [['I2:1;1:2', `Texto sin estilo de texto ni variables tipográficas (Inter Regular 14)${NOTE}`]]);
  assert.deepEqual(of(findings, 'spacing'), [['I2:1;1:4', `Padding 12 sin token${NOTE}`]]);
});

test('un campo que Figma marca como sobrescrito pero vale lo mismo que en el componente no cuenta', async () => {
  whiteToken();
  // En el componente, el mismo relleno blanco y la misma caja fija: se avisan allí.
  const main = button([label('1:2', { textAutoResize: 'NONE' })]);
  const same = label('I2:1;1:2', { textAutoResize: 'NONE' });
  const changed = label('I2:2;1:2', { fills: [solid(GREY)], textAutoResize: 'NONE' });
  place([
    instance('2:1', main, [same], [['I2:1;1:2', ['fills', 'textAutoResize']]]),
    instance('2:2', main, [changed], [['I2:2;1:2', ['fills', 'textAutoResize']]]),
  ]);
  const { findings } = await audit();
  assert.deepEqual(of(findings, 'color'), [['I2:2;1:2', `Relleno #E6E6E6 sin token${NOTE}`]]);
  assert.deepEqual(of(findings, 'text'), []);
});

test('en lo que la instancia intercambió, se compara con el componente de lo intercambiado', async () => {
  whiteToken();
  // El icono de Button era otro: la capa no existe en él, sino en Icon/Star.
  const main = button();
  const star = node('COMPONENT', { id: '9:1', name: 'Icon/Star' }, [node('VECTOR', { id: '9:2', name: 'Vector', fills: [solid(WHITE)] })]);
  place([main, star], library);
  const vector = node('VECTOR', { id: 'I2:1;1:5;9:2', name: 'Vector', fills: [solid(WHITE)] });
  const swapped = node('INSTANCE', { id: 'I2:1;1:5', name: 'Icon/Star', main: star }, [vector]);
  place([instance('2:1', main, [swapped], [['I2:1;1:5;9:2', ['fills']]])]);
  assert.deepEqual(of((await audit()).findings, 'color'), []);
  vector.fills = [solid(GREY)];
  assert.deepEqual(of((await audit()).findings, 'color'), [['I2:1;1:5;9:2', `Relleno #E6E6E6 sin token${NOTE}`]]);
});

test('en la raíz de una instancia, lo marcado que vale lo mismo que en el componente tampoco cuenta', async () => {
  whiteToken();
  const main = node('COMPONENT', { id: '1:1', name: 'Card', fills: [solid(WHITE)] });
  place([main], library);
  const card = (id: string, fill: typeof WHITE) => node('INSTANCE', { id, name: 'Card', main, fills: [solid(fill)], overrides: [{ id, overriddenFields: ['fills'] }] });
  place([card('2:1', WHITE), card('2:2', GREY)]);
  assert.deepEqual(of((await audit()).findings, 'color'), [['2:2', `Relleno #E6E6E6 sin token${NOTE}`]]);
});

test('las capas de las instancias anidadas salen de la exterior, sin entrar en ellas', async () => {
  whiteToken();
  const main = button();
  const deep = label('I2:1;1:5;3:2');
  const entries: Array<[string, string[]]> = [['I2:1;1:5;3:2', ['fills']]];
  // La anidada también lista lo que la exterior le sobrescribe (medido en un sistema de pruebas, septiembre de 2026).
  const nested = node('INSTANCE', { id: 'I2:1;1:5', name: 'Icon', fills: [solid(WHITE)], overrides: entries.map(([id, overriddenFields]) => ({ id, overriddenFields })) }, [deep]);
  place([instance('2:1', main, [nested], entries)]);
  const { findings } = await audit();
  assert.deepEqual(of(findings, 'color'), [['I2:1;1:5;3:2', `Relleno #FFFFFF sin token (coincide con surface/default)${NOTE}`]]);
});

test('lo de dentro de un slot se audita entero una vez, y el slot sobrescrito, por lo suyo', async () => {
  whiteToken();
  const main = button();
  const owned = node('FRAME', { id: 'I2:1;1:10;5:1', name: 'Propio', fills: [solid(WHITE)], layoutMode: 'VERTICAL', paddingLeft: 12 });
  const slot = node('SLOT', { id: 'I2:1;1:10', name: 'Content', fills: [solid(WHITE)], componentPropertyReferences: { slotContentId: 'Content#1:0' }, limitViolations: [] }, [owned]);
  place([instance('2:1', main, [slot], [['I2:1;1:10', ['fills']], ['I2:1;1:10;5:1', ['fills']]])]);
  const { findings } = await audit({}, withTokens);
  assert.deepEqual(of(findings, 'color'), [
    ['I2:1;1:10', `Relleno #FFFFFF sin token (coincide con surface/default)${NOTE}`],
    ['I2:1;1:10;5:1', 'Relleno #FFFFFF sin token (coincide con surface/default)'],
  ]);
  // El contenido propio se revisa entero: también su padding, que no sobrescribe nadie.
  assert.deepEqual(of(findings, 'spacing'), [['I2:1;1:10;5:1', 'Padding 12 sin token']]);
  assert.equal(findings.find((f) => f.nodeId === 'I2:1;1:10;5:1')?.overridden, undefined);
});

test('un texto sobrescrito se revisa por contraste, que se agrupa, y por su color, que no', async () => {
  whiteToken();
  const main = button();
  const grey = (id: string) => label(id, { fills: [solid(GREY)] });
  place([instance('2:1', main, [grey('I2:1;1:2')], [['I2:1;1:2', ['fills']]]), instance('2:2', main, [grey('I2:2;1:2')], [['I2:2;1:2', ['fills']]])]);
  const { findings } = await audit();
  const contrast = findings.filter((f) => f.checkId === 'contrast');
  assert.equal(contrast.length, 1);
  assert.match(contrast[0].message, /se repite en 2 instancias/);
  assert.equal(contrast[0].ignoreKey, 'contrast|src:1:2');
  assert.deepEqual(findings.filter((f) => f.checkId === 'color').map((f) => [f.nodeId, f.ignoreKey, f.overridden]), [
    ['I2:1;1:2', 'color|I2:1;1:2', true],
    ['I2:2;1:2', 'color|I2:2;1:2', true],
  ]);
});

test('una variable rota en lo sobrescrito sale; un estilo roto heredado, no', async () => {
  whiteToken();
  const main = button();
  const broken = label('I2:1;1:2', { fills: [solid(WHITE, { boundVariables: { color: alias('gone') } })] });
  const styled = label('I2:1;1:3', { fills: [], textStyleId: 'S:gone' });
  place([instance('2:1', main, [broken, styled], [['I2:1;1:2', ['fills']], ['I2:1;1:3', ['characters']]])]);
  const { findings } = await audit();
  assert.deepEqual(of(findings, 'broken'), [['I2:1;1:2', `Variable no disponible en fills[0]${NOTE}`]]);
  assert.equal(findings.find((f) => f.checkId === 'broken')?.fix?.kind, 'unbind-paint');
});

test('las capas sobrescritas que cuelgan de una capa ignorada no se miran', async () => {
  whiteToken();
  const main = button();
  const wip = node('FRAME', { id: 'I2:1;1:6', name: '_wip' }, [label('I2:1;1:7')]);
  place([instance('2:1', main, [wip], [['I2:1;1:7', ['fills']]])]);
  assert.deepEqual(of((await audit({ ignorePrefixes: ['_'] })).findings, 'color'), []);
});

test('entrando en las instancias, las capas se auditan enteras, sin coletilla', async () => {
  whiteToken();
  const main = button();
  place([instance('2:1', main, [label('I2:1;1:2')], [['I2:1;1:2', ['fills']]])]);
  const colors = (await audit({ includeInstanceInternals: true })).findings.filter((f) => f.checkId === 'color');
  assert.deepEqual(of(colors, 'color'), [['I2:1;1:2', 'Relleno #FFFFFF sin token (coincide con surface/default)']]);
  assert.equal(colors[0].overridden, undefined);
});

test('revisar de nuevo una capa sobrescrita mira solo lo sobrescrito, y nada si ya no lo está', async () => {
  whiteToken();
  const main = button();
  // El trazo escrito a mano viene del componente: nunca sale en la instancia.
  const layer = label('I2:1;1:2', { strokes: [solid(WHITE)] });
  const inst = instance('2:1', main, [layer], [['I2:1;1:2', ['fills']]]);
  place([inst]);
  const first = await audit();
  const targets = recheckTargets(first.findings.filter((f) => f.checkId === 'color'));
  assert.deepEqual(targets, [{ nodeId: 'I2:1;1:2', overridden: true }]);
  const recheck = () => runAudit('page', settings(), { recheck: targets, lang: 'es' });
  assert.deepEqual(of((await recheck()).findings, 'color'), of(first.findings, 'color'));

  // Quitado el override, la capa vuelve a ser la del componente: sus hallazgos desaparecen.
  inst.overrides = [];
  assert.deepEqual((await recheck()).findings, []);
});

test('si sus capas no tienen overrides que mire alguna regla, la instancia no se recorre buscándolas', async () => {
  whiteToken();
  const main = button();
  const inst = instance('2:1', main, [label('I2:1;1:2')], [['2:1', ['name']], ['I2:1;1:2', ['name', 'reactions']]]);
  place([inst]);
  let searched = 0;
  const findAll = inst.findAll;
  inst.findAll = (...args: any[]) => (searched++, findAll(...args));
  await audit();
  assert.equal(searched, 0);
});

test('si el override de un slot desaparece, revisar de nuevo le deja sus avisos de slot', async () => {
  whiteToken();
  const defs = { 'Content#1:0': { type: 'SLOT', description: 'Filas', slotSettings: { minChildren: null, maxChildren: 1 }, preferredValues: [] } };
  const main = node('COMPONENT', { id: '1:1', name: 'List', componentPropertyDefinitions: defs });
  place([main], library);
  const rows = [node('FRAME', { id: 'I2:1;1:10;5:1', name: 'Fila 1' }), node('FRAME', { id: 'I2:1;1:10;5:2', name: 'Fila 2' })];
  const slot = node('SLOT', { id: 'I2:1;1:10', name: 'Content', fills: [solid(WHITE)], componentPropertyReferences: { slotContentId: 'Content#1:0' }, limitViolations: ['ABOVE_MAX'] }, rows);
  const inst = instance('2:1', main, [slot], [['I2:1;1:10', ['fills']]]);
  place([inst]);
  const first = await audit();
  assert.deepEqual(first.findings.filter((f) => f.nodeId === 'I2:1;1:10').map((f) => f.checkId).sort(), ['color', 'slots']);
  const targets = recheckTargets(first.findings.filter((f) => f.nodeId === 'I2:1;1:10'));
  assert.deepEqual(targets, [{ nodeId: 'I2:1;1:10', overridden: true }]);
  inst.overrides = [];
  const again = await runAudit('page', settings(), { recheck: targets, lang: 'es' });
  assert.deepEqual(again.findings.map((f) => f.checkId), ['slots']);
});
