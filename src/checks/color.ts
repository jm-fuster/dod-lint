import type { Check } from './index';
import type { Finding, FixHint } from '../types';
import { AuditContext, OVERRIDE_NOTE, RGBA, colorEq, composite, contrastRatio, over, toHex } from '../context';
import type { ColorUse, ModeAxis } from '../context';
import type { Text } from '../i18n';

export type PaintTarget = 'fills' | 'strokes';

export function hasFills(node: BaseNode): node is SceneNode & MinimalFillsMixin {
  return 'fills' in node;
}
export function hasStrokes(node: BaseNode): node is SceneNode & MinimalStrokesMixin {
  return 'strokes' in node;
}

/** Pinturas de un objetivo, o null si son mixtas o el nodo no las tiene. Con `ctx`, se leen una vez por auditoría. */
export function paintsOf(node: SceneNode, target: PaintTarget, ctx?: AuditContext): readonly Paint[] | null {
  if (target === 'fills' ? !hasFills(node) : !hasStrokes(node)) return null;
  const paints = ctx ? ctx.prop<readonly Paint[] | symbol>(node, target) : (node as unknown as Record<PaintTarget, readonly Paint[] | symbol>)[target];
  return typeof paints === 'symbol' ? null : paints;
}

/**
 * Alias de variable de una pintura sólida. Vive en la propia pintura; el array node.boundVariables.fills
 * es una lista compacta que NO va alineada con fills[], así que solo se usa cuando las longitudes coinciden.
 */
export function paintAlias(paint: Paint, node: SceneNode, target: PaintTarget, index: number, total: number, ctx?: AuditContext): VariableAlias | undefined {
  if (paint.type !== 'SOLID') return undefined;
  if (paint.boundVariables?.color) return paint.boundVariables.color;
  const bound = (ctx ? ctx.prop(node, 'boundVariables') : node.boundVariables) as Record<string, unknown> | undefined;
  const nodeBound = bound?.[target] as VariableAlias[] | undefined;
  return nodeBound && nodeBound.length === total ? nodeBound[index] : undefined;
}

function solidRGBA(paint: SolidPaint): RGBA {
  return { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: paint.opacity ?? 1 };
}

export function styleIdOf(node: SceneNode, target: PaintTarget, ctx?: AuditContext): string {
  if (target === 'fills' ? !hasFills(node) : !hasStrokes(node)) return '';
  const field = target === 'fills' ? 'fillStyleId' : 'strokeStyleId';
  const id = ctx ? ctx.prop<string | symbol>(node, field) : (node as unknown as Record<string, string | symbol>)[field];
  return typeof id === 'symbol' ? 'mixed' : id;
}

const FRAMES = new Set<string>(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SLOT']);

/** Ámbito de Figma que cubre una pintura: el relleno de un frame, de una forma o de un texto, o un trazo. */
function colorUse(node: SceneNode, target: PaintTarget): ColorUse {
  if (target === 'strokes') return 'STROKE_COLOR';
  if (node.type === 'TEXT') return 'TEXT_FILL';
  return FRAMES.has(node.type) ? 'FRAME_FILL' : 'SHAPE_FILL';
}

const USE: Record<ColorUse, Text> = {
  FRAME_FILL: { es: 'los rellenos de frame', en: 'frame fills' },
  SHAPE_FILL: { es: 'los rellenos de forma', en: 'shape fills' },
  TEXT_FILL: { es: 'los rellenos de texto', en: 'text fills' },
  STROKE_COLOR: { es: 'los trazos', en: 'strokes' },
};

const STYLE_FIELD: Record<PaintTarget, string> = { fills: 'fillStyleId', strokes: 'strokeStyleId' };
/** Campos sobrescritos que miran las reglas de color en las capas de una instancia. */
const PAINT_FIELDS = ['fills', 'strokes', 'fillStyleId', 'strokeStyleId'];

/**
 * Objetivos que hay que mirar en un nodo: todos, o solo los sobrescritos si hereda del componente (una
 * instancia o una capa suya). Soltar el estilo también sobrescribe la pintura.
 */
function targetsFor(node: SceneNode, ctx: AuditContext): { targets: PaintTarget[]; suffix: string } | null {
  // Un set es el marco que agrupa sus variantes en el lienzo: ninguna instancia hereda su relleno ni su trazo
  // (el borde morado discontinuo, #9747FF, lo pone Figma; 141 avisos en un sistema de pruebas).
  if (node.type === 'SECTION' || node.type === 'SLICE' || node.type === 'COMPONENT_SET' || ctx.isCanvasLabel(node)) return null;
  const own = ctx.overridesOf(node);
  if (!own) return { targets: ['fills', 'strokes'], suffix: '' };
  const targets = (['fills', 'strokes'] as PaintTarget[]).filter((t) => own.has(t) || own.has(STYLE_FIELD[t]));
  return targets.length ? { targets, suffix: ctx.tx(OVERRIDE_NOTE) } : null;
}

const LABEL: Record<PaintTarget, Text> = { fills: { es: 'Relleno', en: 'Fill' }, strokes: { es: 'Trazo', en: 'Stroke' } };

/** Ningún color escrito a mano; todo relleno o trazo va a variable o estilo. */
export const colorCheck: Check = {
  meta: {
    id: 'color',
    category: 'tokens',
    title: { es: 'Colores con token', en: 'Colors use tokens' },
    description: {
      es: 'Rellenos y trazos con un color escrito a mano, sin variable ni estilo. Si una sola variable semántica vale lo mismo y su ámbito lo permite, se ofrece enlazarla. En las instancias, solo lo que sobrescriben.',
      en: 'Fills and strokes with a hand-typed color and no variable or style. If exactly one semantic variable has that color and its scope allows it, binding it is offered. On instances, only what they override.',
    },
    severity: 'error',
    fixable: true,
  },
  overrides: PAINT_FIELDS,
  run(node, ctx, page) {
    const scope = targetsFor(node, ctx);
    if (!scope) return null;
    const out: Finding[] = [];

    if (node.type === 'TEXT' && ctx.prop(node, 'fills') === figma.mixed && scope.targets.includes('fills')) {
      const segments = node.getStyledTextSegments(['fills', 'fillStyleId']);
      let literal = 0;
      for (const seg of segments) {
        if (seg.fillStyleId) continue;
        for (const p of seg.fills) {
          if (p.type !== 'SOLID' || p.visible === false) continue;
          if (!p.boundVariables?.color) literal++;
        }
      }
      if (literal) {
        const message = ctx.tx({ es: `Texto con ${literal} segmento(s) de color literal${scope.suffix}`, en: `Text with ${literal} hard-coded color segment(s)${scope.suffix}` });
        out.push(ctx.finding(node, page, this.meta, message));
      }
      scope.targets = scope.targets.filter((t) => t !== 'fills');
    }

    for (const target of scope.targets) {
      const paints = paintsOf(node, target, ctx);
      if (!paints || !paints.length) continue;
      if (styleIdOf(node, target, ctx)) continue;
      paints.forEach((paint, index) => {
        if (paint.visible === false) return;
        if (paint.type === 'SOLID') {
          if (paintAlias(paint, node, target, index, paints.length, ctx)) return;
          const rgba = solidRGBA(paint);
          const use = colorUse(node, target);
          const { preferred, others } = ctx.semanticColorMatches(node, rgba, use);
          const n = preferred.length;
          const fix: FixHint | undefined = n === 1 ? { kind: 'bind-color', target, index, variableId: preferred[0].id, from: { color: rgba } } : undefined;
          // Empate: varias valen, o la única que vale es genérica y otras coincidencias tienen ámbito propio.
          const tie = n > 1 || (n === 0 && others.some((v) => ctx.colorRank(v, use) === 1));
          let hint = '';
          if (n === 1) {
            const name = ctx.varName(preferred[0]);
            hint = ctx.tx({ es: ` (coincide con ${name})`, en: ` (matches ${name})` });
          }
          else if (tie) {
            const count = n || others.length;
            hint = ctx.tx({ es: ` (${count} variables coinciden)`, en: ` (${count} variables match)` });
          } else if (others.length) {
            const name = ctx.varName(others[0]);
            hint = ctx.tx({ es: ` (${name} coincide, pero su ámbito no cubre ${USE[use].es})`, en: ` (${name} matches, but its scope doesn’t cover ${USE[use].en})` });
          }
          const label = ctx.tx(LABEL[target]);
          const hex = toHex(rgba);
          out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `${label} ${hex} sin token${hint}${scope.suffix}`, en: `${label} ${hex} is hard-coded${hint}${scope.suffix}` }), { fix }));
        } else if (paint.type.startsWith('GRADIENT')) {
          const g = paint as GradientPaint;
          const unbound = g.gradientStops.filter((s) => !s.boundVariables?.color).length;
          if (!unbound) return;
          const message = ctx.tx({
            es: `${LABEL[target].es} degradado con ${unbound} parada(s) sin token${scope.suffix}`,
            en: `Gradient ${LABEL[target].en.toLowerCase()} with ${unbound} hard-coded stop(s)${scope.suffix}`,
          });
          out.push(ctx.finding(node, page, this.meta, message, { severity: 'info' }));
        }
      });
    }
    return out.length ? out : null;
  },
};

/** Los consumidores usan la capa semántica, nunca una primitiva directamente. */
export const primitiveCheck: Check = {
  meta: {
    id: 'primitive',
    category: 'tokens',
    title: { es: 'Semántica, no primitivas', en: 'Semantic tokens, not primitives' },
    description: {
      es: 'Rellenos y trazos enlazados directamente a una primitiva. Si una sola variable semántica apunta a ella y su ámbito lo permite, se ofrece cambiarla. En las instancias, solo lo que sobrescriben. Las muestras de una paleta no cuentan.',
      en: 'Fills and strokes bound straight to a primitive. If exactly one semantic variable points to it and its scope allows it, rebinding is offered. On instances, only what they override. Palette swatches don’t count.',
    },
    severity: 'warning',
    fixable: true,
  },
  overrides: PAINT_FIELDS,
  async run(node, ctx, page) {
    if (!ctx.primitiveIds.size) return null;
    const scope = targetsFor(node, ctx);
    if (!scope) return null;
    const out: Finding[] = [];

    if (node.type === 'TEXT' && ctx.prop(node, 'fills') === figma.mixed && scope.targets.includes('fills')) {
      const segments = node.getStyledTextSegments(['fills']);
      const seen = new Set<string>();
      for (const seg of segments) {
        for (const p of seg.fills) {
          const alias = p.type === 'SOLID' ? p.boundVariables?.color : undefined;
          if (!alias || seen.has(alias.id)) continue;
          seen.add(alias.id);
          const v = await ctx.getVariable(alias.id);
          if (v && ctx.isPrimitiveVar(v) && !ctx.documents(node, v)) {
            const name = ctx.varName(v);
            const message = ctx.tx({ es: `Segmento de texto enlazado a la primitiva ${name}${scope.suffix}`, en: `Text segment bound to the primitive ${name}${scope.suffix}` });
            out.push(ctx.finding(node, page, this.meta, message));
          }
        }
      }
      scope.targets = scope.targets.filter((t) => t !== 'fills');
    }

    for (const target of scope.targets) {
      const paints = paintsOf(node, target, ctx);
      if (!paints) continue;
      for (let index = 0; index < paints.length; index++) {
        const p = paints[index];
        if (p.visible === false) continue;
        const alias = paintAlias(p, node, target, index, paints.length, ctx);
        if (!alias) continue;
        const v = await ctx.getVariable(alias.id);
        if (!v || !ctx.isPrimitiveVar(v)) continue;
        // La muestra de una paleta enseña la primitiva que nombra.
        if (ctx.documents(node, v)) continue;
        const use = colorUse(node, target);
        const { direct, preferred, others } = ctx.rebindTargets(v.id, node, use);
        const n = preferred.length;
        // Con un estilo, la pintura es la del estilo: enlazar una variable en la capa lo soltaría.
        const styled = !!styleIdOf(node, target, ctx);
        const fix: FixHint | undefined = n === 1 && !styled ? { kind: 'bind-color', target, index, variableId: preferred[0].id, from: { variableId: v.id } } : undefined;
        const tie = n > 1 || (n === 0 && others.some((v) => ctx.colorRank(v, use) === 1));
        let hint: string;
        if (n === 1) hint = ` → ${ctx.varName(preferred[0])}`;
        else if (tie) {
          const count = n || others.length;
          hint = ctx.tx({ es: ` (${count} semánticas la usan)`, en: ` (${count} semantic variables use it)` });
        } else if (others.length) {
          const name = ctx.varName(others[0]);
          hint = ctx.tx({ es: ` (${name} la usa, pero su ámbito no cubre ${USE[use].es})`, en: ` (${name} uses it, but its scope doesn’t cover ${USE[use].en})` });
        } else if (direct.length) hint = ctx.tx({ es: ' (ninguna semántica la usa en este modo)', en: ' (no semantic variable uses it in this mode)' });
        else hint = ctx.tx({ es: ' (ninguna semántica la usa)', en: ' (no semantic variable uses it)' });
        if (styled) hint += ctx.tx({ es: ' (del estilo)', en: ' (from its style)' });
        const label = ctx.tx(LABEL[target]);
        const name = ctx.varName(v);
        out.push(ctx.finding(node, page, this.meta, ctx.tx({ es: `${label} enlazado a la primitiva ${name}${hint}${scope.suffix}`, en: `${label} bound to the primitive ${name}${hint}${scope.suffix}` }), { fix }));
      }
    }
    return out.length ? out : null;
  },
};

// ---------- Contraste ----------

/** Modos con los que resolver las variables, por colección. Null: los que tiene cada capa. */
type ModeOverride = Readonly<Record<string, string>> | null;

/**
 * Color efectivo de las pinturas de un nodo, compuestas de arriba abajo.
 * Devuelve el color (puede ser translúcido), 'non-solid' si aparece una imagen o degradado antes de
 * alcanzar opacidad, o null si no hay pinturas visibles. Con `modes`, las variables se resuelven en esos
 * modos; en `met` se apuntan las variables por las que pasa.
 */
async function ownSolid(
  paints: readonly Paint[],
  node: SceneNode,
  ctx: AuditContext,
  target: PaintTarget,
  modes: ModeOverride = null,
  met?: Variable[],
): Promise<RGBA | 'non-solid' | null> {
  let acc: RGBA | null = null;
  for (let i = paints.length - 1; i >= 0; i--) {
    const p = paints[i];
    if (p.visible === false) continue;
    if (p.type !== 'SOLID') return acc && acc.a >= 0.99 ? acc : 'non-solid';
    let c: RGBA | null;
    const alias = paintAlias(p, node, target, i, paints.length, ctx);
    if (alias) {
      const v = await ctx.getVariable(alias.id);
      if (v) met?.push(v);
      // Figma refleja el alfa de la variable en paint.opacity al leer la pintura (verificado), no se multiplica.
      const resolved = v ? ctx.resolveColor(v, node) : null;
      if (!modes) c = resolved ? { ...resolved, a: p.opacity ?? resolved.a } : null;
      else {
        // En otro modo, el alfa es el de la variable en ese modo, con lo que la pintura tenga de más.
        const other = v ? ctx.resolveColorIn(v, node, modes) : null;
        const extra = resolved && resolved.a > 0.01 && p.opacity !== undefined ? p.opacity / resolved.a : 1;
        c = other ? { ...other, a: Math.min(1, other.a * extra) } : null;
      }
    } else {
      c = solidRGBA(p);
    }
    if (!c) return 'non-solid';
    acc = acc ? over(acc, c) : c;
    if (acc.a >= 0.99) break;
  }
  return acc;
}

/** El componente principal más cercano por encima de la capa, si está dentro de uno. */
function componentRoot(node: SceneNode, ctx: AuditContext): BaseNode | null {
  for (let cur = ctx.parentOf(node); cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT'; cur = ctx.parentOf(cur)) {
    if (cur.type === 'COMPONENT') return cur;
  }
  return null;
}

interface Background {
  color: RGBA;
  source: string;
  /** Producto de opacidades de los ancestros del texto hasta el nodo de fondo (afecta al texto). */
  textOpacity: number;
}

type Point = { x: number; y: number };

function centerOf(box: Rect | null): Point | null {
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

function covers(box: Rect | null, p: Point): boolean {
  return !!box && p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
}

/** Lo que puede hacer de fondo de un texto, en el orden en que se busca (ver `backgroundLayers`). */
type BackgroundLayer =
  /** Una hermana por debajo que tapa el texto, o el propio contenedor, con sus rellenos. */
  | { kind: 'fill'; node: SceneNode; fills: readonly Paint[] }
  /** Se sube al padre: su opacidad también es la del texto. */
  | { kind: 'up'; node: SceneNode }
  /** El fondo de la página. */
  | { kind: 'page'; paint: Paint | undefined }
  /** El componente principal más cercano, del que no se pasa. */
  | { kind: 'limit' };

/**
 * Las capas que pueden hacer de fondo de un texto, de la más cercana a la más lejana: las hermanas por debajo en z
 * que lo cubren, el padre, las hermanas del padre, y así hasta la página o el componente. Se recorren a medida que
 * se piden: `findBackground` para en la primera opaca y `situationKey` las quiere todas.
 */
function* backgroundLayers(text: SceneNode, ctx: AuditContext): Generator<BackgroundLayer> {
  let child: SceneNode = text;
  let cur: BaseNode | null = ctx.parentOf(text);
  // Dentro de un componente principal, el fondo tiene que ser suyo. Lo que hay detrás (el marco del set, la
  // sección de la documentación) es el lienzo: en Simple Design System, el gris claro literal de las secciones
  // daba 197 errores en componentes transparentes. Un componente así se mide donde se colocan sus instancias.
  const limit = componentRoot(text, ctx);
  // Cada propiedad se lee una vez: en las capas de una instancia cada lectura cuesta, y esto se repite por texto.
  // La caja del texto, solo si hay una hermana con relleno que la pueda tapar.
  let center: Point | null | undefined;
  const centerNow = () => (center === undefined ? (center = centerOf(ctx.prop<Rect | null>(text, 'absoluteBoundingBox'))) : center);

  while (cur && cur.type !== 'DOCUMENT') {
    if (cur.type === 'PAGE') {
      yield { kind: 'page', paint: cur.backgrounds.find((p) => p.visible !== false) };
      return;
    }
    const container = cur as SceneNode & ChildrenMixin;
    // Hermanos por debajo en z que cubren el texto.
    if ('children' in container) {
      const kids = ctx.childrenOf(container);
      for (let i = kids.indexOf(child) - 1; i >= 0; i--) {
        const sib = kids[i];
        // El relleno de un texto es el color de sus letras, no un fondo: en los Input de FlySplit, el sufijo
        // se medía contra el texto del valor que tiene debajo.
        if (sib.type === 'TEXT' || !hasFills(sib)) continue;
        // Primero si queda debajo del texto, que descarta casi todas: un icono al lado no tapa nada, y sus
        // rellenos, la lectura más cara, ya no hacen falta.
        const at = centerNow();
        if (!at || !covers(ctx.prop<Rect | null>(sib, 'absoluteBoundingBox'), at) || !ctx.prop<boolean>(sib, 'visible')) continue;
        const fills = ctx.prop<readonly Paint[] | symbol>(sib, 'fills');
        if (typeof fills === 'symbol' || !fills.length) continue;
        yield { kind: 'fill', node: sib, fills };
      }
    }
    // El propio contenedor.
    const own = hasFills(cur) ? ctx.prop<readonly Paint[] | symbol>(cur, 'fills') : null;
    if (own && typeof own !== 'symbol' && own.length) yield { kind: 'fill', node: cur as SceneNode, fills: own };
    if (cur === limit) {
      yield { kind: 'limit' };
      return;
    }
    yield { kind: 'up', node: cur as SceneNode };
    child = cur as SceneNode;
    cur = ctx.parentOf(cur);
  }
}

/**
 * Busca el fondo efectivo de un texto entre las capas de `backgroundLayers`. Las translúcidas se acumulan y se
 * componen sobre la primera opaca. Devuelve null si hay una imagen o degradado por el camino. `modes` y `met`,
 * como en `ownSolid`: en otro modo una capa puede ser translúcida y el fondo, otro.
 */
async function findBackground(text: SceneNode, ctx: AuditContext, modes: ModeOverride = null, met?: Variable[]): Promise<Background | null> {
  const pending: RGBA[] = [];
  let textOpacity = 1;
  const finalize = (base: RGBA, source: string): Background => {
    let color = { ...base, a: 1 };
    for (let i = pending.length - 1; i >= 0; i--) color = composite(pending[i], color);
    return { color, source, textOpacity };
  };

  for (const layer of backgroundLayers(text, ctx)) {
    if (layer.kind === 'page') {
      if (layer.paint && layer.paint.type === 'SOLID') return finalize(solidRGBA(layer.paint), ctx.tx({ es: 'fondo de la página', en: 'the page background' }));
      return null;
    }
    if (layer.kind === 'limit') return null;
    if (layer.kind === 'up') {
      if ('opacity' in layer.node) textOpacity *= ctx.prop<number>(layer.node, 'opacity');
      continue;
    }
    const r = await ownSolid(layer.fills, layer.node, ctx, 'fills', modes, met);
    if (r === 'non-solid') return null;
    if (!r) continue;
    const c = { ...r, a: r.a * ('opacity' in layer.node ? ctx.prop<number>(layer.node, 'opacity') : 1) };
    if (c.a >= 0.99) return finalize(c, ctx.prop<string>(layer.node, 'name'));
    pending.push(c);
  }
  return null;
}

interface Measured {
  ratio: number;
  fg: RGBA;
  bg: Background;
  /** Los modos en los que se midió, si hay más de uno que revisar. */
  label: string;
}

/** El contraste de un texto contra su fondo, en los modos de cada capa o en `modes`. Null si no se puede medir. */
async function measure(text: TextNode, fills: readonly Paint[], ctx: AuditContext, modes: ModeOverride, met?: Variable[]): Promise<Omit<Measured, 'label'> | null> {
  const fg = await ownSolid(fills, text, ctx, 'fills', modes, met);
  if (!fg || fg === 'non-solid' || fg.a <= 0.01) return null;
  const bg = await findBackground(text, ctx, modes, met);
  if (!bg) return null;
  const fgAlpha = { ...fg, a: fg.a * ctx.prop<number>(text, 'opacity') * bg.textOpacity };
  const fgFlat = fgAlpha.a < 1 ? composite(fgAlpha, bg.color) : { ...fgAlpha, a: 1 };
  return { ratio: contrastRatio(fgFlat, bg.color), fg: fgFlat, bg };
}

/** Con más combinaciones que estas, se cambia un eje cada vez en vez de probarlas todas. */
const MAX_COMBOS = 16;

/**
 * Con al menos tantos modos más por revisar, compensa reconocer la situación de cada texto (`situationKey`):
 * cuesta como medir dos o tres, y con solo claro y oscuro se pierde (medido en Material 3 el 02-10-2026).
 */
const SHARE_FROM = 4;

type Combos = ReturnType<typeof modeCombos> & { key: string };

/** Lo que la regla de contraste guarda durante una auditoría. */
interface ContrastMemo {
  /** Las combinaciones de modos, por ejes y modo de partida. */
  combos: Map<string, Combos>;
  /** Las situaciones de textos que ya pasaron en todos los modos. */
  passing: Set<string>;
  /** Lo que se lee de cada capa para la clave de su situación. */
  layers: Map<string, string>;
}
const memos = new WeakMap<AuditContext, ContrastMemo>();

function memoOf(ctx: AuditContext): ContrastMemo {
  let memo = memos.get(ctx);
  if (!memo) {
    memo = { combos: new Map(), passing: new Set(), layers: new Map() };
    memos.set(ctx, memo);
  }
  return memo;
}

/** `modeCombos`, una vez por ejes y modo de partida: todos los textos que los comparten tienen las mismas. */
function combosFor(node: SceneNode, axes: ModeAxis[], ctx: AuditContext): Combos {
  const start = axes.map((a) => ctx.modeIdFor(node, a.collectionId) ?? a.modes[0].modeId);
  const key = `${axes.map((a) => a.collectionId).join(',')}=${start.join(',')}`;
  const memo = memoOf(ctx).combos;
  let combos = memo.get(key);
  if (!combos) {
    combos = { ...modeCombos(node, axes, ctx), key };
    memo.set(key, combos);
  }
  return combos;
}

/** Lo que lee `ownSolid` de unas pinturas, igual en cualquier modo. */
function paintsKey(paints: readonly Paint[], node: SceneNode, ctx: AuditContext): string {
  let out = '';
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (p.visible === false) out += '-;';
    else if (p.type !== 'SOLID') out += `${p.type};`;
    else {
      const alias = paintAlias(p, node, 'fills', i, paints.length, ctx);
      out += alias ? `@${alias.id}:${p.opacity ?? ''};` : `#${p.color.r},${p.color.g},${p.color.b}:${p.opacity ?? ''};`;
    }
  }
  return out;
}

/** Una capa en la clave: su opacidad, sus modos y sus rellenos. */
function layerKey(node: SceneNode, fills: readonly Paint[], ctx: AuditContext, memo: ContrastMemo): string {
  let key = memo.layers.get(node.id);
  if (key === undefined) {
    key = `${'opacity' in node ? ctx.prop<number>(node, 'opacity') : 1}|${ctx.modeKey(node)}|${paintsKey(fills, node, ctx)}`;
    memo.layers.set(node.id, key);
  }
  return key;
}

/**
 * Todo lo que `measure` puede leer de un texto en cualquier modo, salvo los nombres: el propio texto y cada capa de
 * `backgroundLayers`, sin pararse en la primera opaca, que en otro modo puede no serlo. Dos textos con la misma
 * clave dan el mismo contraste en cada modo. Los nombres solo salen en el aviso, y un texto que no pasa se mide
 * entero.
 */
function situationKey(text: TextNode, fills: readonly Paint[], ctx: AuditContext): string {
  const memo = memoOf(ctx);
  let key = layerKey(text, fills, ctx, memo);
  for (const layer of backgroundLayers(text, ctx)) {
    if (layer.kind === 'fill') key += `>${layerKey(layer.node, layer.fills, ctx, memo)}`;
    else if (layer.kind === 'up') key += `>^${'opacity' in layer.node ? ctx.prop<number>(layer.node, 'opacity') : 1}`;
    else if (layer.kind === 'limit') key += '>|';
    else {
      const p = layer.paint;
      key += `>P${!p ? '' : p.type === 'SOLID' ? `${p.color.r},${p.color.g},${p.color.b}:${p.opacity ?? ''}` : p.type}`;
    }
  }
  return key;
}

/**
 * Las combinaciones de modos que revisar además de la de la capa, con su nombre («Pasajero · Oscuro»): todas,
 * o un eje cada vez si son demasiadas.
 */
function modeCombos(node: SceneNode, axes: ModeAxis[], ctx: AuditContext): { current: string; others: { modes: Record<string, string>; label: string }[] } {
  const current = axes.map((a) => ctx.modeIdFor(node, a.collectionId) ?? a.modes[0].modeId);
  const label = (ids: string[]) => axes.map((a, i) => a.modes.find((m) => m.modeId === ids[i])?.name ?? ids[i]).join(' · ');
  const total = axes.reduce((n, a) => n * a.modes.length, 1);
  let combos: string[][];
  if (total <= MAX_COMBOS) {
    combos = axes.reduce<string[][]>((acc, axis) => acc.flatMap((prefix) => axis.modes.map((m) => [...prefix, m.modeId])), [[]]);
  } else {
    combos = axes.flatMap((axis, i) => axis.modes.map((m) => current.map((id, j) => (j === i ? m.modeId : id))));
  }
  const seen = new Set([current.join('|')]);
  const others: { modes: Record<string, string>; label: string }[] = [];
  for (const ids of combos) {
    if (seen.has(ids.join('|'))) continue;
    seen.add(ids.join('|'));
    others.push({ modes: Object.fromEntries(axes.map((a, i) => [a.collectionId, ids[i]])), label: label(ids) });
  }
  return { current: label(current), others };
}

/** «A», «A y B», «A, B y C», «A, B, C y 2 más». */
function listOf(items: string[], and: string, more: (n: number) => string): string {
  if (items.length > 3) return `${items.slice(0, 3).join(', ')} ${and} ${more(items.length - 3)}`;
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}` : items[0] ?? '';
}

/** El texto conserva al menos 4,5:1 (3:1 si es grande) en cada modo en el que se puede ver. */
export const contrastCheck: Check = {
  meta: {
    id: 'contrast',
    category: 'accessibility',
    title: { es: 'Contraste de texto', en: 'Text contrast' },
    description: {
      es: 'Contraste WCAG del texto contra su fondo. Dentro de los componentes se mira en cada modo del que dependen sus colores (claro, oscuro, roles, marcas), y el aviso dice en cuál falla. Las pantallas y sus instancias, en el modo que tienen.',
      en: 'WCAG contrast of text against its background. Inside components it’s checked in every mode its colors depend on (light, dark, roles, brands), and the finding says which one fails. Screens and their instances, in the mode they have.',
    },
    severity: 'error',
    fixable: false,
  },
  placed: true,
  async run(node, ctx, page) {
    if (node.type !== 'TEXT' || ctx.isCanvasLabel(node)) return null;
    // Un texto vacío no se mide. Su contenido, como el tamaño y el peso, se lee solo si hace falta para decidir:
    // casi todos los textos pasan, y en los de las instancias cada lectura es solo de esta regla.
    const empty = () => !ctx.prop<string>(node, 'characters').trim();
    const fills = ctx.prop<readonly Paint[] | symbol>(node, 'fills');
    if (typeof fills === 'symbol') {
      if (!empty()) ctx.skippedContrast++;
      return null;
    }
    const met: Variable[] = [];
    const current = await measure(node, fills, ctx, null, met);
    if (!current) {
      if (!empty()) ctx.skippedContrast++;
      return null;
    }
    // Un componente tiene que verse bien en todos los modos; una pantalla o una página de documentación, en el
    // suyo (en FlySplit, las insignias PASS/FAIL de Foundations · Color daban 18 errores en un oscuro que no se
    // usa). Dentro de un componente, los demás modos de las colecciones de las que dependen sus colores, salvo
    // las que fija un ancestro.
    const results: Measured[] = [{ ...current, label: '' }];
    const axes = ctx.insideComponent(node) ? await ctx.modeAxes(node, met) : [];
    if (axes.length) {
      const combos = combosFor(node, axes, ctx);
      results[0].label = combos.current;
      // Con muchos modos, casi todos los textos repiten la situación de otro: en Lists de Material 3, con 32 modos,
      // 869 textos en 27 situaciones, y medirlos todos en cada modo era 4,7 s de 6,8. Si otro con la misma ya pasó
      // en todos, este también pasa.
      const key = combos.others.length >= SHARE_FROM ? `${situationKey(node, fills, ctx)}#${combos.key}` : null;
      const passing = memoOf(ctx).passing;
      if (key && current.ratio >= 4.5 && passing.has(key)) return null;
      for (const combo of combos.others) {
        const m = await measure(node, fills, ctx, combo.modes);
        if (m) results.push({ ...m, label: combo.label });
      }
      if (key && results.every((r) => r.ratio >= 4.5)) passing.add(key);
    }

    // Con 4,5:1 en todos los modos pasa sea cual sea su tamaño.
    if (results.every((r) => r.ratio >= 4.5) || empty()) return null;
    const fontSize = ctx.prop<number | symbol>(node, 'fontSize');
    const size = typeof fontSize === 'symbol' ? node.getRangeFontSize(0, 1) : fontSize;
    const px = typeof size === 'number' ? size : 16;
    // El peso solo decide entre 18,66 y 24 px (14 y 18 puntos); fuera de ahí, solo hace falta para el aviso.
    let weightMemo: number | undefined;
    const weight = () => {
      if (weightMemo === undefined) {
        const fontWeight = ctx.prop<number | symbol>(node, 'fontWeight');
        const value = typeof fontWeight === 'symbol' ? node.getRangeFontWeight(0, 1) : fontWeight;
        weightMemo = typeof value === 'number' ? value : 400;
      }
      return weightMemo;
    };
    const large = px >= 24 || (px >= 18.66 && weight() >= 700);
    const min = large ? 3 : 4.5;
    const failing = results.filter((r) => r.ratio < min);
    if (!failing.length) return null;
    const worst = failing.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    const { bg, ratio } = worst;
    const inMode = worst.label ? ctx.tx({ es: ` en ${worst.label}`, en: ` in ${worst.label}` }) : '';
    const others = failing.filter((r) => r !== worst).map((r) => r.label);
    const also = others.length
      ? ctx.tx({
          es: ` (también en ${listOf(others, 'y', (n) => `${n} más`)})`,
          en: ` (also in ${listOf(others, 'and', (n) => `${n} more`)})`,
        })
      : '';
    if (colorEq(worst.fg, bg.color)) {
      return [ctx.finding(node, page, this.meta, ctx.tx({ es: `Texto del mismo color que el fondo${inMode} (${bg.source})`, en: `Text is the same color as its background${inMode} (${bg.source})` }) + also)];
    }
    // WCAG 1.4.3 exime al texto de componentes inactivos; se informa sin penalizar.
    const disabled = ctx.inDisabledState(node);
    const r = ratio.toFixed(2);
    const hex = toHex(bg.color);
    const bold = weight() >= 700;
    const detail = ctx.tx({
      es: `Contraste ${r}:1${inMode}, mínimo ${min}:1 para ${px} px${bold ? ' negrita' : ''} sobre ${bg.source} (${hex})`,
      en: `Contrast ${r}:1${inMode}, minimum ${min}:1 for ${px} px${bold ? ' bold' : ''} text on ${bg.source} (${hex})`,
    });
    const exempt = ctx.tx({ es: '. Estado deshabilitado: WCAG lo exime', en: '. Disabled state: exempt under WCAG' });
    return [
      ctx.finding(node, page, this.meta, (disabled ? detail + exempt : detail) + also, {
        severity: disabled ? 'info' : ratio < min * 0.75 ? 'error' : 'warning',
      }),
    ];
  },
};
