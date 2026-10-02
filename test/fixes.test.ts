import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GREY, WHITE, addRemote, addStyle, alias, collection, color, context, float, node, reset, solid, useVariables } from './figma';
import { applyFix, fixApplied } from '../src/fixes';
import type { FixHint } from '../src/types';

const apply = async (layer: any, hint: FixHint) => applyFix(layer, hint, await context());

/** Una variable de espaciado, space/16, que vale lo que se pida. */
function spacing(value: number) {
  reset();
  useVariables([collection('CS', 'Spacing')], [float('V16', 'space/16', 'CS', { value }, ['GAP'])]);
}
const bindPadding = (from: number, snapTo?: number): FixHint => ({ kind: 'bind-float', field: 'paddingLeft', variableId: 'V16', from, ...(snapTo === undefined ? {} : { snapTo }) });

test('bind-float se aplica si la capa sigue como en la auditoría', async () => {
  spacing(16);
  const frame = node('FRAME', { paddingLeft: 16 });
  assert.equal(await apply(frame, bindPadding(16)), true);
  assert.equal(frame.boundVariables.paddingLeft?.id, 'V16');
});

test('bind-float se omite si el valor cambió después de auditar', async () => {
  spacing(16);
  const frame = node('FRAME', { paddingLeft: 20 });
  assert.equal(await apply(frame, bindPadding(16)), false);
  assert.equal(frame.paddingLeft, 20);
  assert.equal(frame.boundVariables.paddingLeft, undefined);
});

test('bind-float se omite si el campo ya tiene variable', async () => {
  spacing(16);
  assert.equal(await apply(node('FRAME', { paddingLeft: 16, boundVariables: { paddingLeft: alias('otra') } }), bindPadding(16)), false);
});

test('bind-float se omite si la variable ya no vale lo prometido', async () => {
  spacing(18);
  const frame = node('FRAME', { paddingLeft: 16 });
  assert.equal(await apply(frame, bindPadding(16)), false);
  assert.equal(frame.paddingLeft, 16);
});

test('bind-float ajusta al paso de escala que trae la pista', async () => {
  spacing(12);
  const frame = node('FRAME', { paddingLeft: 10 });
  assert.equal(await apply(frame, bindPadding(10, 12)), true);
  assert.equal(frame.paddingLeft, 12);
});

test('el radio uniforme se omite si las esquinas ya difieren o alguna tiene variable', async () => {
  spacing(8);
  const hint: FixHint = { kind: 'bind-float', field: 'cornerRadius', variableId: 'V16', from: 8 };
  assert.equal(await apply(node('FRAME', { cornerRadius: figma.mixed }), hint), false);
  assert.equal(await apply(node('FRAME', { cornerRadius: 8, boundVariables: { topLeftRadius: alias('otra') } }), hint), false);
});

test('los lados iguales de un padding se enlazan todos a la vez, o ninguno si uno ha cambiado', async () => {
  spacing(16);
  const all = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];
  const sides: FixHint = { kind: 'bind-float', field: 'paddingLeft', fields: all, variableId: 'V16', from: 16 };
  const frame = node('FRAME', { paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16 });
  assert.equal(fixApplied(frame, sides), false);
  assert.equal(await apply(frame, sides), true);
  assert.deepEqual(all.map((f) => frame.boundVariables[f]?.id), ['V16', 'V16', 'V16', 'V16']);
  assert.equal(fixApplied(frame, sides), true);
  // Alguien cambió un lado después de auditar: no se toca ninguno.
  const changed = node('FRAME', { paddingLeft: 16, paddingRight: 16, paddingTop: 20, paddingBottom: 16 });
  assert.equal(await apply(changed, sides), false);
  assert.deepEqual(Object.keys(changed.boundVariables), []);
  // A medias, deshacer no la da por puesta ni por quitada.
  const half = node('FRAME', { paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16, boundVariables: { paddingLeft: alias('V16') } });
  assert.equal(fixApplied(half, sides), null);
});

/** Un blanco semántico, surface/default, con el color que se pida. */
function semantic(value = WHITE) {
  reset();
  useVariables([collection('CC', 'Semantic')], [color('VW', 'surface/default', 'CC', { value })]);
}
const bindWhite: FixHint = { kind: 'bind-color', target: 'fills', index: 0, variableId: 'VW', from: { color: WHITE } };

test('bind-color se aplica si la pintura sigue con el mismo color literal', async () => {
  semantic();
  const frame = node('FRAME', { fills: [solid(WHITE)] });
  assert.equal(await apply(frame, bindWhite), true);
  assert.equal(frame.fills[0].boundVariables.color.id, 'VW');
});

test('bind-color se omite si la pintura cambió, ya tiene variable o la capa tiene un estilo', async () => {
  semantic();
  assert.equal(await apply(node('FRAME', { fills: [solid(GREY)] }), bindWhite), false);
  assert.equal(await apply(node('FRAME', { fills: [solid(WHITE, { boundVariables: { color: alias('otra') } })] }), bindWhite), false);
  assert.equal(await apply(node('FRAME', { fills: [solid(WHITE)], fillStyleId: 'S:1' }), bindWhite), false);
});

test('bind-color se omite si la variable ya no resuelve a ese color', async () => {
  semantic(GREY);
  assert.equal(await apply(node('FRAME', { fills: [solid(WHITE)] }), bindWhite), false);
});

test('reenlazar una primitiva exige que la pintura siga en ella y que la semántica dé su color', async () => {
  reset();
  useVariables(
    [collection('C1', 'Primitives', ['value'], true), collection('C3', 'Semantic')],
    [color('white', 'white', 'C1', { value: WHITE }), color('surface', 'surface/default', 'C3', { value: alias('white') })],
  );
  const hint: FixHint = { kind: 'bind-color', target: 'fills', index: 0, variableId: 'surface', from: { variableId: 'white' } };
  assert.equal(await apply(node('FRAME', { fills: [solid(WHITE, { boundVariables: { color: alias('white') } })] }), hint), true);
  assert.equal(await apply(node('FRAME', { fills: [solid(WHITE, { boundVariables: { color: alias('otra') } })] }), hint), false);
});

test('una variable rota se quita solo si la capa sigue enlazada a ella y sigue rota', async () => {
  reset();
  const hint: FixHint = { kind: 'unbind', field: 'opacity', variableId: 'X' };
  const broken = () => node('FRAME', { opacity: 0.5, boundVariables: { opacity: alias('X') } });
  let frame = broken();
  assert.equal(await apply(frame, hint), true);
  assert.equal(frame.boundVariables.opacity, undefined);
  assert.equal(await apply(node('FRAME', { opacity: 0.5, boundVariables: { opacity: alias('Y') } }), hint), false);
  addRemote(float('X', 'opacity/half', 'CB', { value: 0.5 }));
  frame = broken();
  assert.equal(await apply(frame, hint), false);
  assert.equal(frame.boundVariables.opacity?.id, 'X');
});

test('una pintura con una variable rota se suelta solo si sigue rota', async () => {
  reset();
  const hint: FixHint = { kind: 'unbind-paint', target: 'fills', index: 0, variableId: 'X' };
  const painted = () => node('FRAME', { fills: [solid(WHITE, { boundVariables: { color: alias('X') } })] });
  const frame = painted();
  assert.equal(await apply(frame, hint), true);
  assert.deepEqual(frame.fills[0].boundVariables, {});
  addRemote(color('X', 'surface/old', 'CC', { value: WHITE }));
  assert.equal(await apply(painted(), hint), false);
});

test('un estilo roto se quita solo si la capa sigue con él y sigue roto', async () => {
  reset();
  const hint: FixHint = { kind: 'clear-style', field: 'fillStyleId', styleId: 'S:1' };
  let frame = node('FRAME', { fillStyleId: 'S:1' });
  assert.equal(await apply(frame, hint), true);
  assert.equal(frame.fillStyleId, '');
  assert.equal(await apply(node('FRAME', { fillStyleId: 'S:2' }), hint), false);
  addStyle('S:1');
  frame = node('FRAME', { fillStyleId: 'S:1' });
  assert.equal(await apply(frame, hint), false);
  assert.equal(frame.fillStyleId, 'S:1');
});

test('fixApplied sabe si un enlace de la corrección sigue puesto', async () => {
  spacing(16);
  const frame = node('FRAME', { paddingLeft: 16 });
  const pad = bindPadding(16);
  assert.equal(fixApplied(frame, pad), false);
  await apply(frame, pad);
  assert.equal(fixApplied(frame, pad), true);
  // Enlazado a otra variable después: ya no es la corrección.
  frame.boundVariables.paddingLeft = alias('otra');
  assert.equal(fixApplied(frame, pad), false);

  semantic();
  const card = node('FRAME', { fills: [solid(WHITE)] });
  assert.equal(fixApplied(card, bindWhite), false);
  await apply(card, bindWhite);
  assert.equal(fixApplied(card, bindWhite), true);
});

test('fixApplied con el radio uniforme: las cuatro esquinas, ninguna o solo algunas', () => {
  reset();
  const hint: FixHint = { kind: 'bind-float', field: 'cornerRadius', variableId: 'V16', from: 8 };
  const corners = (n: number) => Object.fromEntries(['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'].slice(0, n).map((f) => [f, alias('V16')]));
  assert.equal(fixApplied(node('FRAME', { cornerRadius: 8, boundVariables: corners(4) }), hint), true);
  assert.equal(fixApplied(node('FRAME', { cornerRadius: 8, boundVariables: { cornerRadius: alias('V16') } }), hint), true);
  assert.equal(fixApplied(node('FRAME', { cornerRadius: 8, boundVariables: corners(0) }), hint), false);
  assert.equal(fixApplied(node('FRAME', { cornerRadius: 8, boundVariables: corners(2) }), hint), null);
});

test('fixApplied da por puesta una referencia rota una vez quitada', async () => {
  reset();
  const unbind: FixHint = { kind: 'unbind', field: 'opacity', variableId: 'X' };
  const frame = node('FRAME', { opacity: 0.5, boundVariables: { opacity: alias('X') } });
  assert.equal(fixApplied(frame, unbind), false);
  await apply(frame, unbind);
  assert.equal(fixApplied(frame, unbind), true);

  const unbindPaint: FixHint = { kind: 'unbind-paint', target: 'fills', index: 0, variableId: 'X' };
  const painted = node('FRAME', { fills: [solid(WHITE, { boundVariables: { color: alias('X') } })] });
  assert.equal(fixApplied(painted, unbindPaint), false);
  await apply(painted, unbindPaint);
  assert.equal(fixApplied(painted, unbindPaint), true);

  const clear: FixHint = { kind: 'clear-style', field: 'fillStyleId', styleId: 'S:1' };
  const styled = node('FRAME', { fillStyleId: 'S:1' });
  assert.equal(fixApplied(styled, clear), false);
  await apply(styled, clear);
  assert.equal(fixApplied(styled, clear), true);

  const mode: FixHint = { kind: 'clear-mode', collectionId: 'gone', modeId: 'dark' };
  assert.equal(fixApplied(node('FRAME', { explicitVariableModes: { gone: 'dark' } }), mode), false);
  assert.equal(fixApplied(node('FRAME', { explicitVariableModes: {} }), mode), true);
});
