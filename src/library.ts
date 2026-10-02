/**
 * Variables de las bibliotecas activadas en el archivo (permiso `teamlibrary`). Un archivo de producto casi no tiene
 * variables propias: usa las de su biblioteca. Sin ellas, el plugin no proponía ninguna corrección ni conocía la
 * escala (medido en octubre de 2026 con FlySplit publicada como biblioteca: «Relleno #F8FAFC sin token», y era
 * color/bg/canvas). Hay que importarlas por su clave. Importar no cambia el archivo (Figma no avisa de ningún
 * cambio). Las 122 de FlySplit, por tandas en paralelo: 4,3 s la primera vez en el archivo y 1,4 s la siguiente.
 * Con Figma tapado se queda esperando hasta volver; por eso empieza al abrir el panel, que se lanza desde Figma.
 *
 * Los kits de Figma (Material 3, Simple Design System…) no salen entre las bibliotecas activadas, pero sus
 * colecciones se listan e importan igual por su clave. Se descubren por las colecciones que usan las capas (ver
 * `used`). Las 196 de «M3»: 9,9 s la primera vez en el archivo y 1,9 s otro día (medido el 02-10-2026).
 */

export interface LibraryVariables {
  variables: Variable[];
  collections: VariableCollection[];
  /** Nombre de la biblioteca de cada colección, por id; vacío si viene de un kit, que no lo dice. */
  libraryOf: Map<string, string>;
  /** Ids de las colecciones que vienen de un kit, y no de una biblioteca activada. */
  kits: Set<string>;
}

interface Loaded {
  variables: Variable[];
  collection: VariableCollection | null;
  library: string;
}

/** Solo sirven las de color y las numéricas: las demás no se proponen ni hacen escala. */
const TYPES = new Set<string>(['COLOR', 'FLOAT']);
/** Cuántas se importan a la vez. */
const BATCH = 24;

/** Lo importado de cada colección, por su clave, para toda la sesión: la segunda auditoría ya no importa nada. */
const byCollection = new Map<string, Promise<Loaded>>();
/** Colecciones de fuera del archivo que usan sus capas y no son de una biblioteca activada, por clave, para la sesión. */
const kits = new Map<string, LibraryVariableCollection>();
/** Las colecciones usadas ya miradas, por id: su clave, o null si no es de fuera del archivo. */
const checked = new Map<string, string | null>();

/** Cuántas variables se han importado de cuántas, mientras se importa alguna (ver `onLibraryProgress`). */
const progress = { done: 0, total: 0 };
let listener: ((done: number, total: number) => void) | null = null;

/** Avisa de lo que lleva la importación: al empezar cada colección, tras cada tanda y al acabar (done = total). */
export function onLibraryProgress(fn: ((done: number, total: number) => void) | null): void {
  listener = fn;
}

function report(): void {
  listener?.(progress.done, progress.total);
  if (progress.done >= progress.total) progress.done = progress.total = 0;
}

/** Para las pruebas: otra biblioteca con las mismas claves. */
export function clearLibraryCache(): void {
  byCollection.clear();
  kits.clear();
  checked.clear();
  progress.done = progress.total = 0;
}

/** Sin el permiso, leer `figma.teamLibrary` da error. */
function teamLibrary(): TeamLibraryAPI | null {
  try {
    return figma.teamLibrary ?? null;
  } catch {
    return null;
  }
}

async function load(api: TeamLibraryAPI, c: LibraryVariableCollection, types: ReadonlySet<string>): Promise<Loaded> {
  let listed: LibraryVariable[] = [];
  try {
    listed = await api.getVariablesInLibraryCollectionAsync(c.key);
  } catch {
    // Una colección oculta de una biblioteca (sus primitivas) no se publica: se llega a ella por los alias.
    listed = [];
  }
  const keys = listed.filter((v) => types.has(v.resolvedType)).map((v) => v.key);
  if (keys.length) {
    progress.total += keys.length;
    report();
  }
  const variables: Variable[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    const batch = await Promise.all(slice.map((key) => figma.variables.importVariableByKeyAsync(key).catch(() => null)));
    for (const v of batch) if (v) variables.push(v);
    progress.done += slice.length;
    report();
  }
  let collection: VariableCollection | null = null;
  if (variables.length) {
    try {
      collection = await figma.variables.getVariableCollectionByIdAsync(variables[0].variableCollectionId);
    } catch {
      collection = null;
    }
  }
  return { variables, collection, library: c.libraryName };
}

/** La clave de una colección usada si viene de fuera del archivo, mirada una vez por sesión. */
async function remoteKey(id: string): Promise<string | null> {
  if (checked.has(id)) return checked.get(id)!;
  let key: string | null = null;
  try {
    const c = await figma.variables.getVariableCollectionByIdAsync(id);
    if (c && c.remote && c.key) {
      key = c.key;
      if (!kits.has(key)) kits.set(key, { key, name: c.name, libraryName: '' });
    }
  } catch {
    key = null;
  }
  checked.set(id, key);
  return key;
}

/** Lo importado de una colección con esos tipos, una vez por sesión. */
function cached(api: TeamLibraryAPI, c: LibraryVariableCollection, types: ReadonlySet<string>): Promise<Loaded> {
  const key = `${c.key}|${[...types].sort().join(',')}`;
  let p = byCollection.get(key);
  if (!p) {
    p = load(api, c, types);
    byCollection.set(key, p);
  }
  return p;
}

/**
 * Las variables de color y numéricas de las bibliotecas activadas y de los kits que usa el archivo, ya importadas.
 * Sin permiso, ninguna. `own` son las claves de las colecciones del archivo: si Figma le devuelve al archivo que
 * publica una biblioteca sus propias colecciones (no está documentado ni medido), no se importan, porque ya cuentan
 * como suyas. `used` son ids de colecciones que usan sus capas, para descubrir los kits; los descubiertos se
 * recuerdan para la sesión. De un kit solo se importan los tipos que da `kitTypes` con lo de las bibliotecas: los
 * que el archivo no tiene. Si FlySplit tiene sus colores, los 196 de Material 3 no hacen falta.
 */
export async function libraryVariables(
  own: ReadonlySet<string> = new Set(),
  used: Iterable<string> = [],
  kitTypes: (fromLibraries: readonly Variable[]) => ReadonlySet<string> = () => TYPES,
): Promise<LibraryVariables> {
  const out: LibraryVariables = { variables: [], collections: [], libraryOf: new Map(), kits: new Set() };
  const api = teamLibrary();
  if (!api) return out;
  let available: LibraryVariableCollection[];
  try {
    available = await api.getAvailableLibraryVariableCollectionsAsync();
  } catch {
    available = [];
  }
  const add = (l: Loaded, kit: boolean) => {
    out.variables.push(...l.variables);
    if (!l.collection) return;
    out.collections.push(l.collection);
    out.libraryOf.set(l.collection.id, l.library);
    if (kit) out.kits.add(l.collection.id);
  };
  const libraries = await Promise.all(available.filter((c) => !own.has(c.key)).map((c) => cached(api, c, TYPES)));
  for (const l of libraries) add(l, false);
  for (const id of used) await remoteKey(id);
  const enabled = new Set(available.map((c) => c.key));
  const wanted = [...kits.values()].filter((k) => !enabled.has(k.key) && !own.has(k.key));
  const types = wanted.length ? kitTypes(out.variables) : new Set<string>();
  if (types.size) for (const l of await Promise.all(wanted.map((c) => cached(api, c, types)))) add(l, true);
  return out;
}
