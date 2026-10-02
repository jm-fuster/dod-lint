import type { CollectionInfo, Finding, FixHint, Severity, Settings } from './types';
import type { CheckMeta } from './types';
import { resolveLang } from './i18n';
import type { Lang, Text } from './i18n';
import { findNode } from './nodes';
import { ignoreKeyOf } from './ignore';
import { DISABLED_VARIANT, DISABLED_WORD, INTERACTIVE_PATTERN, KIND_NAME, NON_SPATIAL, NOT_A_CONTROL, PRIMITIVE_NAME, fold, stripAccents, wordsRe } from './names';
import { libraryVariables } from './library';
import type { FloatKind } from './names';

export type { FloatKind } from './names';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Uso de un color, con el nombre del ámbito de Figma que lo cubre. */
export type ColorUse = 'FRAME_FILL' | 'SHAPE_FILL' | 'TEXT_FILL' | 'STROKE_COLOR';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function colorEq(a: RGBA, b: RGBA): boolean {
  const t = 1 / 255 + 1e-6;
  return Math.abs(a.r - b.r) <= t && Math.abs(a.g - b.g) <= t && Math.abs(a.b - b.b) <= t && Math.abs(a.a - b.a) <= 0.011;
}

export function toHex(c: RGBA): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0').toUpperCase();
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a < 0.995 ? `${base} ${Math.round(c.a * 100)}%` : base;
}

type NodeWithModes = SceneNode & { resolvedVariableModes?: Record<string, string> };

function isAlias(value: unknown): value is VariableAlias {
  return typeof value === 'object' && value !== null && 'type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS';
}

function isRGB(value: unknown): value is RGB | RGBA {
  const c = value as RGB;
  return typeof value === 'object' && value !== null && typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number';
}

/**
 * Color compuesto (actualización 139 de la API, septiembre de 2026): un color y una opacidad aparte, de 0 a
 * 100, y al menos uno de los dos es un alias. No lleva campo `type`.
 */
interface ComposedColor {
  color: RGB | RGBA | VariableAlias;
  opacity: number | VariableAlias;
}

function isComposed(value: unknown): value is ComposedColor {
  return typeof value === 'object' && value !== null && 'color' in value && 'opacity' in value;
}

/** Variables a las que remite un valor: la de un alias, o las del color y la opacidad de uno compuesto. */
function aliasIds(value: VariableValue): string[] {
  if (isAlias(value)) return [value.id];
  if (isComposed(value)) return [value.color, value.opacity].filter(isAlias).map((a) => a.id);
  return [];
}

/** Variable de la que sale el color de un valor: la de un alias, o la del color de uno compuesto. */
function colorTarget(value: VariableValue): string {
  if (isAlias(value)) return value.id;
  return isComposed(value) && isAlias(value.color) ? value.color.id : '';
}

/**
 * Ámbitos de tamaño: una variable con alguno, aunque no sea del tipo del campo, se nombra como parecida. Un radio
 * no dice nada de un padding, ni un gap de un radio: en Material 3, cada padding nombraba un token Corner.
 */
const SIZE_SCOPES: Record<FloatKind, Set<string>> = {
  spacing: new Set(['ALL_SCOPES', 'GAP', 'WIDTH_HEIGHT']),
  radius: new Set(['ALL_SCOPES', 'CORNER_RADIUS', 'WIDTH_HEIGHT']),
};

export type PropertyDefinition = ComponentPropertyDefinitions[string];

/**
 * Lo que las reglas leen de una variable, leído una vez por auditoría. Cada lectura de una propiedad cruza
 * al hilo de Figma (medido en un sistema de pruebas en septiembre de 2026: 35-65 µs), y hay bucles que pasan por
 * todas las variables en cada pintura.
 */
interface VarInfo {
  collectionId: string;
  valuesByMode: Record<string, VariableValue>;
  scopes: VariableScope[];
  name: string;
  resolvedType: VariableResolvedDataType;
}

/** Una colección con más de un modo en la que se puede revisar un color. */
export interface ModeAxis {
  collectionId: string;
  modes: { modeId: string; name: string }[];
}

/** Hijos de un slot de instancia, separados por quién los puso. */
export interface SlotContent {
  /** Contenido puesto en esta instancia: el slot está sobrescrito y ya no sigue al componente. */
  owned: SceneNode[];
  /** Contenido por defecto del componente, que se audita en el propio componente. */
  inherited: SceneNode[];
}

/** Lo que el recorrido sabe de una capa por el camino hasta ella. */
export interface NodeScope {
  /**
   * Instancia colocada (en el lienzo o dentro de un slot sobrescrito) cuyo componente define la capa.
   * Vacío si la capa es contenido libre.
   */
  owner?: InstanceNode;
  /** Slot de una instancia al que se llega sin entrar en ella: solo lo revisan las reglas de slots. */
  shell?: boolean;
  /**
   * Texto de una instancia al que se llega sin entrar en ella: solo lo revisan las reglas que dependen de
   * dónde está colocada la instancia (el contraste).
   */
  placed?: boolean;
  /**
   * Capa de dentro de una instancia que esta sobrescribe, a la que se llega sin entrar en la instancia: solo
   * la revisan las reglas de lo sobrescrito, y solo en esos campos (ver `AuditContext.overriddenLayers`).
   */
  overridden?: boolean;
  /** Capa del contenido por defecto de un slot de instancia: corregirla sobrescribiría el slot entero. */
  inherited?: boolean;
  /**
   * Si la capa es, o cuelga de, una que Figma devolvió suelta (sin padre, ver `slotHost`), la última capa
   * de la página por encima. Sus hallazgos se ubican y se seleccionan por ella, y no se ofrece corregirlos.
   */
  anchor?: SceneNode;
}

/** Coletilla de los hallazgos que salen de lo que sobrescribe una instancia. */
export const OVERRIDE_NOTE: Text = { es: ' (override en instancia)', en: ' (instance override)' };

/**
 * Los campos sobrescritos que cambian de verdad respecto a la capa de la que salen. Figma marca a veces un
 * campo que vale lo mismo que en el componente (medido en un sistema de pruebas en septiembre de 2026: 10 de 11
 * `textAutoResize` y 30 de 529 rellenos), y avisar de él repetiría lo que ya sale en el componente. Solo se
 * comparan los campos dados; sin la capa de origen, cuentan todos. La auditoría lee con su caché (`ctx.prop`):
 * la capa del componente es la misma para todas sus instancias, y las reglas vuelven a leer los mismos campos de
 * la capa sobrescrita. Leídos a pelo, en Sliders de Material 3 eran 7,5 de sus 20 s (octubre de 2026).
 */
export function changedFields(
  layer: BaseNode,
  fields: readonly string[],
  source: BaseNode | null,
  compared: ReadonlySet<string>,
  read: (n: BaseNode, f: string) => unknown = (n, f) => (n as unknown as Record<string, unknown>)[f],
): Set<string> {
  return new Set(
    fields.filter((f) => {
      if (!source || !compared.has(f)) return true;
      try {
        const [a, b] = [read(layer, f), read(source, f)];
        return typeof a === 'symbol' || typeof b === 'symbol' || JSON.stringify(a) !== JSON.stringify(b);
      } catch {
        return true;
      }
    }),
  );
}

/** Un nombre sin mayúsculas y con cualquier separador como "/": "Color · color/red" es "color/color/red". */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s/\\\-_.·:|,]+/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Clave de la propiedad SLOT que declara una capa de slot (p. ej. "Content#7:1"). */
export function slotKeyOf(node: BaseNode): string | null {
  try {
    const refs = (node as SceneNode).componentPropertyReferences as Record<string, string> | null;
    return refs?.slotContentId ?? null;
  } catch {
    return null;
  }
}

/** Nombre visible de una propiedad de componente, sin el sufijo "#id". */
export function propertyName(key: string): string {
  return key.split('#')[0];
}

/**
 * Separa los hijos de un slot de instancia por su id (medido en septiembre de 2026). El contenido
 * heredado es un subnodo más de la instancia, `I<instancia>;…;<capa>`, sin el slot en la ruta. Al
 * tocar una sola capa, Figma sobrescribe el slot entero y rehace su contenido con ids que cuelgan
 * del slot, `<slot>;<capa>`; lo insertado desde un plugin conserva además su id suelto hasta que se
 * recarga el archivo.
 */
export function slotContentOf(slot: SlotNode): SlotContent {
  const out: SlotContent = { owned: [], inherited: [] };
  const prefix = `${slot.id};`;
  for (const k of slot.children) (k.id.startsWith(prefix) || !k.id.startsWith('I') ? out.owned : out.inherited).push(k);
  return out;
}

/**
 * Estado compartido de una auditoría: variables locales, colecciones primitivas,
 * escala numérica, cachés de resolución y utilidades de nombres.
 */
export class AuditContext {
  readonly settings: Settings;
  /** Idioma de los mensajes de los hallazgos. */
  readonly lang: Lang;
  collections: VariableCollection[] = [];
  localVars: Variable[] = [];
  /** Variables y colecciones de las bibliotecas activadas, ya importadas (ver `init`). */
  libraryVars: Variable[] = [];
  libraryCollections: VariableCollection[] = [];
  /** Nombre de la biblioteca de cada colección suya, por id. */
  private libraryNames = new Map<string, string>();
  /** Ids de las colecciones que vienen de una biblioteca. */
  private libraryIds = new Set<string>();
  /** Ids de las colecciones que vienen de un kit que usa el archivo (ver `fromKit`). */
  private kitIds = new Set<string>();
  /** Si el archivo o sus bibliotecas tienen numéricas propias para cada tipo de campo (ver `withoutKits`). */
  private ownFloats = new Map<FloatKind, boolean>();
  primitiveIds = new Set<string>();
  semanticColorVars: Variable[] = [];
  /** Semánticas de color que apuntan a otra variable, o a un valor, distinto según el modo. */
  switchers: Variable[] = [];
  /** Variables que una de `switchers` de otra colección elige según el modo (brand/light en claro). */
  modeOptions = new Set<string>();
  /**
   * Colecciones hechas sobre todo de esas opciones: capas intermedias, como la de rol de un sistema
   * encadenado. Sus variables no se consumen solas; se llega a ellas desde la que las elige.
   */
  intermediate = new Set<string>();
  floatVars: Variable[] = [];
  interactiveRe: RegExp;
  /** Nodos de contraste que no se pudieron evaluar (sin fondo sólido determinable). */
  skippedContrast = 0;
  /**
   * Si alguna capa recorrida tiene un campo de espaciado o de radio enlazado a una variable, local o de una
   * biblioteca: entonces se usan esos tokens, y lo escrito a mano se avisa capa a capa (ver `unscaled`).
   */
  readonly tokenUse: Record<FloatKind, boolean> = { spacing: false, radius: false };
  /**
   * Hallazgos de espaciado o de radio de un tipo del que el archivo no tiene variables: «sin token», sin ninguna a
   * la que enlazarlo. Si tampoco se ve ninguna capa enlazada (`tokenUse`), la auditoría los quita al terminar y lo
   * dice una nota. No cuentan para el tope de cada regla.
   */
  readonly unscaled = new Map<Finding, FloatKind>();

  private varCache = new Map<string, Variable | null>();
  private styleCache = new Map<string, BaseStyle | null>();
  private collCache = new Map<string, VariableCollection | null>();
  private colorMemo = new Map<string, RGBA | null>();
  private floatMemo = new Map<string, number | null>();
  private fieldMemo = new Map<string, { preferred: Variable[]; others: Variable[] }>();
  private sigMemo = new Map<string, string>();
  private infoMemo = new Map<string, VarInfo>();
  /** Propiedades ya leídas de cada capa en esta auditoría (ver `prop`). */
  private props = new Map<string, unknown>();
  private parentMemo = new Map<string, BaseNode | null>();
  private pathMemo = new Map<string, string>();
  private modesMemo = new Map<string, Record<string, string>>();
  private defaultModes = new Map<string, string | null>();
  private scaleByKind = new Map<FloatKind, Set<number>>();
  /** Valores numéricos de cada variable FLOAT en todos sus modos, con los alias ya seguidos. */
  private floatValues = new Map<string, number[]>();
  private mainMemo = new Map<string, ComponentNode | null>();
  private defsMemo = new Map<string, ComponentPropertyDefinitions | null>();
  private slotMemo = new Map<string, SlotContent>();
  /** Ids que `findAllWithCriteria` devolvió como SLOT (ver `isSlot`). */
  private knownSlots = new Set<string>();
  /** La página que se recorre no tiene ningún slot (ver `noteSlots`). */
  private slotlessPage = false;
  /** Los textos de la página que se recorre, por instancia que los contiene (ver `noteTexts`). */
  private textsByInstance: Map<string, TextNode[]> | null = null;
  private slotsMemo = new Map<string, SlotNode[]>();
  private hostMemo = new Map<string, InstanceNode | ComponentNode | null>();
  private kidsMemo = new Map<string, readonly SceneNode[]>();
  private variantsMemo = new Map<string, number>();
  private nodeMemo = new Map<string, BaseNode | null>();
  /** Campos que una instancia sobrescribe en las capas de dentro a las que se llega por eso. */
  private overridden = new Map<string, Set<string>>();
  /** Campos que la raíz de cada instancia sobrescribe y que cambian de verdad (ver `compareRoot`). */
  private rootOverrides = new Map<string, Set<string>>();
  /** Capas de cada componente principal por id, leídas una vez por auditoría. */
  private mainLayers = new Map<string, Map<string, SceneNode>>();
  /** Lo que cada instancia marca como sobrescrito, por capa, leído una vez por auditoría. */
  private overridesMemo = new Map<string, Map<string, readonly string[]>>();
  // Para revisar el color en otros modos (ver `modeAxes` y `resolveColorIn`).
  private pinnedMemo = new Map<string, Set<string>>();
  private reachMemo = new Map<string, Set<string>>();
  private collModesMemo = new Map<string, ModeAxis['modes']>();
  private inMemo = new Map<string, RGBA | null>();
  private trustMemo = new Map<string, boolean>();
  private modeKeyMemo = new Map<string, string>();

  constructor(settings: Settings, lang: Lang = resolveLang(settings.language)) {
    this.settings = settings;
    this.lang = lang;
    this.interactiveRe = compilePattern(settings.interactivePattern);
  }

  /** Un texto en el idioma de la auditoría. */
  tx(text: Text): string {
    return text[this.lang];
  }

  /**
   * Una propiedad de una capa, leída una vez por auditoría. Varias reglas miran los mismos rellenos, trazos,
   * estilos y variables enlazadas, y cada lectura cruza al hilo de Figma (medido en un sistema de pruebas en
   * septiembre de 2026: 130 µs `boundVariables`, 255 µs `fills`, 50 µs `name`). La auditoría solo lee, así
   * que lo leído no caduca; las correcciones leen siempre de la capa.
   */
  prop<T>(node: BaseNode, key: string): T {
    const k = `${node.id}|${key}`;
    if (this.props.has(k)) return this.props.get(k) as T;
    const value = (node as unknown as Record<string, unknown>)[key] as T;
    this.props.set(k, value);
    return value;
  }

  /** El padre de una capa, leído una vez por auditoría: las rutas y los ancestros se repasan por cada hallazgo. */
  parentOf(node: BaseNode): BaseNode | null {
    let parent = this.parentMemo.get(node.id);
    if (parent === undefined) {
      parent = node.parent;
      this.parentMemo.set(node.id, parent);
    }
    return parent;
  }

  private infoOf(v: Variable): VarInfo {
    let info = this.infoMemo.get(v.id);
    if (!info) {
      info = { collectionId: v.variableCollectionId, valuesByMode: v.valuesByMode, scopes: v.scopes ?? [], name: v.name, resolvedType: v.resolvedType };
      this.infoMemo.set(v.id, info);
    }
    return info;
  }

  /**
   * Lee las variables y colecciones propias del archivo y, salvo `libraries: false`, también las de sus bibliotecas
   * activadas y las de los kits que usa (ver `libraryVariables`): con ellas se proponen correcciones y se saca la
   * escala como con las propias. Los kits se descubren en `scan`, las capas que se van a recorrer: cada una dice qué
   * colecciones usa dentro (`resolvedVariableModes`), y leerlo no cuesta casi nada.
   */
  async init(opts: { libraries?: boolean; scan?: readonly SceneNode[] } = {}): Promise<void> {
    this.collections = await figma.variables.getLocalVariableCollectionsAsync();
    this.localVars = await figma.variables.getLocalVariablesAsync();
    let library: Awaited<ReturnType<typeof libraryVariables>> | null = null;
    if (opts.libraries !== false) {
      const local = new Set(this.collections.map((c) => c.id));
      const used = new Set<string>();
      for (const node of opts.scan ?? []) for (const id of Object.keys(this.modesOf(node))) if (!local.has(id)) used.add(id);
      // De un kit, solo los tipos que el archivo y sus bibliotecas no tienen (ver `fromKit`).
      const missing = (fromLibraries: readonly Variable[]) => {
        const mine = [...this.localVars, ...fromLibraries];
        const floats = mine.filter((v) => this.infoOf(v).resolvedType === 'FLOAT');
        const types = new Set<string>();
        if (!mine.some((v) => this.infoOf(v).resolvedType === 'COLOR')) types.add('COLOR');
        if (!floats.some((v) => this.fitsKind(v, 'spacing')) || !floats.some((v) => this.fitsKind(v, 'radius'))) types.add('FLOAT');
        return types;
      };
      library = await libraryVariables(new Set(this.collections.map((c) => c.key)), used, missing);
    }
    for (const v of this.localVars) this.varCache.set(v.id, v);
    for (const c of this.collections) this.collCache.set(c.id, c);
    // Lo que ya es del archivo no cuenta dos veces: repetida, una variable empataría consigo misma y no se propondría.
    this.libraryVars = (library?.variables ?? []).filter((v) => !this.varCache.has(v.id));
    this.libraryCollections = (library?.collections ?? []).filter((c) => !this.collCache.has(c.id));
    this.libraryIds = new Set(this.libraryCollections.map((c) => c.id));
    this.kitIds = new Set(this.libraryCollections.filter((c) => library?.kits.has(c.id)).map((c) => c.id));
    this.libraryNames = new Map();
    // Vacío si viene de un kit, que no dice de qué biblioteca es.
    for (const c of this.libraryCollections) this.libraryNames.set(c.id, library?.libraryOf.get(c.id) ?? '');
    for (const v of this.libraryVars) this.varCache.set(v.id, v);
    for (const c of this.libraryCollections) this.collCache.set(c.id, c);
    const vars = this.allVars();
    const collections = this.allCollections();
    // Las de una biblioteca suelen apuntar a sus primitivas, aunque estén ocultas: se traen una vez, para seguir sus
    // alias a mano (el contraste en otros modos) como con las propias.
    await this.preloadAliases(this.libraryVars);

    if (this.settings.primitiveAuto) {
      this.primitiveIds = new Set(collections.filter((c) => this.looksPrimitive(c)).map((c) => c.id));
      // Si todo parece primitivo no hay capa semántica: la comprobación de primitivas no tiene sentido.
      if (collections.length && this.primitiveIds.size === collections.length) this.primitiveIds.clear();
    } else {
      this.primitiveIds = new Set(this.settings.primitiveCollectionIds.filter((id) => this.collCache.has(id)));
    }

    this.semanticColorVars = vars.filter(
      (v) => this.infoOf(v).resolvedType === 'COLOR' && !this.primitiveIds.has(this.infoOf(v).collectionId),
    );
    // Los colores de un kit, solo si el archivo y sus bibliotecas no tienen ninguno (ver `fromKit`).
    if (this.kitIds.size && this.semanticColorVars.some((v) => !this.fromKit(v))) {
      this.semanticColorVars = this.semanticColorVars.filter((v) => !this.fromKit(v));
    }
    for (const v of this.semanticColorVars) {
      const targets = new Set(Object.values(this.infoOf(v).valuesByMode).map(colorTarget));
      if (targets.size < 2) continue;
      this.switchers.push(v);
      for (const id of targets) {
        const target = id ? this.varCache.get(id) : null;
        if (id && (target ? this.infoOf(target).collectionId : undefined) !== this.infoOf(v).collectionId) this.modeOptions.add(id);
      }
    }
    for (const c of collections) {
      const colors = this.semanticColorVars.filter((v) => this.infoOf(v).collectionId === c.id);
      const options = colors.filter((v) => this.modeOptions.has(v.id)).length;
      if (options * 2 > colors.length) this.intermediate.add(c.id);
    }
    this.floatVars = vars.filter((v) => this.infoOf(v).resolvedType === 'FLOAT');
    for (const v of this.floatVars) {
      const values = await this.numericValues(v);
      this.floatValues.set(v.id, values);
    }
  }

  /** Las variables propias y las de las bibliotecas activadas. */
  private allVars(): Variable[] {
    return this.libraryVars.length ? [...this.localVars, ...this.libraryVars] : this.localVars;
  }

  /** Las colecciones propias y las de las bibliotecas activadas, en ese orden. */
  private allCollections(): VariableCollection[] {
    return this.libraryCollections.length ? [...this.collections, ...this.libraryCollections] : this.collections;
  }

  /** Trae, una vez, las variables a las que apuntan estas, y las de más abajo. */
  private async preloadAliases(vars: readonly Variable[], depth = 0): Promise<void> {
    if (depth > 8 || !vars.length) return;
    const next: Variable[] = [];
    for (const v of vars) {
      for (const value of Object.values(this.infoOf(v).valuesByMode)) {
        for (const id of aliasIds(value)) {
          if (this.varCache.has(id)) continue;
          const target = await this.getVariable(id);
          if (target) next.push(target);
        }
      }
    }
    await this.preloadAliases(next, depth + 1);
  }

  /**
   * Valores que puede tomar una variable numérica en cualquiera de sus modos, siguiendo los alias.
   * En muchos sistemas los tokens de espaciado y radio apuntan a primitivas y no llevan el número
   * escrito; sin seguirlos, la escala se queda sin sus pasos.
   */
  private async numericValues(v: Variable, seen = new Set<string>()): Promise<number[]> {
    if (seen.has(v.id)) return [];
    seen.add(v.id);
    const out: number[] = [];
    for (const value of Object.values(this.infoOf(v).valuesByMode)) {
      if (typeof value === 'number') {
        out.push(value);
      } else if (isAlias(value)) {
        const target = await this.getVariable(value.id);
        if (target) out.push(...(await this.numericValues(target, seen)));
      }
    }
    return out;
  }

  /**
   * Oculta de publicación. Una colección de biblioteca está publicada (si no, no se vería), aunque en el archivo que
   * la usa Figma la dé por oculta: visto el 02-10-2026 con las dos de FlySplit, en contra de lo que dice su API.
   */
  private isHidden(c: VariableCollection): boolean {
    return !this.libraryIds.has(c.id) && c.hiddenFromPublishing;
  }

  /** Una colección es primitiva si (está oculta o su nombre lo sugiere) y ninguna de sus variables es un alias. */
  private looksPrimitive(c: VariableCollection): boolean {
    const candidate = this.isHidden(c) || PRIMITIVE_NAME.test(fold(c.name));
    if (!candidate) return false;
    return !this.hasAliases(c);
  }

  private hasAliases(c: VariableCollection): boolean {
    const sample = this.allVars().filter((v) => this.infoOf(v).collectionId === c.id).slice(0, 60);
    return sample.some((v) => Object.values(this.infoOf(v).valuesByMode).some((val) => aliasIds(val).length > 0));
  }

  collectionsInfo(): CollectionInfo[] {
    const all = this.allVars();
    return this.allCollections().map((c) => {
      const vars = all.filter((v) => this.infoOf(v).collectionId === c.id);
      const library = this.libraryNames.get(c.id);
      return {
        id: c.id,
        name: c.name,
        hidden: this.isHidden(c),
        colorCount: vars.filter((v) => this.infoOf(v).resolvedType === 'COLOR').length,
        floatCount: vars.filter((v) => this.infoOf(v).resolvedType === 'FLOAT').length,
        modeNames: c.modes.map((m) => m.name),
        isPrimitive: this.primitiveIds.has(c.id),
        ...(library !== undefined ? { library } : {}),
      };
    });
  }

  isPrimitive(collectionId: string): boolean {
    return this.primitiveIds.has(collectionId);
  }

  /** Nombre de una variable, leído una vez por auditoría: los mensajes lo repiten por hallazgo. */
  varName(v: Variable): string {
    return this.infoOf(v).name;
  }

  /**
   * ¿Es la capa una muestra que documenta esa variable? En una paleta, la muestra de cada primitiva va
   * enlazada a ella a propósito, y ella o uno de sus tres ancestros más cercanos acaba con su nombre
   * («Color · color/red», en un sistema de pruebas en septiembre de 2026). Se exige que el nombre acabe así para
   * que la muestra de color/red-dark no tape un enlace equivocado a color/red.
   */
  documents(node: SceneNode, v: Variable): boolean {
    const wanted = normalizeName(this.varName(v));
    if (!wanted) return false;
    let cur: BaseNode | null = node;
    for (let depth = 0; cur && depth < 4 && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT'; depth++, cur = this.parentOf(cur)) {
      const name = normalizeName(this.prop<string>(cur, 'name') ?? '');
      if (name === wanted || name.endsWith(`/${wanted}`)) return true;
    }
    return false;
  }

  /** ¿Es de una colección primitiva? */
  isPrimitiveVar(v: Variable): boolean {
    return this.primitiveIds.has(this.infoOf(v).collectionId);
  }

  async getVariable(id: string): Promise<Variable | null> {
    if (this.varCache.has(id)) return this.varCache.get(id)!;
    let v: Variable | null = null;
    try {
      v = await figma.variables.getVariableByIdAsync(id);
    } catch {
      v = null;
    }
    this.varCache.set(id, v);
    return v;
  }

  async getStyle(id: string): Promise<BaseStyle | null> {
    if (this.styleCache.has(id)) return this.styleCache.get(id)!;
    let s: BaseStyle | null = null;
    try {
      s = await figma.getStyleByIdAsync(id);
    } catch {
      s = null;
    }
    this.styleCache.set(id, s);
    return s;
  }

  async getCollection(id: string): Promise<VariableCollection | null> {
    if (this.collCache.has(id)) return this.collCache.get(id)!;
    let c: VariableCollection | null = null;
    try {
      c = await figma.variables.getVariableCollectionByIdAsync(id);
    } catch {
      c = null;
    }
    this.collCache.set(id, c);
    return c;
  }

  /**
   * Modos con los que un nodo resuelve cada colección, leídos una vez por auditoría. Figma los calcula en
   * cada lectura, y la regla de primitivas los consulta una vez por variable semántica.
   */
  private modesOf(node: SceneNode): Record<string, string> {
    let modes = this.modesMemo.get(node.id);
    if (!modes) {
      try {
        modes = (node as NodeWithModes).resolvedVariableModes ?? {};
      } catch {
        modes = {};
      }
      this.modesMemo.set(node.id, modes);
    }
    return modes;
  }

  /** Modo con el que un nodo resuelve una colección: explícito en un ancestro o el modo por defecto. */
  modeIdFor(node: SceneNode, collectionId: string): string | null {
    const resolved = this.modesOf(node);
    if (resolved[collectionId]) return resolved[collectionId];
    // El modo por defecto, leído una vez por colección: también cruza al hilo de Figma, y se pide por variable.
    let mode = this.defaultModes.get(collectionId);
    if (mode === undefined) {
      mode = this.collCache.get(collectionId)?.defaultModeId ?? null;
      this.defaultModes.set(collectionId, mode);
    }
    return mode;
  }

  /**
   * Firma completa de modos del nodo. Una variable puede resolver a valores distintos según el modo
   * de CUALQUIER colección de su cadena de alias, así que la caché no puede mirar solo la suya.
   */
  private modeSignature(node: SceneNode): string {
    const cached = this.sigMemo.get(node.id);
    if (cached !== undefined) return cached;
    const modes = this.modesOf(node);
    const sig = Object.keys(modes)
      .sort()
      .map((k) => `${k}=${modes[k]}`)
      .join('|');
    this.sigMemo.set(node.id, sig);
    return sig;
  }

  resolveColor(v: Variable, node: SceneNode, depth = 0): RGBA | null {
    const key = `${v.id}:${this.modeSignature(node)}`;
    if (this.colorMemo.has(key)) return this.colorMemo.get(key)!;
    let out: RGBA | null = null;
    try {
      const r = v.resolveForConsumer(node);
      if (r.resolvedType === 'COLOR') out = this.flatColor(r.value, node, depth);
    } catch {
      out = null;
    }
    this.colorMemo.set(key, out);
    return out;
  }

  /**
   * Un color resuelto como RGBA. Figma devuelve los colores compuestos ya aplanados, con la opacidad en el alfa
   * (medido en un sistema de pruebas el 30-09-2026: 50 da 0,5). Los tipos permiten que llegue el compuesto crudo: entonces
   * se resuelven aquí su color y su opacidad, que va de 0 a 100 y multiplica el alfa del color. Cualquier otra
   * cosa no se puede evaluar: mejor null que un contraste de NaN:1.
   */
  private flatColor(value: VariableValue, node: SceneNode, depth: number): RGBA | null {
    if (isRGB(value)) return { r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 };
    if (!isComposed(value) || depth > 8) return null;
    const inner = (alias: VariableAlias) => this.varCache.get(alias.id) ?? null;
    let base: RGBA | null = null;
    if (isRGB(value.color)) base = this.flatColor(value.color, node, depth + 1);
    else if (isAlias(value.color)) {
      const v = inner(value.color);
      base = v ? this.resolveColor(v, node, depth + 1) : null;
    }
    let opacity: number | null = null;
    if (typeof value.opacity === 'number') opacity = value.opacity;
    else if (isAlias(value.opacity)) {
      const v = inner(value.opacity);
      opacity = v ? this.resolveFloat(v, node) : null;
    }
    if (!base || opacity === null) return null;
    return { ...base, a: base.a * Math.max(0, Math.min(1, opacity / 100)) };
  }

  resolveFloat(v: Variable, node: SceneNode): number | null {
    const key = `${v.id}:${this.modeSignature(node)}`;
    if (this.floatMemo.has(key)) return this.floatMemo.get(key)!;
    let out: number | null = null;
    try {
      const r = v.resolveForConsumer(node);
      if (r.resolvedType === 'FLOAT' && typeof r.value === 'number') out = r.value;
    } catch {
      out = null;
    }
    this.floatMemo.set(key, out);
    return out;
  }

  // ---------- Otros modos ----------

  /**
   * Colecciones cuyo modo fija la propia capa o un ancestro, la página incluida. Ese modo es una decisión de
   * quien diseña (una pantalla puesta en oscuro), así que al revisar otros modos se respeta.
   */
  pinnedCollections(node: BaseNode): ReadonlySet<string> {
    let pinned = this.pinnedMemo.get(node.id);
    if (pinned) return pinned;
    const parent = node.type === 'PAGE' || node.type === 'DOCUMENT' ? null : this.parentOf(node);
    pinned = new Set(parent ? this.pinnedCollections(parent) : []);
    let explicit: Record<string, string> | undefined;
    try {
      explicit = this.prop<Record<string, string> | undefined>(node, 'explicitVariableModes');
    } catch {
      explicit = undefined;
    }
    for (const id of Object.keys(explicit ?? {})) pinned.add(id);
    this.pinnedMemo.set(node.id, pinned);
    return pinned;
  }

  /**
   * Con qué modos resuelve una capa sus variables, también en los otros modos que se prueban: su firma de modos y
   * las colecciones que tiene fijadas. Dos capas con la misma clave resuelven igual cada variable en cada modo.
   */
  modeKey(node: SceneNode): string {
    let key = this.modeKeyMemo.get(node.id);
    if (key === undefined) {
      key = `${this.modeSignature(node)}/${[...this.pinnedCollections(node)].sort().join(',')}`;
      this.modeKeyMemo.set(node.id, key);
    }
    return key;
  }

  /** Colecciones a las que llega una variable siguiendo sus alias en todos los modos, ella incluida. */
  private async reachOf(v: Variable, seen = new Set<string>()): Promise<Set<string>> {
    const cached = this.reachMemo.get(v.id);
    if (cached) return cached;
    const out = new Set<string>([this.infoOf(v).collectionId]);
    if (seen.has(v.id)) return out;
    seen.add(v.id);
    for (const value of Object.values(this.infoOf(v).valuesByMode)) {
      for (const id of aliasIds(value)) {
        const target = await this.getVariable(id);
        if (target) for (const c of await this.reachOf(target, seen)) out.add(c);
      }
    }
    this.reachMemo.set(v.id, out);
    return out;
  }

  /** Modos de una colección, leídos una vez por auditoría. */
  private async modesOfCollection(id: string): Promise<ModeAxis['modes']> {
    let modes = this.collModesMemo.get(id);
    if (!modes) {
      const c = await this.getCollection(id);
      modes = (c?.modes ?? []).map((m) => ({ modeId: m.modeId, name: m.name }));
      this.collModesMemo.set(id, modes);
    }
    return modes;
  }

  /**
   * Las colecciones con más de un modo de las que dependen estas variables, salvo las que la capa tiene
   * fijadas, en el orden del archivo. Son los ejes en los que se puede revisar su color en otros modos.
   */
  async modeAxes(node: SceneNode, vars: readonly Variable[]): Promise<ModeAxis[]> {
    const ids = new Set<string>();
    for (const v of vars) for (const id of await this.reachOf(v)) ids.add(id);
    const pinned = this.pinnedCollections(node);
    const axes: ModeAxis[] = [];
    for (const id of ids) {
      if (pinned.has(id)) continue;
      const modes = await this.modesOfCollection(id);
      if (modes.length > 1) axes.push({ collectionId: id, modes });
    }
    const all = this.allCollections();
    const order = (id: string) => {
      const i = all.findIndex((c) => c.id === id);
      return i < 0 ? all.length : i;
    };
    return axes.sort((a, b) => order(a.collectionId) - order(b.collectionId));
  }

  /**
   * El color de una variable en una capa con otros modos para algunas colecciones, siguiendo los alias a mano:
   * `resolveForConsumer` solo resuelve en los modos que la capa tiene. Una colección que la capa fija no se
   * cambia. Null si no se puede: si a mano, en los modos de la capa, no sale lo mismo que da Figma, no se
   * sabe resolver bien esa variable (una colección extendida, por ejemplo), y no se adivina.
   */
  resolveColorIn(v: Variable, node: SceneNode, modes: Readonly<Record<string, string>>): RGBA | null {
    if (!this.manualMatches(v, node)) return null;
    const pinned = this.pinnedCollections(node);
    const effective: Record<string, string> = {};
    for (const [id, mode] of Object.entries(modes)) if (!pinned.has(id)) effective[id] = mode;
    const key = `${v.id}:${this.modeSignature(node)}:${Object.keys(effective).sort().map((k) => `${k}=${effective[k]}`).join('|')}`;
    if (this.inMemo.has(key)) return this.inMemo.get(key)!;
    const out = this.manualColor(v, node, effective, 0);
    this.inMemo.set(key, out);
    return out;
  }

  /** ¿Da la resolución a mano, en los modos de la capa, el mismo color que Figma? */
  private manualMatches(v: Variable, node: SceneNode): boolean {
    const key = `${v.id}:${this.modeSignature(node)}`;
    let ok = this.trustMemo.get(key);
    if (ok === undefined) {
      const figmaColor = this.resolveColor(v, node);
      const manual = this.manualColor(v, node, {}, 0);
      ok = !!figmaColor && !!manual && colorEq(figmaColor, manual);
      this.trustMemo.set(key, ok);
    }
    return ok;
  }

  /** Valor de una variable en el modo que le toca: el pedido para su colección, o el de la capa. */
  private manualValue(v: Variable, node: SceneNode, modes: Readonly<Record<string, string>>): VariableValue | undefined {
    const { collectionId, valuesByMode } = this.infoOf(v);
    const modeId = modes[collectionId] ?? this.modeIdFor(node, collectionId);
    if (modeId && modeId in valuesByMode) return valuesByMode[modeId];
    const values = Object.values(valuesByMode);
    return values.length === 1 ? values[0] : undefined;
  }

  private manualColor(v: Variable, node: SceneNode, modes: Readonly<Record<string, string>>, depth: number): RGBA | null {
    if (depth > 8) return null;
    const value = this.manualValue(v, node, modes);
    const follow = (alias: VariableAlias) => {
      const target = this.varCache.get(alias.id);
      return target ? this.manualColor(target, node, modes, depth + 1) : null;
    };
    if (isAlias(value)) return follow(value);
    if (isRGB(value)) return { r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 };
    if (!isComposed(value)) return null;
    const base = isAlias(value.color) ? follow(value.color) : isRGB(value.color) ? { a: 1, ...value.color } : null;
    let opacity: number | null = null;
    if (typeof value.opacity === 'number') opacity = value.opacity;
    else if (isAlias(value.opacity)) {
      const target = this.varCache.get(value.opacity.id);
      opacity = target ? this.manualFloat(target, node, modes, depth + 1) : null;
    }
    if (!base || opacity === null) return null;
    return { r: base.r, g: base.g, b: base.b, a: base.a * Math.max(0, Math.min(1, opacity / 100)) };
  }

  private manualFloat(v: Variable, node: SceneNode, modes: Readonly<Record<string, string>>, depth: number): number | null {
    if (depth > 8) return null;
    const value = this.manualValue(v, node, modes);
    if (typeof value === 'number') return value;
    if (!isAlias(value)) return null;
    const target = this.varCache.get(value.id);
    return target ? this.manualFloat(target, node, modes, depth + 1) : null;
  }

  /**
   * Ranking de idoneidad de una variable de color para un uso, como `floatRank`: 0 = ámbito explícito
   * (ALL_FILLS vale para los tres rellenos), 1 = todos los ámbitos, -1 = Figma no la ofrece para ese uso.
   * Sin ningún ámbito no sale en ningún selector, así que tampoco se propone.
   */
  colorRank(v: Variable, use: ColorUse): number {
    const scopes = this.infoOf(v).scopes;
    if (scopes.includes(use) || (use !== 'STROKE_COLOR' && scopes.includes('ALL_FILLS'))) return 0;
    return scopes.includes('ALL_SCOPES') ? 1 : -1;
  }

  /**
   * Las candidatas que valen para el uso, y el resto. Un ámbito explícito para ese uso basta para elegir.
   * Las de todos los ámbitos solo cuentan si ninguna otra coincidencia tiene ámbito propio: si las demás lo
   * tienen para otros usos, quedarse con la genérica por descarte sería adivinar (un token de texto que
   * se quedó con todos los ámbitos acabaría en el relleno de un frame).
   */
  byColorScope(vars: Variable[], use: ColorUse): { preferred: Variable[]; others: Variable[] } {
    const explicit = vars.filter((v) => this.colorRank(v, use) === 0);
    const preferred = explicit.length ? explicit : vars.every((v) => this.colorRank(v, use) === 1) ? vars : [];
    return { preferred, others: vars.filter((v) => !preferred.includes(v)) };
  }

  /**
   * ¿Viene de un kit que usa el archivo? Sus variables quedan de reserva, por tipo: colores, espaciado y radio solo
   * cuentan si el archivo y sus bibliotecas activadas no tienen ninguna de ese tipo. Un componente suelto de
   * Material 3 en un boceto de FlySplit traía sus 196 colores: los blancos empataban con los propios, se perdía la
   * corrección, y en las pantallas de FlySplit se proponían colores de Material 3 (octubre de 2026).
   */
  private fromKit(v: Variable): boolean {
    return this.kitIds.has(this.infoOf(v).collectionId);
  }

  /** Las numéricas sin las de un kit, si el archivo o sus bibliotecas tienen alguna para ese tipo de campo (ver `fromKit`). */
  private withoutKits(vars: Variable[], kind: FloatKind): Variable[] {
    if (!this.kitIds.size) return vars;
    let own = this.ownFloats.get(kind);
    if (own === undefined) {
      own = this.floatVars.some((v) => this.fitsKind(v, kind) && !this.fromKit(v));
      this.ownFloats.set(kind, own);
    }
    return own ? vars.filter((v) => !this.fromKit(v)) : vars;
  }

  /** Variables semánticas que resuelven exactamente a un color en el modo del nodo, ordenadas por ámbito para el uso. */
  semanticColorMatches(node: SceneNode, target: RGBA, use: ColorUse): { preferred: Variable[]; others: Variable[] } {
    const all = this.semanticColorVars.filter((v) => {
      const c = this.resolveColor(v, node);
      return c !== null && colorEq(c, target);
    });
    return this.byColorScope(all, use);
  }

  /** Variables de la lista cuyo valor crudo, en el modo del nodo, es un alias a la variable dada. */
  private aliasesIn(vars: Variable[], targetId: string, node: SceneNode): Variable[] {
    return vars.filter((v) => {
      const info = this.infoOf(v);
      const modeId = this.modeIdFor(node, info.collectionId);
      const raw = modeId ? info.valuesByMode[modeId] : undefined;
      return raw !== undefined && isAlias(raw) && raw.id === targetId;
    });
  }

  /**
   * Semánticas a las que reenlazar un color enlazado a una primitiva, en el modo del nodo. Parte de las que
   * apuntan a ella (`direct`). Si una es una opción de una capa intermedia (brand/light, que la semántica
   * elige en claro), sube hasta la que la elige en este modo: enlazar la opción congelaría el eje claro/oscuro.
   */
  rebindTargets(primitiveId: string, node: SceneNode, use: ColorUse): { direct: Variable[]; preferred: Variable[]; others: Variable[] } {
    const direct = this.aliasesIn(this.semanticColorVars, primitiveId, node);
    const found = new Map<string, Variable>();
    const seen = new Set<string>();
    const climb = (v: Variable) => {
      if (seen.has(v.id)) return;
      seen.add(v.id);
      if (!this.modeOptions.has(v.id) || !this.intermediate.has(this.infoOf(v).collectionId)) {
        found.set(v.id, v);
        return;
      }
      // Si ninguna la elige en este modo, ninguna semántica da aquí ese color: no queda candidata.
      for (const up of this.aliasesIn(this.switchers, v.id, node)) climb(up);
    };
    for (const v of direct) climb(v);
    return { direct, ...this.byColorScope([...found.values()], use) };
  }

  /** Variables numéricas que resuelven a un valor dado. */
  floatVarsForValue(value: number, node: SceneNode): Variable[] {
    return this.floatVars.filter((v) => {
      const f = this.resolveFloat(v, node);
      return f !== null && Math.abs(f - value) < 0.01;
    });
  }

  /**
   * Ranking de idoneidad de una variable numérica para un tipo de campo:
   * 0 = ámbito explícito y nombre coherente, 1 = ámbito explícito, 2 = todos los ámbitos y nombre positivo, -1 = no sirve.
   * Los ámbitos solo restringen el selector de la UI, así que el plugin es más estricto que Figma. Sin ningún
   * ámbito no sale en ningún selector, como en los colores (`colorRank`): no se propone.
   */
  floatRank(v: Variable, kind: FloatKind): number {
    const { scopes, name } = this.infoOf(v);
    const explicit = kind === 'radius' ? 'CORNER_RADIUS' : 'GAP';
    const folded = fold(name);
    const nameOk = KIND_NAME[kind].test(folded) && !NON_SPATIAL[kind].test(folded);
    if (scopes.includes(explicit)) return nameOk ? 0 : 1;
    if (scopes.includes('ALL_SCOPES') && nameOk) return 2;
    return -1;
  }

  fitsKind(v: Variable, kind: FloatKind): boolean {
    return this.floatRank(v, kind) >= 0;
  }

  /**
   * Variables que valen `value` y sirven para el tipo de campo. `preferred` es el mejor escalón del ranking;
   * solo se ofrece corrección automática si ese escalón tiene una única candidata. Se calcula una vez por valor,
   * tipo y modos: repasa todas las numéricas, y en Material 3 se pedía miles de veces con los mismos (0,4 ms cada
   * vez, octubre de 2026). Quien lo usa no cambia las listas.
   */
  floatVarsForField(value: number, node: SceneNode, kind: FloatKind): { preferred: Variable[]; others: Variable[] } {
    const key = `${kind}|${value}|${this.modeSignature(node)}`;
    let out = this.fieldMemo.get(key);
    if (!out) {
      out = this.rankForField(value, node, kind);
      this.fieldMemo.set(key, out);
    }
    return out;
  }

  private rankForField(value: number, node: SceneNode, kind: FloatKind): { preferred: Variable[]; others: Variable[] } {
    const all = this.withoutKits(this.floatVarsForValue(value, node), kind);
    const ranked = all.map((v) => ({ v, rank: this.floatRank(v, kind) }));
    const valid = ranked.filter((r) => r.rank >= 0);
    const best = valid.length ? Math.min(...valid.map((r) => r.rank)) : -1;
    const preferred = valid.filter((r) => r.rank === best).map((r) => r.v);
    // Las demás solo se nombran si son de tamaño: un contador del prototipo o una opacidad que valgan lo mismo no dicen nada.
    const others = all.filter((v) => !preferred.includes(v) && this.infoOf(v).scopes.some((sc) => SIZE_SCOPES[kind].has(sc)));
    return { preferred, others };
  }

  /**
   * Valores de la escala para un tipo de campo: los de las variables que sirven para él. Sin ninguna no hay
   * escala, y nada queda fuera de ella. Tomar entonces todas las numéricas del archivo daba una escala sin
   * sentido: en un sistema de pruebas eran contadores del prototipo y objetivos táctiles (septiembre de 2026).
   */
  scaleFor(kind: FloatKind): Set<number> {
    const cached = this.scaleByKind.get(kind);
    if (cached) return cached;
    const set = new Set<number>();
    // La de un kit, solo si el archivo y sus bibliotecas no tienen escala de ese tipo (ver `fromKit`).
    for (const v of this.withoutKits(this.floatVars.filter((x) => this.fitsKind(x, kind)), kind)) {
      for (const value of this.floatValues.get(v.id) ?? []) set.add(round2(value));
    }
    this.scaleByKind.set(kind, set);
    return set;
  }

  nearestScale(value: number, kind: FloatKind = 'spacing'): number | null {
    let best: number | null = null;
    let dist = Infinity;
    for (const s of this.scaleFor(kind)) {
      const d = Math.abs(s - value);
      // A la misma distancia de dos pasos gana el menor: no agranda el componente ni depende del orden de las variables.
      if (d < dist || (d === dist && best !== null && s < best)) {
        dist = d;
        best = s;
      }
    }
    return best;
  }

  inScale(value: number, kind: FloatKind = 'spacing'): boolean {
    const scale = this.scaleFor(kind);
    if (!scale.size) return true;
    return scale.has(round2(value));
  }

  /**
   * ¿Está el nodo dentro de una variante o instancia en estado deshabilitado? Vale cualquier eje, se llame State,
   * Zustand o 状態: lo que lo dice es el valor (Disabled, Désactivé, Deaktiviert…).
   */
  inDisabledState(node: SceneNode): boolean {
    let cur: BaseNode | null = node;
    while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
      if (DISABLED_VARIANT.test(fold(this.prop<string>(cur, 'name')))) return true;
      if (cur.type === 'INSTANCE') {
        try {
          const props = cur.componentProperties;
          for (const [key, prop] of Object.entries(props)) {
            if (prop.type === 'VARIANT' && DISABLED_WORD.test(fold(String(prop.value)))) return true;
            if (prop.type === 'BOOLEAN' && prop.value === true && DISABLED_WORD.test(fold(key.split('#')[0]))) return true;
          }
        } catch {
          // instancias sin propiedades legibles
        }
      }
      cur = this.parentOf(cur);
    }
    return false;
  }

  /**
   * ¿Es un rótulo del lienzo? Un texto suelto en la página o en una sección, fuera de cualquier frame, titula o
   * anota lo que tiene al lado y no forma parte de ningún diseño: en un sistema de pruebas son los nombres de cada
   * pantalla, que daban 226 avisos de color, estilo y contraste en Screens (septiembre de 2026).
   */
  isCanvasLabel(node: SceneNode): boolean {
    if (node.type !== 'TEXT') return false;
    const parent = this.parentOf(node);
    return parent?.type === 'PAGE' || parent?.type === 'SECTION';
  }

  /** ¿Cuelga de alguna página? Figma devuelve fuera de toda página los componentes eliminados y las variantes de un set eliminado. */
  onCanvas(node: BaseNode): boolean {
    for (let cur: BaseNode | null = node; cur; cur = this.parentOf(cur)) if (cur.type === 'PAGE') return true;
    return false;
  }

  /** ¿Está el nodo dentro de un componente principal (no de una instancia)? */
  insideComponent(node: SceneNode): boolean {
    let cur: BaseNode | null = this.parentOf(node);
    while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
      if (cur.type === 'COMPONENT' || cur.type === 'COMPONENT_SET') return true;
      cur = this.parentOf(cur);
    }
    return false;
  }

  /**
   * ¿Es un control interactivo por su nombre? La exclusión (Label, Icon, Badge…) se aplica al último
   * segmento del nombre, para que "Icon Button" cuente como botón y "Button/Label" no.
   */
  isInteractiveName(name: string): boolean {
    const folded = fold(name);
    if (!this.interactiveRe.test(folded)) return false;
    const last = folded.split('/').pop()?.trim() ?? folded;
    return !(NOT_A_CONTROL.test(last) && !this.interactiveRe.test(last));
  }

  /**
   * Lo que cuenta de una capa que hereda del componente: en la raíz de una instancia colocada, lo que ella
   * sobrescribe; en una capa de dentro a la que se llega por sus overrides, los campos sobrescritos. Null si
   * la capa se revisa entera.
   */
  overridesOf(node: SceneNode): Set<string> | null {
    const layer = this.overridden.get(node.id);
    if (layer) return layer;
    if (node.type !== 'INSTANCE' || this.settings.includeInstanceInternals) return null;
    return this.rootOverrides.get(node.id) ?? new Set(this.fieldsIn(node, node.id));
  }

  /** Como `overridesOf`, solo en las capas de dentro: la raíz de una instancia, en este caso, se revisa entera. */
  layerOverrides(node: SceneNode): Set<string> | null {
    return this.overridden.get(node.id) ?? null;
  }

  /** Lo que una instancia marca como sobrescrito, por id de capa (el suyo, para su raíz). */
  private overridesIn(instance: InstanceNode): Map<string, readonly string[]> {
    let byLayer = this.overridesMemo.get(instance.id);
    if (!byLayer) {
      byLayer = new Map();
      try {
        for (const o of instance.overrides) byLayer.set(o.id, o.overriddenFields);
      } catch {
        // sin overrides legibles no hay nada sobrescrito que mirar
      }
      this.overridesMemo.set(instance.id, byLayer);
    }
    return byLayer;
  }

  private fieldsIn(instance: InstanceNode, layerId: string): readonly string[] {
    return this.overridesIn(instance).get(layerId) ?? [];
  }

  /** Deja en la raíz de una instancia solo lo que cambia de verdad respecto al componente (ver `changedFields`). */
  async compareRoot(node: InstanceNode, relevant: ReadonlySet<string>): Promise<void> {
    if (this.rootOverrides.has(node.id)) return;
    const fields = this.fieldsIn(node, node.id);
    const main = fields.some((f) => relevant.has(f)) ? await this.mainComponent(node) : null;
    this.rootOverrides.set(node.id, changedFields(node, fields, main, relevant, (n, f) => this.prop(n, f)));
  }

  /**
   * Capas de dentro de una instancia que ella sobrescribe en alguno de los campos dados. `overrides` trae
   * también las de sus instancias anidadas, así que no hace falta entrar en ellas. Se quedan fuera las que
   * cuelgan de un slot, porque el contenido propio se revisa entero y el heredado no puede tener overrides
   * (tocarlo sobrescribe el slot, ver `slotContentOf`), y las que cuelgan de una capa ignorada. Sus campos
   * quedan apuntados para `overridesOf`.
   */
  async overriddenLayers(node: InstanceNode, relevant: ReadonlySet<string>): Promise<SceneNode[]> {
    const ids = new Set<string>();
    for (const [id, fields] of this.overridesIn(node)) if (id !== node.id && fields.some((f) => relevant.has(f))) ids.add(id);
    if (!ids.size) return [];
    const found: SceneNode[] = [];
    try {
      // Una sola pasada, que para en cuanto aparecen todas: buscar cada id por separado recorrería la instancia una
      // vez por capa. Casi siempre es una sola, y recorrerla entera era un 25 % más en Buttons de Material 3; da
      // las mismas capas en el mismo orden (comprobado en sus 4.504 instancias con capas sobrescritas).
      node.findOne((n) => {
        if (ids.has(n.id)) found.push(n);
        return found.length === ids.size;
      });
    } catch {
      return [];
    }
    const out: SceneNode[] = [];
    for (const layer of found) {
      let reached = true;
      for (let p = this.parentOf(layer); reached && p && p.id !== node.id; p = this.parentOf(p)) reached = !this.isSlot(p) && !this.isIgnored(p);
      if (reached && (await this.overrideIn(node, layer, relevant))) out.push(layer);
    }
    return out;
  }

  /**
   * Apunta lo que una instancia sobrescribe de verdad en una capa suya, en alguno de los campos dados. Sirve
   * también para volver a revisar la capa como en la auditoría: false si ya no le cambia nada de eso.
   */
  async overrideIn(owner: InstanceNode, layer: SceneNode, relevant: ReadonlySet<string>): Promise<boolean> {
    const fields = this.fieldsIn(owner, layer.id);
    if (!fields.some((f) => relevant.has(f))) return false;
    const changed = changedFields(layer, fields, await this.sourceOf(layer, owner), relevant, (n, f) => this.prop(n, f));
    if (![...changed].some((f) => relevant.has(f))) return false;
    this.overridden.set(layer.id, changed);
    return true;
  }

  /**
   * La capa de la que sale una capa de una instancia, con lo que valdría sin los overrides de esta. Es la del
   * componente principal; si la instancia intercambió lo que la contiene, esa capa no existe en él y vale
   * la del componente de lo intercambiado (medido en un sistema de pruebas en septiembre de 2026: 75 de 271
   * capas sobrescritas en Screens cuelgan de un icono intercambiado).
   */
  private async sourceOf(layer: SceneNode, owner: InstanceNode): Promise<SceneNode | null> {
    const main = await this.mainComponent(owner);
    const source = main && this.layerIn(main, owner, layer.id);
    if (source) return source;
    let near: BaseNode | null = layer.type === 'INSTANCE' ? layer : null;
    for (let p = this.parentOf(layer); !near && p && p.id !== owner.id; p = this.parentOf(p)) if (p.type === 'INSTANCE') near = p;
    if (!near || near.type !== 'INSTANCE') return null;
    const nearMain = await this.mainComponent(near);
    if (!nearMain) return null;
    return near === layer ? nearMain : this.layerIn(nearMain, near, layer.id);
  }

  /**
   * Una capa de un componente por el id que tiene en una instancia suya: el de la instancia seguido del que
   * tiene en el componente. `I<instancia>;<capa>` es `<capa>`, e `I<instancia>;<anidada>;<capa>` es
   * `I<anidada>;<capa>`.
   */
  private layerIn(main: ComponentNode, instance: InstanceNode, layerId: string): SceneNode | null {
    const prefix = `${instance.id.startsWith('I') ? instance.id : `I${instance.id}`};`;
    if (!layerId.startsWith(prefix)) return null;
    const rest = layerId.slice(prefix.length);
    let layers = this.mainLayers.get(main.id);
    if (!layers) {
      layers = new Map();
      try {
        for (const n of main.findAll()) layers.set(n.id, n);
      } catch {
        // sin las capas del componente no hay con qué comparar: cuenta todo lo sobrescrito
      }
      this.mainLayers.set(main.id, layers);
    }
    return layers.get(rest.includes(';') ? `I${rest}` : rest) ?? null;
  }

  /** Una capa por id, buscada una vez por auditoría (ver `findNode`). */
  async nodeById(id: string): Promise<BaseNode | null> {
    if (this.nodeMemo.has(id)) return this.nodeMemo.get(id)!;
    let node: BaseNode | null = null;
    try {
      node = await findNode(id);
    } catch {
      node = null;
    }
    this.nodeMemo.set(id, node);
    return node;
  }

  /** Componente principal de una instancia, o null si no se puede resolver. Una llamada por instancia y auditoría. */
  async mainComponent(node: InstanceNode): Promise<ComponentNode | null> {
    if (this.mainMemo.has(node.id)) return this.mainMemo.get(node.id)!;
    let main: ComponentNode | null = null;
    try {
      main = await node.getMainComponentAsync();
    } catch {
      main = null;
    }
    this.mainMemo.set(node.id, main);
    return main;
  }

  /** Definiciones de propiedades de un componente; las de una variante viven en su set. */
  definitionsOf(component: ComponentNode): ComponentPropertyDefinitions | null {
    const target = component.parent?.type === 'COMPONENT_SET' ? component.parent : component;
    if (this.defsMemo.has(target.id)) return this.defsMemo.get(target.id)!;
    let defs: ComponentPropertyDefinitions | null = null;
    try {
      defs = target.componentPropertyDefinitions;
    } catch {
      defs = null;
    }
    this.defsMemo.set(target.id, defs);
    return defs;
  }

  /** Propiedad SLOT de una capa de slot, buscada en el componente (o el principal de la instancia) que la contiene. */
  /**
   * Instancia o componente que contiene una capa de slot. Tras deshacer, Figma puede devolver el slot de
   * una instancia suelto, sin padre ni referencia a su propiedad, aunque en el lienzo se vea bien (con
   * contenido insertado por API, septiembre de 2026). Entonces la instancia sale del id: "I<instancia>;<capa>".
   */
  async slotHost(slot: SlotNode): Promise<InstanceNode | ComponentNode | null> {
    if (this.hostMemo.has(slot.id)) return this.hostMemo.get(slot.id)!;
    let host: BaseNode | null = slot.parent;
    while (host && host.type !== 'INSTANCE' && host.type !== 'COMPONENT' && host.type !== 'PAGE') host = host.parent;
    let out: InstanceNode | ComponentNode | null = host?.type === 'INSTANCE' || host?.type === 'COMPONENT' ? host : null;
    const cut = slot.id.lastIndexOf(';');
    if (!slot.parent && slot.id.startsWith('I') && cut > 0) {
      const path = slot.id.slice(1, cut);
      const found = await findNode(path.includes(';') ? `I${path}` : path);
      out = found?.type === 'INSTANCE' ? found : null;
    }
    this.hostMemo.set(slot.id, out);
    return out;
  }

  async slotDefinition(slot: SlotNode): Promise<{ key: string | null; def: PropertyDefinition | null }> {
    const host = await this.slotHost(slot);
    let component: ComponentNode | null = null;
    if (host?.type === 'COMPONENT') component = host;
    else if (host?.type === 'INSTANCE') component = await this.mainComponent(host);
    let key = slotKeyOf(slot);
    // Un slot suelto (ver `slotHost`) no trae la referencia: vale la de la capa original del principal,
    // cuyo id es el último tramo del de la subcapa.
    if (!key && component && host?.type === 'INSTANCE') {
      const sourceId = slot.id.slice(slot.id.lastIndexOf(';') + 1);
      const source = component.findOne((n) => n.id === sourceId);
      if (source) key = slotKeyOf(source);
    }
    if (!key) return { key, def: null };
    const defs = component ? this.definitionsOf(component) : null;
    return { key, def: defs?.[key] ?? null };
  }

  /**
   * ¿Es una capa de slot? Un frame convertido en slot mientras el plugin está abierto conserva en su
   * objeto el tipo FRAME, aunque `findAllWithCriteria` ya lo devuelva como SLOT (medido en septiembre
   * de 2026), así que también cuentan los ids que esa búsqueda ha devuelto.
   */
  isSlot(node: BaseNode): node is SlotNode {
    return node.type === 'SLOT' || this.knownSlots.has(node.id);
  }

  /**
   * Busca una vez los slots de la página que se va a recorrer, y los registra para `isSlot`. Sin ninguno,
   * `slotsUnder` no busca: era un recorrido por cada instancia y cada componente, 1,2 s en la página Buttons de
   * Material 3, que no tiene slots (octubre de 2026). Si no se puede saber, se busca como siempre.
   */
  noteSlots(page: PageNode): void {
    try {
      const slots = page.findAllWithCriteria({ types: ['SLOT'] });
      for (const s of slots) this.knownSlots.add(s.id);
      this.slotlessPage = slots.length === 0;
    } catch {
      this.slotlessPage = false;
    }
  }

  /**
   * Busca una vez los textos de la página que se va a recorrer entera y los apunta en cada instancia que los
   * contiene, para `placedTexts`. Buscarlos instancia por instancia era 1,3 s en la página Buttons de Material 3:
   * 5.566 búsquedas para 438 textos (octubre de 2026). Los padres que hay que leer son los que el contraste sube
   * después buscando el fondo. Como en `placedTexts`, un texto cuenta en una instancia si llega a ella sin pasar
   * por una capa ignorada, y los nombres solo se leen por debajo de la instancia más alta.
   */
  noteTexts(page: PageNode): void {
    let texts: TextNode[];
    try {
      texts = page.findAllWithCriteria({ types: ['TEXT'] });
    } catch {
      this.textsByInstance = null;
      return;
    }
    const byInstance = new Map<string, TextNode[]>();
    for (const text of texts) {
      const chain: BaseNode[] = [];
      let top = -1;
      for (let p = this.parentOf(text); p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = this.parentOf(p)) {
        if (p.type === 'INSTANCE') top = chain.length;
        chain.push(p);
      }
      for (let i = 0; i <= top; i++) {
        const p = chain[i];
        if (p.type === 'INSTANCE') {
          const list = byInstance.get(p.id);
          if (list) list.push(text);
          else byInstance.set(p.id, [text]);
        }
        if (i < top && this.isIgnored(p)) break;
      }
    }
    this.textsByInstance = byInstance;
  }

  /** Capas de slot bajo un nodo, registradas para `isSlot`. */
  slotsUnder(node: BaseNode & ChildrenMixin): SlotNode[] {
    if (this.slotlessPage) return [];
    let all = this.slotsMemo.get(node.id);
    if (all) return all;
    try {
      all = node.findAllWithCriteria({ types: ['SLOT'] });
    } catch {
      all = [];
    }
    for (const s of all) this.knownSlots.add(s.id);
    this.slotsMemo.set(node.id, all);
    return all;
  }

  /**
   * Slots que quien usa una instancia puede rellenar: los suyos y los de sus instancias anidadas.
   * Los que viven dentro del contenido de otro slot se alcanzan al recorrer ese contenido.
   */
  instanceSlots(node: InstanceNode): SlotNode[] {
    return this.slotsUnder(node).filter((s) => {
      for (let p = this.parentOf(s); p && p.id !== node.id; p = this.parentOf(p)) if (this.isSlot(p)) return false;
      return true;
    });
  }

  /**
   * Textos de una instancia colocada, para las reglas que dependen de dónde está. Se dejan fuera los que
   * cuelgan de una capa ignorada y los que Figma devuelve sin camino hasta la instancia (ver `slotHost`).
   */
  placedTexts(node: InstanceNode): TextNode[] {
    if (this.textsByInstance) return this.textsByInstance.get(node.id) ?? [];
    let texts: TextNode[];
    try {
      texts = node.findAllWithCriteria({ types: ['TEXT'] });
    } catch {
      return [];
    }
    // Capas ya vistas camino de la instancia: true si llegan a ella sin pasar por una ignorada.
    const reaches = new Map<string, boolean>([[node.id, true]]);
    return texts.filter((t) => {
      const path: BaseNode[] = [];
      let ok = false;
      for (let p: BaseNode | null = this.parentOf(t); p; p = this.parentOf(p)) {
        const known = reaches.get(p.id);
        if (known !== undefined) {
          ok = known;
          break;
        }
        path.push(p);
        if (this.isIgnored(p)) break;
      }
      for (const p of path) reaches.set(p.id, ok);
      return ok;
    });
  }

  /** Hijos de un contenedor, leídos una vez por auditoría: el contraste los repasa por cada texto. */
  childrenOf(node: BaseNode & ChildrenMixin): readonly SceneNode[] {
    let kids = this.kidsMemo.get(node.id);
    if (!kids) {
      kids = node.children;
      this.kidsMemo.set(node.id, kids);
    }
    return kids;
  }

  /**
   * ¿Puede aparecer esta capa oculta? Si su visibilidad la controla una propiedad booleana del componente o
   * una variable, quien use el componente o cambie de modo la verá.
   */
  revealable(node: SceneNode): boolean {
    try {
      if (this.prop<SceneNode['componentPropertyReferences']>(node, 'componentPropertyReferences')?.visible) return true;
      return !!this.prop<Record<string, unknown> | undefined>(node, 'boundVariables')?.visible;
    } catch {
      return false;
    }
  }

  /** Contenido de un slot de instancia separado en propio y heredado (ver `slotContentOf`). */
  slotContent(slot: SlotNode): SlotContent {
    let out = this.slotMemo.get(slot.id);
    if (!out) {
      out = slotContentOf(slot);
      this.slotMemo.set(slot.id, out);
    }
    return out;
  }

  /**
   * Contexto de una raíz del recorrido que puede estar dentro de una instancia (una capa seleccionada a fondo):
   * rehace el camino desde la página para saber de qué instancia es y si cae en contenido heredado de un slot.
   */
  scopeOf(node: SceneNode, internals: boolean): NodeScope {
    const chain: SceneNode[] = [];
    for (let p = this.parentOf(node); p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = this.parentOf(p)) chain.unshift(p as SceneNode);
    if (!chain.some((n) => n.type === 'INSTANCE')) return {};
    chain.push(node);
    let owner: InstanceNode | undefined;
    let inherited = false;
    for (let i = 0; i < chain.length - 1; i++) {
      const n = chain[i];
      if (n.type === 'INSTANCE' && !owner) {
        owner = n;
        this.slotsUnder(n);
      } else if (owner && this.isSlot(n)) {
        const next = chain[i + 1].id;
        if (this.slotContent(n).owned.some((k) => k.id === next)) {
          owner = undefined;
          inherited = false;
        } else {
          inherited = true;
        }
      }
    }
    return { owner, inherited, shell: !!owner && !internals && this.isSlot(node) };
  }

  isIgnored(node: BaseNode): boolean {
    const name = this.prop<string>(node, 'name') || '';
    return this.settings.ignorePrefixes.some((p) => p && name.startsWith(p));
  }

  /** Ruta de capas hasta la página, sin incluirla. */
  path(node: BaseNode): string {
    const parent = this.parentOf(node);
    if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT') return '';
    let out = this.pathMemo.get(parent.id);
    if (out === undefined) {
      const above = this.path(parent);
      const name = this.prop<string>(parent, 'name');
      out = above ? `${above} / ${name}` : name;
      this.pathMemo.set(parent.id, out);
    }
    return out;
  }

  /** ¿Es una colección local que sigue existiendo? */
  isLocalCollection(id: string): boolean {
    return this.collections.some((c) => c.id === id);
  }

  finding(node: SceneNode | PageNode, page: PageNode, meta: CheckMeta, message: string, opts: { severity?: Severity; fix?: FixHint } = {}): Finding {
    const target = opts.fix && (opts.fix.kind === 'bind-float' || opts.fix.kind === 'bind-color') ? this.varCache.get(opts.fix.variableId) : undefined;
    return {
      checkId: meta.id,
      nodeId: node.id,
      nodeName: this.prop<string>(node, 'name'),
      nodeType: node.type,
      path: this.path(node),
      pageId: page.id,
      pageName: page.name,
      message,
      severity: opts.severity ?? meta.severity,
      fix: opts.fix,
      ignoreKey: ignoreKeyOf(meta.id, node.id),
      variantOf: this.variantOf(node),
      ...(target ? { fixTo: this.varName(target) } : {}),
    };
  }

  /**
   * Variante de un set en la que está una capa y la ruta de nombres desde ella ("" si es la propia variante).
   * Las capas de cada variante tienen ids distintos: la ruta es lo que permite reconocer la misma capa.
   */
  private variantOf(node: SceneNode | PageNode): Finding['variantOf'] {
    if (node.type === 'PAGE') return undefined;
    const names: string[] = [];
    for (let cur: BaseNode | null = node; cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT'; cur = this.parentOf(cur)) {
      const set = this.parentOf(cur);
      if (cur.type === 'COMPONENT' && set?.type === 'COMPONENT_SET') {
        let variants = this.variantsMemo.get(set.id);
        if (variants === undefined) {
          variants = (set as ComponentSetNode).children.length;
          this.variantsMemo.set(set.id, variants);
        }
        return { setId: set.id, setName: this.prop<string>(set, 'name'), variantId: cur.id, variants, layerPath: names.reverse().join(' / ') };
      }
      names.push(this.prop<string>(cur, 'name'));
    }
    return undefined;
  }
}

/** El patrón de nombres interactivos, para nombres pasados por `fold`: sin acentos, como ellos. */
export function compilePattern(pattern: string): RegExp {
  try {
    return wordsRe(stripAccents(pattern));
  } catch {
    return wordsRe(INTERACTIVE_PATTERN);
  }
}

/** Contraste WCAG 2.x entre dos colores opacos. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const lum = (c: RGBA) => {
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const l1 = lum(a);
  const l2 = lum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Compone un color con alfa sobre un fondo opaco. */
export function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** Composición general "top sobre bottom" cuando el fondo también puede ser translúcido. */
export function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}
