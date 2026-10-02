import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, alias, audit, library, node, place, reset, solid } from './figma';
import { ALL_CHECKS } from '../src/settings';
import type { Finding, Settings } from '../src/types';

// Referencias rotas: lo que hereda una instancia se revisa en su componente, salvo que no se pueda revisar allí.

const broken = (fs: Finding[]) => fs.filter((f) => f.checkId === 'broken').map((f) => [f.nodeId, f.message]);
/** Un relleno blanco enlazado a una variable que ya no existe. */
const goneFill = () => [solid(WHITE, { boundVariables: { color: alias('gone') } })];

/** Cuenta las lecturas de unas propiedades de una capa del simulado. */
function countReads(target: any, keys: string[]): Record<string, number> {
  const reads: Record<string, number> = {};
  for (const key of keys) {
    let value = target[key];
    Object.defineProperty(target, key, {
      get: () => {
        reads[key] = (reads[key] ?? 0) + 1;
        return value;
      },
      set: (v) => {
        value = v;
      },
      configurable: true,
    });
  }
  return reads;
}

test('la instancia de un componente del archivo no repite lo roto que hereda: se avisa en el componente', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card', fills: goneFill() });
  place([main], library);
  // Sin overrides: el relleno roto es el del componente.
  place([node('INSTANCE', { id: '2:1', name: 'Card', main, fills: goneFill() })]);
  assert.deepEqual(broken((await audit()).findings), []);
});

test('lo que una instancia sobrescribe con una variable rota sí se avisa en ella', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card', fills: [solid(WHITE)] });
  place([main], library);
  place([node('INSTANCE', { id: '2:1', name: 'Card', main, fills: goneFill(), overrides: [{ id: '2:1', overriddenFields: ['fills'] }] })]);
  assert.deepEqual(broken((await audit()).findings), [['2:1', 'Variable no disponible en fills[0] (override en instancia)']]);
});

test('de un componente de biblioteca o eliminado, lo roto heredado solo se ve en la instancia', async () => {
  reset();
  const remote = node('COMPONENT', { id: 'R:1', name: 'Card', remote: true, fills: goneFill() });
  // Eliminado: Figma lo devuelve fuera de toda página.
  const deleted = node('COMPONENT', { id: '1:9', name: 'Old card', fills: goneFill() });
  place([node('INSTANCE', { id: '2:1', name: 'Card', main: remote, fills: goneFill() }), node('INSTANCE', { id: '2:2', name: 'Old card', main: deleted, fills: goneFill() })]);
  assert.deepEqual(broken((await audit()).findings), [
    ['2:1', 'Variable no disponible en fills[0]'],
    ['2:2', 'Variable no disponible en fills[0]'],
    ['2:2', 'Componente principal eliminado (restaurable desde la instancia)'],
  ]);
});

test('un modo de una colección borrada puesto en la instancia se avisa aunque herede lo demás', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  // Como en Figma: el modo puesto en una instancia sale entre lo que sobrescribe.
  place([node('INSTANCE', { id: '2:1', name: 'Card', main, explicitVariableModes: { gone: 'dark' }, overrides: [{ id: '2:1', overriddenFields: ['explicitVariableModes'] }] })]);
  assert.deepEqual(broken((await audit()).findings), [['2:1', 'Modo de una colección que ya no está disponible']]);
});

test('un modo que la instancia hereda de su componente se avisa una vez, en el componente', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card', explicitVariableModes: { gone: 'dark' } });
  place([main, node('INSTANCE', { id: '2:1', name: 'Card', main, explicitVariableModes: { gone: 'dark' } })]);
  assert.deepEqual(broken((await audit()).findings), [['1:1', 'Modo de una colección que ya no está disponible']]);
});

test('de un componente se lee una vez si es de biblioteca y de qué cuelga, aunque tenga muchas instancias', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  place([1, 2, 3, 4].map((i) => node('INSTANCE', { id: `2:${i}`, name: 'Card', main })));
  const reads = countReads(main, ['remote', 'parent']);
  await audit({ enabled: Object.fromEntries(ALL_CHECKS.map((c) => [c, c === 'broken'])) as Settings['enabled'] });
  assert.deepEqual(reads, { remote: 1, parent: 1 });
});

test('sin trazos no se lee el estilo de trazo, y de la instancia que hereda no se lee lo heredado', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  const frame = node('FRAME', { id: '3:1', name: 'Caja', strokes: [], strokeStyleId: '' });
  const outlined = node('FRAME', { id: '3:2', name: 'Borde', strokes: [solid(WHITE)], strokeStyleId: 'S:gone' });
  const inst = node('INSTANCE', { id: '2:1', name: 'Card', main, effectStyleId: '', gridStyleId: '' });
  place([frame, outlined, inst]);
  const frameReads = countReads(frame, ['strokeStyleId']);
  const instReads = countReads(inst, ['boundVariables', 'strokes', 'strokeStyleId', 'effectStyleId', 'gridStyleId']);
  // Solo esta regla: el espaciado también lee las variables de la instancia, para saber si se usan tokens.
  const { findings } = await audit({ enabled: Object.fromEntries(ALL_CHECKS.map((c) => [c, c === 'broken'])) as Settings['enabled'] });
  assert.deepEqual(frameReads, {});
  assert.deepEqual(instReads, {});
  // Con trazos, el estilo se mira, y uno que ya no existe se avisa.
  assert.deepEqual(broken(findings), [['3:2', 'Estilo no disponible en strokeStyleId']]);
});
