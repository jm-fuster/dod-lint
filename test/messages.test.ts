import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/ui/messages';

/** Lo que enseña la fila, sin las traducciones de las etiquetas. */
const shown = (message: string) => {
  const { title, notes, flags, arrow } = splitMessage(message);
  return { title, notes, flags: flags.map((f) => f.label.es), ...(arrow ? { arrow } : {}) };
};

test('lo que pasa va aparte de las aclaraciones del final, que pueden ser varias', () => {
  assert.deepEqual(shown('Padding 10 fuera de escala (paso más cercano: 12, space/3)'), { title: 'Padding 10 fuera de escala', notes: ['paso más cercano: 12, space/3'], flags: [] });
  assert.deepEqual(shown('Relleno #FFFFFF sin token (coincide con surface/default) (override en instancia)'), { title: 'Relleno #FFFFFF sin token', notes: ['coincide con surface/default'], flags: ['override'] });
  assert.deepEqual(shown('Fill #FFFFFF is hard-coded (matches surface/default) (instance override)'), { title: 'Fill #FFFFFF is hard-coded', notes: ['matches surface/default'], flags: ['override'] });
  assert.deepEqual(shown('Texto sin estilo de texto ni variables tipográficas (Inter Regular 14)'), { title: 'Texto sin estilo de texto ni variables tipográficas', notes: ['Inter Regular 14'], flags: [] });
});

test('la semántica tras «→» se separa, y un paréntesis dentro de otro no lo corta', () => {
  assert.deepEqual(shown('Relleno enlazado a la primitiva color/cream-light → background/screen (override en instancia)'), {
    title: 'Relleno enlazado a la primitiva color/cream-light',
    notes: [],
    flags: ['override'],
    arrow: 'background/screen',
  });
  assert.deepEqual(shown('Padding 16 sin token (3 variables valen lo mismo: Space (sm), Margin, Gutter)'), { title: 'Padding 16 sin token', notes: ['3 variables valen lo mismo: Space (sm), Margin, Gutter'], flags: [] });
});

test('el color del fondo de un contraste es parte de lo que pasa, y las repeticiones son una etiqueta', () => {
  assert.deepEqual(shown('Contraste 2.9:1, mínimo 4.5:1 para 12 px sobre Card (#FFFFFF) (se repite en 4 instancias)'), {
    title: 'Contraste 2.9:1, mínimo 4.5:1 para 12 px sobre Card (#FFFFFF)',
    notes: [],
    flags: ['en 4 instancias'],
  });
  assert.deepEqual(shown('Contrast 2.9:1, minimum 4.5:1 for 12 px text on Card (#FFFFFF) (repeated in 4 instances)').flags, ['en 4 instancias']);
});

test('los nombres entre comillas con paréntesis se quedan como están', () => {
  const message = 'Instancia desvinculada de «Button (Size=Small)»: ya no recibe los cambios del componente';
  assert.deepEqual(shown(message), { title: message, notes: [], flags: [] });
  const quoted = 'Contraste 3.92:1, mínimo 4.5:1 para 12 px sobre Field (#FFFFFF). Estado deshabilitado: WCAG lo exime';
  assert.deepEqual(shown(quoted), { title: quoted, notes: [], flags: [] });
});
