import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, alias, audit, collection, color, context, float, library, node, page, place, reset, settings, solid, useVariables } from './figma';
import { runAudit } from '../src/audit';
import { ALL_CHECKS } from '../src/settings';
import type { Settings } from '../src/types';

// Cada lectura de una propiedad cruza al hilo de Figma (medido en un sistema de pruebas en septiembre de 2026:
// 255 µs los rellenos de una capa, 130 µs sus variables enlazadas, 35-65 µs cada campo de una variable).
// Varias reglas miran lo mismo, así que la auditoría lo lee una vez y lo comparte.

/** Mientras el simulado resuelve una variable, sus lecturas no cuentan: en Figma lo hace el propio Figma. */
let resolving = false;
function quietResolve(vars: any[]) {
  for (const v of vars) {
    const resolve = v.resolveForConsumer.bind(v);
    v.resolveForConsumer = (n: any) => {
      resolving = true;
      try {
        return resolve(n);
      } finally {
        resolving = false;
      }
    };
  }
}

/** Cuenta las lecturas de unas propiedades de un objeto del simulado. */
function countReads(target: any, keys: string[]): Record<string, number> {
  const reads: Record<string, number> = {};
  for (const key of keys) {
    let value = target[key];
    Object.defineProperty(target, key, {
      get: () => {
        if (!resolving) reads[key] = (reads[key] ?? 0) + 1;
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

test('las reglas comparten lo leído de cada capa: rellenos, trazos, estilos, variables enlazadas, nombre', async () => {
  reset();
  const surface = color('surface', 'surface/default', 'C3', { value: WHITE });
  useVariables([collection('C3', 'Semantic')], [surface]);
  quietResolve([surface]);
  const text = node('TEXT', { id: '3:2', name: 'Label', fills: [solid(WHITE)] });
  const frame = node('FRAME', { id: '3:1', name: 'Card', fills: [solid(WHITE)], layoutMode: 'VERTICAL', paddingLeft: 12 }, [text]);
  place([frame]);
  const keys = ['fills', 'strokes', 'fillStyleId', 'strokeStyleId', 'boundVariables', 'name', 'visible', 'explicitVariableModes', 'resolvedVariableModes', 'parent'];
  const frameReads = countReads(frame, keys);
  const textReads = countReads(text, [...keys, 'characters', 'textStyleId']);
  const { findings } = await audit();
  assert.ok(findings.length > 0);
  for (const [key, n] of Object.entries(frameReads)) assert.ok(n <= 1, `el frame lee ${key} ${n} veces`);
  for (const [key, n] of Object.entries(textReads)) assert.ok(n <= 1, `el texto lee ${key} ${n} veces`);
});

test('de cada variable se lee una vez su colección, sus valores, sus ámbitos y su nombre', async () => {
  reset();
  const prims = collection('P', 'Primitives', ['value'], true);
  const sem = collection('S', 'Semantic', ['light', 'dark']);
  const blue = color('blue', 'blue/500', 'P', { value: WHITE });
  const semantic = [0, 1, 2, 3].map((i) => color(`s${i}`, `surface/${i}`, 'S', { light: alias(i === 0 ? 'blue' : 'other'), dark: alias('blue') }));
  const grey = color('other', 'grey/100', 'P', { value: WHITE });
  useVariables([prims, sem], [blue, grey, ...semantic]);
  quietResolve([blue, grey, ...semantic]);
  // Varias capas enlazadas a la primitiva: cada una busca a qué semántica pasarse.
  place([0, 1, 2].map((i) => node('FRAME', { id: `4:${i}`, name: `Caja ${i}`, fills: [solid(WHITE, { boundVariables: { color: alias('blue') } })] })));
  const reads = semantic.map((v) => countReads(v, ['variableCollectionId', 'valuesByMode', 'scopes', 'name']));
  const { findings } = await audit();
  assert.equal(findings.filter((f) => f.checkId === 'primitive').length, 3);
  for (const [i, r] of reads.entries()) for (const [key, n] of Object.entries(r)) assert.ok(n <= 1, `surface/${i} lee ${key} ${n} veces`);
});

test('la capa del componente se lee una vez aunque la sobrescriban muchas instancias', async () => {
  reset();
  const source = node('FRAME', { id: '1:2', name: 'State layer', fills: [solid(WHITE)] });
  const main = node('COMPONENT', { id: '1:1', name: 'Slider' }, [source]);
  place([main], library);
  // Tres instancias que cambian el relleno de esa capa, cada una a su color.
  const layers = [0, 1, 2].map((i) => node('FRAME', { id: `I2:${i};1:2`, name: 'State layer', fills: [solid({ r: i / 4, g: 0, b: 0, a: 1 })] }));
  const instances = layers.map((layer, i) =>
    node('INSTANCE', { id: `2:${i}`, name: 'Slider', main, overrides: [{ id: layer.id, overriddenFields: ['fills'] }] }, [layer]),
  );
  place(instances);
  const sourceReads = countReads(source, ['fills']);
  const layerReads = layers.map((l) => countReads(l, ['fills']));
  const { findings } = await audit();
  // Los tres rellenos cambian de verdad: salen los tres, y el del componente no.
  assert.deepEqual(findings.filter((f) => f.checkId === 'color').map((f) => f.nodeId), layers.map((l) => l.id));
  assert.ok((sourceReads.fills ?? 0) <= 1, `el componente lee fills ${sourceReads.fills} veces`);
  for (const [i, r] of layerReads.entries()) assert.ok((r.fills ?? 0) <= 1, `la capa ${i} lee fills ${r.fills} veces`);
});

test('las variables candidatas de un espaciado se buscan una vez por valor y modos', async () => {
  reset();
  useVariables([collection('CS', 'Spacing')], [float('V16', 'space/16', 'CS', { value: 16 }, ['GAP'])]);
  const ctx = await context();
  let searches = 0;
  const search = ctx.floatVarsForValue.bind(ctx);
  ctx.floatVarsForValue = (value: number, n: SceneNode) => (searches++, search(value, n));
  const [a, b] = [node('FRAME', { name: 'A' }), node('FRAME', { name: 'B' })];
  place([a, b]);
  const first = ctx.floatVarsForField(16, a, 'spacing');
  assert.equal(ctx.floatVarsForField(16, b, 'spacing'), first);
  assert.deepEqual(first.preferred.map((v) => v.name), ['space/16']);
  assert.equal(searches, 1);
  ctx.floatVarsForField(12, a, 'spacing');
  ctx.floatVarsForField(16, a, 'radius');
  assert.equal(searches, 3);
});

/** Solo una regla, para contar lo que lee ella. */
const only = (id: string) => ({ enabled: Object.fromEntries(ALL_CHECKS.map((c) => [c, c === id])) as Settings['enabled'] });
const hexColor = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });

test('el contraste no lee el contenido, el tamaño ni el peso de un texto que pasa', async () => {
  reset();
  const text = node('TEXT', { name: 'Label', fills: [solid(hexColor('#000000'))] });
  place([node('FRAME', { name: 'Pantalla', fills: [solid(WHITE)] }, [text])]);
  const reads = countReads(text, ['characters', 'fontSize', 'fontWeight']);
  await audit(only('contrast'));
  assert.deepEqual(reads, {});
});

test('de un texto grande que no llega a 4,5:1 se lee el tamaño, y el peso no hace falta', async () => {
  reset();
  // #949494 sobre blanco da 3,03:1: pasa a 24 px, que pide 3:1.
  const text = node('TEXT', { name: 'Title', fills: [solid(hexColor('#949494'))], fontSize: 24 });
  place([node('FRAME', { name: 'Pantalla', fills: [solid(WHITE)] }, [text])]);
  const reads = countReads(text, ['fontSize', 'fontWeight']);
  const { findings } = await audit(only('contrast'));
  assert.deepEqual(findings, []);
  assert.deepEqual(reads, { fontSize: 1 });
});

test('de una capa hermana que no queda debajo del texto no se leen los rellenos', async () => {
  reset();
  const aside = node('RECTANGLE', { name: 'Icono', fills: [solid(hexColor('#FF0000'))], absoluteBoundingBox: { x: 200, y: 0, width: 24, height: 24 } });
  const under = node('RECTANGLE', { name: 'Fondo', fills: [solid(WHITE)], absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 48 } });
  const text = node('TEXT', { name: 'Label', fills: [solid(hexColor('#000000'))] });
  place([node('FRAME', { name: 'Pantalla' }, [under, aside, text])]);
  const asideReads = countReads(aside, ['fills']);
  const underReads = countReads(under, ['fills']);
  await audit(only('contrast'));
  assert.deepEqual(asideReads, {});
  assert.deepEqual(underReads, { fills: 1 });
});

test('recorriendo la página entera, los textos de las instancias se buscan una vez; con una selección, en cada una', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  const instances = [1, 2, 3].map((i) => node('INSTANCE', { id: `2:${i}`, name: 'Card', main }, [node('TEXT', { id: `I2:${i};1:2`, name: 'Label', fills: [solid(WHITE)] })]));
  place(instances);
  let inInstances = 0;
  for (const inst of instances) {
    const search = inst.findAllWithCriteria;
    inst.findAllWithCriteria = (q: { types: string[] }) => (q.types.includes('TEXT') && inInstances++, search(q));
  }
  const pageSearch = page.findAllWithCriteria;
  let onPage = 0;
  page.findAllWithCriteria = (q: { types: string[] }) => (q.types.includes('TEXT') && onPage++, pageSearch(q));
  try {
    const { findings } = await audit(only('contrast'));
    assert.deepEqual([inInstances, onPage], [0, 1]);
    // Los tres textos se miden igual que buscándolos instancia por instancia.
    assert.equal(findings.filter((f) => f.checkId === 'contrast').length, 1);
    page.selection = [instances[0]];
    await runAudit('selection', settings(only('contrast')), { lang: 'es' });
    assert.deepEqual([inInstances, onPage], [1, 1]);
  } finally {
    page.findAllWithCriteria = pageSearch;
  }
});

test('en una página sin slots, las instancias no los buscan una a una', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  const inst = node('INSTANCE', { id: '2:1', name: 'Card', main }, [node('TEXT', { id: 'I2:1;1:2', name: 'Label' })]);
  place([inst]);
  let searches = 0;
  const search = inst.findAllWithCriteria;
  inst.findAllWithCriteria = (q: { types: string[] }) => (q.types.includes('SLOT') && searches++, search(q));
  await audit();
  assert.equal(searches, 0);
  // Con un slot en la página, sí: las instancias lo buscan entre lo suyo.
  place([inst, node('SLOT', { id: '3:1', name: 'Content' })]);
  await audit();
  assert.ok(searches > 0);
});
