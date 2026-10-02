import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, alias, collection, color, context, node, page, place, reset, solid, useVariables } from './figma';
import type { Color } from './figma';
import { contrastCheck } from '../src/checks/color';
import { AuditContext } from '../src/context';
import { splitMessage } from '../src/ui/messages';

const INK: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const DARK: Color = { r: 0.12, g: 0.12, b: 0.12, a: 1 };
const NAVY: Color = { r: 0, g: 0, b: 0.6, a: 1 };
const GREEN: Color = { r: 0, g: 0.35, b: 0, a: 1 };
const SKY: Color = { r: 0.6, g: 0.75, b: 1, a: 1 };

/** Un texto enlazado a `textVar` dentro de una tarjeta enlazada a `bg/surface`. */
function card(textVar: string, frame: Record<string, unknown> = {}) {
  const text = node('TEXT', { name: 'Título', fills: [solid(INK, { boundVariables: { color: alias(textVar) } })] });
  const component = node('COMPONENT', { name: 'Card', fills: [solid(WHITE, { boundVariables: { color: alias('surface') } })], ...frame }, [text]);
  place([component]);
  return text;
}

const messages = async (text: any) => ((await contrastCheck.run(text, await context(), page)) ?? []).map((f) => f.message);

test('el contraste se mira en todos los modos: un texto que solo falla en oscuro se avisa con su modo', async () => {
  reset();
  useVariables([collection('S', 'Semantic', ['Claro', 'Oscuro'])], [
    // Alguien olvidó cambiar el texto en oscuro.
    color('text', 'text/primary', 'S', { Claro: INK, Oscuro: INK }),
    color('surface', 'bg/surface', 'S', { Claro: WHITE, Oscuro: DARK }),
  ]);
  assert.deepEqual(await messages(card('text')), ['Contraste 1.06:1 en Oscuro, mínimo 4.5:1 para 14 px sobre Card (#1F1F1F)']);
});

test('con dos ejes encadenados, como rol y tema, se prueban todas las combinaciones', async () => {
  reset();
  // Como FlySplit: la semántica elige por tema un hueco del rol, y el rol elige el color.
  useVariables([collection('R', 'Role', ['Piloto', 'Pasajero']), collection('S', 'Semantic', ['Claro', 'Oscuro'])], [
    color('brandLight', 'slot/brand-light', 'R', { Piloto: NAVY, Pasajero: GREEN }),
    color('brandDark', 'slot/brand-dark', 'R', { Piloto: NAVY, Pasajero: SKY }),
    color('brand', 'text/brand', 'S', { Claro: alias('brandLight'), Oscuro: alias('brandDark') }),
    color('surface', 'bg/surface', 'S', { Claro: WHITE, Oscuro: DARK }),
  ]);
  const [message] = await messages(card('brand'));
  // Falla el azul del piloto sobre oscuro; los demás pasan.
  assert.match(message, /^Contraste \d\.\d\d:1 en Piloto · Oscuro, mínimo 4\.5:1 para 14 px sobre Card \(#1F1F1F\)$/);
});

test('si fallan varios modos, se dice el peor y los demás aparte', async () => {
  reset();
  useVariables([collection('R', 'Role', ['Piloto', 'Pasajero']), collection('S', 'Semantic', ['Claro', 'Oscuro'])], [
    color('brandLight', 'slot/brand-light', 'R', { Piloto: NAVY, Pasajero: GREEN }),
    color('brandDark', 'slot/brand-dark', 'R', { Piloto: NAVY, Pasajero: GREEN }),
    color('brand', 'text/brand', 'S', { Claro: alias('brandLight'), Oscuro: alias('brandDark') }),
    color('surface', 'bg/surface', 'S', { Claro: WHITE, Oscuro: DARK }),
  ]);
  const [message] = await messages(card('brand'));
  assert.match(message, /^Contraste \d\.\d\d:1 en Piloto · Oscuro, mínimo 4\.5:1 para 14 px sobre Card \(#1F1F1F\) \(también en Pasajero · Oscuro\)$/);
  // En la fila, el color del fondo sigue en lo que pasa, y los otros modos van como aclaración.
  const { title, notes } = splitMessage(message);
  assert.match(title, /sobre Card \(#1F1F1F\)$/);
  assert.deepEqual(notes, ['también en Pasajero · Oscuro']);
});

test('fuera de los componentes, como en una pantalla o una página de documentación, solo cuenta su modo', async () => {
  reset();
  useVariables([collection('S', 'Semantic', ['Claro', 'Oscuro'])], [
    color('text', 'text/primary', 'S', { Claro: INK, Oscuro: INK }),
    color('surface', 'bg/surface', 'S', { Claro: WHITE, Oscuro: DARK }),
  ]);
  const text = node('TEXT', { name: 'PASS', fills: [solid(INK, { boundVariables: { color: alias('text') } })] });
  place([node('FRAME', { name: 'Doc · Color', fills: [solid(WHITE, { boundVariables: { color: alias('surface') } })] }, [text])]);
  assert.deepEqual(await messages(text), []);
  // Un componente anidado en otro sí se revisa en todos.
  const inner = node('TEXT', { name: 'Título', fills: [solid(INK, { boundVariables: { color: alias('text') } })] });
  place([node('COMPONENT', { name: 'Card', fills: [solid(WHITE, { boundVariables: { color: alias('surface') } })] }, [node('INSTANCE', { name: 'Header', overrides: [] }, [inner])])]);
  assert.deepEqual(await messages(inner), ['Contraste 1.06:1 en Oscuro, mínimo 4.5:1 para 14 px sobre Card (#1F1F1F)']);
});

test('un modo fijado por un ancestro se respeta: una tarjeta puesta en claro no se revisa en oscuro', async () => {
  reset();
  useVariables([collection('S', 'Semantic', ['Claro', 'Oscuro'])], [
    color('text', 'text/primary', 'S', { Claro: INK, Oscuro: INK }),
    color('surface', 'bg/surface', 'S', { Claro: WHITE, Oscuro: DARK }),
  ]);
  assert.deepEqual(await messages(card('text', { explicitVariableModes: { S: 'Claro' } })), []);
});

test('un texto que tiene debajo otro texto se mide contra el fondo, no contra las letras del otro', async () => {
  reset();
  // Los Input de FlySplit: el sufijo cae sobre el texto del valor, y los dos son grises.
  const GREY: Color = { r: 0.42, g: 0.42, b: 0.42, a: 1 };
  const value = node('TEXT', { name: 'value', fills: [solid(GREY)] });
  const suffix = node('TEXT', { name: 'suffix', fills: [solid(GREY)] });
  place([node('FRAME', { name: 'field', fills: [solid(WHITE)] }, [value, suffix])]);
  // Gris #6B6B6B sobre blanco: 5,33:1, pasa.
  assert.deepEqual(await messages(suffix), []);
});

test('en un componente transparente, el lienzo de la documentación no es su fondo', async () => {
  reset();
  // Simple Design System: «Avatar Block» no tiene relleno, y detrás está el gris claro literal de la sección.
  const PAPER: Color = { r: 0.96, g: 0.96, b: 0.96, a: 1 };
  const SECONDARY: Color = { r: 0.46, g: 0.46, b: 0.46, a: 1 };
  const title = node('TEXT', { name: 'Title', fills: [solid(SECONDARY)] });
  place([node('SECTION', { name: '', fills: [solid(PAPER)] }, [node('COMPONENT', { name: 'Avatar Block' }, [title])])]);
  const ctx = await context();
  assert.equal(await contrastCheck.run(title, ctx, page), null);
  assert.equal(ctx.skippedContrast, 1);
  // En una pantalla, lo que hay detrás sí es el fondo.
  const onScreen = node('TEXT', { name: 'Title', fills: [solid(SECONDARY)] });
  place([node('FRAME', { name: 'Pantalla', fills: [solid(PAPER)] }, [onScreen])]);
  assert.match((await messages(onScreen))[0], /^Contraste 4\.\d\d:1, mínimo 4\.5:1 para 14 px sobre Pantalla/);
});

test('si a mano no sale lo mismo que da Figma en el modo de la capa, no se adivinan los demás', async () => {
  reset();
  const text = color('text', 'text/primary', 'S', { Claro: INK, Oscuro: INK });
  // Como una colección extendida: Figma resuelve otra cosa que lo que dicen sus valores.
  text.resolveForConsumer = () => ({ value: { r: 0, g: 0, b: 0, a: 1 }, resolvedType: 'COLOR' });
  useVariables([collection('S', 'Semantic', ['Claro', 'Oscuro'])], [text, color('surface', 'bg/surface', 'S', { Claro: WHITE, Oscuro: DARK })]);
  assert.deepEqual(await messages(card('text')), []);
});

// Muchos modos, como Material 3 (32): con cinco o más por revisar, la situación de cada texto se reconoce y un texto
// que repite la de otro que ya pasó no se vuelve a medir en cada modo.
const SIX = ['Claro', 'Oscuro', 'Azul', 'Verde', 'Rojo', 'Gris'];
const inAll = (c: Color) => Object.fromEntries(SIX.map((m) => [m, c]));

/** Una variante con un título enlazado a `text`, sobre un panel enlazado a `panel`, sobre el relleno `under`. */
function variant(name: string, under: Color = WHITE) {
  const text = node('TEXT', { name: 'Título', fills: [solid(INK, { boundVariables: { color: alias('text') } })] });
  const panel = node('FRAME', { name: 'Panel', fills: [solid(WHITE, { boundVariables: { color: alias('panel') } })] }, [text]);
  return { name, text, component: node('COMPONENT', { name, fills: [solid(under)] }, [panel]) };
}

test('con muchos modos, un texto en la misma situación que otro que ya pasó no se vuelve a medir', async () => {
  reset();
  useVariables([collection('S', 'Semantic', SIX)], [color('text', 'text/primary', 'S', inAll(INK)), color('panel', 'bg/panel', 'S', inAll(WHITE))]);
  const variants = ['Size=S', 'Size=M', 'Size=L'].map((name) => variant(name));
  place(variants.map((v) => v.component));
  const ctx = await context();
  const proto = AuditContext.prototype as any;
  const original = proto.resolveColorIn;
  let calls = 0;
  proto.resolveColorIn = function (...args: unknown[]) {
    calls++;
    return original.apply(this, args);
  };
  try {
    assert.equal(await contrastCheck.run(variants[0].text, ctx, page), null);
    const first = calls;
    assert.ok(first >= 5, `se mide en los otros cinco modos (${first})`);
    for (const v of variants.slice(1)) assert.equal(await contrastCheck.run(v.text, ctx, page), null);
    assert.equal(calls, first);
  } finally {
    proto.resolveColorIn = original;
  }
});

test('dos textos iguales en su modo pero no en otro no comparten el resultado', async () => {
  reset();
  // El panel es blanco, salvo en Oscuro, que es transparente: ahí se ve lo que tiene debajo cada variante.
  const CLEAR: Color = { r: 1, g: 1, b: 1, a: 0 };
  useVariables([collection('S', 'Semantic', SIX)], [color('text', 'text/primary', 'S', inAll(INK)), color('panel', 'bg/panel', 'S', { ...inAll(WHITE), Oscuro: CLEAR })]);
  const light = variant('Fondo=Claro');
  const dark = variant('Fondo=Oscuro', DARK);
  place([light.component, dark.component]);
  const ctx = await context();
  assert.equal(await contrastCheck.run(light.text, ctx, page), null);
  const found = (await contrastCheck.run(dark.text, ctx, page)) ?? [];
  assert.deepEqual(
    found.map((f) => f.message),
    ['Contraste 1.06:1 en Oscuro, mínimo 4.5:1 para 14 px sobre Fondo=Oscuro (#1F1F1F)'],
  );
});

test('si una situación no pasa, cada texto que la repite tiene su aviso, con su fondo', async () => {
  reset();
  useVariables([collection('S', 'Semantic', SIX)], [color('text', 'text/primary', 'S', inAll(INK)), color('panel', 'bg/panel', 'S', { ...inAll(WHITE), Oscuro: DARK })]);
  const variants = ['Size=S', 'Size=M'].map((name) => variant(name));
  place(variants.map((v) => v.component));
  const ctx = await context();
  for (const v of variants) {
    const found = (await contrastCheck.run(v.text, ctx, page)) ?? [];
    assert.deepEqual(
      found.map((f) => f.message),
      ['Contraste 1.06:1 en Oscuro, mínimo 4.5:1 para 14 px sobre Panel (#1F1F1F)'],
    );
  }
});
