import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, audit, context, library, node, page, place, reset, solid } from './figma';
import { detachedCheck, stackedCheck, touchCheck } from '../src/checks/components';
import type { Settings } from '../src/types';

// ---------- Objetivo táctil ----------

const sized = (name: string, width: number, height: number) => node('COMPONENT', { name, width, height });

async function touch(target: any, overrides: Partial<Settings> = {}) {
  reset();
  place([target]);
  const found = await touchCheck.run(target, await context(overrides), page);
  return found?.map((f) => `[${f.severity}] ${f.message}`) ?? [];
}

test('el objetivo táctil mide el lado más corto contra los 24 px de WCAG 2.2 AA', async () => {
  // Un botón de escritorio de 32 px de alto pasa.
  assert.deepEqual(await touch(sized('Button', 120, 32)), []);
  assert.deepEqual(await touch(sized('Icon button', 20, 20)), ['[warning] Mide 20 × 20 px, por debajo de 24 px']);
  // 44 de alto no basta si mide 16 de ancho.
  assert.deepEqual(await touch(sized('Icon button', 16, 44)), ['[warning] Mide 16 × 44 px, por debajo de 24 px']);
});

test('con un mínimo de 44, los tamaños pequeños solo tienen que llegar a 24', async () => {
  const set = () => node('COMPONENT_SET', { name: 'Button' }, [sized('Size=md', 120, 44), sized('Size=sm', 96, 32), sized('Size=xs', 64, 20)]);
  assert.deepEqual(await touch(set(), { touchMin: 44 }), ['[warning] 1 de 3 variantes por debajo de 24 px (la más pequeña, 64 × 20 px)']);
  const withLarge = node('COMPONENT_SET', { name: 'Button' }, [sized('Size=lg', 140, 36), sized('Size=xs', 64, 20)]);
  assert.deepEqual(await touch(withLarge, { touchMin: 44 }), ['[warning] 2 de 2 variantes por debajo de 44 px, o 24 px en los tamaños pequeños (la más pequeña, 64 × 20 px)']);
});

// ---------- Variantes apiladas ----------

/** Una variante con su caja en el lienzo. */
const variant = (name: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) =>
  node('COMPONENT', { name, absoluteBoundingBox: { x, y, width, height }, width, height, ...extra });

async function stacked(variants: any[]) {
  reset();
  const set = node('COMPONENT_SET', { name: 'Selection/Checkbox' }, variants);
  place([set]);
  const found = await stackedCheck.run(set, await context(), page);
  return found?.map((f) => `[${f.severity}] ${f.message}`) ?? [];
}

test('una variante pequeña encima de otra grande está apilada, aunque se vean las dos', async () => {
  // El caso de FlySplit: cada Layout=Box, de 20 × 20, caía sobre el checkbox de su Layout=Row.
  const found = await stacked([
    variant('Layout=Row, State=Default', 0, 0, 255, 44),
    variant('Layout=Row, State=Hover', 0, 64, 255, 44),
    variant('Layout=Box, State=Default', 0, 0, 20, 20),
    variant('Layout=Box, State=Hover', 0, 64, 20, 20),
  ]);
  assert.deepEqual(found, ['[warning] 4 variantes apiladas sobre otras (p. ej. «Layout=Row, State=Default» y «Layout=Box, State=Default»)']);
});

test('un solape de unos píxeles entre filas sale como info, con cuánto', async () => {
  // Search-bar en un sistema de pruebas: dos filas que se pisan 4 px.
  const found = await stacked([variant('State=Enabled', 0, 0, 165, 48), variant('State=Filled', 0, 44, 165, 48), variant('State=Focus', 200, 0, 165, 48)]);
  assert.deepEqual(found, ['[info] 2 variantes se solapan con otras hasta 4 px (p. ej. «State=Enabled» y «State=Filled»)']);
});

test('variantes en rejilla, que se tocan sin pisarse, y las ocultas no cuentan', async () => {
  assert.deepEqual(await stacked([variant('A', 0, 0, 100, 40), variant('B', 100, 0, 100, 40), variant('C', 0, 40, 100, 40)]), []);
  assert.deepEqual(await stacked([variant('A', 0, 0, 100, 40), variant('B', 0, 0, 100, 40, { visible: false })]), []);
});

// ---------- Instancias desvinculadas ----------

/** Hallazgos de un frame desvinculado; `build` crea antes los componentes que haga falta. */
async function detached(info: unknown, build: () => void = () => {}) {
  reset();
  build();
  const frame = node('FRAME', { name: 'Card', detachedInfo: info });
  place([frame]);
  const found = await detachedCheck.run(frame, await context(), page);
  return found?.map((f) => `[${f.severity}] ${f.message}`) ?? [];
}

test('un frame desvinculado nombra su componente, o su set y variante', async () => {
  const card = () => place([node('COMPONENT', { id: '1:1', name: 'Card' })], library);
  assert.deepEqual(await detached({ type: 'local', componentId: '1:1' }, card), ['[warning] Instancia desvinculada de «Card»: ya no recibe los cambios del componente']);
  const button = () => place([node('COMPONENT_SET', { id: '1:5', name: 'Button' }, [node('COMPONENT', { id: '1:6', name: 'Size=Small' })])], library);
  assert.deepEqual(await detached({ type: 'local', componentId: '1:6' }, button), ['[warning] Instancia desvinculada de «Button (Size=Small)»: ya no recibe los cambios del componente']);
});

test('si el componente se eliminó o ya no existe, sale como información; el de una biblioteca no se nombra', async () => {
  // Figma devuelve los componentes eliminados fuera de toda página, también las variantes de un set eliminado.
  const deleted = () => node('COMPONENT_SET', { id: '8:1', name: 'World-Press-Photo-n1' }, [node('COMPONENT', { id: '8:2', name: 'Property 1=Child' })]);
  assert.deepEqual(await detached({ type: 'local', componentId: '8:2' }, deleted), ['[info] Instancia desvinculada de «World-Press-Photo-n1 (Property 1=Child)», un componente eliminado']);
  assert.deepEqual(await detached({ type: 'local', componentId: '404:1' }), ['[info] Instancia desvinculada de un componente que ya no existe']);
  assert.deepEqual(await detached({ type: 'library', componentKey: '9c4b0d67' }), ['[warning] Instancia desvinculada de un componente de biblioteca: ya no recibe sus cambios']);
});

test('solo cuentan los frames: los componentes, las instancias y los frames normales no se avisan', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  place([node('FRAME', { name: 'Pantalla', detachedInfo: null }), node('INSTANCE', { name: 'Card', main }), node('COMPONENT', { name: 'Otro' })]);
  const { findings } = await audit();
  assert.deepEqual(findings.filter((f) => f.checkId === 'detached'), []);
});

// ---------- Iconos y documentación ----------

/** Un icono: pequeño, sin relleno propio y hecho solo de formas, como los 1.722 de Simple Design System. */
const icon = (name: string, size = 24) => node('COMPONENT', { name, width: size, height: size }, [node('VECTOR', { name: 'Vector' })]);
const checkIds = (findings: { checkId: string }[]) => [...new Set(findings.map((f) => f.checkId))].sort();

test('un icono no pide descripción, estados ni objetivo táctil, aunque su nombre suene a control', async () => {
  reset();
  place([icon('Toggle Left'), icon('Radio'), node('COMPONENT_SET', { name: 'Icon / Check' }, [icon('Weight=Regular'), icon('Weight=Fill')])]);
  const { findings } = await audit();
  assert.deepEqual(checkIds(findings.filter((f) => ['description', 'states', 'touch'].includes(f.checkId))), []);
});

test('un botón de icono no es un icono: lleva el icono como instancia, o un relleno propio', async () => {
  reset();
  const glyph = icon('Star');
  place([glyph], library);
  const withInstance = node('COMPONENT', { name: 'Icon Button', width: 20, height: 20 }, [node('INSTANCE', { name: 'Star', main: glyph, overrides: [] }, [node('VECTOR')])]);
  const withFill = node('COMPONENT', { name: 'Toggle', width: 20, height: 20, fills: [solid(WHITE)] }, [node('VECTOR')]);
  place([withInstance, withFill]);
  const { findings } = await audit();
  for (const target of [withInstance, withFill]) {
    assert.deepEqual(checkIds(findings.filter((f) => f.nodeId === target.id && ['description', 'states', 'touch'].includes(f.checkId))), ['description', 'states', 'touch']);
  }
});

test('el enlace de documentación solo se pide si se activa en ajustes', async () => {
  reset();
  place([node('COMPONENT', { name: 'Card', description: 'Tarjeta para agrupar contenido relacionado.', documentationLinks: [] })]);
  const links = (fs: { checkId: string; message: string }[]) => fs.filter((f) => f.checkId === 'description').map((f) => f.message);
  assert.deepEqual(links((await audit()).findings), []);
  assert.deepEqual(links((await audit({ requireDocLinks: true })).findings), ['Sin enlace de documentación']);
});

// ---------- Contenido de relleno ----------

test('el relleno que es el valor por defecto de una propiedad de texto sale como información', async () => {
  reset();
  const label = node('TEXT', { name: 'Label', characters: 'Label', componentPropertyReferences: { characters: 'Label#12:0' } });
  const title = node('TEXT', { name: 'Title', characters: 'Title' });
  place([node('COMPONENT', { name: 'Card' }, [label, title])]);
  const found = (await audit()).findings.filter((f) => f.checkId === 'placeholder').map((f) => `[${f.severity}] ${f.nodeName}: ${f.message}`);
  // Sin propiedad, el relleno se queda en cada instancia: sigue siendo un aviso.
  assert.deepEqual(found, ['[info] Label: Contenido de relleno: "Label" (valor por defecto de la propiedad Label)', '[warning] Title: Contenido de relleno: "Title"']);
});
