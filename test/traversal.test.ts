import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GREY, WHITE, alias, audit, collection, color, library, node, place, reset, solid, useVariables } from './figma';
import type { Color } from './figma';
import { DEFAULT_SETTINGS } from '../src/settings';

/** Un blanco semántico, para que los rellenos blancos escritos a mano tengan corrección. */
function whiteToken() {
  reset();
  useVariables([collection('C3', 'Semantic')], [color('surface', 'surface/default', 'C3', { value: WHITE })]);
}
const literalFrame = (id: string, name: string) => node('FRAME', { id, name, fills: [solid(WHITE)] });

/**
 * Instancia de Card con un slot que tiene un hijo heredado del componente (`I<instancia>;<capa>`) y otro
 * puesto en esta instancia (`<slot>;<capa>`), los dos con relleno escrito a mano.
 */
function cardInstance() {
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  const slot = node('SLOT', { id: 'I2:1;1:10', name: 'Content', componentPropertyReferences: { slotContentId: 'Content#1:0' }, limitViolations: [] }, [
    literalFrame('I2:1;1:11', 'Heredado'),
    literalFrame('I2:1;1:10;5:1', 'Propio'),
  ]);
  return node('INSTANCE', { id: '2:1', name: 'Card', main }, [slot]);
}

const colors = (findings: Array<{ checkId: string; nodeName: string; fix?: { kind: string } }>) =>
  findings.filter((f) => f.checkId === 'color').map((f) => [f.nodeName, f.fix?.kind]);

test('de una instancia solo se audita lo que se puso en sus slots, con corrección', async () => {
  whiteToken();
  place([cardInstance()]);
  const result = await audit();
  assert.deepEqual(colors(result.findings), [['Propio', 'bind-color']]);
  assert.equal(result.scanned, 3); // la instancia, el slot y su contenido propio
});

test('entrando en las instancias, el contenido heredado se audita sin corrección', async () => {
  whiteToken();
  place([cardInstance()]);
  const result = await audit({ includeInstanceInternals: true });
  assert.deepEqual(colors(result.findings), [['Heredado', undefined], ['Propio', 'bind-color']]);
});

test('las capas ocultas se saltan salvo con "Incluir capas ocultas"', async () => {
  whiteToken();
  const hidden = literalFrame('3:2', 'Oculta');
  hidden.visible = false;
  place([node('FRAME', { id: '3:1', name: 'Pantalla' }, [hidden])]);
  assert.deepEqual(colors((await audit()).findings), []);
  assert.deepEqual(colors((await audit({ includeHidden: true })).findings), [['Oculta', 'bind-color']]);
});

test('un slot que Figma devuelve suelto tras deshacer se señala en su instancia, sin correcciones', async () => {
  whiteToken();
  const layer = node('SLOT', { id: '4:150', name: 'Content', componentPropertyReferences: { slotContentId: 'Content#9:0' } });
  const definitions = { 'Content#9:0': { type: 'SLOT', description: 'Filas de la lista', slotSettings: { minChildren: null, maxChildren: 2 }, preferredValues: [] } };
  const main = node('COMPONENT', { id: '4:100', name: 'List', componentPropertyDefinitions: definitions }, [layer]);
  place([main], library);
  // Sin referencia a su propiedad y sin padre, aunque la instancia lo tenga entre sus hijos.
  const slot = node('SLOT', { id: 'I4:171;4:150', name: 'Content' }, [
    literalFrame('4:201', 'Fila 1'),
    node('FRAME', { id: '4:202', name: 'Fila 2' }),
    node('FRAME', { id: '4:203', name: 'Fila 3' }),
  ]);
  const instance = node('INSTANCE', { id: '4:171', name: 'List', main }, [slot]);
  slot.parent = null;
  place([instance]);

  const result = await audit();
  assert.equal(result.looseNodes, 4);
  const at = (checkId: string) => result.findings.filter((f) => f.checkId === checkId).map((f) => [f.nodeId, f.path, f.message, f.fix]);
  assert.deepEqual(at('slots'), [['4:171', 'List', 'Slot "Content" con 3 elementos: admite como máximo 2', undefined]]);
  assert.deepEqual(at('color'), [['4:171', 'List / Content', 'Relleno #FFFFFF sin token (coincide con surface/default)', undefined]]);
  // Se ignoran por su instancia, que es donde se señalan.
  assert.deepEqual([...new Set(result.findings.filter((f) => f.nodeId === '4:171').map((f) => f.ignoreKey))].sort(), ['color|4:171', 'slots|4:171']);
});

// ---------- Contraste de los textos de las instancias ----------

const INK: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const DARK: Color = { r: 0.12, g: 0.12, b: 0.12, a: 1 };

/** Botón con un texto de color `c`, en la biblioteca; su texto es la capa 6:2. */
function button(c: Color, extra: Record<string, unknown> = {}) {
  const main = node('COMPONENT', { id: '6:1', name: 'Button' }, [node('TEXT', { id: '6:2', name: 'Label', fills: [solid(c)], ...extra })]);
  place([main], library);
  return main;
}
/** Una instancia del botón, con el texto como lo devuelve Figma (`I<instancia>;6:2`). */
const instanceOf = (main: any, id: string, label: Record<string, unknown>) =>
  node('INSTANCE', { id, name: 'Button', main }, [node('TEXT', { id: `I${id};6:2`, name: 'Label', ...label })]);
const contrast = (findings: Array<{ checkId: string; nodeId: string; path: string; message: string }>) =>
  findings.filter((f) => f.checkId === 'contrast').map((f) => [f.nodeId, f.path, f.message]);

test('el contraste mira los textos de las instancias donde están colocadas, y solo el contraste', async () => {
  reset();
  const main = button(INK);
  place([node('FRAME', { id: '7:0', name: 'Pantalla', fills: [solid(DARK)] }, [instanceOf(main, '7:1', { fills: [solid(INK)] })])]);
  const result = await audit();
  assert.deepEqual(contrast(result.findings), [['I7:1;6:2', 'Pantalla / Button', 'Contraste 1.06:1, mínimo 4.5:1 para 14 px sobre Pantalla (#1F1F1F)']]);
  assert.deepEqual(result.findings.filter((f) => f.nodeId === 'I7:1;6:2').map((f) => f.checkId), ['contrast']);
});

test('el texto de una instancia se resuelve en el modo de donde está colocada', async () => {
  reset();
  useVariables([collection('C3', 'Semantic', ['light', 'dark'])], [color('textPrimary', 'text/primary', 'C3', { light: INK, dark: WHITE })]);
  const main = button(INK, { fills: [solid(INK, { boundVariables: { color: alias('textPrimary') } })] });
  // En Figma el modo lo hereda el texto del frame; en el simulado se pone en el propio texto. Cada frame lo fija,
  // así que no se revisa en el otro.
  const label = (mode: string) => ({ fills: [solid(INK, { boundVariables: { color: alias('textPrimary') } })], resolvedVariableModes: { C3: mode } });
  place([
    node('FRAME', { id: '7:0', name: 'Claro', fills: [solid(WHITE)], explicitVariableModes: { C3: 'light' } }, [instanceOf(main, '7:1', label('light'))]),
    node('FRAME', { id: '8:0', name: 'Oscuro', fills: [solid(WHITE)], explicitVariableModes: { C3: 'dark' } }, [instanceOf(main, '8:1', label('dark'))]),
  ]);
  assert.deepEqual(contrast((await audit()).findings), [['I8:1;6:2', 'Oscuro / Button', 'Texto del mismo color que el fondo (Oscuro)']]);
});

test('el mismo texto de un componente con el mismo resultado en varias instancias sale una vez', async () => {
  reset();
  const main = button(INK);
  place([node('FRAME', { id: '7:0', name: 'Pantalla', fills: [solid(DARK)] }, [instanceOf(main, '7:1', { fills: [solid(INK)] }), instanceOf(main, '7:2', { fills: [solid(INK)] })])]);
  assert.deepEqual(contrast((await audit()).findings), [
    ['I7:1;6:2', 'Pantalla / Button', 'Contraste 1.06:1, mínimo 4.5:1 para 14 px sobre Pantalla (#1F1F1F) (se repite en 2 instancias)'],
  ]);
});

test('un texto puesto en un slot se audita entero una sola vez; uno heredado, solo por contraste', async () => {
  reset();
  const main = node('COMPONENT', { id: '1:1', name: 'Card' });
  place([main], library);
  const slot = node('SLOT', { id: 'I2:1;1:10', name: 'Content', componentPropertyReferences: { slotContentId: 'Content#1:0' }, limitViolations: [] }, [
    node('TEXT', { id: 'I2:1;1:11', name: 'Heredado', fills: [solid(INK)] }),
    node('TEXT', { id: 'I2:1;1:10;5:1', name: 'Propio', fills: [solid(INK)] }),
  ]);
  place([node('FRAME', { id: '2:0', name: 'Pantalla', fills: [solid(DARK)] }, [node('INSTANCE', { id: '2:1', name: 'Card', main }, [slot])])]);
  const result = await audit();
  const checks = (id: string) => result.findings.filter((f) => f.nodeId === id).map((f) => f.checkId);
  assert.deepEqual(checks('I2:1;1:10;5:1'), ['text', 'color', 'contrast']);
  assert.deepEqual(checks('I2:1;1:11'), ['contrast']);
});

test('los textos de una capa ignorada dentro de una instancia no se miran', async () => {
  reset();
  const main = node('COMPONENT', { id: '6:1', name: 'Button' });
  place([main], library);
  const decor = node('FRAME', { id: 'I7:1;6:5', name: '_decor' }, [node('TEXT', { id: 'I7:1;6:6', name: 'Label', fills: [solid(INK)] })]);
  place([node('FRAME', { id: '7:0', name: 'Pantalla', fills: [solid(DARK)] }, [node('INSTANCE', { id: '7:1', name: 'Button', main }, [decor])])]);
  assert.deepEqual(contrast((await audit()).findings), []);
});

// ---------- Capas ocultas que pueden aparecer ----------

test('una capa oculta que muestra una propiedad booleana o una variable se audita; otra oculta, no', async () => {
  whiteToken();
  const byProperty = literalFrame('8:2', 'Icono');
  Object.assign(byProperty, { visible: false, componentPropertyReferences: { visible: 'Mostrar icono#8:0' } });
  const byVariable = literalFrame('8:3', 'Promo');
  Object.assign(byVariable, { visible: false, boundVariables: { visible: alias('showPromo') } });
  const hidden = literalFrame('8:4', 'Oculta sin más');
  hidden.visible = false;
  place([node('COMPONENT', { id: '8:1', name: 'Tarjeta' }, [byProperty, byVariable, hidden])]);
  assert.deepEqual(colors((await audit()).findings), [['Icono', 'bind-color'], ['Promo', 'bind-color']]);
});

test('el auto layout cuenta los hijos ocultos que pueden aparecer', async () => {
  reset();
  const icon = node('FRAME', { id: '9:3', name: 'Icono', visible: false, componentPropertyReferences: { visible: 'Mostrar icono#9:0' } });
  const content = node('FRAME', { id: '9:2', name: 'Contenido' }, [node('TEXT', { id: '9:4', name: 'Texto' }), icon]);
  place([node('COMPONENT', { id: '9:1', name: 'Tarjeta' }, [content])]);
  const layout = (await audit()).findings.filter((f) => f.checkId === 'auto-layout').map((f) => [f.nodeName, f.message]);
  assert.deepEqual(layout, [['Contenido', 'Frame con 2 hijos sin auto layout']]);
});

test('con el contraste apagado no se recorren los textos de las instancias', async () => {
  reset();
  const main = button(INK);
  place([node('FRAME', { id: '7:0', name: 'Pantalla', fills: [solid(DARK)] }, [instanceOf(main, '7:1', { fills: [solid(INK)] })])]);
  const on = await audit();
  const off = await audit({ enabled: { ...DEFAULT_SETTINGS.enabled, contrast: false } });
  assert.equal(on.scanned - off.scanned, 1); // el texto de la instancia
});

test('un texto suelto en una sección o en la página es un rótulo del lienzo: las reglas de diseño no lo miran', async () => {
  reset();
  useVariables([collection('S', 'Semantic')], [color('ink', 'text/primary', 'S', { value: GREY })]);
  // Como en un sistema de pruebas: el nombre de cada pantalla, gris, encima de ella en la sección.
  const label = node('TEXT', { name: '01 · Login', fills: [solid(GREY)] });
  const title = node('TEXT', { name: 'Título', fills: [solid(GREY)] });
  const loose = node('TEXT', { name: 'Notas', fills: [solid(GREY)] });
  place([node('SECTION', { name: 'Screens' }, [label, node('FRAME', { name: 'Login' }, [title])]), loose]);
  const { findings } = await audit();
  const on = (n: any) => findings.filter((f) => f.nodeId === n.id).map((f) => f.checkId).sort();
  assert.deepEqual([on(label), on(loose)], [[], []]);
  assert.deepEqual(on(title), ['color', 'contrast', 'text']);
});
