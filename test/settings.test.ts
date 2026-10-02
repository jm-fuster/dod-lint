import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reset } from './figma';
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, mergeSettings, saveSettings, settingsEdits } from '../src/settings';
import type { Settings } from '../src/types';

const inFile = () => figma.root.getPluginData(SETTINGS_KEY);
const forUser = () => figma.clientStorage.getAsync(SETTINGS_KEY);
const rules = (enabled: Partial<Settings['enabled']>) => enabled as Settings['enabled'];

test('la Definición de hecho se guarda en el archivo, solo con lo que cambia, y el idioma para quien usa el plugin', async () => {
  reset();
  await saveSettings(mergeSettings({ touchMin: 44, language: 'en', enabled: rules({ description: false }) }));
  assert.deepEqual(JSON.parse(inFile()), { enabled: { description: false }, touchMin: 44 });
  assert.deepEqual(await forUser(), { language: 'en' });
  // Volver a los valores por defecto deja el archivo sin ajustes.
  await saveSettings(mergeSettings({ language: 'en' }));
  assert.equal(inFile(), '');
});

test('quien abre el archivo audita con su Definición de hecho y con su propio idioma', async () => {
  reset();
  figma.root.setPluginData(SETTINGS_KEY, JSON.stringify({ touchMin: 44, requiredStates: ['Default', 'Focus'] }));
  // Así se guardaba antes, todo por usuario: de ello solo cuenta el idioma.
  await figma.clientStorage.setAsync(SETTINGS_KEY, { language: 'en', touchMin: 48, enabled: { contrast: false } });
  const s = await loadSettings();
  assert.equal(s.touchMin, 44);
  assert.deepEqual(s.requiredStates, ['Default', 'Focus']);
  assert.equal(s.enabled.contrast, true);
  assert.equal(s.language, 'en');
});

test('cambiar solo el idioma no escribe en el archivo', async () => {
  reset();
  await saveSettings(mergeSettings({ language: 'en' }));
  assert.equal(inFile(), '');
  // Tampoco reescribe unos ajustes de una versión anterior que siguen valiendo lo mismo.
  const old = JSON.stringify({ primitiveCollectionIds: ['c1'] });
  figma.root.setPluginData(SETTINGS_KEY, old);
  await saveSettings(mergeSettings(await loadSettings(), { language: 'es' }));
  assert.equal(inFile(), old);
  assert.deepEqual(await forUser(), { language: 'es' });
});

test('al guardar solo se escribe lo que has cambiado: no se pisa lo que otra persona guardó con el plugin abierto', async () => {
  reset();
  const mine = await loadSettings();
  // Otra persona, en el mismo archivo, sube el tamaño mínimo.
  await saveSettings(mergeSettings(await loadSettings(), { touchMin: 44 }));
  // Tú, desde los ajustes de antes, cambias los estados y apagas una regla.
  const draft = mergeSettings(mine, { requiredStates: ['Default', 'Focus'], enabled: rules({ description: false }) });
  const edits = settingsEdits(mine, draft);
  assert.deepEqual(edits, { enabled: { description: false }, requiredStates: ['Default', 'Focus'] });
  await saveSettings(mergeSettings(await loadSettings(), edits));
  const s = await loadSettings();
  assert.equal(s.touchMin, 44);
  assert.deepEqual(s.requiredStates, ['Default', 'Focus']);
  assert.equal(s.enabled.description, false);
  assert.equal(s.enabled.contrast, true);
});

test('ajustes de otra versión: la lista de primitivas sola se toma a mano, y lo que no tiene su tipo no cuenta', async () => {
  reset();
  figma.root.setPluginData(SETTINGS_KEY, JSON.stringify({ primitiveCollectionIds: ['c1'] }));
  const old = await loadSettings();
  assert.equal(old.primitiveAuto, false);
  assert.deepEqual(old.primitiveCollectionIds, ['c1']);

  figma.root.setPluginData(
    SETTINGS_KEY,
    JSON.stringify({ touchMin: '48', requiredStates: 'Default', snapToScale: 1, enabled: { color: 'no' }, inventado: true, toString: 'x', language: 'en' }),
  );
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);

  figma.root.setPluginData(SETTINGS_KEY, 'no es JSON');
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);
});
