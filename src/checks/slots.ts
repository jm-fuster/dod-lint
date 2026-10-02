import type { Check } from './index';
import type { CheckMeta, Finding } from '../types';
import type { AuditContext, PropertyDefinition } from '../context';
import { propertyName, slotKeyOf } from '../context';
import { definable, definitions, nestedIn } from './components';
import type { Definable } from './components';

type Violation = SlotNode['limitViolations'][number];

/** Límites incumplidos según Figma, o null si el objeto no los expone (uno que se ha quedado con el tipo FRAME). */
function nativeViolations(slot: SlotNode): Violation[] | null {
  try {
    const v = slot.limitViolations;
    return Array.isArray(v) ? [...v] : null;
  } catch {
    return null;
  }
}

function limitsOf(def: PropertyDefinition | null): { min: number | null; max: number | null } {
  const s = def?.slotSettings;
  return {
    min: typeof s?.minChildren === 'number' ? s.minChildren : null,
    max: typeof s?.maxChildren === 'number' ? s.maxChildren : null,
  };
}

const count = (n: number, ctx: AuditContext) => ctx.tx({ es: `${n} ${n === 1 ? 'elemento' : 'elementos'}`, en: `${n} ${n === 1 ? 'item' : 'items'}` });

function quoteList(names: string[], ctx: AuditContext): string {
  const shown = names.slice(0, 3).map((n) => `"${n}"`).join(', ');
  const rest = names.length - 3;
  return rest > 0 ? shown + ctx.tx({ es: ` y ${rest} más`, en: ` and ${rest} more` }) : shown;
}

/** Hijos de un slot que no son instancias de un componente preferido. */
async function nonPreferred(slot: SlotNode, def: PropertyDefinition | null, ctx: AuditContext): Promise<string[]> {
  const keys = new Set((def?.preferredValues ?? []).map((p) => p.key));
  if (!keys.size) return [];
  const out: string[] = [];
  for (const kid of slot.children) {
    if (kid.type === 'INSTANCE') {
      const main = await ctx.mainComponent(kid);
      const setKey = main?.parent?.type === 'COMPONENT_SET' ? main.parent.key : null;
      if (main && (keys.has(main.key) || (setKey !== null && keys.has(setKey)))) continue;
    }
    out.push(kid.name);
  }
  return out;
}

/**
 * Límites que incumple el contenido de un slot, contados aquí. Figma solo los calcula en las
 * instancias (`limitViolations`; en el componente devuelve siempre [], medido en septiembre de 2026).
 */
async function countViolations(slot: SlotNode, def: PropertyDefinition | null, ctx: AuditContext): Promise<{ kinds: Violation[]; offenders: string[] }> {
  const n = slot.children.length;
  const { min, max } = limitsOf(def);
  const kinds: Violation[] = [];
  if (min !== null && n < min) kinds.push('BELOW_MIN');
  if (max !== null && n > max) kinds.push('ABOVE_MAX');
  let offenders: string[] = [];
  if (def?.slotSettings?.allowPreferredValuesOnly) {
    offenders = await nonPreferred(slot, def, ctx);
    if (offenders.length) kinds.push('HAS_NON_PREFERRED');
  }
  return { kinds, offenders };
}

/** Límites que incumple el contenido por defecto. Vacío con mínimo es el patrón de slot obligatorio y no cuenta. */
async function defaultContentIssues(slot: SlotNode, def: PropertyDefinition, ctx: AuditContext): Promise<string[]> {
  const n = slot.children.length;
  const { min, max } = limitsOf(def);
  const { kinds, offenders } = await countViolations(slot, def, ctx);
  return kinds
    .filter((k) => k !== 'BELOW_MIN' || n > 0)
    .map((k) => {
      if (k === 'BELOW_MIN') return ctx.tx({ es: `${count(n, ctx)} de un mínimo de ${min}`, en: `${count(n, ctx)}, minimum ${min}` });
      if (k === 'ABOVE_MAX') return ctx.tx({ es: `${count(n, ctx)} de un máximo de ${max}`, en: `${count(n, ctx)}, maximum ${max}` });
      const list = quoteList(offenders, ctx);
      return ctx.tx({ es: `${list} fuera de las instancias preferidas`, en: `${list} outside the preferred instances` });
    });
}

/** Definición: una vez por propiedad SLOT, sobre el set o el componente suelto. */
async function definitionFindings(target: Definable, ctx: AuditContext, page: PageNode, meta: CheckMeta): Promise<Finding[]> {
  const defs = definitions(target);
  if (!defs) return [];
  const keys = Object.keys(defs).filter((k) => defs[k].type === 'SLOT');
  // Los slots de las instancias anidadas pertenecen a otro componente.
  const layers = ctx.slotsUnder(target).filter((s) => !nestedIn(s, target, (a) => a.type === 'INSTANCE', ctx));
  if (!keys.length && !layers.length) return [];
  const out: Finding[] = [];
  const variants = target.type === 'COMPONENT_SET' ? target.children.length : 1;
  const where = (n: number) => (variants > 1 ? ctx.tx({ es: ` (en ${n} de ${variants} variantes)`, en: ` (in ${n} of ${variants} variants)` }) : '');

  const byKey = new Map<string, SlotNode[]>();
  for (const layer of layers) {
    const key = slotKeyOf(layer);
    if (!key || !defs[key]) {
      const message = key
        ? ctx.tx({ es: `Slot enlazado a una propiedad que ya no existe (${propertyName(key)})`, en: `Slot bound to a property that no longer exists (${propertyName(key)})` })
        : ctx.tx({ es: 'Capa de slot sin propiedad enlazada', en: 'Slot layer without a bound property' });
      out.push(ctx.finding(layer, page, meta, message, { severity: 'error' }));
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(layer);
    byKey.set(key, list);
  }

  for (const key of keys) {
    const def = defs[key];
    const name = propertyName(key);
    const own = byKey.get(key) ?? [];

    if (!own.length) {
      // Sin capa lo que toca es borrarla; pedirle descripción o límites sería ruido.
      const message = ctx.tx({
        es: `Propiedad de slot "${name}" sin capa: no hace nada${variants > 1 ? ' en ninguna variante' : ''}`,
        en: `Slot property "${name}" has no layer: it does nothing${variants > 1 ? ' in any variant' : ''}`,
      });
      out.push(ctx.finding(target, page, meta, message));
      continue;
    }
    if (def.slotSettings?.allowPreferredValuesOnly && !(def.preferredValues ?? []).length) {
      const message = ctx.tx({
        es: `Slot "${name}" solo admite instancias preferidas, pero la lista está vacía`,
        en: `Slot "${name}" only allows preferred instances, but the list is empty`,
      });
      out.push(ctx.finding(target, page, meta, message));
    }
    const loose = own.filter((l) => l.layoutMode === 'NONE');
    if (loose.length) {
      const message = ctx.tx({
        es: `Slot "${name}" sin auto layout: lo que se inserte no se ordena solo${where(loose.length)}`,
        en: `Slot "${name}" has no auto layout: inserted content won’t arrange itself${where(loose.length)}`,
      });
      out.push(ctx.finding(loose[0], page, meta, message));
    }
    let failing = 0;
    let first: { layer: SlotNode; issues: string[] } | null = null;
    for (const layer of own) {
      const issues = await defaultContentIssues(layer, def, ctx);
      if (!issues.length) continue;
      failing++;
      if (!first) first = { layer, issues };
    }
    if (first) {
      const issues = first.issues.join('; ');
      const message = ctx.tx({
        es: `El contenido por defecto de "${name}" incumple sus límites: ${issues}${where(failing)}`,
        en: `The default content of "${name}" breaks its limits: ${issues}${where(failing)}`,
      });
      out.push(ctx.finding(first.layer, page, meta, message));
    }
    if (!(def.description ?? '').trim()) {
      const message = ctx.tx({
        es: `Slot "${name}" sin descripción: explica qué contenido admite`,
        en: `Slot "${name}" has no description: explain what content it takes`,
      });
      out.push(ctx.finding(target, page, meta, message, { severity: 'info' }));
    }
  }
  return out;
}

/** Uso: un slot de instancia rellenado fuera de los límites que pide su componente. */
async function usageFindings(slot: SlotNode, ctx: AuditContext, page: PageNode, meta: CheckMeta): Promise<Finding[]> {
  const host = await ctx.slotHost(slot);
  // Los slots de un componente principal se revisan una sola vez en su set, junto a la propiedad.
  if (host?.type !== 'INSTANCE') return [];
  const n = slot.children.length;
  // Heredado y con contenido: es el contenido por defecto, y ese aviso ya sale en el componente.
  if (n > 0 && !ctx.slotContent(slot).owned.length) return [];
  // Un slot suelto (ver `slotHost`) devuelve `limitViolations` vacío aunque incumpla: se cuenta aquí.
  const detached = !slot.parent;
  const native = detached ? null : nativeViolations(slot);
  if (native && !native.length) return [];
  const { key, def } = await ctx.slotDefinition(slot);
  const counted = native ? null : await countViolations(slot, def, ctx);
  const violations = native ?? counted?.kinds ?? [];
  const name = key ? propertyName(key) : slot.name;
  const { min, max } = limitsOf(def);
  const items = count(n, ctx);
  const out: Finding[] = [];
  for (const v of violations) {
    let message: string;
    if (v === 'BELOW_MIN' && n === 0) {
      message = ctx.tx({
        es: `Slot "${name}" vacío${min !== null ? `: pide al menos ${count(min, ctx)}` : ' y tiene un mínimo de elementos'}`,
        en: `Slot "${name}" is empty${min !== null ? `: it needs at least ${count(min, ctx)}` : ' and has a minimum item count'}`,
      });
    } else if (v === 'BELOW_MIN') {
      message = ctx.tx({
        es: `Slot "${name}" con ${items}${min !== null ? `: pide al menos ${min}` : ', por debajo del mínimo'}`,
        en: `Slot "${name}" has ${items}${min !== null ? `: it needs at least ${min}` : ', below the minimum'}`,
      });
    } else if (v === 'ABOVE_MAX') {
      message = ctx.tx({
        es: `Slot "${name}" con ${items}${max !== null ? `: admite como máximo ${max}` : ', por encima del máximo'}`,
        en: `Slot "${name}" has ${items}${max !== null ? `: it takes at most ${max}` : ', above the maximum'}`,
      });
    } else {
      const names = counted?.offenders ?? (await nonPreferred(slot, def, ctx));
      const list = names.length ? `: ${quoteList(names, ctx)}` : '';
      message = ctx.tx({
        es: `Slot "${name}" con contenido fuera de sus instancias preferidas${list}`,
        en: `Slot "${name}" has content outside its preferred instances${list}`,
      });
    }
    out.push(ctx.finding(slot, page, meta, message));
  }
  return out;
}

/** Los slots son parte de la API del componente; se definen con límites claros y se rellenan dentro de ellos. */
export const slotsCheck: Check = {
  meta: {
    id: 'slots',
    category: 'slots',
    title: { es: 'Slots definidos y respetados', en: 'Slots defined and respected' },
    description: {
      es: 'En los componentes: propiedades de slot sin capa, slots sin auto layout o sin descripción, contenido por defecto que incumple sus límites y "solo instancias preferidas" con la lista vacía. En las instancias: slots que incumplen sus límites o con contenido no preferido.',
      en: 'In components: slot properties with no layer, slots without auto layout or a description, default content that breaks its limits, and "preferred instances only" with an empty list. In instances: slots that break their limits or hold non-preferred content.',
    },
    severity: 'warning',
    fixable: false,
  },
  instanceSlots: true,
  async run(node, ctx, page) {
    if (ctx.isSlot(node)) {
      const out = await usageFindings(node, ctx, page, this.meta);
      return out.length ? out : null;
    }
    const target = definable(node, ctx);
    if (!target) return null;
    const out = await definitionFindings(target, ctx, page, this.meta);
    return out.length ? out : null;
  },
};
