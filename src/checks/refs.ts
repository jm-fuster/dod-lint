import type { Check } from './index';
import type { CheckMeta, Finding, FixHint } from '../types';
import type { AuditContext } from '../context';
import { OVERRIDE_NOTE } from '../context';
import { paintsOf } from './color';

const STYLE_FIELDS = ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId', 'gridStyleId'] as const;
/** Las pinturas de las que es cada estilo de pintura. */
const PAINTS_OF: Partial<Record<(typeof STYLE_FIELDS)[number], 'fills' | 'strokes'>> = { fillStyleId: 'fills', strokeStyleId: 'strokes' };
const isEmpty = (paints: unknown) => Array.isArray(paints) && paints.length === 0;

/** Campos de boundVariables cuyo desenlace no es seguro de forma genérica. */
const NO_UNBIND = new Set(['componentProperties', 'textRangeFills', 'effects', 'layoutGrids', 'fills', 'strokes']);

/**
 * Modos explícitos de una colección que ya no existe. Figma los conserva al borrar la colección (medido en
 * septiembre de 2026: una colección borrada, sin variables, seguía puesta en una página y Figma la devolvía
 * por id). No cambian nada de lo que se ve, pero siguen en el panel de la capa; se quitan si Figma aún
 * devuelve la colección.
 */
async function orphanModes(target: SceneNode | PageNode, ctx: AuditContext, page: PageNode, meta: CheckMeta): Promise<Finding[]> {
  let modes: Record<string, string>;
  try {
    modes = ctx.prop<Record<string, string>>(target, 'explicitVariableModes');
  } catch {
    return [];
  }
  const out: Finding[] = [];
  for (const [collectionId, modeId] of Object.entries(modes ?? {})) {
    if (ctx.isLocalCollection(collectionId)) continue;
    const c = await ctx.getCollection(collectionId);
    if (c?.remote) continue; // de una biblioteca disponible
    if (!c) {
      const message = ctx.tx({ es: 'Modo de una colección que ya no está disponible', en: 'Mode of a collection that is no longer available' });
      out.push(ctx.finding(target, page, meta, message, { severity: 'warning' }));
      continue;
    }
    const mode = c.modes.find((m) => m.modeId === modeId)?.name;
    const message = mode
      ? ctx.tx({ es: `Modo «${mode}» de «${c.name}», una colección que ya no existe`, en: `Mode "${mode}" of "${c.name}", a collection that no longer exists` })
      : ctx.tx({ es: `Modo de «${c.name}», una colección que ya no existe`, en: `Mode of "${c.name}", a collection that no longer exists` });
    out.push(ctx.finding(target, page, meta, message, { severity: 'warning', fix: { kind: 'clear-mode', collectionId, modeId } }));
  }
  return out;
}

/** Transversal: cero referencias rotas a variables, estilos o componentes principales. */
export const brokenCheck: Check = {
  meta: {
    id: 'broken',
    category: 'references',
    title: { es: 'Referencias rotas', en: 'Broken references' },
    description: {
      es: 'Variables, estilos y componentes principales que ya no existen o no se pueden resolver, y modos de colecciones borradas puestos en capas o páginas. En las instancias de un componente del archivo, solo lo que sobrescriben.',
      en: 'Variables, styles and main components that no longer exist or can’t be resolved, and modes from deleted collections set on layers or pages. On instances of a component in this file, only what they override.',
    },
    severity: 'error',
    fixable: true,
  },
  async runPage(page, ctx) {
    const out = await orphanModes(page, ctx, page, this.meta);
    return out.length ? out : null;
  },
  overrides: ['boundVariables', 'explicitVariableModes', 'fills', 'strokes', ...STYLE_FIELDS],
  async run(node, ctx, page) {
    // En una capa de dentro de una instancia solo cuenta lo que esta le sobrescribe. En la raíz de una instancia de
    // un componente de este archivo, también: lo que hereda se revisa en el componente. Leerlo todo en cada
    // instancia eran unas ocho lecturas por raíz, la mitad de lo que tardaba esta regla (5.566 instancias en la
    // página Buttons de Material 3, octubre de 2026). Si el componente viene de una biblioteca o se ha eliminado,
    // lo que hereda roto solo se ve en la instancia, y se revisa entera.
    const inner = ctx.layerOverrides(node);
    const root = !inner && node.type === 'INSTANCE';
    const main = root ? await ctx.mainComponent(node) : null;
    // De cada componente se lee una vez si es de biblioteca y de qué cuelga: en Buttons de Material 3, 5.566
    // instancias comparten unos pocos, y leerlo en cada una era 1,5 s.
    const remote = !!main && ctx.prop<boolean>(main, 'remote');
    const own = inner ?? (main && !remote && ctx.onCanvas(main) ? (ctx.overridesOf(node) ?? new Set<string>()) : null);
    const counts = (field: string) => !own || own.has(field);
    // Los modos, como lo demás. Figma marca como sobrescrito el modo puesto en una instancia: los 16 que cambiaban
    // el de su componente en FlySplit y Simple Design System (octubre de 2026). Los 47 que lo heredaban, no, y el
    // heredado se revisa en el componente.
    const out: Finding[] = counts('explicitVariableModes') ? await orphanModes(node, ctx, page, this.meta) : [];
    if (inner) for (const f of out) f.message += ctx.tx(OVERRIDE_NOTE);
    const fields: Finding[] = [];

    // Variables enlazadas en campos simples y en propiedades de componente. Si solo cuenta lo sobrescrito y no se
    // sobrescribe nada, no hay variable que mirar.
    const bound = !own || own.size ? ctx.prop<Record<string, unknown> | undefined>(node, 'boundVariables') : undefined;
    if (bound) {
      for (const [field, value] of Object.entries(bound)) {
        // Rellenos y trazos se inspeccionan por pintura, porque boundVariables.fills no va alineado con fills[].
        if (field === 'fills' || field === 'strokes') continue;
        if (!counts(field) && !counts('boundVariables')) continue;
        const aliases: VariableAlias[] = [];
        if (Array.isArray(value)) {
          for (const a of value) if (a && typeof a === 'object' && 'id' in a) aliases.push(a as VariableAlias);
        } else if (value && typeof value === 'object' && 'id' in (value as object)) {
          aliases.push(value as VariableAlias);
        } else if (value && typeof value === 'object') {
          for (const a of Object.values(value as Record<string, unknown>)) if (a && typeof a === 'object' && 'id' in (a as object)) aliases.push(a as VariableAlias);
        }
        for (const alias of aliases) {
          const v = await ctx.getVariable(alias.id);
          if (v) continue;
          const fix: FixHint | undefined = NO_UNBIND.has(field) || Array.isArray(value) ? undefined : { kind: 'unbind', field, variableId: alias.id };
          fields.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `Variable no disponible en ${field}`, en: `Unavailable variable in ${field}` }), { fix }));
        }
      }
    }

    // Pinturas: el alias vive en cada pintura, con su índice real.
    for (const target of ['fills', 'strokes'] as const) {
      const paints = counts(target) ? paintsOf(node, target, ctx) : null;
      if (!paints) continue;
      for (let index = 0; index < paints.length; index++) {
        const p = paints[index];
        if (p.type === 'SOLID') {
          const alias = p.boundVariables?.color;
          if (!alias) continue;
          const v = await ctx.getVariable(alias.id);
          if (!v) {
            const message = ctx.tx({ es: `Variable no disponible en ${target}[${index}]`, en: `Unavailable variable in ${target}[${index}]` });
            fields.push(ctx.finding(node, page, this.meta, message, { fix: { kind: 'unbind-paint', target, index, variableId: alias.id } }));
          }
        } else if (p.type.startsWith('GRADIENT')) {
          const stops = (p as GradientPaint).gradientStops;
          for (let s = 0; s < stops.length; s++) {
            const alias = stops[s].boundVariables?.color;
            if (!alias) continue;
            const v = await ctx.getVariable(alias.id);
            if (v) continue;
            const where = `${target}[${index}]`;
            fields.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `Variable no disponible en la parada ${s + 1} del degradado (${where})`, en: `Unavailable variable in gradient stop ${s + 1} (${where})` })));
          }
        }
      }
    }
    if (node.type === 'TEXT' && counts('fills') && ctx.prop(node, 'fills') === figma.mixed) {
      const seen = new Set<string>();
      for (const seg of node.getStyledTextSegments(['fills'])) {
        for (const p of seg.fills) {
          const alias = p.type === 'SOLID' ? p.boundVariables?.color : undefined;
          if (!alias || seen.has(alias.id)) continue;
          seen.add(alias.id);
          if (await ctx.getVariable(alias.id)) continue;
          fields.push(ctx.finding(node, page, this.meta, ctx.tx({ es: 'Variable no disponible en un segmento de texto', en: 'Unavailable variable in a text segment' })));
        }
      }
    }

    // Estilos.
    for (const field of STYLE_FIELDS) {
      if (!(field in node) || !counts(field)) continue;
      // Sin rellenos no hay estilo de relleno que mirar, ni de trazo sin trazos: la mayoría de las capas no tienen
      // trazos, y era una lectura más por capa. Un estilo de pintura vacío no se aplica en la práctica.
      const paints = PAINTS_OF[field];
      if (paints && isEmpty(ctx.prop(node, paints))) continue;
      const id = ctx.prop<string | symbol>(node, field);
      if (typeof id === 'string') {
        if (!id) continue;
        const s = await ctx.getStyle(id);
        if (!s) fields.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `Estilo no disponible en ${field}`, en: `Unavailable style in ${field}` }), { fix: { kind: 'clear-style', field, styleId: id } }));
      } else if (node.type === 'TEXT' && (field === 'textStyleId' || field === 'fillStyleId')) {
        const segments = node.getStyledTextSegments([field]);
        const ids = new Set(segments.map((s) => s[field]).filter((x): x is string => typeof x === 'string' && !!x));
        for (const sid of ids) {
          const s = await ctx.getStyle(sid);
          if (!s) fields.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `Estilo no disponible en un segmento (${field})`, en: `Unavailable style in a segment (${field})` })));
        }
      }
    }
    if (own) for (const f of fields) f.message += ctx.tx(OVERRIDE_NOTE);
    out.push(...fields);

    // Componente principal: Figma conserva los eliminados (parent === null) y los devuelve igualmente.
    if (root) {
      if (!main) {
        out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: 'Instancia sin componente principal disponible', en: 'Instance without an available main component' })));
      } else if (!remote && ctx.parentOf(main) === null) {
        const message = ctx.tx({ es: 'Componente principal eliminado (restaurable desde la instancia)', en: 'Main component deleted (it can be restored from the instance)' });
        out.push(ctx.finding(node, page, this.meta, message));
      }
    }
    return out.length ? out : null;
  },
};
