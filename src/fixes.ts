import type { FixHint } from './types';
import type { AuditContext } from './context';
import { colorEq } from './context';
import { styleIdOf } from './checks/color';

type PaintTarget = 'fills' | 'strokes';

const RADIUS_FIELDS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];

function getPaints(node: SceneNode, target: PaintTarget): readonly Paint[] | null {
  if (!(target in node)) return null;
  const value = (node as unknown as Record<PaintTarget, readonly Paint[] | symbol>)[target];
  return typeof value === 'symbol' ? null : value;
}

function setPaints(node: SceneNode, target: PaintTarget, paints: Paint[]): void {
  (node as unknown as Record<PaintTarget, Paint[]>)[target] = paints;
}

const sameNumber = (value: unknown, expected: number) => typeof value === 'number' && Math.abs(value - expected) < 0.01;

/** ¿Tiene ya el campo una variable? El radio uniforme cuenta como enlazado si lo está cualquier esquina. */
function isBound(node: SceneNode, field: string): boolean {
  const bound = (node.boundVariables ?? {}) as Record<string, unknown>;
  if (field === 'cornerRadius') return !!bound.cornerRadius || RADIUS_FIELDS.some((f) => bound[f]);
  return !!bound[field];
}

const aliasId = (value: unknown) => (value as VariableAlias | undefined)?.id;

/**
 * ¿Sigue puesta la corrección tal como la dejó applyFix? true si del todo, false si nada, null a medias
 * (unas esquinas del radio sí y otras no). Deshacer la mira antes y después del deshacer de Figma.
 */
export function fixApplied(node: SceneNode | PageNode, fix: FixHint): boolean | null {
  if (fix.kind === 'clear-mode') return node.explicitVariableModes[fix.collectionId] !== fix.modeId;
  if (node.type === 'PAGE') return false;
  const bound = (node.boundVariables ?? {}) as Record<string, unknown>;
  const paint = (target: PaintTarget, index: number) => {
    const p = getPaints(node, target)?.[index];
    return p?.type === 'SOLID' ? p.boundVariables?.color?.id : undefined;
  };
  switch (fix.kind) {
    case 'bind-float': {
      // El radio uniforme se enlaza en las cuatro esquinas, y los lados iguales de un padding, todos a la vez.
      const fields = fix.field === 'cornerRadius' && aliasId(bound.cornerRadius) !== fix.variableId ? RADIUS_FIELDS : fix.fields;
      if (fields) {
        const on = fields.filter((f) => aliasId(bound[f]) === fix.variableId).length;
        return on === fields.length ? true : on === 0 ? false : null;
      }
      return aliasId(bound[fix.field]) === fix.variableId;
    }
    case 'bind-color':
      return paint(fix.target, fix.index) === fix.variableId;
    case 'unbind':
      return aliasId(bound[fix.field]) !== fix.variableId;
    case 'unbind-paint':
      return paint(fix.target, fix.index) !== fix.variableId;
    case 'clear-style':
      return (node as unknown as Record<string, unknown>)[fix.field] !== fix.styleId;
  }
}

/**
 * Carga las fuentes de un texto. Solo hace falta para propiedades tipográficas (textStyleId, characters…);
 * fills, strokes y sus estilos no la requieren, así que no se llama para ellos.
 */
async function ensureFonts(node: SceneNode): Promise<void> {
  if (node.type !== 'TEXT') return;
  if (node.hasMissingFont) throw new Error('Fuente no disponible');
  const names = node.characters.length
    ? node.getRangeAllFontNames(0, node.characters.length)
    : node.fontName !== figma.mixed
      ? [node.fontName]
      : [];
  await Promise.all(names.map((f) => figma.loadFontAsync(f)));
}

/**
 * Quita el modo de una colección que ya no existe, si sigue puesto igual y la colección sigue sin existir.
 * La API pide el objeto de la colección, así que solo se puede si Figma todavía la devuelve por id.
 */
async function clearMode(node: SceneNode | PageNode, fix: Extract<FixHint, { kind: 'clear-mode' }>, ctx: AuditContext): Promise<boolean> {
  if (node.explicitVariableModes[fix.collectionId] !== fix.modeId || ctx.isLocalCollection(fix.collectionId)) return false;
  const collection = await ctx.getCollection(fix.collectionId);
  if (!collection || collection.remote) return false;
  node.clearExplicitVariableModeForCollection(collection);
  return true;
}

/**
 * Aplica una corrección. Devuelve true solo si cambió algo.
 * Nunca inventa valores: enlaza variables existentes, ajusta a un paso de la escala declarado en la pista,
 * o quita referencias que ya no resuelven. Antes comprueba que la capa y la variable siguen como en la
 * auditoría: si algo ha cambiado desde entonces, no toca nada y la corrección cuenta como omitida.
 */
export async function applyFix(node: SceneNode | PageNode, fix: FixHint, ctx: AuditContext): Promise<boolean> {
  if (fix.kind === 'clear-mode') return clearMode(node, fix, ctx);
  // Lo demás solo existe en capas; una página solo lleva modos.
  if (node.type === 'PAGE') return false;
  switch (fix.kind) {
    case 'bind-float': {
      const v = await ctx.getVariable(fix.variableId);
      const fields = fix.fields ?? [fix.field];
      if (!v || fields.some((f) => !(f in node))) return false;
      const target = node as unknown as Record<string, unknown> & { setBoundVariable(field: string, v: Variable | null): void };
      // El mismo número que se auditó, todavía sin variable, y una variable que sigue valiendo lo prometido. Con
      // varios lados, todos: si uno ha cambiado, no se toca ninguno.
      if (fields.some((f) => !sameNumber(target[f], fix.from) || isBound(node, f))) return false;
      const value = ctx.resolveFloat(v, node);
      if (value === null || !sameNumber(value, fix.snapTo ?? fix.from)) return false;
      for (const f of fields) {
        if (fix.snapTo !== undefined) target[f] = fix.snapTo;
        target.setBoundVariable(f, v);
      }
      return true;
    }
    case 'bind-color': {
      const v = await ctx.getVariable(fix.variableId);
      const paints = getPaints(node, fix.target);
      // Un estilo aplicado después manda sobre las pinturas: enlazar la variable lo soltaría.
      if (!v || !paints || styleIdOf(node, fix.target)) return false;
      const p = paints[fix.index];
      if (!p || p.type !== 'SOLID') return false;
      const now = ctx.resolveColor(v, node);
      if (!now) return false;
      if ('variableId' in fix.from) {
        // Reenlace de una primitiva: la pintura sigue en ella y la semántica da el mismo color en este modo.
        if (p.boundVariables?.color?.id !== fix.from.variableId) return false;
        const primitive = await ctx.getVariable(fix.from.variableId);
        const was = primitive ? ctx.resolveColor(primitive, node) : null;
        if (!was || !colorEq(was, now)) return false;
      } else {
        // Color literal: sigue sin variable y con el mismo color, que es también el de la variable.
        const current = { r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity ?? 1 };
        if (p.boundVariables?.color || !colorEq(current, fix.from.color) || !colorEq(now, fix.from.color)) return false;
      }
      const next = [...paints];
      next[fix.index] = figma.variables.setBoundVariableForPaint(p, 'color', v);
      setPaints(node, fix.target, next);
      return true;
    }
    case 'unbind': {
      if (!(fix.field in node)) return false;
      const alias = ((node.boundVariables ?? {}) as Record<string, unknown>)[fix.field] as VariableAlias | undefined;
      // Solo si sigue enlazado a la misma variable y esta sigue sin resolver.
      if (alias?.id !== fix.variableId || (await ctx.getVariable(fix.variableId))) return false;
      await ensureFonts(node);
      (node as unknown as { setBoundVariable(field: string, v: Variable | null): void }).setBoundVariable(fix.field, null);
      return true;
    }
    case 'unbind-paint': {
      const paints = getPaints(node, fix.target);
      if (!paints) return false;
      const p = paints[fix.index];
      // Solo se toca la pintura que sigue enlazada a la variable rota, y si sigue rota.
      if (!p || p.type !== 'SOLID' || p.boundVariables?.color?.id !== fix.variableId) return false;
      if (await ctx.getVariable(fix.variableId)) return false;
      const next = [...paints];
      next[fix.index] = figma.variables.setBoundVariableForPaint(p, 'color', null);
      setPaints(node, fix.target, next);
      return true;
    }
    case 'clear-style': {
      const n = node as unknown as Record<string, unknown>;
      // Solo si la capa sigue con el mismo estilo y este sigue sin resolver.
      if (n[fix.field] !== fix.styleId || (await ctx.getStyle(fix.styleId))) return false;
      const call = async (name: string) => {
        if (typeof n[name] !== 'function') return false;
        await (n[name] as (id: string) => Promise<void>)('');
        return true;
      };
      switch (fix.field) {
        case 'fillStyleId':
          return call('setFillStyleIdAsync');
        case 'strokeStyleId':
          return call('setStrokeStyleIdAsync');
        case 'textStyleId':
          await ensureFonts(node);
          return call('setTextStyleIdAsync');
        case 'effectStyleId':
          return call('setEffectStyleIdAsync');
        case 'gridStyleId':
          return call('setGridStyleIdAsync');
      }
      return false;
    }
  }
  return false;
}
