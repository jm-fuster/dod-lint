import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCollection, collection, context, node, page, place, reset, settings, useVariables } from './figma';
import { runAudit } from '../src/audit';
import { applyFix } from '../src/fixes';
import type { FixHint } from '../src/types';

/** Como en un sistema de pruebas: «Tokens» se borró, pero Figma la sigue devolviendo por id, sin variables. */
const DELETED = { ...collection('VariableCollectionId:9:1018', 'Tokens', ['light', 'dark']), remote: false };
const LIBRARY = { ...collection('VariableCollectionId:abc/1:2', 'Brand', ['light', 'dark']), remote: true };
const LOCAL = collection('C3', 'Semantic', ['light', 'dark']);

const brokenOf = async (layer: any) => {
  place([layer]);
  const result = await runAudit('page', settings(), { pages: [page], lang: 'es' });
  return result.findings.filter((f) => f.checkId === 'broken').map((f) => [f.nodeType, f.severity, f.message, f.fix?.kind]);
};

test('un modo de una colección borrada se avisa y se ofrece quitarlo', async () => {
  reset();
  useVariables([LOCAL], []);
  addCollection(DELETED);
  const frame = node('FRAME', { name: 'Pantalla', explicitVariableModes: { [DELETED.id]: 'dark', C3: 'dark' } });
  assert.deepEqual(await brokenOf(frame), [['FRAME', 'warning', 'Modo «dark» de «Tokens», una colección que ya no existe', 'clear-mode']]);
});

test('si Figma ya no devuelve la colección, se avisa sin corrección', async () => {
  reset();
  const frame = node('FRAME', { name: 'Pantalla', explicitVariableModes: { 'VariableCollectionId:7:7': 'x' } });
  assert.deepEqual(await brokenOf(frame), [['FRAME', 'warning', 'Modo de una colección que ya no está disponible', undefined]]);
});

test('los modos de colecciones locales o de una biblioteca disponible no son hallazgos', async () => {
  reset();
  useVariables([LOCAL], []);
  addCollection(LIBRARY);
  assert.deepEqual(await brokenOf(node('FRAME', { name: 'Pantalla', explicitVariableModes: { C3: 'dark', [LIBRARY.id]: 'light' } })), []);
});

test('el modo puesto en la propia página se avisa al auditar la página, no una selección', async () => {
  reset();
  addCollection(DELETED);
  page.explicitVariableModes = { [DELETED.id]: 'light' };
  const frame = node('FRAME', { name: 'Pantalla' });
  place([frame]);
  const onPage = await runAudit('page', settings(), { pages: [page], lang: 'es' });
  assert.deepEqual(onPage.findings.filter((f) => f.checkId === 'broken').map((f) => [f.nodeId, f.nodeType, f.nodeName]), [[page.id, 'PAGE', 'Pruebas']]);
  page.selection = [frame];
  const onSelection = await runAudit('selection', settings(), { pages: [page], lang: 'es' });
  assert.deepEqual(onSelection.findings.filter((f) => f.checkId === 'broken'), []);
});

test('quitar el modo solo si sigue igual y la colección sigue sin existir', async () => {
  reset();
  addCollection(DELETED);
  const hint: FixHint = { kind: 'clear-mode', collectionId: DELETED.id, modeId: 'dark' };
  const frame = node('FRAME', { explicitVariableModes: { [DELETED.id]: 'dark' } });
  assert.equal(await applyFix(frame, hint, await context()), true);
  assert.deepEqual(frame.explicitVariableModes, {});
  // Otro modo desde la auditoría: no se toca.
  const changed = node('FRAME', { explicitVariableModes: { [DELETED.id]: 'light' } });
  assert.equal(await applyFix(changed, hint, await context()), false);
  // La colección vuelve a estar entre las locales: tampoco.
  useVariables([DELETED], []);
  const restored = node('FRAME', { explicitVariableModes: { [DELETED.id]: 'dark' } });
  assert.equal(await applyFix(restored, hint, await context()), false);
  // Y en una página también se puede.
  useVariables([], []);
  page.explicitVariableModes = { [DELETED.id]: 'dark' };
  assert.equal(await applyFix(page, hint, await context()), true);
  assert.deepEqual(page.explicitVariableModes, {});
});
