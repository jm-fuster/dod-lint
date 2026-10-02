import type { Check } from './index';
import type { Finding, FixHint } from '../types';
import { OVERRIDE_NOTE, round2 } from '../context';
import type { AuditContext, FloatKind } from '../context';
import type { Text } from '../i18n';
import { ART_NAME, fold } from '../names';

type LayoutNode = FrameNode | ComponentNode | ComponentSetNode | InstanceNode;

function hasLayout(node: SceneNode): node is LayoutNode {
  return 'layoutMode' in node;
}

export const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'RECTANGLE', 'LINE', 'POLYGON', 'STAR']);

/** Todo contenedor con varios hijos usa auto layout. */
export const autoLayoutCheck: Check = {
  meta: {
    id: 'auto-layout',
    category: 'layout',
    title: { es: 'Auto layout en todos los niveles', en: 'Auto layout at every level' },
    description: {
      es: 'Frames y grupos con dos o más hijos sin auto layout. No cuentan los artboards de primer nivel (salvo que lo actives en ajustes), los iconos ni el arte vectorial.',
      en: 'Frames and groups with two or more children and no auto layout. Top-level artboards (unless you turn them on in settings), icons and vector art don’t count.',
    },
    severity: 'warning',
    fixable: false,
  },
  run(node, ctx, page) {
    if (ctx.isSlot(node)) return null;
    const s = ctx.settings;
    const parent = ctx.parentOf(node);
    const isTopLevel = parent?.type === 'PAGE' || parent?.type === 'SECTION';
    if (isTopLevel && !s.includeTopLevelFrames) return null;

    // Cuentan también los hijos ocultos que pueden aparecer (ver `revealable`).
    const shown = (c: SceneNode) => ctx.prop<boolean>(c, 'visible') || s.includeHidden || ctx.revealable(c);
    if (node.type === 'GROUP') {
      const kids = ctx.childrenOf(node).filter(shown);
      if (kids.length < 2) return null;
      if (kids.some((k) => 'isMask' in k && k.isMask)) return null;
      if (kids.every((k) => VECTORISH.has(k.type))) return null;
      const n = kids.length;
      return [ctx.finding(node, page, this.meta, ctx.tx({ es: `Grupo con ${n} hijos: conviértelo en frame con auto layout`, en: `Group with ${n} children: turn it into an auto layout frame` }))];
    }

    if (!hasLayout(node)) return null;
    if (node.type === 'INSTANCE' || node.type === 'COMPONENT_SET') return null;
    if (ctx.prop<string>(node, 'layoutMode') !== 'NONE') return null;
    const kids = ctx.childrenOf(node).filter(shown);
    if (kids.length < 2) return null;
    if (kids.some((k) => 'isMask' in k && k.isMask)) return null;
    // Iconos y arte vectorial: varios trazados en un frame pequeño no son un problema de layout.
    if (kids.every((k) => VECTORISH.has(k.type))) return null;
    if (ART_NAME.test(fold(ctx.prop<string>(node, 'name'))) && Math.max(node.width, node.height) <= 64) return null;
    const n = kids.length;
    return [ctx.finding(node, page, this.meta, ctx.tx({ es: `Frame con ${n} hijos sin auto layout`, en: `Frame with ${n} children and no auto layout` }))];
  },
};

const PADDING_FIELDS = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] as const;
/** Repartos en los que Figma calcula el hueco solo e ignora el gap. */
const AUTO_GAP = new Set(['SPACE_BETWEEN', 'SPACE_EVENLY', 'SPACE_AROUND']);
const RADIUS_FIELDS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] as const;
/** Todo lo que mira la regla, para saber si una capa de instancia sobrescribe algo de ello. */
const SPACING_FIELDS = [...PADDING_FIELDS, 'itemSpacing', 'counterAxisSpacing', 'gridRowGap', 'gridColumnGap', 'cornerRadius', ...RADIUS_FIELDS];

/** Campos de cada tipo, para saber si se usan esos tokens. */
const KIND_FIELDS: Record<FloatKind, readonly string[]> = {
  spacing: [...PADDING_FIELDS, 'itemSpacing', 'counterAxisSpacing', 'gridRowGap', 'gridColumnGap'],
  radius: ['cornerRadius', ...RADIUS_FIELDS],
};

/**
 * Apunta si la capa tiene enlazado algún campo de espaciado o de radio, a una variable local o de una biblioteca,
 * también uno que hereda de su componente: así se sabe que el equipo usa esos tokens aunque el archivo no tenga.
 */
function noteTokenUse(node: SceneNode, ctx: AuditContext): void {
  if (!('paddingLeft' in node) && !('topLeftRadius' in node)) return;
  const bound = ctx.prop<Record<string, unknown> | undefined>(node, 'boundVariables') ?? {};
  for (const kind of ['spacing', 'radius'] as const) {
    if (!ctx.tokenUse[kind] && KIND_FIELDS[kind].some((f) => bound[f])) ctx.tokenUse[kind] = true;
  }
}

const PADDING: Text = { es: 'Padding', en: 'Padding' };
const GAP: Text = { es: 'Gap', en: 'Gap' };
const ROW_GAP: Text = { es: 'Gap entre filas', en: 'Row gap' };
const COLUMN_GAP: Text = { es: 'Gap entre columnas', en: 'Column gap' };
const RADIUS: Text = { es: 'Radio', en: 'Radius' };

/** Padding, gap y radio enlazados a variables de la escala. */
export const spacingCheck: Check = {
  meta: {
    id: 'spacing',
    category: 'layout',
    title: { es: 'Padding, gap y radio con token', en: 'Padding, gap and radius use tokens' },
    description: {
      es: 'Padding, gap y radio escritos a mano, y valores fuera de tu escala, con el paso más cercano. En las instancias, solo lo que sobrescriben. Si no se usan variables de ese tipo, una nota los cuenta en vez de avisar uno a uno.',
      en: 'Padding, gap and radius typed by hand, and values off your scale, with the nearest step. On instances, only what they override. If no variables of that kind are in use, a note counts them instead of flagging each one.',
    },
    severity: 'warning',
    fixable: true,
  },
  overrides: SPACING_FIELDS,
  run(node, ctx, page) {
    if (!ctx.tokenUse.spacing || !ctx.tokenUse.radius) noteTokenUse(node, ctx);
    if (node.type === 'SECTION' || node.type === 'COMPONENT_SET') return null;
    // En un archivo de biblioteca, lo de fuera de los componentes es documentación, bocetos y pantallas de ejemplo:
    // en FlySplit, unos 1.950 de 1.960 avisos (01-10-2026). Un enlace a un token cuenta igual, arriba.
    if (ctx.settings.spacingComponentsOnly && node.type !== 'COMPONENT' && !ctx.insideComponent(node)) return null;
    // Una instancia, o una capa suya, hereda del componente: solo importa lo que sobrescribe.
    const own = ctx.overridesOf(node);
    if (own && !SPACING_FIELDS.some((f) => own.has(f))) return null;
    // Solo hay algo que mirar en un auto layout o en una capa con esquinas redondeadas: del resto no se lee nada.
    const layout = hasLayout(node) && ctx.prop<string>(node, 'layoutMode') !== 'NONE' ? node : null;
    const cornered = 'topLeftRadius' in node ? node : null;
    const radius = cornered ? ctx.prop<number | symbol>(cornered, 'cornerRadius') : 0;
    if (!layout && radius === 0) return null;
    const out: Finding[] = [];
    const bound = ctx.prop<Record<string, unknown> | undefined>(node, 'boundVariables') ?? {};
    const suffix = own ? ctx.tx(OVERRIDE_NOTE) : '';

    // Un radio de la mitad del lado corto o más ya hace una píldora: cualquier valor que también llegue se ve igual.
    let halfSide: number | undefined;
    const half = () => (halfSide ??= 'width' in node ? Math.min(node.width, node.height) / 2 : Infinity);

    /** Avisa de un campo, o de varios con el mismo valor (los lados de un padding), en un solo hallazgo. */
    const report = (fields: string | string[], labelText: Text, value: number, kind: FloatKind) => {
      const list = typeof fields === 'string' ? [fields] : fields;
      const field = list[0];
      if (value === 0 || bound[field]) return;
      // La corrección enlaza todos los campos del aviso.
      const bindTo = (variableId: string, snapTo?: number): FixHint => ({
        kind: 'bind-float',
        field,
        ...(list.length > 1 ? { fields: list } : {}),
        variableId,
        from: value,
        ...(snapTo === undefined ? {} : { snapTo }),
      });
      if (own && !own.has(field) && !(kind === 'radius' && (own.has('cornerRadius') || RADIUS_FIELDS.some((f) => own!.has(f))))) return;
      const pill = kind === 'radius' && value >= half();
      // Si es una píldora, los pasos que también lo son valen lo mismo: no está fuera de escala, solo escrito a mano.
      const pillSteps = pill ? [...ctx.scaleFor('radius')].filter((s) => s >= half()) : [];
      const offScale = !ctx.inScale(value, kind) && !pillSteps.length;
      const { preferred, others } = ctx.floatVarsForField(value, node, kind);
      const label = ctx.tx(labelText);
      const v = round2(value);
      let fix: FixHint | undefined;
      let message: string;
      if (preferred.length === 1) {
        fix = bindTo(preferred[0].id);
        const name = ctx.varName(preferred[0]);
        message = ctx.tx({ es: `${label} ${v} sin token (existe ${name})`, en: `${label} ${v} is hard-coded (matches ${name})` });
      } else if (preferred.length > 1) {
        const n = preferred.length;
        const names = preferred.map((p) => ctx.varName(p)).join(', ');
        message = ctx.tx({ es: `${label} ${v} sin token (${n} variables valen lo mismo: ${names})`, en: `${label} ${v} is hard-coded (${n} variables have this value: ${names})` });
      } else if (pillSteps.length) {
        // Se enlaza el paso mayor (el «full»), que sigue siendo píldora aunque el componente crezca.
        const full = Math.max(...pillSteps);
        const fullVars = ctx.floatVarsForField(full, node, 'radius').preferred;
        if (fullVars.length === 1) {
          fix = bindTo(fullVars[0].id, full);
          const name = ctx.varName(fullVars[0]);
          message = ctx.tx({ es: `${label} ${v} sin token: ya es una píldora (existe ${name})`, en: `${label} ${v} is hard-coded: it’s already a pill (matches ${name})` });
        } else {
          message = ctx.tx({ es: `${label} ${v} sin token: ya es una píldora`, en: `${label} ${v} is hard-coded: it’s already a pill` });
        }
      } else if (others.length && !offScale) {
        const name = ctx.varName(others[0]);
        message = ctx.tx({
          es: `${label} ${v} sin token (${name} vale lo mismo pero no es de ${kind === 'radius' ? 'radio' : 'espaciado'})`,
          en: `${label} ${v} is hard-coded (${name} has this value but isn’t a ${kind === 'radius' ? 'radius' : 'spacing'} variable)`,
        });
      } else if (offScale) {
        // El paso más cercano se dice siempre; ajustarlo cambia la medida, y solo se corrige si se ha activado.
        const near = ctx.nearestScale(value, kind);
        const nearVars = near !== null ? ctx.floatVarsForField(near, node, kind).preferred : [];
        if (pill && near !== null) {
          // Ningún paso llega a la mitad: bajar al más cercano le cambiaría la forma, así que no se propone.
          message = ctx.tx({
            es: `${label} ${v} fuera de escala (el paso más cercano, ${near}, dejaría de ser una píldora)`,
            en: `${label} ${v} is off the scale (the nearest step, ${near}, would no longer be a pill)`,
          });
        } else if (kind === 'radius' && near !== null && near >= half()) {
          // Lo contrario: en una capa diminuta, el paso más cercano ya llega a la mitad y la convertiría en píldora
          // (la batería de un sistema de pruebas: 8 px de alto, radio 1 y paso mínimo 4).
          message = ctx.tx({
            es: `${label} ${v} fuera de escala (el paso más cercano, ${near}, la convertiría en una píldora)`,
            en: `${label} ${v} is off the scale (the nearest step, ${near}, would turn it into a pill)`,
          });
        } else if (near !== null && nearVars.length === 1) {
          if (ctx.settings.snapToScale) fix = bindTo(nearVars[0].id, near);
          const name = ctx.varName(nearVars[0]);
          message = ctx.tx({ es: `${label} ${v} fuera de escala (paso más cercano: ${near}, ${name})`, en: `${label} ${v} is off the scale (nearest step: ${near}, ${name})` });
        } else if (near !== null) {
          message = ctx.tx({ es: `${label} ${v} fuera de escala (paso más cercano: ${near})`, en: `${label} ${v} is off the scale (nearest step: ${near})` });
        } else {
          message = ctx.tx({ es: `${label} ${v} fuera de escala`, en: `${label} ${v} is off the scale` });
        }
      } else {
        message = ctx.tx({ es: `${label} ${v} sin token`, en: `${label} ${v} is hard-coded` });
      }
      const finding = ctx.finding(node, page, this.meta, message + suffix, { severity: offScale ? 'error' : 'warning', fix });
      // Sin variables de este tipo en el archivo no hay ningún token al que enlazarlo: la auditoría decide al final
      // si se avisa capa a capa (ver `AuditContext.unscaled`).
      if (!ctx.scaleFor(kind).size) ctx.unscaled.set(finding, kind);
      out.push(finding);
    };

    if (layout) {
      // Los lados con el mismo valor y sin variable van en un solo aviso que los enlaza todos: con los cuatro iguales
      // salían cuatro avisos idénticos, que inflaban los recuentos y el informe.
      const sides = new Map<number, string[]>();
      for (const f of PADDING_FIELDS) {
        const value = layout[f];
        if (value === 0 || bound[f] || (own && !own.has(f))) continue;
        sides.set(round2(value), [...(sides.get(round2(value)) ?? []), f]);
      }
      for (const fields of sides.values()) report(fields, PADDING, layout[fields[0] as (typeof PADDING_FIELDS)[number]], 'spacing');
      if (ctx.prop<string>(layout, 'layoutMode') === 'GRID') {
        const grid = layout as LayoutNode & { gridRowGap?: number; gridColumnGap?: number };
        if (typeof grid.gridRowGap === 'number') report('gridRowGap', ROW_GAP, grid.gridRowGap, 'spacing');
        if (typeof grid.gridColumnGap === 'number') report('gridColumnGap', COLUMN_GAP, grid.gridColumnGap, 'spacing');
      } else {
        if (!AUTO_GAP.has(layout.primaryAxisAlignItems)) report('itemSpacing', GAP, layout.itemSpacing, 'spacing');
        if (layout.layoutWrap === 'WRAP') {
          const alignContent = (layout as LayoutNode & { counterAxisAlignContent?: string }).counterAxisAlignContent;
          if (alignContent !== 'SPACE_BETWEEN' && typeof layout.counterAxisSpacing === 'number') report('counterAxisSpacing', ROW_GAP, layout.counterAxisSpacing, 'spacing');
        }
      }
    }

    if (cornered && radius !== 0) {
      // Con las cuatro esquinas iguales, Figma da su valor en cornerRadius y no hace falta leerlas.
      const corners = RADIUS_FIELDS.map((f) => (typeof radius === 'number' ? radius : cornered[f]));
      const values = corners.filter((v): v is number => typeof v === 'number');
      const boundCount = RADIUS_FIELDS.filter((f) => bound[f]).length + (bound['cornerRadius'] ? 1 : 0);
      const uniform = values.length === 4 && values.every((v) => v === values[0]);
      if (uniform && boundCount === 0) {
        // Una única pista que enlaza las cuatro esquinas a la vez.
        report('cornerRadius', RADIUS, values[0], 'radius');
      } else {
        const seen = new Set<string>();
        for (const [i, f] of RADIUS_FIELDS.entries()) {
          const v = corners[i];
          if (typeof v !== 'number') continue;
          const key = `${bound[f] ? 'b' : 'u'}:${round2(v)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          report(f, RADIUS, v, 'radius');
        }
      }
    }
    return out.length ? out : null;
  },
};
