import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUE, WHITE, alias, collection, color, context, fixTarget, float, node, page, place, reset, solid, useVariables } from './figma';
import { colorCheck, contrastCheck } from '../src/checks/color';

// Colores compuestos (actualización 139 de la API, septiembre de 2026): un color y una opacidad de 0 a 100, al
// menos uno de ellos alias a otra variable. Figma los devuelve aplanados al resolverlos, con la opacidad en el
// alfa (medido en un sistema de pruebas el 30-09-2026), y el simulado hace lo mismo. Los tipos de `resolveForConsumer`
// permiten que llegue sin aplanar: la auditoría lo resuelve entonces por su cuenta.

const HALF_BLUE = { ...BLUE, a: 0.5 };

function composedTokens(overlay: unknown) {
  reset();
  useVariables(
    [collection('P', 'Primitives', ['value'], true), collection('S', 'Semantic')],
    [
      color('blue', 'blue/500', 'P', { value: BLUE }),
      float('op50', 'opacity/50', 'P', { value: 50 }, ['COLOR_OPACITY']),
      color('overlay', 'overlay/brand', 'S', { value: overlay }, ['ALL_FILLS']),
    ],
  );
}

test('un color compuesto vale su color con su opacidad: un relleno igual tiene corrección', async () => {
  for (const overlay of [{ color: alias('blue'), opacity: 50 }, { color: { r: 0, g: 0, b: 1 }, opacity: alias('op50') }]) {
    composedTokens(overlay);
    const frame = node('FRAME', { name: 'Velo', fills: [solid(HALF_BLUE)] });
    place([frame]);
    const found = (await colorCheck.run(frame, await context(), page)) ?? [];
    assert.deepEqual(found.map((f) => [f.message, fixTarget(f)]), [['Relleno #0000FF 50% sin token (coincide con overlay/brand)', 'overlay/brand']]);
  }
});

test('un color compuesto que no se puede resolver no da un contraste de NaN', async () => {
  // El color remite a una variable que ya no existe.
  composedTokens({ color: alias('gone'), opacity: 50 });
  const text = node('TEXT', { name: 'Aviso', fills: [solid(BLUE, { boundVariables: { color: alias('overlay') } })] });
  place([node('FRAME', { name: 'Tarjeta', fills: [solid(WHITE)] }, [text])]);
  const ctx = await context();
  assert.equal(await contrastCheck.run(text, ctx, page), null);
  assert.equal(ctx.skippedContrast, 1);
});

test('una colección de colores compuestos remite a otras variables: no se toma por primitiva', async () => {
  reset();
  useVariables(
    [collection('P', 'Primitives', ['value'], true), collection('O', 'Overlays', ['value'], true)],
    [color('blue', 'blue/500', 'P', { value: BLUE }), color('veil', 'veil/brand', 'O', { value: { color: alias('blue'), opacity: 40 } })],
  );
  const primitive = (await context()).collectionsInfo().map((c) => [c.name, c.isPrimitive]);
  assert.deepEqual(primitive, [['Primitives', true], ['Overlays', false]]);
});

test('una semántica que elige por modo el color de un compuesto cuenta como selector', async () => {
  reset();
  useVariables(
    [collection('P', 'Primitives', ['value'], true), collection('S', 'Semantic', ['light', 'dark'])],
    [
      color('blue', 'blue/500', 'P', { value: BLUE }),
      color('white', 'white', 'P', { value: WHITE }),
      color('scrim', 'scrim', 'S', { light: { color: alias('blue'), opacity: 40 }, dark: { color: alias('white'), opacity: 40 } }),
    ],
  );
  assert.deepEqual((await context()).switchers.map((v) => v.name), ['scrim']);
});

test('si Figma devolviera un compuesto sin aplanar, la auditoría lo resuelve igual', async () => {
  composedTokens({ color: alias('blue'), opacity: 50 });
  const ctx = await context();
  // Una variable cuyo `resolveForConsumer` devuelve el valor crudo, como permiten los tipos de la API.
  const raw = color('raw', 'overlay/raw', 'S', { value: { color: alias('blue'), opacity: 50 } });
  raw.resolveForConsumer = () => ({ value: { color: alias('blue'), opacity: 50 }, resolvedType: 'COLOR' });
  assert.deepEqual(ctx.resolveColor(raw as any, node('FRAME', {}) as any), HALF_BLUE);
});
