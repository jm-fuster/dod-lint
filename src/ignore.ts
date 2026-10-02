// Hallazgos ignorados: una regla en una capa, guardada en el archivo para que la vea igual quien lo abra.

export const IGNORED_KEY = 'dodlint.ignored.v1';

/** Clave con la que se ignora un hallazgo: la regla y la capa. */
export const ignoreKeyOf = (checkId: string, nodeId: string) => `${checkId}|${nodeId}`;

/**
 * Clave de un texto de instancia revisado donde está colocado: la capa original del componente, que es el
 * último tramo del id. Ignorarlo lo ignora en todas las instancias, igual que sale una sola vez en la lista.
 */
export const placedKeyOf = (checkId: string, nodeId: string) => ignoreKeyOf(checkId, `src:${nodeId.slice(nodeId.lastIndexOf(';') + 1)}`);

/** ¿Es la clave de un texto de instancia, que se ignora en todas? */
export const isPlacedKey = (key: string) => key.includes('|src:');

/** Claves ignoradas en este archivo, con cuándo se ignoró cada una. */
export function readIgnored(): Record<string, { at: string }> {
  try {
    const raw = figma.root.getPluginData(IGNORED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, { at: string }>) : {};
  } catch {
    return {};
  }
}

/** Añade o quita claves. Escribe en el archivo, así que solo lo hace una acción de quien usa el plugin. */
export function writeIgnored(keys: string[], ignore: boolean): void {
  const all = readIgnored();
  const at = new Date().toISOString();
  for (const key of keys) {
    if (ignore) all[key] = { at };
    else delete all[key];
  }
  figma.root.setPluginData(IGNORED_KEY, Object.keys(all).length ? JSON.stringify(all) : '');
}
