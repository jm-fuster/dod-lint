import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUE, GREY, WHITE, alias, audit, collection, color, context, fixTarget, float, library, node, page, place, reset, settings, solid, useVariables } from './figma';
import { runAudit } from '../src/audit';
import type { FloatKind } from '../src/context';
import type { Settings } from '../src/types';
import type { Color } from './figma';
import { colorCheck, primitiveCheck } from '../src/checks/color';
import { spacingCheck } from '../src/checks/layout';
import type { Check } from '../src/checks';

/** Mensaje y variable propuesta de cada hallazgo de una regla sobre una capa. */
async function run(check: Check, layer: any): Promise<Array<{ msg: string; fix: string | undefined }>> {
  // Dentro de un frame: un texto suelto en la página es un rótulo del lienzo y no se revisa.
  place([node('FRAME', { name: 'Pantalla' }, [layer])]);
  const found = (await check.run(layer, await context(), page)) ?? [];
  return found.map((f) => ({ msg: f.message, fix: fixTarget(f) }));
}

// ---------- Colores y ámbitos ----------

const SEMANTIC = collection('C3', '03 Semantic', ['light', 'dark']);
const white = (id: string, name: string, scopes: string[]) => color(id, name, 'C3', { light: WHITE, dark: WHITE }, scopes);
function whites(...vars: any[]) {
  reset();
  useVariables([SEMANTIC], vars);
}
const literal = (type: string, c: Color, target: 'fills' | 'strokes' = 'fills') => node(type, { [target]: [solid(c)] });

test('un ámbito explícito para el uso decide entre colores iguales', async () => {
  whites(white('surface', 'surface/default', ['FRAME_FILL', 'SHAPE_FILL']), white('onBrand', 'text/on-brand', ['TEXT_FILL']));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (coincide con surface/default)', fix: 'surface/default' }]);
  assert.deepEqual(await run(colorCheck, literal('TEXT', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (coincide con text/on-brand)', fix: 'text/on-brand' }]);
});

test('si ninguna coincidencia cubre el uso, no hay corrección y el mensaje dice por qué', async () => {
  whites(white('onBrand', 'text/on-brand', ['TEXT_FILL']));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE)), [
    { msg: 'Relleno #FFFFFF sin token (text/on-brand coincide, pero su ámbito no cubre los rellenos de frame)', fix: undefined },
  ]);
});

test('con todos los ámbitos, como en un archivo sin ámbitos, se elige igual que antes', async () => {
  whites(white('a', 'white/a', ['ALL_SCOPES']));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (coincide con white/a)', fix: 'white/a' }]);
  whites(white('a', 'white/a', ['ALL_SCOPES']), white('b', 'white/b', ['ALL_SCOPES']));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (2 variables coinciden)', fix: undefined }]);
});

test('una variable con todos los ámbitos no gana por descarte a las que tienen ámbito propio', async () => {
  whites(white('a', 'white/a', ['ALL_SCOPES']), white('onBrand', 'text/on-brand', ['TEXT_FILL']));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (2 variables coinciden)', fix: undefined }]);
  assert.deepEqual(await run(colorCheck, literal('TEXT', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (coincide con text/on-brand)', fix: 'text/on-brand' }]);
  // Lo que pasaba en un sistema de pruebas en oscuro: los blancos son de texto y uno se quedó con todos los ámbitos.
  whites(white('t1', 'text/on-brand', ['SHAPE_FILL', 'TEXT_FILL']), white('t2', 'text/on-primary', ['SHAPE_FILL', 'TEXT_FILL']), white('img', 'text/on-image', ['ALL_SCOPES']));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE, 'strokes')), [{ msg: 'Trazo #FFFFFF sin token (3 variables coinciden)', fix: undefined }]);
  assert.deepEqual(await run(colorCheck, literal('VECTOR', WHITE)), [{ msg: 'Relleno #FFFFFF sin token (2 variables coinciden)', fix: undefined }]);
});

test('una variable sin ningún ámbito no se propone nunca', async () => {
  whites(white('hidden', 'white/hidden', []));
  assert.deepEqual(await run(colorCheck, literal('FRAME', WHITE)), [
    { msg: 'Relleno #FFFFFF sin token (white/hidden coincide, pero su ámbito no cubre los rellenos de frame)', fix: undefined },
  ]);
});

test('los trazos buscan STROKE_COLOR y las formas SHAPE_FILL', async () => {
  reset();
  useVariables([SEMANTIC], [
    color('border', 'border/default', 'C3', { light: GREY, dark: GREY }, ['STROKE_COLOR']),
    color('muted', 'surface/muted', 'C3', { light: GREY, dark: GREY }, ['FRAME_FILL']),
  ]);
  assert.deepEqual(await run(colorCheck, literal('FRAME', GREY, 'strokes')), [{ msg: 'Trazo #E6E6E6 sin token (coincide con border/default)', fix: 'border/default' }]);
  assert.equal((await run(colorCheck, literal('ELLIPSE', GREY)))[0].fix, undefined);
});

// ---------- Primitivas ----------

const PRIMITIVES = collection('C1', '01 Primitives', ['value'], true);
const LIGHT_BLUE: Color = { r: 0.5, g: 0.5, b: 1, a: 1 };
const GREEN: Color = { r: 0, g: 0.4, b: 0, a: 1 };
const INK: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const primitives = () => [
  color('blue500', 'blue/500', 'C1', { value: BLUE }),
  color('blue300', 'blue/300', 'C1', { value: LIGHT_BLUE }),
  color('green700', 'green/700', 'C1', { value: GREEN }),
  color('neutral0', 'neutral/0', 'C1', { value: WHITE }),
  color('neutral900', 'neutral/900', 'C1', { value: INK }),
];
/** Una forma con el relleno enlazado a una primitiva, en unos modos. */
const boundTo = (primitiveId: string, c: Color, modes: Record<string, string>, extra: Record<string, unknown> = {}) =>
  node('RECTANGLE', { fills: [solid(c, { boundVariables: { color: alias(primitiveId) } })], resolvedVariableModes: modes, ...extra });

/** Como FlySplit: la semántica (claro/oscuro) elige entre variables de la capa de rol, que apuntan a primitivas. */
function chained() {
  reset();
  useVariables([PRIMITIVES, collection('C2', '02 Role', ['piloto', 'pasajero'], true), SEMANTIC], [
    ...primitives(),
    color('brandLight', 'brand/light', 'C2', { piloto: alias('blue500'), pasajero: alias('green700') }),
    color('brandDark', 'brand/dark', 'C2', { piloto: alias('blue300'), pasajero: alias('green700') }),
    color('colorBrand', 'color/brand', 'C3', { light: alias('brandLight'), dark: alias('brandDark') }),
    color('colorSurface', 'color/surface', 'C3', { light: alias('neutral0'), dark: alias('neutral900') }),
  ]);
}

test('en un sistema encadenado se propone la semántica que elige la variable de rol', async () => {
  chained();
  assert.deepEqual(await run(primitiveCheck, boundTo('blue500', BLUE, { C2: 'piloto', C3: 'light' })), [
    { msg: 'Relleno enlazado a la primitiva blue/500 → color/brand', fix: 'color/brand' },
  ]);
});

test('si en este modo ninguna semántica da ese color, no hay corrección', async () => {
  chained();
  assert.deepEqual(await run(primitiveCheck, boundTo('blue500', BLUE, { C2: 'piloto', C3: 'dark' })), [
    { msg: 'Relleno enlazado a la primitiva blue/500 (ninguna semántica la usa en este modo)', fix: undefined },
  ]);
});

test('una semántica que apunta directa a la primitiva se propone tal cual', async () => {
  chained();
  assert.deepEqual(await run(primitiveCheck, boundTo('neutral0', WHITE, { C2: 'piloto', C3: 'light' })), [
    { msg: 'Relleno enlazado a la primitiva neutral/0 → color/surface', fix: 'color/surface' },
  ]);
});

test('si la pintura viene de un estilo, no se ofrece corrección', async () => {
  chained();
  assert.deepEqual(await run(primitiveCheck, boundTo('blue500', BLUE, { C2: 'piloto', C3: 'light' }, { fillStyleId: 'S:9' })), [
    { msg: 'Relleno enlazado a la primitiva blue/500 → color/brand (del estilo)', fix: undefined },
  ]);
});

test('un token de componente que reenvía a la semántica no cambia la propuesta', async () => {
  reset();
  useVariables([PRIMITIVES, SEMANTIC, collection('C4', 'Components')], [
    ...primitives(),
    color('colorBrand', 'color/brand', 'C3', { light: alias('blue500'), dark: alias('blue300') }),
    color('buttonBg', 'button/bg', 'C4', { value: alias('colorBrand') }),
  ]);
  assert.equal((await run(primitiveCheck, boundTo('blue500', BLUE, { C3: 'light' })))[0].fix, 'color/brand');
});

test('los modos de un componente tampoco la cambian', async () => {
  reset();
  useVariables([PRIMITIVES, SEMANTIC, collection('C5', 'Button', ['primary', 'secondary'])], [
    ...primitives(),
    color('colorBrand', 'color/brand', 'C3', { light: alias('blue500'), dark: alias('blue300') }),
    color('colorNeutral', 'color/neutral', 'C3', { light: alias('neutral900'), dark: alias('neutral0') }),
    color('colorSurface', 'color/surface', 'C3', { light: alias('neutral0'), dark: alias('neutral900') }),
    color('colorText', 'color/text', 'C3', { light: alias('neutral900'), dark: alias('neutral0') }),
    color('colorLink', 'color/link', 'C3', { light: alias('blue300'), dark: alias('blue500') }),
    // button/bg elige entre dos de las cinco semánticas: la colección semántica no es una capa intermedia.
    color('buttonBg', 'button/bg', 'C5', { primary: alias('colorBrand'), secondary: alias('colorNeutral') }),
  ]);
  assert.equal((await run(primitiveCheck, boundTo('blue500', BLUE, { C3: 'light', C5: 'primary' })))[0].fix, 'color/brand');
});

test('una semántica cuyo ámbito no cubre el uso no se propone', async () => {
  reset();
  useVariables([PRIMITIVES, SEMANTIC], [...primitives(), color('onBrand', 'text/on-brand', 'C3', { light: alias('neutral0'), dark: alias('neutral0') }, ['TEXT_FILL'])]);
  assert.deepEqual(await run(primitiveCheck, boundTo('neutral0', WHITE, { C3: 'light' })), [
    { msg: 'Relleno enlazado a la primitiva neutral/0 (text/on-brand la usa, pero su ámbito no cubre los rellenos de forma)', fix: undefined },
  ]);
});

// ---------- Espaciado y radio ----------

test('un padding con variable de espaciado se propone con el valor que tenía', async () => {
  reset();
  useVariables([collection('CS', 'Spacing')], [float('space16', 'space/16', 'CS', { value: 16 }, ['GAP'])]);
  const frame = node('FRAME', { layoutMode: 'HORIZONTAL', paddingLeft: 16 });
  place([frame]);
  const found = (await spacingCheck.run(frame, await context(), page)) ?? [];
  assert.deepEqual(found.map((f) => [f.message, f.fix]), [['Padding 16 sin token (existe space/16)', { kind: 'bind-float', field: 'paddingLeft', variableId: 'space16', from: 16 }]]);
});

test('la escala sigue los alias: un radio de 1 va al paso de 4, no al de 999', async () => {
  reset();
  useVariables([collection('P', 'Primitives · Dimensions', ['value'], true), collection('T', 'Tokens · Dimensions')], [
    float('dim4', 'dim/4', 'P', { value: 4 }),
    float('dim999', 'dim/999', 'P', { value: 999 }),
    float('radiusSm', 'Radius-sm', 'T', { value: alias('dim4') }, ['CORNER_RADIUS']),
    float('radiusFull', 'Radius-full', 'T', { value: alias('dim999') }, ['CORNER_RADIUS']),
  ]);
  const frame = node('FRAME', { cornerRadius: 1, topLeftRadius: 1, topRightRadius: 1, bottomLeftRadius: 1, bottomRightRadius: 1 });
  place([frame]);
  const found = (await spacingCheck.run(frame, await context({ snapToScale: true }), page)) ?? [];
  assert.deepEqual(found.map((f) => [f.severity, f.message, fixTarget(f)]), [['error', 'Radio 1 fuera de escala (paso más cercano: 4, Radius-sm)', 'Radius-sm']]);
});

/** Radios de la escala: los pasos que se pidan, con ámbito de radio y alias a primitivas como en un sistema de pruebas. */
function radii(steps: Record<string, number>) {
  reset();
  const primitives = Object.entries(steps).map(([name, value]) => float(`p-${name}`, `dim/${value}`, 'P', { value }));
  const tokens = Object.keys(steps).map((name) => float(name, name, 'T', { value: alias(`p-${name}`) }, ['CORNER_RADIUS']));
  useVariables([collection('P', 'Primitives · Dimensions', ['value'], true), collection('T', 'Tokens · Dimensions')], [...primitives, ...tokens]);
}
const rounded = (width: number, height: number, radius: number) =>
  node('FRAME', { width, height, cornerRadius: radius, topLeftRadius: radius, topRightRadius: radius, bottomLeftRadius: radius, bottomRightRadius: radius });
/** Con «ajustar a la escala» activado, que es lo que estas pruebas miran. */
async function radiusOf(layer: any) {
  place([layer]);
  const found = (await spacingCheck.run(layer, await context({ snapToScale: true }), page)) ?? [];
  return found.map((f) => [f.severity, f.message, fixTarget(f), f.fix && 'snapTo' in f.fix ? f.fix.snapTo : undefined]);
}

test('un radio que ya es una píldora se enlaza al paso «full», que lo sigue siendo a cualquier tamaño', async () => {
  radii({ 'Radius-xl': 20, 'Radius-full': 999 });
  // Un switch de 40 × 20: con 10 ya es una píldora, así que 100 no está fuera de escala, solo escrito a mano.
  assert.deepEqual(await radiusOf(rounded(40, 20, 100)), [['warning', 'Radio 100 sin token: ya es una píldora (existe Radius-full)', 'Radius-full', 999]]);
});

test('si ningún paso llega a la mitad, no se propone bajar la píldora al más cercano', async () => {
  radii({ 'Radius-xs': 4, 'Radius-sm': 8 });
  assert.deepEqual(await radiusOf(rounded(40, 20, 100)), [['error', 'Radio 100 fuera de escala (el paso más cercano, 8, dejaría de ser una píldora)', undefined, undefined]]);
});

test('un radio que no es píldora se ajusta como antes, y un valor exacto se enlaza tal cual', async () => {
  radii({ 'Radius-sm': 8, 'Radius-lg': 12, 'Radius-full': 999 });
  assert.deepEqual(await radiusOf(rounded(100, 40, 9)), [['error', 'Radio 9 fuera de escala (paso más cercano: 8, Radius-sm)', 'Radius-sm', 8]]);
  radii({ 'Radius-xl': 20, 'Radius-full': 999 });
  assert.deepEqual(await radiusOf(rounded(40, 20, 20)), [['warning', 'Radio 20 sin token (existe Radius-xl)', 'Radius-xl', undefined]]);
});

test('sin variables de espaciado ni de radio no hay escala: nada sale fuera de ella', async () => {
  reset();
  // Como en un sistema de pruebas: las numéricas son contadores del prototipo (sin ámbitos), objetivos táctiles y una opacidad.
  useVariables(
    [collection('E', 'Prototipo · Estado'), collection('T', 'BK · Tokens')],
    [
      float('count', 'platos/total', 'E', { value: 10 }, []),
      float('touch', 'touch-target/min', 'T', { value: 44 }, ['WIDTH_HEIGHT']),
      float('op', 'opacity/60', 'T', { value: 20 }, ['COLOR_OPACITY']),
    ],
  );
  const box = node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', paddingLeft: 20, paddingTop: 44, itemSpacing: 10, cornerRadius: 6, topLeftRadius: 6, topRightRadius: 6, bottomLeftRadius: 6, bottomRightRadius: 6 });
  const found = (await spacingCheck.run(box, await context(), page)) ?? [];
  // El objetivo táctil, que es de tamaño, se nombra; el contador y la opacidad, que valen lo mismo, no.
  assert.deepEqual(found.map((f) => [f.severity, f.message]), [
    ['warning', 'Padding 20 sin token'],
    ['warning', 'Padding 44 sin token (touch-target/min vale lo mismo pero no es de espaciado)'],
    ['warning', 'Gap 10 sin token'],
    ['warning', 'Radio 6 sin token'],
  ]);
});

test('una variable numérica sin ningún ámbito no sale en ningún selector: no se propone', async () => {
  reset();
  useVariables([collection('S', 'Spacing')], [float('hidden', 'space/16', 'S', { value: 16 }, []), float('shown', 'space/8', 'S', { value: 8 })]);
  // Sin ajustar a la escala, para que solo cuente si se propone la de 16: la de 8 se nombra como paso más cercano.
  const found = (await spacingCheck.run(node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', paddingLeft: 16 }), await context({ snapToScale: false }), page)) ?? [];
  assert.deepEqual(found.map((f) => [f.message, fixTarget(f)]), [['Padding 16 fuera de escala (paso más cercano: 8, space/8)', undefined]]);
});

test('por defecto no se ajusta a la escala: el aviso dice el paso más cercano, sin corrección', async () => {
  reset();
  useVariables([collection('S', 'Spacing')], [float('s8', 'space/8', 'S', { value: 8 }, ['GAP']), float('s12', 'space/12', 'S', { value: 12 }, ['GAP'])]);
  const box = node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', paddingLeft: 10, itemSpacing: 12 });
  const found = (await spacingCheck.run(box, await context(), page)) ?? [];
  // Lo exacto se sigue enlazando: no cambia ninguna medida.
  assert.deepEqual(found.map((f) => [f.severity, f.message, fixTarget(f)]), [
    ['error', 'Padding 10 fuera de escala (paso más cercano: 8, space/8)', undefined],
    ['warning', 'Gap 12 sin token (existe space/12)', 'space/12'],
  ]);
});

test('a la misma distancia de dos pasos se ajusta al menor, sea cual sea el orden de las variables', async () => {
  for (const order of [['s8', 's4'], ['s4', 's8']]) {
    reset();
    const vars: Record<string, any> = { s4: float('s4', 'space/4', 'S', { value: 4 }, ['GAP']), s8: float('s8', 'space/8', 'S', { value: 8 }, ['GAP']) };
    useVariables([collection('S', 'Spacing')], order.map((k) => vars[k]));
    const found = (await spacingCheck.run(node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', itemSpacing: 6 }), await context({ snapToScale: true }), page)) ?? [];
    assert.deepEqual(found.map((f) => [f.message, fixTarget(f)]), [['Gap 6 fuera de escala (paso más cercano: 4, space/4)', 'space/4']]);
  }
});

test('la muestra de una paleta, con el nombre de la primitiva que enseña, no se avisa', async () => {
  reset();
  const RED: Color = { r: 1, g: 0, b: 0, a: 1 };
  useVariables(
    [collection('P', 'Primitives', ['value'], true), collection('S', 'Semantic')],
    [color('red', 'color/red', 'P', { value: RED }), color('redDark', 'color/red-dark', 'P', { value: RED }), color('danger', 'text/danger', 'S', { value: alias('red') })],
  );
  /** Una muestra dentro de un frame con ese nombre, enlazada a esa variable. */
  const swatchIn = (frame: string, variableId: string) => {
    const rect = node('RECTANGLE', { name: 'muestra', fills: [solid(RED, { boundVariables: { color: alias(variableId) } })] });
    place([node('FRAME', { name: 'Muestras' }, [node('FRAME', { name: frame }, [rect])])]);
    return rect;
  };
  const flagged = async (rect: any) => ((await primitiveCheck.run(rect, await context(), page)) ?? []).length;
  // Como en un sistema de pruebas: «Color · color/red» enseña color/red.
  assert.equal(await flagged(swatchIn('Color · color/red', 'red')), 0);
  assert.equal(await flagged(swatchIn('Color/Red', 'red')), 0);
  // La muestra de color/red-dark enlazada a color/red es un error, y una tarjeta cualquiera también se avisa.
  assert.equal(await flagged(swatchIn('Color · color/red-dark', 'red')), 1);
  assert.equal(await flagged(swatchIn('Tarjeta', 'red')), 1);
});

test('el marco de un set no se mira: su borde lo pone Figma y ninguna instancia lo hereda', async () => {
  reset();
  const PURPLE: Color = { r: 0x97 / 255, g: 0x47 / 255, b: 1, a: 1 };
  const variant = node('COMPONENT', { name: 'Estado=Activa', fills: [solid(GREY)] });
  const set = node('COMPONENT_SET', { name: 'Pestaña', strokes: [solid(PURPLE)] }, [variant]);
  place([set]);
  const ctx = await context();
  assert.equal(await colorCheck.run(set, ctx, page), null);
  assert.deepEqual(((await colorCheck.run(variant, ctx, page)) ?? []).map((f) => f.message), ['Relleno #E6E6E6 sin token']);
});

test('tampoco se propone subir un radio pequeño a un paso que lo convierta en píldora', async () => {
  // La batería de un sistema de pruebas: 8 px de alto, radio 1, y el paso mínimo de la escala es 4.
  radii({ 'Radius-xs': 4, 'Radius-sm': 8 });
  assert.deepEqual(await radiusOf(rounded(20, 8, 1)), [['error', 'Radio 1 fuera de escala (el paso más cercano, 4, la convertiría en una píldora)', undefined, undefined]]);
  // En una capa más alta, el mismo paso no la convierte y se sigue proponiendo.
  assert.deepEqual(await radiusOf(rounded(40, 20, 1)), [['error', 'Radio 1 fuera de escala (paso más cercano: 4, Radius-xs)', 'Radius-xs', 4]]);
});

// ---------- Sin variables de espaciado o de radio en uso ----------

const spacingOf = (findings: { checkId: string; message: string }[]) => findings.filter((f) => f.checkId === 'spacing').map((f) => f.message);

/** Como Material 3: hay tokens de radio (Corner) y ninguno de espaciado. */
function cornersOnly() {
  reset();
  useVariables([collection('S', 'Shape')], [float('cornerM', 'Corner/Medium', 'S', { value: 12 }, ['CORNER_RADIUS'])]);
}
const box = (props: Record<string, unknown> = {}) =>
  node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', paddingLeft: 12, paddingRight: 12, itemSpacing: 8, cornerRadius: 12, topLeftRadius: 12, topRightRadius: 12, bottomLeftRadius: 12, bottomRightRadius: 12, ...props });

test('sin variables de espaciado en uso, los paddings y gaps escritos a mano no se avisan uno a uno', async () => {
  cornersOnly();
  place([node('FRAME', { name: 'Pantalla' }, [box()])]);
  const result = await audit();
  // El radio sí tiene token: se avisa. El padding de 12 ya no nombra el Corner que vale lo mismo.
  assert.deepEqual(spacingOf(result.findings), ['Radio 12 sin token (existe Corner/Medium)']);
  // El padding de 12 a izquierda y derecha cuenta una vez, y el gap otra.
  assert.deepEqual(result.untokenized, { spacing: 2 });
});

test('una capa enlazada a una variable de espaciado de una biblioteca basta para avisar lo escrito a mano', async () => {
  cornersOnly();
  // La variable no es local: viene de una biblioteca, y el archivo no tiene escala propia.
  const bound = node('FRAME', { name: 'Enlazada', layoutMode: 'VERTICAL', paddingLeft: 16, boundVariables: { paddingLeft: alias('lib-space-16') } });
  place([node('FRAME', { name: 'Pantalla' }, [bound, box()])]);
  const result = await audit();
  assert.deepEqual(spacingOf(result.findings), ['Padding 12 sin token', 'Gap 8 sin token', 'Radio 12 sin token (existe Corner/Medium)']);
  assert.deepEqual(result.untokenized, {});
});

test('también cuenta el enlace que una instancia hereda de su componente de biblioteca', async () => {
  cornersOnly();
  const main = node('COMPONENT', { id: '1:1', name: 'Card', layoutMode: 'VERTICAL', paddingLeft: 16, boundVariables: { paddingLeft: alias('lib-space-16') } });
  place([main], library);
  const card = node('INSTANCE', { id: '2:1', name: 'Card', main, layoutMode: 'VERTICAL', paddingLeft: 16, boundVariables: { paddingLeft: alias('lib-space-16') } });
  place([node('FRAME', { name: 'Pantalla' }, [card, box()])]);
  assert.deepEqual((await audit()).untokenized, {});
});

test('lo que no se avisa no cuenta para el tope de la regla, y lo que sí, solo hasta el tope', async () => {
  cornersOnly();
  // Tres capas con muchos paddings sin token y, detrás, dos radios que sí se avisan.
  const wide = () => box({ paddingTop: 12, paddingBottom: 12, cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0 });
  const round = () => node('RECTANGLE', { name: 'Redonda', cornerRadius: 12, topLeftRadius: 12, topRightRadius: 12, bottomLeftRadius: 12, bottomRightRadius: 12 });
  place([node('FRAME', { name: 'Pantalla' }, [wide(), wide(), wide(), round(), round()])]);
  const result = await runAudit('page', settings(), { pages: [page], lang: 'es', maxPerCheck: 2 });
  assert.deepEqual(spacingOf(result.findings), ['Radio 12 sin token (existe Corner/Medium)', 'Radio 12 sin token (existe Corner/Medium)']);
  assert.deepEqual(result.truncated, []);
  // Si se usan los tokens, lo escrito a mano vuelve y el tope lo corta.
  const kept = await runAudit('page', settings(), { pages: [page], lang: 'es', maxPerCheck: 2, withoutTokens: [] });
  assert.equal(spacingOf(kept.findings).length, 2);
  assert.deepEqual(kept.truncated, ['spacing']);
});

test('«Actualizar la lista» decide como la auditoría, aunque solo vuelva a mirar las capas con hallazgos', async () => {
  cornersOnly();
  const bound = node('FRAME', { id: '3:1', name: 'Enlazada', layoutMode: 'VERTICAL', paddingLeft: 16, boundVariables: { paddingLeft: alias('lib-space-16') } });
  const hard = box({ id: '3:2', cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0 });
  place([node('FRAME', { name: 'Pantalla' }, [bound, hard])]);
  const first = await audit();
  assert.equal(spacingOf(first.findings).length, 2);
  // Solo vuelve a mirar la caja, que no tiene nada enlazado: sin la decisión de la auditoría, sus paddings se irían.
  const again = await runAudit('page', settings(), { lang: 'es', recheck: [{ nodeId: '3:2' }], withoutTokens: Object.keys(first.untokenized) as FloatKind[] });
  assert.equal(spacingOf(again.findings).length, 2);
});

test('con la regla de espaciado apagada no hay nota de tokens sin usar', async () => {
  cornersOnly();
  place([node('FRAME', { name: 'Pantalla' }, [box()])]);
  const result = await audit({ enabled: { spacing: false } as Settings['enabled'] });
  assert.deepEqual(result.untokenized, {});
});

test('con «solo dentro de componentes», la documentación y las pantallas no se revisan; un componente, sí', async () => {
  cornersOnly();
  const screen = box({ id: '4:1', name: 'Pantalla de ejemplo', cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0 });
  const nested = box({ id: '4:3', name: 'Cabecera', cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0 });
  const card = node('COMPONENT', { id: '4:2', name: 'Card', layoutMode: 'VERTICAL', paddingLeft: 12 }, [nested]);
  // Fuera de los componentes, un padding enlazado: el equipo usa tokens de espaciado, aunque aquí no se revise.
  const bound = node('FRAME', { name: 'Doc · Card', layoutMode: 'VERTICAL', paddingLeft: 16, boundVariables: { paddingLeft: alias('lib-space-16') } });
  place([node('FRAME', { name: 'Documentación' }, [bound, screen]), card]);
  const where = (findings: { checkId: string; nodeId: string }[]) => [...new Set(findings.filter((f) => f.checkId === 'spacing').map((f) => f.nodeId))].sort();
  assert.deepEqual(where((await audit()).findings), ['4:1', '4:2', '4:3']);
  const only = await audit({ spacingComponentsOnly: true });
  assert.deepEqual(where(only.findings), ['4:2', '4:3']);
  assert.deepEqual(only.untokenized, {});
});

test('los lados de un padding con el mismo valor salen en un solo aviso que los enlaza todos', async () => {
  reset();
  useVariables([collection('S', 'Spacing')], [float('s8', 'space/8', 'S', { value: 8 }, ['GAP']), float('s16', 'space/16', 'S', { value: 16 }, ['GAP'])]);
  const sidesOf = async (layer: any) => {
    place([node('FRAME', { name: 'Pantalla' }, [layer])]);
    const found: any[] = (await spacingCheck.run(layer, await context(), page)) ?? [];
    return found.map((f) => [f.message, f.fix?.fields ?? f.fix?.field]);
  };
  // Los cuatro iguales: un aviso, no cuatro.
  const all = node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 });
  assert.deepEqual(await sidesOf(all), [['Padding 16 sin token (existe space/16)', ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']]]);
  // Dos pares, y un lado que ya tiene variable no cuenta.
  const pairs = node('FRAME', { name: 'Caja', layoutMode: 'VERTICAL', paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, boundVariables: { paddingBottom: alias('s8') } });
  assert.deepEqual(await sidesOf(pairs), [
    ['Padding 16 sin token (existe space/16)', ['paddingLeft', 'paddingRight']],
    ['Padding 8 sin token (existe space/8)', 'paddingTop'],
  ]);
});
