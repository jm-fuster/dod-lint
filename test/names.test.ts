import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, collection, context, float, node, page, place, reset, solid, useVariables } from './figma';
import { compilePattern } from '../src/context';
import { propsCheck, statesCheck, touchCheck } from '../src/checks/components';
import { contrastCheck } from '../src/checks/color';
import { autoLayoutCheck } from '../src/checks/layout';
import { SMALL_SIZE, fold } from '../src/names';
import type { Settings } from '../src/types';

// Lo que se reconoce por el nombre, en los seis idiomas que entiende el plugin y sin depender de los acentos.

async function states(name: string, axes: Record<string, string[]>, overrides: Partial<Settings> = {}) {
  reset();
  const definitions = Object.fromEntries(Object.entries(axes).map(([key, options]) => [key, { type: 'VARIANT', variantOptions: options }]));
  const set = node('COMPONENT_SET', { name, componentPropertyDefinitions: definitions });
  place([set]);
  const found = await statesCheck.run(set, await context(overrides), page);
  return found?.map((f) => `[${f.severity}] ${f.message}`) ?? [];
}

test('los estados se reconocen en francés, alemán, portugués e italiano', async () => {
  assert.deepEqual(await states('Bouton', { État: ['Défaut', 'Survol', 'Appuyé', 'Focus', 'Désactivé'] }), []);
  assert.deepEqual(await states('Schaltfläche', { Zustand: ['Standard', 'Hover', 'Gedrückt', 'Fokussiert', 'Deaktiviert'] }), []);
  assert.deepEqual(await states('Botão', { Estado: ['Padrão', 'Hover', 'Pressionado', 'Focado', 'Desabilitado'] }), []);
  assert.deepEqual(await states('Pulsante', { Stato: ['Predefinito', 'Hover', 'Premuto', 'Focalizzato', 'Disabilitato'] }), []);
  assert.deepEqual(await states('Bouton', { État: ['Défaut', 'Survol'] }), ['[warning] Faltan estados en État: Pressed, Focus, Disabled']);
});

test('a los campos se les piden los suyos también en otros idiomas', async () => {
  assert.deepEqual(await states('Champ de saisie', { État: ['Défaut', 'Survol', 'Focus', 'Désactivé'] }), []);
  assert.deepEqual(await states('Eingabefeld', { Zustand: ['Standard', 'Hover', 'Fokus', 'Deaktiviert'] }), []);
  assert.deepEqual(await states('Caixa de seleção', { Estado: ['Padrão', 'Hover', 'Foco', 'Desativado'] }), []);
  assert.deepEqual(await states('Interruttore', { Stato: ['Predefinito', 'Disabilitato'] }), ['[warning] Faltan estados en Stato: Hover, Focus']);
});

test('un eje con dos estados de interacción es el de estado, se llame como se llame', async () => {
  assert.deepEqual(await states('Card', { Interaction: ['Default', 'Hover', 'Pressed'] }), ['[warning] Faltan estados en Interaction: Focus, Disabled']);
  // El Split button de Material 3, que salía como «sin eje de estado».
  const m3 = ['Enabled', 'Hovered', 'Focused', 'Pressed', 'Disabled'];
  assert.deepEqual(await states('Split button', { Size: ['Small', 'Medium'], 'Leading state': m3, 'Trailing state': [...m3, 'Selected'] }), []);
  // Un idioma que el plugin no entiende: el eje se reconoce por sus valores.
  assert.deepEqual(await states('ボタン', { 状態: ['デフォルト', 'Hover', 'Focus', 'Disabled'] }), ['[warning] Faltan estados en 状態: Default, Pressed']);
  // Con uno solo no basta: Deshabilitada puede ser un tipo más.
  assert.deepEqual(await states('Tarjeta', { Tipo: ['Primaria', 'Secundaria', 'Deshabilitada'] }), []);
});

test('los estados pedidos en ajustes se pueden escribir en otro idioma', async () => {
  const french = { requiredStates: ['Défaut', 'Survol', 'Appuyé', 'Désactivé'] };
  assert.deepEqual(await states('Button', { State: ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] }, french), []);
  assert.deepEqual(await states('Button', { State: ['Default', 'Pressed'] }, french), ['[warning] Faltan estados en State: Survol, Désactivé']);
});

test('los controles se reconocen por su nombre en otros idiomas, sin sus partes', async () => {
  const ctx = await context();
  const controls = ['Bouton', 'Case à cocher', 'Liste déroulante', 'Schaltfläche', 'Kontrollkästchen', 'Eingabefeld', 'Botão', 'Caixa de seleção', 'Pulsante', 'Casella di controllo', 'Pestaña', 'Desplegable', 'btn_primary'];
  assert.deepEqual(controls.filter((n) => !ctx.isInteractiveName(n)), []);
  const parts = ['Bouton/Libellé', 'Botão/Ícone', 'Schaltfläche/Beschriftung', 'Pulsante/Etichetta', 'Tarjeta', 'Carte', 'Table'];
  assert.deepEqual(parts.filter((n) => ctx.isInteractiveName(n)), []);
});

test('los tamaños pequeños se reconocen en otros idiomas', async () => {
  const small = ['Size=XXS', 'Tamaño=Pequeño', 'Tamanho=Pequena', 'Taille=Petite', 'Größe=Klein', 'Groesse=Kompakt', 'Dimensione=Piccola'];
  assert.deepEqual(small.filter((n) => !SMALL_SIZE.test(fold(n))), []);
  assert.deepEqual(['Size=Standard', 'Taille=Grande', 'Größe=Groß'].filter((n) => SMALL_SIZE.test(fold(n))), []);

  reset();
  const sized = (name: string, width: number, height: number) => node('COMPONENT', { name, width, height });
  const set = node('COMPONENT_SET', { name: 'Bouton' }, [sized('Taille=Moyen', 120, 44), sized('Taille=Petit', 96, 32), sized('Taille=XS', 64, 20)]);
  place([set]);
  const found = await touchCheck.run(set, await context({ touchMin: 44 }), page);
  assert.deepEqual(found?.map((f) => f.message), ['1 de 3 variantes por debajo de 24 px (la más pequeña, 64 × 20 px)']);
});

const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });

/** Severidad del contraste de un texto que se queda justo por debajo del mínimo, dentro de `wrapper`. */
async function contrastIn(wrapper: any) {
  const text = node('TEXT', { name: 'Label', fills: [solid(hex('#777777'))] });
  const outer = node('FRAME', { name: 'Pantalla' }, [wrapper]);
  wrapper.children = [text];
  text.parent = wrapper;
  place([outer]);
  const found = (await contrastCheck.run(text, await context(), page)) ?? [];
  return found.map((f) => f.severity);
}

test('el estado deshabilitado se reconoce en cualquier idioma y en cualquier eje', async () => {
  for (const name of ['État=Désactivé', 'Zustand=Deaktiviert', 'Estado=Desabilitado', 'Stato=Disabilitato', 'Type=Disabled', '状態=Disabled', 'Size=SM, Désactivé=Oui']) {
    reset();
    assert.deepEqual(await contrastIn(node('FRAME', { name })), ['info'], name);
  }
  for (const name of ['État=Défaut', 'Disabled=False', 'Disabled']) {
    reset();
    assert.deepEqual(await contrastIn(node('FRAME', { name })), ['warning'], name);
  }
  // En una instancia, por sus propiedades.
  reset();
  assert.deepEqual(await contrastIn(node('INSTANCE', { name: 'Bouton', componentProperties: { Zustand: { type: 'VARIANT', value: 'Deaktiviert' } } })), ['info']);
  reset();
  assert.deepEqual(await contrastIn(node('INSTANCE', { name: 'Bouton', componentProperties: { 'Désactivé#1:2': { type: 'BOOLEAN', value: true } } })), ['info']);
});

test('el contenido de relleno se reconoce en otros idiomas, y «Todo» es contenido de verdad', async () => {
  reset();
  const texts = ['Libellé', 'Rótulo', 'Beschriftung', 'Etichetta', 'Título', 'TODO', 'Todo', 'Hola'].map((characters) => node('TEXT', { name: characters, characters }));
  place([node('COMPONENT', { name: 'Card' }, texts)]);
  const found = (await audit()).findings.filter((f) => f.checkId === 'placeholder').map((f) => f.nodeName);
  assert.deepEqual(found, ['Libellé', 'Rótulo', 'Beschriftung', 'Etichetta', 'Título', 'TODO']);
});

test('los iconos anidados se reconocen en otros idiomas, y sus glifos estructurales también', async () => {
  const props = async (name: string) => {
    reset();
    const component = node('COMPONENT', { name: 'Bouton', componentPropertyDefinitions: {} }, [node('INSTANCE', { name })]);
    place([component]);
    return ((await propsCheck.run(component, await context(), page)) ?? []).map((f) => f.message);
  };
  assert.deepEqual(await props('Icône'), ['Icono anidado sin instance swap ni booleano de visibilidad']);
  assert.deepEqual(await props('Icona sinistra'), ['Icono anidado sin instance swap ni booleano de visibilidad']);
  assert.deepEqual(await props('Icône/Flèche'), []);
  assert.deepEqual(await props('Ícone/Seta'), []);
});

test('un frame pequeño de icono o ilustración no pide auto layout, también con acentos', async () => {
  const layout = async (name: string) => {
    reset();
    const art = node('FRAME', { name, width: 24, height: 24 }, [node('VECTOR'), node('TEXT')]);
    place([node('FRAME', { name: 'Pantalla' }, [art])]);
    return (await autoLayoutCheck.run(art, await context(), page)) ?? [];
  };
  for (const name of ['Ícone', 'Icône', 'Illustrazione', 'Ilustração', 'Logotipo']) assert.deepEqual(await layout(name), [], name);
  assert.equal((await layout('Etiqueta')).length, 1);
});

test('las variables de espaciado y de radio se reconocen por su nombre en otros idiomas', async () => {
  reset();
  const vars = [
    float('a', 'espacement/16', 'C', { value: 16 }),
    float('b', 'Abstand/klein', 'C', { value: 8 }),
    float('c', 'espaçamento/md', 'C', { value: 12 }),
    float('d', 'spaziatura/4', 'C', { value: 4 }),
    float('e', 'margen/lg', 'C', { value: 24 }),
    float('f', 'rayon/8', 'C', { value: 8 }),
    float('g', 'raggio/md', 'C', { value: 8 }),
    float('h', 'taille-police/16', 'C', { value: 16 }),
    float('i', 'espacement-lettres/1', 'C', { value: 1 }),
  ];
  useVariables([collection('C', 'Tokens')], vars);
  const ctx = await context();
  const rank = (kind: 'spacing' | 'radius') => vars.filter((v) => ctx.floatRank(v as unknown as Variable, kind) >= 0).map((v) => v.name);
  assert.deepEqual(rank('spacing'), ['espacement/16', 'Abstand/klein', 'espaçamento/md', 'spaziatura/4', 'margen/lg']);
  assert.deepEqual(rank('radius'), ['rayon/8', 'raggio/md']);
});

test('el patrón de nombres interactivos no distingue acentos y vale en cualquier alfabeto', () => {
  assert.equal(compilePattern('bot[oó]n|pestaña').test(fold('Pestaña')), true);
  assert.equal(compilePattern('ボタン').test(fold('プライマリボタン')), true);
  assert.equal(compilePattern('кнопка').test(fold('Кнопка/Основная')), true);
  // Siguen siendo palabras enteras.
  assert.equal(compilePattern('tab').test(fold('Table')), false);
});
