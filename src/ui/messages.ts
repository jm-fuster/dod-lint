// Cómo se enseña un mensaje del sandbox en una fila: lo que pasa, aparte de sus aclaraciones y etiquetas.
import type { Text } from '../i18n';

export interface Flag {
  label: Text;
  title: Text;
}
const OVERRIDE_FLAG: Flag = {
  label: { es: 'override', en: 'override' },
  title: { es: 'Lo cambia esta instancia; el resto de la capa viene del componente', en: 'This instance changes it; the rest of the layer comes from the component' },
};
export const ANCHORED: Flag = {
  label: { es: 'en su instancia', en: 'on its instance' },
  title: {
    es: 'Figma ha devuelto esta capa sin su sitio en la página (pasa a veces al deshacer): se señala en su instancia y no se ofrece corregirla',
    en: 'Figma returned this layer detached from the page (it sometimes happens after an undo): it points to its instance, and no fix is offered',
  },
};

/**
 * Separa un mensaje del sandbox en lo que pasa y sus aclaraciones: los paréntesis del final, lo que va tras
 * «→» (la semántica a la que pasar una primitiva) y las marcas que se enseñan como etiqueta.
 */
export function splitMessage(message: string): { title: string; notes: string[]; flags: Flag[]; arrow?: string } {
  let title = message.trim();
  const notes: string[] = [];
  const flags: Flag[] = [];
  while (title.endsWith(')')) {
    let depth = 0;
    let start = -1;
    for (let i = title.length - 1; i >= 0; i--) {
      if (title[i] === ')') depth++;
      else if (title[i] === '(' && --depth === 0) {
        start = i;
        break;
      }
    }
    if (start <= 0) break;
    const inner = title.slice(start + 1, -1);
    // El color del fondo de un contraste es parte de lo que pasa.
    if (/^#[0-9a-f]{6}/i.test(inner)) break;
    const repeated = inner.match(/^(?:se repite en|repeated in) (\d+) (?:instancias|instances)$/);
    if (/^(override en instancia|instance override)$/.test(inner)) flags.unshift(OVERRIDE_FLAG);
    else if (repeated) flags.unshift({ label: { es: `en ${repeated[1]} instancias`, en: `in ${repeated[1]} instances` }, title: { es: 'El mismo texto de un componente da este resultado en todas ellas', en: 'The same component text gets this result in all of them' } });
    else notes.unshift(inner);
    title = title.slice(0, start).trimEnd();
  }
  const cut = title.indexOf(' → ');
  const arrow = cut > 0 ? title.slice(cut + 3) : undefined;
  if (cut > 0) title = title.slice(0, cut);
  return { title, notes, flags, arrow };
}
