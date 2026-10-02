import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context, node, page, place, reset } from './figma';
import { statesCheck } from '../src/checks/components';

/** Hallazgos de la regla de estados sobre un set con esos ejes de variante. */
async function states(name: string, axes: Record<string, string[]>) {
  reset();
  const definitions = Object.fromEntries(Object.entries(axes).map(([key, options]) => [key, { type: 'VARIANT', variantOptions: options }]));
  const set = node('COMPONENT_SET', { name, componentPropertyDefinitions: definitions });
  place([set]);
  const found = await statesCheck.run(set, await context(), page);
  return found?.map((f) => `[${f.severity}] ${f.message}`) ?? [];
}

test('un eje Status de negocio no pide estados de interacción', async () => {
  assert.deepEqual(await states('Badge', { Status: ['Success', 'Warning', 'Error'] }), []);
  assert.deepEqual(await states('Card/Flight', { Status: ['Published', 'Accepted', 'Confirmed'], Favorite: ['true', 'false'] }), []);
  assert.deepEqual(await states('Avatar', { Status: ['Online', 'Offline'] }), []);
});

test('Active y Desactivado no bastan para tomar un eje Status por uno de interacción', async () => {
  assert.deepEqual(await states('Tag', { Status: ['Active', 'Inactive'] }), []);
  assert.deepEqual(await states('Pill', { Status: ['Activo', 'Desactivado'] }), []);
});

test('un eje State pide los estados aunque no tenga ninguno de interacción', async () => {
  // Un desplegable es un control de selección, como un Select: no se le pide Pressed.
  assert.deepEqual(await states('Dropdown-trigger', { State: ['Open', 'Closed'] }), ['[warning] Faltan estados en State: Default, Hover, Focus, Disabled']);
  assert.deepEqual(await states('Card', { State: ['Default', 'Hover'] }), ['[warning] Faltan estados en State: Pressed, Focus, Disabled']);
});

test('con varios ejes manda el que tiene estados de interacción', async () => {
  assert.deepEqual(await states('Input', { Status: ['Default', 'Error', 'Success'], State: ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] }), []);
});

test('un componente con nombre interactivo y solo un eje Status sí se avisa', async () => {
  assert.deepEqual(await states('Button', { Status: ['Success', 'Error'] }), ['[warning] Faltan estados en Status: Default, Hover, Pressed, Focus, Disabled']);
});

test('un componente con nombre interactivo sin eje de estado sale como info', async () => {
  assert.deepEqual(await states('Button', { Size: ['sm', 'md'] }), ['[info] Componente interactivo sin eje de estado (State)']);
});

test('a los campos y controles de selección no se les pide Pressed; a lo que se pulsa, sí', async () => {
  const withoutPressed = ['Default', 'Hover', 'Focus', 'Disabled'];
  assert.deepEqual(await states('Input', { State: withoutPressed }), []);
  assert.deepEqual(await states('Forms/Checkbox', { State: withoutPressed, Checked: ['true', 'false'] }), []);
  assert.deepEqual(await states('Interruptor', { Estado: ['Por defecto', 'Hover', 'Foco', 'Deshabilitado'] }), []);
  // Un nombre de botón manda aunque diga también otra cosa.
  assert.deepEqual(await states('Toggle button', { State: withoutPressed }), ['[warning] Faltan estados en State: Pressed']);
  assert.deepEqual(await states('Chip', { State: withoutPressed }), ['[warning] Faltan estados en State: Pressed']);
  // A un campo le siguen faltando los suyos.
  assert.deepEqual(await states('Text field', { State: ['Default', 'Focus'] }), ['[warning] Faltan estados en State: Hover, Disabled']);
});

test('los estados se reconocen por sus sinónimos', async () => {
  assert.deepEqual(await states('Button', { State: ['Enabled', 'Hovered', 'Active', 'Focused', 'Disabled'] }), []);
});

test('los estados se reconocen en español, también en femenino', async () => {
  // Las pestañas de un sistema de pruebas: «Inactiva» es el reposo, y faltan los de interacción.
  assert.deepEqual(await states('BK / Carta / Pestaña', { Estado: ['Activa', 'Inactiva'] }), ['[warning] Faltan estados en Estado: Hover, Pressed, Focus, Disabled']);
  assert.deepEqual(await states('Botón', { Estado: ['Por defecto', 'Hover', 'Pulsada', 'Enfocada', 'Deshabilitada'] }), []);
});
