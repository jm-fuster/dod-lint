import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHITE, context, node, page, place, reset, solid } from './figma';
import { colorEq, compilePattern, composite, contrastRatio, over, round2, slotContentOf, toHex } from '../src/context';
import { contrastCheck } from '../src/checks/color';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';
import { resolveLang } from '../src/i18n';
import type { Settings } from '../src/types';

const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });

test('contraste WCAG: negro sobre blanco da 21:1 y #767676 sobre blanco, 4,54:1', () => {
  assert.equal(round2(contrastRatio(hex('#000000'), hex('#FFFFFF'))), 21);
  assert.equal(round2(contrastRatio(hex('#767676'), hex('#FFFFFF'))), 4.54);
  assert.equal(contrastRatio(hex('#FFFFFF'), hex('#FFFFFF')), 1);
});

test('composición de colores con alfa', () => {
  assert.deepEqual(composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE), { r: 0.5, g: 0.5, b: 0.5, a: 1 });
  const mixed = over({ r: 1, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 1, a: 0.5 });
  assert.deepEqual([round2(mixed.r), round2(mixed.g), round2(mixed.b), round2(mixed.a)], [0.67, 0, 0.33, 0.75]);
});

test('dos colores son iguales con un paso de 1/255 por canal y un 1 % de alfa de margen', () => {
  assert.equal(colorEq(WHITE, { r: 254 / 255, g: 1, b: 1, a: 1 }), true);
  assert.equal(colorEq(WHITE, { r: 253 / 255, g: 1, b: 1, a: 1 }), false);
  assert.equal(colorEq(WHITE, { ...WHITE, a: 0.99 }), true);
  assert.equal(colorEq(WHITE, { ...WHITE, a: 0.98 }), false);
});

test('hexadecimal con la opacidad cuando no es completa', () => {
  assert.equal(toHex(WHITE), '#FFFFFF');
  assert.equal(toHex({ ...WHITE, a: 0.5 }), '#FFFFFF 50%');
});

test('el contenido de un slot de instancia se separa en propio y heredado por su id', () => {
  const slot: any = { id: 'I2:41;2:11', children: [{ id: 'I2:41;2:12' }, { id: 'I2:41;2:11;2:48' }, { id: '2:45' }] };
  const { owned, inherited } = slotContentOf(slot);
  // Heredado: un subnodo más de la instancia. Propio: cuelga del slot, o es lo insertado por API con id suelto.
  assert.deepEqual(owned.map((k) => k.id), ['I2:41;2:11;2:48', '2:45']);
  assert.deepEqual(inherited.map((k) => k.id), ['I2:41;2:12']);
});

test('los ajustes guardados se mezclan con los de por defecto sin tocarlos', () => {
  const merged = mergeSettings({ touchMin: 48, enabled: { color: false, inventada: true } as unknown as Settings['enabled'] }, null, { language: 'es' });
  assert.equal(merged.touchMin, 48);
  assert.equal(merged.language, 'es');
  assert.equal(merged.enabled.color, false);
  assert.equal(merged.enabled.spacing, true);
  assert.equal('inventada' in merged.enabled, false);
  assert.equal(DEFAULT_SETTINGS.enabled.color, true);
  assert.equal(mergeSettings({ touchMin: undefined }).touchMin, 24);
});

test('idioma: manda el ajuste y, en automático, el del sistema; sin saberlo, inglés', () => {
  assert.equal(resolveLang('es', 'en-US'), 'es');
  assert.equal(resolveLang('auto', 'es-ES'), 'es');
  assert.equal(resolveLang('auto', 'en-GB'), 'en');
  assert.equal(resolveLang('auto', null), 'en');
  assert.equal(resolveLang(undefined), 'en');
});

test('un patrón de nombres interactivos no válido cae en el de reserva', () => {
  assert.equal(compilePattern('button|chip').test('Icon Button'), true);
  assert.equal(compilePattern('(').test('Checkbox'), true);
});

/** Hallazgos de contraste de un texto de ese color sobre el fondo blanco de la página. */
async function contrastOf(textColor: string, props: Record<string, unknown> = {}, wrapper?: string) {
  reset();
  const text = node('TEXT', { name: 'Label', fills: [solid(hex(textColor))], ...props });
  // Siempre dentro de un frame sin relleno: un texto suelto en la página es un rótulo del lienzo y no se revisa.
  place([node('FRAME', { name: wrapper ?? 'Pantalla' }, [text])]);
  const found = (await contrastCheck.run(text, await context(), page)) ?? [];
  return found.map((f) => [f.severity, f.message]);
}

test('contraste: justo por encima del mínimo pasa y justo por debajo avisa', async () => {
  assert.deepEqual(await contrastOf('#767676'), []);
  assert.deepEqual(await contrastOf('#777777'), [['warning', 'Contraste 4.48:1, mínimo 4.5:1 para 14 px sobre fondo de la página (#FFFFFF)']]);
});

test('contraste: el texto grande pide 3:1 y el estado deshabilitado solo informa', async () => {
  assert.deepEqual(await contrastOf('#949494', { fontSize: 24 }), []);
  assert.deepEqual(await contrastOf('#777777', {}, 'State=Disabled'), [
    ['info', 'Contraste 4.48:1, mínimo 4.5:1 para 14 px sobre fondo de la página (#FFFFFF). Estado deshabilitado: WCAG lo exime'],
  ]);
});
