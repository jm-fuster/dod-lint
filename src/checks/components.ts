import type { Check } from './index';
import type { Finding, Severity } from '../types';
import { round2 } from '../context';
import type { AuditContext } from '../context';
import type { Text } from '../i18n';
import { BUSINESS_AXIS, FIELD_NAME, ICON_LAYER, PRESSABLE_NAME, SMALL_SIZE, STATE_AXIS, STRUCTURAL_GLYPH, fold, interactionStates, synonymsOf } from '../names';
import { VECTORISH } from './layout';

export type Definable = ComponentNode | ComponentSetNode;

/** Lo que mide como mucho un icono. */
const ICON_MAX = 64;

/**
 * ¿Es un icono? Un componente pequeño, sin relleno propio, hecho solo de formas vectoriales y sin instancias
 * dentro (un botón de icono lleva el icono como instancia), o un set cuyas variantes lo son. No tiene estados,
 * no se toca como un control y no se le pide descripción: en Simple Design System son 1.722 componentes sueltos,
 * y con el nombre de lo que dibujan («Toggle Left», «Radio») parecían controles.
 */
export function isIcon(node: SceneNode): boolean {
  if (node.type === 'COMPONENT_SET') {
    const variants = node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT');
    return variants.length > 0 && variants.every(isIcon);
  }
  if (node.type !== 'COMPONENT' || Math.max(node.width, node.height) > ICON_MAX) return false;
  const fills = node.fills;
  if (typeof fills === 'symbol' || fills.some((p) => p.visible !== false)) return false;
  const all = node.findAll(() => true);
  if (all.some((n) => n.type === 'INSTANCE' || n.type === 'TEXT')) return false;
  const leaves = all.filter((n) => !('children' in n));
  return leaves.length > 0 && leaves.every((n) => VECTORISH.has(n.type));
}

/** Componente suelto o set: los que exponen definiciones de propiedades. */
export function definable(node: SceneNode, ctx?: AuditContext): Definable | null {
  if (node.type === 'COMPONENT_SET') return node;
  if (node.type === 'COMPONENT' && (ctx ? ctx.parentOf(node) : node.parent)?.type !== 'COMPONENT_SET') return node;
  return null;
}

export function definitions(node: Definable): ComponentPropertyDefinitions | null {
  try {
    return node.componentPropertyDefinitions;
  } catch {
    return null;
  }
}

/** Los valores de un eje, sin mayúsculas ni acentos. */
const variantOptions = (def: ComponentPropertyDefinitions[string]) => (def.variantOptions ?? []).map((o) => fold(o.trim()));

/** Los estados que se piden a un componente, según lo que dice su nombre que es. */
export function requiredStatesFor(name: string, ctx: AuditContext): string[] {
  const folded = fold(name);
  const field = !PRESSABLE_NAME.test(folded) && FIELD_NAME.test(folded);
  return field ? ctx.settings.fieldStates : ctx.settings.requiredStates;
}

/** Los componentes interactivos tienen todos los estados. */
export const statesCheck: Check = {
  meta: {
    id: 'states',
    category: 'components',
    title: { es: 'Estados completos', en: 'Complete states' },
    description: {
      es: 'Sets con el eje de estado incompleto y controles sin eje de estado. A los botones se les pide Default, Hover, Pressed, Focus y Disabled; a los campos y controles de selección, lo mismo sin Pressed. Reconoce los nombres en inglés, español, francés, alemán, portugués e italiano.',
      en: 'Sets with an incomplete state axis, and controls with no state axis. Buttons need Default, Hover, Pressed, Focus and Disabled; fields and selection controls, the same without Pressed. Names are recognized in English, Spanish, French, German, Portuguese and Italian.',
    },
    severity: 'warning',
    fixable: false,
  },
  run(node, ctx, page) {
    if (node.type === 'COMPONENT' && ctx.parentOf(node)?.type !== 'COMPONENT_SET') {
      if (!ctx.isInteractiveName(node.name) || isIcon(node)) return null;
      const message = ctx.tx({ es: 'Componente interactivo sin variantes de estado', en: 'Interactive component without state variants' });
      return [ctx.finding(node, page, this.meta, message, { severity: 'info' })];
    }
    if (node.type !== 'COMPONENT_SET' || isIcon(node)) return null;
    const defs = definitions(node);
    if (!defs) return null;
    const variantAxes = Object.keys(defs).filter((k) => defs[k].type === 'VARIANT');
    const axes = variantAxes.filter((k) => STATE_AXIS.test(fold(k.trim())));
    const interactive = ctx.isInteractiveName(node.name);
    const states = (k: string) => interactionStates(variantOptions(defs[k]));
    // Manda el eje de estado que ya tiene algún estado de interacción. Si no, cualquier eje con dos o más, se
    // llame como se llame: Leading state en el Split button de Material 3, que salía como «sin eje de estado»
    // (octubre de 2026), o 状態 en un idioma que el plugin no entiende. Después, el que se llama State o Estado.
    // Un eje Status sin ninguno (Success, Error, Published…) es de negocio: solo se le piden estados si el
    // nombre dice que el componente es interactivo.
    const stateKey =
      axes.find((k) => states(k) > 0) ??
      variantAxes.find((k) => states(k) >= 2) ??
      axes.find((k) => !BUSINESS_AXIS.test(fold(k.trim()))) ??
      (interactive ? axes[0] : undefined);
    if (!stateKey) {
      if (!interactive) return null;
      const message = ctx.tx({ es: 'Componente interactivo sin eje de estado (State)', en: 'Interactive component without a State axis' });
      return [ctx.finding(node, page, this.meta, message, { severity: 'info' })];
    }
    const options = variantOptions(defs[stateKey]);
    const missing = requiredStatesFor(node.name, ctx).filter((req) => {
      const synonyms = synonymsOf(req);
      return !options.some((o) => synonyms.includes(o));
    });
    if (!missing.length) return null;
    const list = missing.join(', ');
    return [ctx.finding(node, page, this.meta, ctx.tx({ es: `Faltan estados en ${stateKey}: ${list}`, en: `Missing states in ${stateKey}: ${list}` }))];
  },
};

/** Las variantes de un set no se tapan unas a otras en el lienzo. */
export const stackedCheck: Check = {
  meta: {
    id: 'stacked',
    category: 'components',
    title: { es: 'Variantes sin solapar', en: 'Variants don’t overlap' },
    description: {
      es: 'Variantes de un set que se solapan en el lienzo. Si una tapa la mitad o más de otra, la de debajo pasa desapercibida. Suele pasar al añadir un eje sin reordenar el set.',
      en: 'Variants in a set that overlap on the canvas. If one covers half or more of another, the one below goes unnoticed. It usually happens when an axis is added and the set isn’t rearranged.',
    },
    severity: 'warning',
    fixable: false,
  },
  run(node, ctx, page) {
    if (node.type !== 'COMPONENT_SET') return null;
    const variants = node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT' && (c.visible || ctx.settings.includeHidden));
    // En coordenadas absolutas: en un set con auto layout, las x/y de los hijos pueden no estar al día.
    const boxes = variants.map((v) => v.absoluteBoundingBox);
    const stacked = new Set<number>();
    const overlapping = new Set<number>();
    let example: { pair: [number, number]; stacked: boolean } | null = null;
    let depth = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        if (!a || !b) continue;
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w <= 0.5 || h <= 0.5) continue;
        // Apiladas: lo que comparten cubre al menos la mitad de la más pequeña.
        const isStacked = w * h >= 0.5 * Math.min(a.width * a.height, b.width * b.height);
        (isStacked ? stacked : overlapping).add(i).add(j);
        if (!isStacked) depth = Math.max(depth, Math.min(w, h));
        if (!example || (isStacked && !example.stacked)) example = { pair: [i, j], stacked: isStacked };
      }
    }
    if (!example) return null;
    const [a, b] = example.pair.map((k) => variants[k].name);
    if (stacked.size) {
      const n = stacked.size;
      return [ctx.finding(node, page, this.meta, ctx.tx({ es: `${n} variantes apiladas sobre otras (p. ej. «${a}» y «${b}»)`, en: `${n} variants stacked on top of others (e.g. "${a}" and "${b}")` }))];
    }
    const n = overlapping.size;
    const px = round2(depth);
    const message = ctx.tx({ es: `${n} variantes se solapan con otras hasta ${px} px (p. ej. «${a}» y «${b}»)`, en: `${n} variants overlap others by up to ${px} px (e.g. "${a}" and "${b}")` });
    return [ctx.finding(node, page, this.meta, message, { severity: 'info' })];
  },
};

/** WCAG 2.2 AA (2.5.8): lo que tiene que medir cualquier objetivo, también uno de tamaño pequeño. */
const AA_TARGET = 24;

/** Lado más corto: WCAG pide el mínimo en los dos. */
const shortSide = (n: SceneNode) => Math.min(n.width, n.height);
const dims = (n: SceneNode) => `${round2(n.width)} × ${round2(n.height)} px`;

/** Tamaño mínimo en los controles. */
export const touchCheck: Check = {
  meta: {
    id: 'touch',
    category: 'components',
    title: { es: 'Objetivo táctil mínimo', en: 'Minimum touch target' },
    description: {
      es: 'Controles cuyo lado más corto no llega al mínimo: 24 px por defecto, el de WCAG 2.2 AA (44 es el de Apple y el AAA). Con un mínimo mayor, a los tamaños pequeños se les piden 24.',
      en: 'Controls whose shorter side is below the minimum: 24 px by default, the WCAG 2.2 AA one (44 is Apple’s and AAA’s). With a higher minimum, small sizes only need 24.',
    },
    severity: 'warning',
    fixable: false,
  },
  run(node, ctx, page) {
    const min = ctx.settings.touchMin;
    // Un mínimo de 44 es para los controles principales: los pequeños existen para no llegar a él.
    const minFor = (name: string) => (SMALL_SIZE.test(fold(name)) ? Math.min(min, AA_TARGET) : min);
    if (node.type === 'COMPONENT_SET') {
      if (!ctx.isInteractiveName(node.name) || isIcon(node)) return null;
      const variants = node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT');
      const short = variants.filter((v) => shortSide(v) + 0.01 < minFor(v.name));
      if (!short.length) return null;
      const smallest = short.reduce((a, b) => (shortSide(b) < shortSide(a) ? b : a));
      const limits = new Set(short.map((v) => minFor(v.name)));
      const [s, n] = [short.length, variants.length];
      const below: Text =
        limits.size === 1
          ? { es: `${[...limits][0]} px`, en: `${[...limits][0]} px` }
          : { es: `${min} px, o ${AA_TARGET} px en los tamaños pequeños`, en: `${min} px, or ${AA_TARGET} px for small sizes` };
      return [
        ctx.finding(node, page, this.meta, ctx.tx({
          es: `${s} de ${n} variantes por debajo de ${below.es} (la más pequeña, ${dims(smallest)})`,
          en: `${s} of ${n} variants below ${below.en} (smallest: ${dims(smallest)})`,
        })),
      ];
    }
    if (node.type !== 'COMPONENT' || ctx.parentOf(node)?.type === 'COMPONENT_SET') return null;
    if (!ctx.isInteractiveName(node.name) || isIcon(node)) return null;
    const limit = minFor(node.name);
    if (shortSide(node) + 0.01 >= limit) return null;
    return [ctx.finding(node, page, this.meta, ctx.tx({ es: `Mide ${dims(node)}, por debajo de ${limit} px`, en: `${dims(node)}, below ${limit} px` }))];
  },
};

/** ¿Hay, entre el nodo y `root`, una capa que cumpla `test`? */
export function nestedIn(node: BaseNode, root: BaseNode, test: (ancestor: BaseNode) => boolean, ctx?: AuditContext): boolean {
  const up = (n: BaseNode) => (ctx ? ctx.parentOf(n) : n.parent);
  for (let cur = up(node); cur && cur.id !== root.id; cur = up(cur)) if (test(cur)) return true;
  return false;
}

/** Propiedades expuestas (texto, instance swap, booleanos). */
export const propsCheck: Check = {
  meta: {
    id: 'props',
    category: 'components',
    title: { es: 'Propiedades expuestas', en: 'Exposed properties' },
    description: {
      es: 'Componentes con texto pero sin propiedad de texto, o con un icono intercambiable sin instance swap ni booleano. El contenido de los slots no cuenta.',
      en: 'Components with text but no text property, or with a swappable icon and no instance swap or boolean. Slot content doesn’t count.',
    },
    severity: 'info',
    fixable: false,
  },
  run(node, ctx, page) {
    const target = definable(node, ctx);
    if (!target) return null;
    const defs = definitions(target);
    if (!defs) return null;
    const types = new Set(Object.values(defs).map((d) => d.type));
    const out: Finding[] = [];
    // Las propiedades no llegan al interior de una instancia anidada ni al contenido de un slot.
    const own = (n: BaseNode) => !nestedIn(n, target, (a) => a.type === 'INSTANCE' || ctx.isSlot(a), ctx);

    const texts = target.findAllWithCriteria({ types: ['TEXT'] }).filter(own);
    if (texts.length && !types.has('TEXT')) {
      const n = texts.length;
      out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `Tiene ${n} texto(s) pero no expone ninguna propiedad de texto`, en: `Has ${n} text layer(s) but exposes no text property` })));
    }

    const icons = target
      .findAllWithCriteria({ types: ['INSTANCE'] })
      .filter((i) => {
        const name = fold(i.name);
        return ICON_LAYER.test(name) && !STRUCTURAL_GLYPH.test(name) && own(i);
      });
    if (icons.length && !types.has('INSTANCE_SWAP') && !types.has('BOOLEAN')) {
      out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: 'Icono anidado sin instance swap ni booleano de visibilidad', en: 'Nested icon without an instance swap or a visibility boolean' })));
    } else if (icons.length && !types.has('INSTANCE_SWAP')) {
      out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: 'Icono anidado sin propiedad de instance swap', en: 'Nested icon without an instance swap property' })));
    }
    return out.length ? out : null;
  },
};

/** Descripción rellenada y enlace de documentación. */
export const descriptionCheck: Check = {
  meta: {
    id: 'description',
    category: 'components',
    title: { es: 'Descripción y documentación', en: 'Description and documentation' },
    description: {
      es: 'Componentes sin una descripción útil (qué es, cuándo usarlo y cuándo no) y, si lo pides en ajustes, sin enlace de documentación. Los iconos no cuentan.',
      en: 'Components without a useful description (what it is, when to use it and when not) and, if you ask for it in settings, without a documentation link. Icons don’t count.',
    },
    severity: 'warning',
    fixable: false,
  },
  run(node, ctx, page) {
    const target = definable(node, ctx);
    if (!target || isIcon(target)) return null;
    const out: Finding[] = [];
    const desc = (target.description ?? '').trim();
    if (desc.length < ctx.settings.minDescriptionLength) {
      const n = desc.length;
      const message = desc
        ? ctx.tx({ es: `Descripción demasiado corta (${n} caracteres)`, en: `Description too short (${n} characters)` })
        : ctx.tx({ es: 'Sin descripción', en: 'No description' });
      out.push(ctx.finding(node, page, this.meta, message));
    }
    // Muchos equipos no usan los enlaces de documentación (Simple Design System, ninguno): se piden si se activa.
    if (ctx.settings.requireDocLinks && (!target.documentationLinks || target.documentationLinks.length === 0)) {
      out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: 'Sin enlace de documentación', en: 'No documentation link' }), { severity: 'info' }));
    }
    return out.length ? out : null;
  },
};

/** ¿Está fuera de todas las páginas? Así conserva Figma los componentes eliminados, y las variantes de un set eliminado. */
function offCanvas(node: BaseNode): boolean {
  for (let p = node.parent; p; p = p.parent) if (p.type === 'PAGE') return false;
  return true;
}

/** Nombre con el que se reconoce un componente: el del set y el de la variante, si es una. */
function componentLabel(component: BaseNode): string {
  return component.parent?.type === 'COMPONENT_SET' ? `${component.parent.name} (${component.name})` : component.name;
}

/** Los frames que eran instancias siguen vinculados a su componente. */
export const detachedCheck: Check = {
  meta: {
    id: 'detached',
    category: 'components',
    title: { es: 'Sin instancias desvinculadas', en: 'No detached instances' },
    description: {
      es: 'Frames que eran instancias y se desvincularon, así que ya no reciben los cambios del componente. Si el componente se eliminó, sale como información.',
      en: 'Frames that were instances and were detached, so they no longer get the component’s changes. If the component was deleted, it’s listed as info.',
    },
    severity: 'warning',
    fixable: false,
  },
  async run(node, ctx, page) {
    if (node.type !== 'FRAME') return null;
    let info: DetachedInfo | null;
    try {
      info = node.detachedInfo;
    } catch {
      return null;
    }
    if (!info) return null;
    let message: string;
    // De un componente que ya no está no hay cambios que perderse ni nada que volver a enlazar: se informa. En
    // Simple Design System eran 71 de 74.
    let severity: Severity | undefined;
    if (info.type === 'library') {
      message = ctx.tx({ es: 'Instancia desvinculada de un componente de biblioteca: ya no recibe sus cambios', en: 'Detached from a library component: it no longer gets its changes' });
    } else {
      const component = await ctx.nodeById(info.componentId);
      const name = component ? componentLabel(component) : '';
      if (!component) {
        message = ctx.tx({ es: 'Instancia desvinculada de un componente que ya no existe', en: 'Detached from a component that no longer exists' });
        severity = 'info';
      } else if (offCanvas(component)) {
        message = ctx.tx({ es: `Instancia desvinculada de «${name}», un componente eliminado`, en: `Detached from "${name}", a deleted component` });
        severity = 'info';
      } else message = ctx.tx({ es: `Instancia desvinculada de «${name}»: ya no recibe los cambios del componente`, en: `Detached from "${name}": it no longer gets the component’s changes` });
    }
    return [ctx.finding(node, page, this.meta, message, severity ? { severity } : {})];
  },
};
