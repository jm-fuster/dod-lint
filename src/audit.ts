import type { CheckId, Finding, RecheckTarget, Scope, Settings } from './types';
import { AuditContext } from './context';
import type { FloatKind, NodeScope, SlotContent } from './context';
import { CHECKS } from './checks';
import type { Lang } from './i18n';
import { ignoreKeyOf, placedKeyOf, readIgnored } from './ignore';
import { findNodes } from './nodes';

export interface AuditResult {
  findings: Finding[];
  scanned: number;
  pages: number;
  durationMs: number;
  truncated: CheckId[];
  skippedContrast: number;
  cancelled: boolean;
  /** Capas recorridas que Figma devolvió sueltas (ver `NodeScope.anchor`). */
  looseNodes: number;
  /**
   * Tipos de token que no se usan (sin variables en el archivo ni capas enlazadas a una), con cuántos valores
   * escritos a mano no se han avisado capa a capa por eso.
   */
  untokenized: Partial<Record<FloatKind, number>>;
  /** Con `profile`: milisegundos de cada regla, y del resto del recorrido en `walk`. */
  timings?: Record<string, number>;
}

export interface AuditOptions {
  /** Máximo de hallazgos por comprobación; el resto se marca como truncado. */
  maxPerCheck?: number;
  onProgress?: (scanned: number, findings: number) => void;
  /**
   * Cada cuántos milisegundos de trabajo se cede el hilo, para que Figma y la UI respondan. Por tiempo y no por
   * capas: cien capas eran 0,1 s en una página y 0,8 s en otra (Material 3, octubre de 2026). Infinity no cede.
   */
  yieldMs?: number;
  /** Cómo se cede el hilo: por defecto, un setTimeout. El plugin hace ida y vuelta con su UI (ver `uiPause`). */
  pause?: () => Promise<void>;
  /** Páginas concretas a recorrer (pruebas). Sustituye a la página actual o al archivo. */
  pages?: PageNode[];
  /** Capas concretas a recorrer (pruebas). Sustituye al alcance y a `pages`. */
  roots?: SceneNode[];
  /**
   * Capas (o páginas) que volver a revisar tras editarlas a mano, sin bajar a sus hijos salvo `deep`.
   * Sustituye al alcance, a `pages` y a `roots`.
   */
  recheck?: RecheckTarget[];
  /** Idioma de los mensajes; por defecto, el de los ajustes (automático = inglés en el sandbox). */
  lang?: Lang;
  /** Se consulta cada vez que se cede el hilo: si devuelve true, la auditoría para y devuelve lo que lleva. */
  shouldStop?: () => boolean;
  /** Mide cuánto tarda cada regla (para comparar versiones; no lo usa el plugin). */
  profile?: boolean;
  /**
   * Tipos de token que se dan por no usados, en vez de decidirlo con lo recorrido. «Actualizar la lista» pasa los
   * de la auditoría: solo vuelve a mirar las capas con hallazgos, y con ellas decidiría otra cosa.
   */
  withoutTokens?: readonly FloatKind[];
}

interface Entry extends NodeScope {
  node: SceneNode;
  /** Al revisar de nuevo, lo que cuelga de una capa `deep` también se recorre. */
  deep?: boolean;
}

type Group = { page: PageNode; roots: readonly SceneNode[]; pageTarget?: boolean };

/** Qué se revisa de una instancia sin entrar en ella. */
interface Walk {
  internals: boolean;
  /** Sus textos, para las reglas que dependen de dónde está. */
  placed: boolean;
  /** Las capas que sobrescribe en alguno de estos campos. */
  overrides: ReadonlySet<string>;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Hallazgo de una capa suelta: la ruta y la selección pasan por su ancla, y no se ofrece corregirlo. */
function anchorTo(f: Finding, anchor: SceneNode, ctx: AuditContext): void {
  const base = [ctx.path(anchor), anchor.name].filter(Boolean).join(' / ');
  f.path = f.path ? `${base} / ${f.path}` : base;
  f.nodeId = anchor.id;
  f.ignoreKey = ignoreKeyOf(f.checkId, anchor.id);
  f.anchored = true;
  delete f.fix;
}

function pageOf(node: BaseNode): PageNode | null {
  let cur: BaseNode | null = node;
  while (cur && cur.type !== 'PAGE') cur = cur.parent;
  return (cur as PageNode | null) ?? null;
}

/** Raíces del recorrido agrupadas por página. */
async function collectRoots(scope: Scope, opts: AuditOptions): Promise<Group[]> {
  if (opts.recheck) {
    // Las que ya no existen se quedan fuera: sus hallazgos desaparecen al sustituirlos.
    const groups = new Map<string, { page: PageNode; roots: SceneNode[]; pageTarget?: boolean }>();
    const nodes = await findNodes(opts.recheck.map((t) => t.nodeId));
    for (const target of opts.recheck) {
      const node = nodes.get(target.nodeId);
      if (!node || node.type === 'DOCUMENT') continue;
      const page = node.type === 'PAGE' ? node : pageOf(node);
      if (!page) continue;
      const group = groups.get(page.id) ?? { page, roots: [] };
      if (node.type === 'PAGE') group.pageTarget = true;
      else group.roots.push(node as SceneNode);
      groups.set(page.id, group);
    }
    return [...groups.values()];
  }
  if (opts.roots) {
    const groups = new Map<string, { page: PageNode; roots: SceneNode[] }>();
    for (const node of opts.roots) {
      const page = pageOf(node);
      if (!page) continue;
      const group = groups.get(page.id) ?? { page, roots: [] };
      group.roots.push(node);
      groups.set(page.id, group);
    }
    return [...groups.values()];
  }
  let pages: PageNode[];
  if (opts.pages) {
    for (const p of opts.pages) await p.loadAsync();
    pages = opts.pages;
  } else if (scope === 'file') {
    await figma.loadAllPagesAsync();
    pages = [...figma.root.children];
  } else {
    pages = [figma.currentPage];
  }
  return pages.map((page) => ({ page, roots: scope === 'selection' ? figma.currentPage.selection : page.children }));
}

/**
 * Apila los hijos que hay que recorrer. De una instancia, salvo que se entre en las instancias, solo se
 * llega a sus slots, a sus textos (para el contraste) y a las capas que sobrescribe (para lo sobrescrito).
 * De un slot de instancia, solo al contenido propio, porque el heredado es el contenido por defecto del
 * componente y ya se audita en él.
 */
async function descend(stack: Entry[], entry: Entry, content: SlotContent | null, ctx: AuditContext, walk: Walk): Promise<void> {
  const { node, owner, inherited, anchor } = entry;
  // Lo que cuelga de un texto o de una capa sobrescrita de una instancia viene del componente.
  if ((entry.placed || entry.overridden) && !entry.shell) return;
  const push = (kids: readonly SceneNode[], scope: (kid: SceneNode) => NodeScope) => {
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      // Una capa sin padre no está en la página: se ubica por la última que sí lo está.
      const loose = anchor ?? (ctx.parentOf(kid) ? undefined : node);
      stack.push({ node: kid, ...scope(kid), ...(loose ? { anchor: loose } : {}) });
    }
  };
  if (owner && ctx.isSlot(node)) {
    // Si no se pudo clasificar, todo cuenta como heredado: no se audita dos veces ni se ofrece corregirlo.
    const ownedKids = content?.owned ?? [];
    const owned = new Set(ownedKids.map((k) => k.id));
    push(entry.shell ? ownedKids : ctx.childrenOf(node), (k) => (owned.has(k.id) ? {} : { owner, inherited: true }));
    return;
  }
  if (node.type === 'INSTANCE') {
    const top = owner ?? node;
    if (walk.internals) {
      push(ctx.childrenOf(node), () => ({ owner: top, inherited }));
      return;
    }
    // El contraste depende de dónde está la instancia y en qué modo, y lo sobrescrito se define en ella. Los
    // textos y las capas sobrescritas van debajo de los slots en la pila: el contenido propio de un slot se
    // audita entero antes y no se repite. Una misma capa puede llegar por los dos lados.
    const slots = ctx.instanceSlots(node);
    const layers = new Map<string, { layer: SceneNode; scope: NodeScope }>();
    if (walk.placed) for (const t of ctx.placedTexts(node)) layers.set(t.id, { layer: t, scope: { placed: true } });
    for (const layer of walk.overrides.size ? await ctx.overriddenLayers(node, walk.overrides) : []) {
      layers.set(layer.id, { layer, scope: { ...layers.get(layer.id)?.scope, overridden: true } });
    }
    // Un slot sobrescrito se revisa también por eso en su propia entrada, que es la que baja a su contenido.
    const overriddenSlots = new Set<string>();
    for (const s of slots) if (layers.delete(s.id)) overriddenSlots.add(s.id);
    push([...layers.values()].map((l) => l.layer), (l) => ({ owner: top, ...layers.get(l.id)!.scope }));
    push(slots, (s) => ({ owner: top, shell: true, ...(overriddenSlots.has(s.id) ? { overridden: true } : {}) }));
    return;
  }
  if ('children' in node) push(ctx.childrenOf(node), () => ({ owner, inherited }));
}

const TOKEN_KINDS: readonly FloatKind[] = ['spacing', 'radius'];

/**
 * Sin variables de un tipo en el archivo, ni ninguna capa enlazada a una (de una biblioteca, por ejemplo), lo
 * escrito a mano no se avisa capa a capa: no hay ningún token al que enlazarlo, y en Material 3, sin variables de
 * espaciado, eran unos 4.100 de 7.538 hallazgos. Lo dice una nota, con cuántos son. Si se usan, se quedan, y
 * entonces cuentan para el tope de la regla.
 */
function withoutUnusedTokens(findings: Finding[], ctx: AuditContext, settings: Settings, opts: AuditOptions, max: number, truncated: Set<CheckId>) {
  const unused = opts.withoutTokens ?? (settings.enabled.spacing ? TOKEN_KINDS.filter((k) => !ctx.scaleFor(k).size && !ctx.tokenUse[k]) : []);
  const untokenized: Partial<Record<FloatKind, number>> = {};
  for (const k of unused) untokenized[k] = 0;
  if (!ctx.unscaled.size) return { kept: findings, untokenized };
  let keptUnscaled = 0;
  let kept = findings.filter((f) => {
    const kind = ctx.unscaled.get(f);
    if (!kind) return true;
    if (!unused.includes(kind)) {
      keptUnscaled++;
      return true;
    }
    untokenized[kind]!++;
    return false;
  });
  if (keptUnscaled) {
    let n = 0;
    kept = kept.filter((f) => f.checkId !== 'spacing' || ++n <= max);
    if (n > max) truncated.add('spacing');
  }
  return { kept, untokenized };
}

/**
 * Recorre el alcance elegido y ejecuta las comprobaciones activas sobre cada nodo.
 * El recorrido es iterativo (sin recursión) y cede el hilo periódicamente.
 */
export async function runAudit(scope: Scope, settings: Settings, opts: AuditOptions = {}): Promise<AuditResult> {
  const t0 = Date.now();
  const ctx = new AuditContext(settings, opts.lang);
  // Las capas que se van a recorrer dicen qué colecciones usan: así se descubren los kits de Figma, que no salen
  // entre las bibliotecas. Al revisar de nuevo ya se conocen, de la auditoría.
  const groups = await collectRoots(scope, opts);
  await ctx.init({ scan: opts.recheck ? [] : groups.flatMap((g) => g.roots) });
  const timings: Record<string, number> = {};
  /** Suma a `timings` lo que tarda un tramo, si se mide. */
  const timed = async <T>(label: string, work: () => Promise<T> | T): Promise<T> => {
    if (!opts.profile) return work();
    const t = Date.now();
    try {
      return await work();
    } finally {
      timings[label] = (timings[label] ?? 0) + Date.now() - t;
    }
  };
  if (opts.profile) timings.init = Date.now() - t0;
  const enabled = CHECKS.filter((c) => settings.enabled[c.meta.id]);
  const placedChecks = enabled.filter((c) => c.placed);
  // Qué se mira de una instancia sin entrar en ella: los campos sobrescritos que interesan a alguna regla.
  const walk: Walk = {
    internals: settings.includeInstanceInternals,
    placed: placedChecks.length > 0,
    overrides: new Set(enabled.flatMap((c) => c.overrides ?? [])),
  };
  /** Reglas de una capa según cómo se llegó a ella: entera, o solo por lo que depende de su instancia. */
  const checksFor = (e: Entry) =>
    e.shell || e.placed || e.overridden
      ? enabled.filter((c) => (e.shell && c.instanceSlots) || (e.placed && c.placed) || (e.overridden && c.overrides))
      : enabled;
  // La propia página se revisa al auditar páginas o el archivo, o si se vuelve a revisar; una selección no la incluye.
  const allPageChecks = enabled.filter((c) => c.runPage);
  const pageChecks = scope !== 'selection' && !opts.roots && !opts.recheck ? allPageChecks : [];
  const targets = new Map((opts.recheck ?? []).map((t) => [t.nodeId, t]));
  const internals = settings.includeInstanceInternals;
  const max = opts.maxPerCheck ?? 1000;
  const yieldMs = opts.yieldMs ?? 100;
  const pause = opts.pause ?? tick;
  let lastYield = Date.now();
  const perCheck = new Map<CheckId, number>();
  const truncated = new Set<CheckId>();
  const findings: Finding[] = [];
  let scanned = 0;
  let cancelled = false;
  let looseNodes = 0;
  // El mismo texto de un componente con el mismo resultado en varias instancias sale una vez, con la cuenta.
  const repeats = new Map<string, { finding: Finding; count: number }>();
  const repeated = (f: Finding) => {
    const key = `${f.checkId}|${f.nodeId.slice(f.nodeId.lastIndexOf(';') + 1)}|${f.message}`;
    const seen = repeats.get(key);
    if (seen) {
      seen.count++;
      // Dónde más sale, para volver a revisarlas todas.
      (seen.finding.alsoAt ??= []).push(f.nodeId);
    } else repeats.set(key, { finding: f, count: 1 });
    return !!seen;
  };

  // Es un ajuste global del sandbox: se restaura al terminar para no alterar a quien lo comparta.
  const prevSkip = figma.skipInvisibleInstanceChildren;
  figma.skipInvisibleInstanceChildren = !settings.includeHidden;
  try {
    const visited = new Set<string>();
    pages: for (const { page, roots, pageTarget } of groups) {
      // Los slots de la página, de una vez: sin ninguno, las instancias no los buscan una a una. Al revisar de
      // nuevo unas pocas capas no compensa recorrer la página entera.
      if (!opts.recheck) await timed('slots', () => ctx.noteSlots(page));
      // Los textos de las instancias, también de una vez, si se recorre la página entera: con una selección
      // pequeña sale más barato buscarlos instancia por instancia.
      if (!opts.recheck && scope !== 'selection' && walk.placed) await timed('descend', () => ctx.noteTexts(page));
      for (const check of opts.recheck ? (pageTarget ? allPageChecks : []) : pageChecks) {
        try {
          const result = await check.runPage!(page, ctx);
          if (result && result.length) {
            findings.push(...result);
            perCheck.set(check.meta.id, (perCheck.get(check.meta.id) ?? 0) + result.length);
          }
        } catch (e) {
          if (__DEV__) console.warn(`[dod-lint] ${check.meta.id} falló en la página ${page.name}:`, e);
        }
      }
      const stack: Entry[] = [];
      for (let i = roots.length - 1; i >= 0; i--) {
        const root = roots[i];
        const scope = ctx.scopeOf(root, internals);
        const target = targets.get(root.id);
        const how: NodeScope = target?.placed ? { placed: true } : {};
        // Una capa a la que se llegó por su instancia (un texto, algo sobrescrito) se vuelve a mirar igual, con lo
        // que la instancia le sobrescriba ahora. Si ya no le sobrescribe nada, sus hallazgos desaparecen; los de
        // un slot se quedan en sus reglas.
        if ((target?.placed || target?.overridden) && !internals && scope.owner && (await ctx.overrideIn(scope.owner, root, walk.overrides))) how.overridden = true;
        if (target?.overridden && !internals && !how.placed && !how.overridden && !scope.shell) continue;
        stack.push({ node: root, ...scope, ...how });
      }
      while (stack.length) {
        const entry = stack.pop()!;
        const node = entry.node;
        let skip: boolean;
        try {
          // Con una selección que incluye un nodo y a un descendiente suyo, el descendiente llegaría dos veces.
          // Una capa oculta que puede aparecer (la muestra una propiedad booleana o una variable) se audita igual.
          skip = visited.has(node.id) || (!settings.includeHidden && !ctx.prop<boolean>(node, 'visible') && !ctx.revealable(node)) || ctx.isIgnored(node);
        } catch {
          skip = true; // una capa que ya no se puede leer no debe tumbar la auditoría
        }
        if (skip) continue;
        visited.add(node.id);
        scanned++;
        if (entry.anchor) looseNodes++;

        let content: SlotContent | null = null;
        if (entry.owner && ctx.isSlot(node)) {
          try {
            content = ctx.slotContent(node);
          } catch (e) {
            if (__DEV__) console.warn(`[dod-lint] no se pudo leer el slot ${node.name}:`, e);
          }
        } else if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && ctx.parentOf(node)?.type !== 'COMPONENT_SET')) {
          await timed('slots', () => ctx.slotsUnder(node)); // para que las reglas reconozcan sus slots aunque el objeto diga FRAME
        }

        // Lo que la raíz de una instancia marca como sobrescrito, comparado con su componente.
        if (node.type === 'INSTANCE' && !internals && !entry.overridden) {
          try {
            await timed('compare', () => ctx.compareRoot(node, walk.overrides));
          } catch (e) {
            if (__DEV__) console.warn(`[dod-lint] no se pudo comparar ${node.name} con su componente:`, e);
          }
        }
        for (const check of checksFor(entry)) {
          const count = perCheck.get(check.meta.id) ?? 0;
          if (count >= max) {
            truncated.add(check.meta.id);
            continue;
          }
          let result: Finding[] | null = null;
          try {
            const t = opts.profile ? Date.now() : 0;
            result = await check.run(node, ctx, page);
            if (opts.profile) timings[check.meta.id] = (timings[check.meta.id] ?? 0) + Date.now() - t;
          } catch (e) {
            // Un fallo puntual en un nodo no debe tumbar la auditoría entera.
            if (__DEV__) console.warn(`[dod-lint] ${check.meta.id} falló en ${node.name}:`, e);
          }
          if (result && result.length) {
            if (entry.inherited) for (const f of result) delete f.fix;
            if (entry.anchor) for (const f of result) if (f.nodeId === node.id) anchorTo(f, entry.anchor, ctx);
            if (entry.placed && check.placed) {
              result = result.filter((f) => !repeated(f));
              for (const f of result) f.ignoreKey = placedKeyOf(f.checkId, f.nodeId);
            } else if (entry.overridden && check.overrides) {
              for (const f of result) if (f.nodeId === node.id) f.overridden = true;
            }
            findings.push(...result);
            // Lo que quizá no se avise (ver `AuditContext.unscaled`) no cuenta para el tope.
            perCheck.set(check.meta.id, count + result.filter((f) => !ctx.unscaled.has(f)).length);
          }
        }

        // Al revisar de nuevo solo se baja desde las capas `deep`, y todo lo que cuelga de ellas lo hereda.
        const deep = !opts.recheck || entry.deep || !!targets.get(node.id)?.deep;
        if (deep) {
          const from = stack.length;
          try {
            await timed('descend', () => descend(stack, entry, content, ctx, walk));
          } catch (e) {
            if (__DEV__) console.warn(`[dod-lint] no se pudo entrar en ${node.name}:`, e);
          }
          if (opts.recheck) for (let i = from; i < stack.length; i++) stack[i].deep = true;
        }
        if (Date.now() - lastYield >= yieldMs) {
          opts.onProgress?.(scanned, findings.length);
          await pause();
          lastYield = Date.now();
          if (opts.shouldStop?.()) {
            cancelled = true;
            break pages;
          }
        }
      }
    }
  } finally {
    figma.skipInvisibleInstanceChildren = prevSkip;
  }
  for (const { finding, count } of repeats.values()) {
    if (count > 1) finding.message += ctx.tx({ es: ` (se repite en ${count} instancias)`, en: ` (repeated in ${count} instances)` });
  }
  const { kept, untokenized } = withoutUnusedTokens(findings, ctx, settings, opts, max, truncated);
  const ignored = readIgnored();
  for (const f of kept) if (ignored[f.ignoreKey]) f.ignored = true;

  opts.onProgress?.(scanned, kept.length);
  return {
    findings: kept,
    scanned,
    pages: groups.length,
    durationMs: Date.now() - t0,
    truncated: [...truncated],
    skippedContrast: ctx.skippedContrast,
    cancelled,
    looseNodes,
    untokenized,
    ...(opts.profile ? { timings: { ...timings, walk: Date.now() - t0 - Object.values(timings).reduce((a, b) => a + b, 0) } } : {}),
  };
}
