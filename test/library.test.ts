import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUE, addCollection, addKit, addLibrary, alias, audit, collection, color, context, float, importCount, node, place, reset, solid, useVariables } from './figma';
import { onLibraryProgress } from '../src/library';
import { applyFix } from '../src/fixes';

// Un archivo de producto que usa las variables de su biblioteca, como el de prueba con FlySplit publicada como
// biblioteca (octubre de 2026): sin variables propias, el plugin no proponía nada ni conocía la escala.

/** #F8FAFC, el color/bg/canvas de FlySplit. */
const CANVAS = { r: 248 / 255, g: 250 / 255, b: 252 / 255, a: 1 };

/** Una biblioteca como la de FlySplit: semánticas que apuntan a primitivas ocultas, y una escala con números. */
function flySplitLibrary() {
  reset();
  const slate = color('LP:slate', 'slate/100', 'LP', { value: CANVAS });
  const grey = color('LP:grey', 'grey/900', 'LP', { value: { r: 0.1, g: 0.1, b: 0.1, a: 1 } });
  addLibrary('FlySplit', collection('LS', 'Semantic', ['light', 'dark']), [color('LS:canvas', 'color/bg/canvas', 'LS', { light: alias('LP:slate'), dark: alias('LP:grey') }, ['FRAME_FILL'])], [slate, grey]);
  addLibrary('FlySplit', collection('LK', 'Scale'), [float('LK:8', 'space/8', 'LK', { value: 8 }, ['GAP']), float('LK:16', 'space/16', 'LK', { value: 16 }, ['GAP'])]);
}

test('un color escrito a mano que vale lo mismo que una variable de la biblioteca la propone, y la corrección la enlaza', async () => {
  flySplitLibrary();
  const screen = node('FRAME', { name: 'Pantalla', fills: [solid(CANVAS)] });
  place([screen]);
  const f = (await audit()).findings.find((x) => x.checkId === 'color');
  assert.equal(f?.message, 'Relleno #F8FAFC sin token (coincide con color/bg/canvas)');
  assert.equal(await applyFix(screen, f!.fix!, await context()), true);
  assert.equal(screen.fills[0].boundVariables.color.id, 'LS:canvas');
});

test('con la escala de la biblioteca, lo que vale un paso se enlaza y lo que no sale fuera de escala', async () => {
  flySplitLibrary();
  const card = node('FRAME', { name: 'Tarjeta', layoutMode: 'VERTICAL', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, itemSpacing: 10 });
  place([node('FRAME', { name: 'Pantalla' }, [card])]);
  const spacing = (await audit()).findings.filter((x) => x.checkId === 'spacing' && x.nodeName === 'Tarjeta').map((x) => [x.message, x.fix?.kind]);
  assert.deepEqual(spacing.sort(), [
    ['Gap 10 fuera de escala (paso más cercano: 8, space/8)', undefined],
    ['Padding 16 sin token (existe space/16)', 'bind-float'],
  ]);
});

test('una biblioteca que publica sus primitivas: el enlace directo a una se avisa y se propone su semántica', async () => {
  reset();
  addLibrary('SDS', collection('CP', 'Color Primitives'), [color('CP:blue', 'blue/500', 'CP', { value: BLUE })]);
  addLibrary('SDS', collection('CS', 'Color'), [color('CS:brand', 'background/brand', 'CS', { value: alias('CP:blue') }, ['FRAME_FILL'])]);
  place([node('FRAME', { name: 'Pantalla' }, [node('FRAME', { name: 'Botón', fills: [solid(BLUE, { boundVariables: { color: alias('CP:blue') } })] })])]);
  const f = (await audit()).findings.find((x) => x.checkId === 'primitive');
  assert.match(f?.message ?? '', /^Relleno enlazado a la primitiva blue\/500/);
  assert.equal(f?.fix?.kind, 'bind-color');
  assert.equal(f?.fix && 'variableId' in f.fix ? f.fix.variableId : undefined, 'CS:brand');
});

test('las variables de la biblioteca se importan una vez por sesión, y en ajustes salen con su biblioteca', async () => {
  flySplitLibrary();
  const ctx = await context();
  // Solo las de color y las numéricas: la de fondo y los dos espacios.
  assert.equal(importCount(), 3);
  await context();
  assert.equal(importCount(), 3);
  assert.deepEqual(
    ctx.collectionsInfo().map((c) => [c.name, c.library ?? null, c.colorCount, c.floatCount]),
    [
      ['Semantic', 'FlySplit', 1, 0],
      ['Scale', 'FlySplit', 0, 2],
    ],
  );
});

/** Un archivo con su propia variable de marca, y una pantalla con ese azul escrito a mano. */
function ownBrand() {
  reset();
  const brand = color('CS:brand', 'background/brand', 'CS', { value: BLUE }, ['FRAME_FILL']);
  useVariables([collection('CS', 'Color')], [brand]);
  place([node('FRAME', { name: 'Pantalla', fills: [solid(BLUE)] })]);
  return brand;
}

const colorHint = async () => {
  const f = (await audit()).findings.find((x) => x.checkId === 'color');
  return [f?.message, f?.fix && 'variableId' in f.fix ? f.fix.variableId : undefined];
};

test('el archivo que publica la biblioteca no la importa: sus variables cuentan una vez', async () => {
  const brand = ownBrand();
  // Por si Figma le devuelve sus propias colecciones entre las bibliotecas activadas (no está documentado).
  addLibrary('Este archivo', collection('CS', 'Color'), [brand]);
  assert.deepEqual(await colorHint(), ['Relleno #0000FF sin token (coincide con background/brand)', 'CS:brand']);
  assert.equal(importCount(), 0);
});

test('una variable del archivo que llega también por una biblioteca no cuenta dos veces', async () => {
  const brand = ownBrand();
  addLibrary('Otra', { ...collection('CS', 'Color'), key: 'publicada' }, [brand]);
  assert.deepEqual(await colorHint(), ['Relleno #0000FF sin token (coincide con background/brand)', 'CS:brand']);
  assert.deepEqual((await context()).collectionsInfo().map((c) => [c.name, c.library ?? null, c.colorCount]), [['Color', null, 1]]);
});

test('una colección de biblioteca está publicada aunque Figma la dé por oculta: no por eso es primitiva', async () => {
  reset();
  // Visto el 02-10-2026 en el archivo de prueba: las dos colecciones de FlySplit salían «ocultas» en ajustes.
  const slate = color('LP:slate', 'slate/100', 'LP', { value: CANVAS });
  addLibrary('M3', collection('M3', 'M3', ['Light', 'Dark'], true), [color('M3:primary', 'Primary', 'M3', { Light: BLUE, Dark: BLUE }, ['ALL_FILLS'])]);
  addLibrary('FlySplit', collection('LS', 'Semantic', ['light', 'dark'], true), [color('LS:canvas', 'color/bg/canvas', 'LS', { light: alias('LP:slate'), dark: alias('LP:slate') }, ['FRAME_FILL'])], [slate]);
  place([node('FRAME', { name: 'Pantalla' }, [node('FRAME', { name: 'Botón', fills: [solid(BLUE, { boundVariables: { color: alias('M3:primary') } })] })])]);
  assert.deepEqual((await audit()).findings.filter((x) => x.checkId === 'primitive').map((x) => x.message), []);
  assert.deepEqual(
    (await context()).collectionsInfo().map((c) => [c.name, c.hidden, c.isPrimitive]),
    [
      ['M3', false, false],
      ['Semantic', false, false],
    ],
  );
});

test('sin el permiso de bibliotecas, solo cuentan las variables del archivo', async () => {
  flySplitLibrary();
  const figma = (globalThis as any).figma;
  const api = figma.teamLibrary;
  // Como en Figma: sin el permiso en el manifiesto, leer teamLibrary da error.
  Object.defineProperty(figma, 'teamLibrary', {
    get() {
      throw new Error('in get_teamLibrary: "teamlibrary" permission not specified in manifest.json');
    },
    configurable: true,
  });
  try {
    const ctx = await context();
    assert.equal(ctx.libraryVars.length, 0);
    assert.equal(importCount(), 0);
  } finally {
    Object.defineProperty(figma, 'teamLibrary', { value: api, writable: true, configurable: true });
  }
});

test('un kit de Figma que usan las capas cuenta como una biblioteca, aunque no salga entre las activadas', async () => {
  reset();
  // Como la casilla de Material 3: la colección «M3» no sale entre las bibliotecas, pero la capa dice que la usa.
  addKit(collection('M3', 'M3', ['Light', 'Dark']), [color('M3:primary', 'Schemes/Primary', 'M3', { Light: BLUE, Dark: BLUE }, ['ALL_FILLS'])]);
  place([node('FRAME', { name: 'Pantalla', fills: [solid(BLUE)], resolvedVariableModes: { M3: 'Light' } })]);
  const f = (await audit()).findings.find((x) => x.checkId === 'color');
  assert.equal(f?.message, 'Relleno #0000FF sin token (coincide con Schemes/Primary)');
  // Se recuerda para la sesión, también sin mirar las capas, y en ajustes sale como de fuera del archivo.
  assert.deepEqual((await context()).collectionsInfo().map((c) => [c.name, c.library ?? null]), [['M3', '']]);
});

test('una colección oculta de una biblioteca, que usan las capas pero no se puede listar, se salta', async () => {
  flySplitLibrary();
  // Las primitivas ocultas de FlySplit: las capas dicen que las usan, a través de los alias, pero no se publican.
  addCollection({ ...collection('LP', 'Primitives'), remote: true });
  place([node('FRAME', { name: 'Pantalla', fills: [solid(CANVAS)], resolvedVariableModes: { LP: 'value', LS: 'light' } })]);
  const f = (await audit()).findings.find((x) => x.checkId === 'color');
  assert.equal(f?.message, 'Relleno #F8FAFC sin token (coincide con color/bg/canvas)');
});

test('mientras importa, dice cuántas variables lleva de cuántas, y al acabar, que ha acabado', async () => {
  flySplitLibrary();
  const seen: Array<[number, number]> = [];
  onLibraryProgress((done, total) => seen.push([done, total]));
  try {
    await context();
  } finally {
    onLibraryProgress(null);
  }
  assert.ok(seen.some(([done, total]) => done < total), JSON.stringify(seen));
  const [done, total] = seen[seen.length - 1];
  assert.equal(done, total);
  // Lo ya importado en la sesión no vuelve a avisar.
  const again: Array<[number, number]> = [];
  onLibraryProgress((d, t) => again.push([d, t]));
  try {
    await context();
  } finally {
    onLibraryProgress(null);
  }
  assert.deepEqual(again, []);
});

test('un componente suelto de un kit no quita la corrección con un token propio, ni cambia la escala', async () => {
  reset();
  useVariables(
    [collection('CS', 'Color'), collection('CK', 'Scale')],
    [color('CS:white', 'bg/surface', 'CS', { value: { r: 1, g: 1, b: 1, a: 1 } }, ['FRAME_FILL']), float('CK:8', 'space/8', 'CK', { value: 8 }, ['GAP'])],
  );
  // Como FlySplit con un componente de Material 3 en un boceto: el kit tiene un blanco y un 10.
  addKit(collection('KS', 'M3'), [
    color('KS:white', 'Schemes/On Primary', 'KS', { value: { r: 1, g: 1, b: 1, a: 1 } }, ['ALL_FILLS']),
    color('KS:primary', 'Schemes/Primary', 'KS', { value: BLUE }, ['ALL_FILLS']),
    float('KS:10', 'Spacing/10', 'KS', { value: 10 }, ['GAP']),
  ]);
  // Un azul que solo tiene el kit tampoco se propone: en una pantalla de FlySplit sería un color de Material 3.
  const screen = node('FRAME', { name: 'Pantalla', fills: [solid({ r: 1, g: 1, b: 1, a: 1 })], layoutMode: 'VERTICAL', itemSpacing: 10 }, [node('RECTANGLE', { name: 'Marca', fills: [solid(BLUE)] })]);
  // La capa de primer nivel dice qué colecciones se usan dentro, como en Figma.
  place([node('FRAME', { name: 'Boceto', resolvedVariableModes: { KS: 'value' } }, [screen])]);
  const all = (await audit()).findings;
  assert.deepEqual(all.filter((f) => f.nodeName === 'Marca' && f.checkId === 'color').map((f) => f.message), ['Relleno #0000FF sin token']);
  const findings = all.filter((f) => f.nodeName === 'Pantalla');
  const fill = findings.find((f) => f.checkId === 'color');
  assert.equal(fill?.message, 'Relleno #FFFFFF sin token (coincide con bg/surface)');
  assert.equal(fill?.fix && 'variableId' in fill.fix ? fill.fix.variableId : undefined, 'CS:white');
  assert.deepEqual(findings.filter((f) => f.checkId === 'spacing').map((f) => f.message), ['Gap 10 fuera de escala (paso más cercano: 8, space/8)']);
});

test('de un kit no se importa lo que el archivo ya tiene: con colores y escala propios, nada', async () => {
  reset();
  useVariables(
    [collection('CS', 'Color'), collection('CK', 'Scale')],
    [
      color('CS:white', 'bg/surface', 'CS', { value: { r: 1, g: 1, b: 1, a: 1 } }, ['FRAME_FILL']),
      float('CK:8', 'space/8', 'CK', { value: 8 }, ['GAP']),
      float('CK:r4', 'radius/sm', 'CK', { value: 4 }, ['CORNER_RADIUS']),
    ],
  );
  addKit(collection('KS', 'M3'), [color('KS:primary', 'Schemes/Primary', 'KS', { value: BLUE }, ['ALL_FILLS']), float('KS:10', 'Spacing/10', 'KS', { value: 10 }, ['GAP'])]);
  place([node('FRAME', { name: 'Boceto', resolvedVariableModes: { KS: 'value' } })]);
  await audit();
  assert.equal(importCount(), 0);
});
