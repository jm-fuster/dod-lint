// Figma simulado para las pruebas: lo justo de la API de plugins que usan las reglas, las correcciones y el
// recorrido. Las variables resuelven por modo siguiendo los alias, como `resolveForConsumer`; las capas
// se construyen con `node()` y se buscan por id, como en `getNodeByIdAsync`.
import { AuditContext } from '../src/context';
import { mergeSettings } from '../src/settings';
import { runAudit } from '../src/audit';
import type { AuditOptions } from '../src/audit';
import { clearLibraryCache } from '../src/library';
import type { FixHint, Settings } from '../src/types';

export type Color = { r: number; g: number; b: number; a: number };
export const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
export const GREY: Color = { r: 0.9, g: 0.9, b: 0.9, a: 1 };
export const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 };

export const alias = (id: string) => ({ type: 'VARIABLE_ALIAS' as const, id });

const state = {
  collections: [] as any[],
  /** Variables locales: las que devuelve `getLocalVariablesAsync`. */
  variables: [] as any[],
  /** Variables que resuelven por id sin ser locales, como las de una biblioteca. */
  remote: new Map<string, any>(),
  styles: new Map<string, any>(),
  nodes: new Map<string, any>(),
  /** Datos del plugin guardados en la raíz del archivo. */
  pluginData: new Map<string, string>(),
  /** Lo que el plugin guarda para quien lo usa (`clientStorage`). */
  client: new Map<string, unknown>(),
  /** Colecciones que resuelven por id sin ser locales: borradas (`remote: false`) o de una biblioteca. */
  other: new Map<string, any>(),
  /** Bibliotecas activadas: cada colección publicada con sus variables, que se importan por su clave. */
  libraries: [] as Array<{ library: string; collection: any; variables: any[]; kit?: boolean }>,
  /** Cuántas variables se han importado, para ver que la caché de la sesión funciona. */
  imports: 0,
};

/**
 * Activa una biblioteca: su colección y sus variables se ven por `figma.teamLibrary` y se importan por su clave
 * (la de cada variable es su id). Lo importado resuelve por id, como en Figma. `hidden` son las variables a las que
 * apuntan, que no se publican pero resuelven igual (las primitivas ocultas de FlySplit, medido en octubre de 2026).
 */
export function addLibrary(library: string, collection: any, variables: any[], hidden: any[] = []) {
  state.libraries.push({ library, collection: { ...collection, remote: true }, variables });
  state.other.set(collection.id, { ...collection, remote: true });
  for (const v of hidden) state.remote.set(v.id, { ...v, remote: true });
}
export const importCount = () => state.imports;

/**
 * Un kit de Figma, como el de Material 3: su colección se lista y se importa por su clave como la de una biblioteca,
 * pero no sale entre las activadas (medido el 02-10-2026 con la colección «M3»).
 */
export function addKit(collection: any, variables: any[], hidden: any[] = []) {
  addLibrary('', collection, variables, hidden);
  state.libraries[state.libraries.length - 1].kit = true;
}

/** Una colección que Figma devuelve por id pero ya no está entre las locales, o una de biblioteca. */
export const addCollection = (c: any) => state.other.set(c.id, c);

/** Modos explícitos, como en las capas y las páginas de Figma. */
function withModes(target: any, modes: Record<string, string> = {}) {
  target.explicitVariableModes = { ...modes };
  target.clearExplicitVariableModeForCollection = (c: any) => {
    delete target.explicitVariableModes[c.id];
  };
  return target;
}

const variableById = (id: string) => state.variables.find((v) => v.id === id) ?? state.remote.get(id) ?? null;

const isAliasValue = (value: any) => value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS';

/**
 * Valor de una variable para una capa: el modo de cada colección sale del nodo o, si no, el de por defecto. Un
 * color compuesto sale ya aplanado, con la opacidad (de 0 a 100) en el alfa, como en Figma (medido en Burger
 * King el 30-09-2026).
 */
export function resolve(v: any, node: any): { value: unknown; resolvedType: string } {
  let cur = v;
  for (let i = 0; i < 20 && cur; i++) {
    const coll = state.collections.find((c) => c.id === cur.variableCollectionId);
    const modeId = node?.resolvedVariableModes?.[cur.variableCollectionId] ?? coll?.defaultModeId ?? Object.keys(cur.valuesByMode)[0];
    const value = cur.valuesByMode[modeId];
    if (isAliasValue(value)) {
      cur = variableById(value.id);
      continue;
    }
    if (value && typeof value === 'object' && 'color' in value && 'opacity' in value) {
      const inner = (alias: any) => {
        const target = variableById(alias.id);
        if (!target) throw new Error(`No se pudo resolver ${v.name}`);
        return resolve(target, node).value as any;
      };
      const base = isAliasValue(value.color) ? inner(value.color) : { a: 1, ...value.color };
      const opacity = isAliasValue(value.opacity) ? inner(value.opacity) : value.opacity;
      return { value: { r: base.r, g: base.g, b: base.b, a: (base.a ?? 1) * (opacity / 100) }, resolvedType: 'COLOR' };
    }
    return { value, resolvedType: cur.resolvedType };
  }
  throw new Error(`No se pudo resolver ${v.name}`);
}

/**
 * Colección con sus modos; el id de cada modo es su nombre, y el primero es el de por defecto. Su clave, la que se
 * usa para publicarla como biblioteca, es su id.
 */
export function collection(id: string, name: string, modes: string[] = ['value'], hidden = false) {
  return { id, key: id, name, hiddenFromPublishing: hidden, defaultModeId: modes[0], modes: modes.map((m) => ({ modeId: m, name: m })) };
}

function makeVariable(id: string, name: string, collectionId: string, type: 'COLOR' | 'FLOAT', valuesByMode: Record<string, unknown>, scopes: string[]) {
  return {
    id, name, variableCollectionId: collectionId, resolvedType: type, valuesByMode, scopes,
    resolveForConsumer(node: any) {
      return resolve(this, node);
    },
  };
}
export const color = (id: string, name: string, collectionId: string, valuesByMode: Record<string, unknown>, scopes = ['ALL_SCOPES']) =>
  makeVariable(id, name, collectionId, 'COLOR', valuesByMode, scopes);
export const float = (id: string, name: string, collectionId: string, valuesByMode: Record<string, unknown>, scopes = ['ALL_SCOPES']) =>
  makeVariable(id, name, collectionId, 'FLOAT', valuesByMode, scopes);

/** Sustituye las colecciones y variables locales. */
export function useVariables(collections: any[], variables: any[]) {
  state.collections = collections;
  state.variables = variables;
}
/** Una variable que resuelve por id pero no es local (o que vuelve a estar disponible). */
export const addRemote = (v: any) => state.remote.set(v.id, v);
export const addStyle = (id: string) => state.styles.set(id, { id, name: id });

export const page: any = { type: 'PAGE', id: '0:1', name: 'Pruebas', children: [], selection: [], loadAsync: async () => {} };
/** Otra página, fuera de la auditoría: aquí viven los componentes principales de las instancias. */
export const library: any = { type: 'PAGE', id: '0:2', name: 'Biblioteca', children: [], selection: [], loadAsync: async () => {} };

export const solid = (c: Color, extra: Record<string, unknown> = {}) => ({ type: 'SOLID', visible: true, color: { r: c.r, g: c.g, b: c.b }, opacity: c.a, ...extra });
page.backgrounds = [solid(WHITE)];
library.backgrounds = [solid(WHITE)];
withModes(page);
withModes(library);
// Las páginas buscan en todo lo que cuelga de ellas, como en Figma (la auditoría busca así sus slots).
for (const p of [page, library]) p.findAllWithCriteria = ({ types }: { types: string[] }) => descendants(p).filter((d) => types.includes(d.type));
/** Las páginas también se encuentran por id, como en `getNodeByIdAsync`. */
const registerPages = () => [page, library].forEach((p) => state.nodes.set(p.id, p));
registerPages();

const CONTAINERS = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SLOT']);
const FRAMES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SLOT']);
let counter = 0;

function descendants(n: any): any[] {
  const out: any[] = [];
  for (const kid of n.children ?? []) out.push(kid, ...descendants(kid));
  return out;
}

/**
 * Una capa con valores por defecto razonables para su tipo. Solo los contenedores tienen `children`, porque
 * el recorrido y varias reglas miran si la propiedad existe. Los hijos reciben la capa como `parent`.
 */
export function node(type: string, props: Record<string, any> = {}, children: any[] = []): any {
  const n: any = {
    type, id: `n:${++counter}`, name: type, visible: true, parent: null, opacity: 1,
    boundVariables: {}, resolvedVariableModes: {}, fills: [], strokes: [], fillStyleId: '', strokeStyleId: '',
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 48 }, width: 100, height: 48,
  };
  if (FRAMES.has(type)) {
    Object.assign(n, {
      layoutMode: 'NONE', layoutWrap: 'NO_WRAP', primaryAxisAlignItems: 'MIN', itemSpacing: 0,
      paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0,
      cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0,
    });
  }
  if (type === 'TEXT') {
    Object.assign(n, {
      characters: 'Hola', fontSize: 14, fontWeight: 400, fontName: { family: 'Inter', style: 'Regular' }, textStyleId: '',
      textAutoResize: 'WIDTH_AND_HEIGHT', textTruncation: 'DISABLED', hasMissingFont: false,
    });
  }
  if (type === 'INSTANCE') Object.assign(n, { overrides: [], componentProperties: {} });
  withModes(n);
  Object.assign(n, props);
  if (CONTAINERS.has(type)) {
    n.children = children;
    for (const kid of children) kid.parent = n;
  }
  n.setBoundVariable = (field: string, v: any) => {
    if (!v) {
      delete n.boundVariables[field];
      return;
    }
    n.boundVariables[field] = alias(v.id);
    n[field] = resolve(v, n).value;
  };
  n.findAllWithCriteria = ({ types }: { types: string[] }) => descendants(n).filter((d) => types.includes(d.type));
  n.findAll = (test: (d: any) => boolean = () => true) => descendants(n).filter(test);
  n.findOne = (test: (d: any) => boolean) => descendants(n).find(test) ?? null;
  n.getMainComponentAsync = async () => props.main ?? null;
  n.setFillStyleIdAsync = async (id: string) => {
    n.fillStyleId = id;
  };
  state.nodes.set(n.id, n);
  return n;
}

/** Coloca capas en una página (por defecto, la que se audita). */
export function place(nodes: any[], target: any = page) {
  target.children = nodes;
  for (const n of nodes) n.parent = target;
}

/** Deja el simulado como recién abierto: sin variables, estilos ni capas. */
export function reset() {
  useVariables([], []);
  state.remote.clear();
  state.styles.clear();
  state.nodes.clear();
  registerPages();
  state.pluginData.clear();
  state.client.clear();
  state.other.clear();
  state.libraries = [];
  state.imports = 0;
  clearLibraryCache();
  withModes(page);
  withModes(library);
  page.selection = [];
  place([], page);
  place([], library);
  counter = 0;
}

(globalThis as any).figma = {
  mixed: Symbol('mixed'),
  skipInvisibleInstanceChildren: false,
  currentPage: page,
  root: {
    name: 'Pruebas',
    children: [page, library],
    getPluginData: (key: string) => state.pluginData.get(key) ?? '',
    setPluginData: (key: string, value: string) => (value ? state.pluginData.set(key, value) : state.pluginData.delete(key)),
  },
  clientStorage: {
    // Como en Figma, se guarda una copia: cambiar lo leído no cambia lo guardado.
    getAsync: async (key: string) => (state.client.has(key) ? structuredClone(state.client.get(key)) : undefined),
    setAsync: async (key: string, value: unknown) => {
      state.client.set(key, structuredClone(value));
    },
  },
  loadAllPagesAsync: async () => {},
  getNodeByIdAsync: async (id: string) => state.nodes.get(id) ?? null,
  getStyleByIdAsync: async (id: string) => state.styles.get(id) ?? null,
  variables: {
    getLocalVariableCollectionsAsync: async () => state.collections,
    getLocalVariablesAsync: async () => state.variables,
    getVariableByIdAsync: async (id: string) => variableById(id),
    getVariableCollectionByIdAsync: async (id: string) => state.collections.find((c) => c.id === id) ?? state.other.get(id) ?? null,
    setBoundVariableForPaint: (paint: any, _field: string, v: any) => ({ ...paint, boundVariables: v ? { color: alias(v.id) } : {} }),
    importVariableByKeyAsync: async (key: string) => {
      const found = state.libraries.flatMap((l) => l.variables).find((v) => v.id === key);
      if (!found) throw new Error(`No hay ninguna variable publicada con la clave ${key}`);
      state.imports++;
      const v = { ...found, remote: true };
      state.remote.set(v.id, v);
      return v;
    },
  },
  teamLibrary: {
    getAvailableLibraryVariableCollectionsAsync: async () =>
      state.libraries.filter((l) => !l.kit).map((l) => ({ key: l.collection.key, name: l.collection.name, libraryName: l.library })),
    getVariablesInLibraryCollectionAsync: async (key: string) => {
      const found = state.libraries.find((l) => l.collection.key === key);
      // Como en Figma: una colección que no se publica (las primitivas ocultas de una biblioteca) no se puede listar.
      if (!found) throw new Error(`No hay ninguna colección publicada con la clave ${key}`);
      return found.variables.map((v) => ({ key: v.id, name: v.name, resolvedType: v.resolvedType }));
    },
  },
};

export const settings = (overrides: Partial<Settings> = {}) => mergeSettings({ language: 'es', ...overrides });

/** Contexto de auditoría ya inicializado con las variables del simulado. */
export async function context(overrides: Partial<Settings> = {}) {
  const ctx = new AuditContext(settings(overrides), 'es');
  await ctx.init();
  return ctx;
}

/** Audita la página de pruebas. */
export const audit = (overrides: Partial<Settings> = {}, opts: AuditOptions = {}) => runAudit('page', settings(overrides), { pages: [page], lang: 'es', ...opts });

/**
 * Como en un archivo que usa tokens de espaciado y de radio, de una biblioteca por ejemplo: lo escrito a mano se
 * avisa capa a capa aunque el simulado no tenga variables de ese tipo.
 */
export const withTokens: AuditOptions = { withoutTokens: [] };

/** Nombre de la variable a la que enlaza una corrección, para comparar sin ids. */
export function fixTarget(f: { fix?: FixHint }): string | undefined {
  const id = f.fix && 'variableId' in f.fix ? f.fix.variableId : undefined;
  return id ? variableById(id)?.name : undefined;
}
