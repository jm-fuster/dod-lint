import type { CheckId, Settings } from './types';
import { INTERACTIVE_PATTERN } from './names';

export const SETTINGS_KEY = 'dodlint.settings.v1';

export const ALL_CHECKS: CheckId[] = [
  'auto-layout',
  'spacing',
  'text',
  'color',
  'primitive',
  'states',
  'stacked',
  'touch',
  'placeholder',
  'props',
  'slots',
  'description',
  'detached',
  'broken',
  'contrast',
];

export const DEFAULT_SETTINGS: Settings = {
  enabled: Object.fromEntries(ALL_CHECKS.map((id) => [id, true])) as Record<CheckId, boolean>,
  language: 'auto',
  primitiveAuto: true,
  primitiveCollectionIds: [],
  // WCAG 2.2 AA (2.5.8). 44 es el de Apple y el AAA, y en un sistema de escritorio salta en casi todo.
  touchMin: 24,
  includeHidden: false,
  includeInstanceInternals: false,
  includeTopLevelFrames: false,
  // En una biblioteca, la documentación y los bocetos son casi todo el ruido; en un archivo de producto, las
  // pantallas son lo que hay que revisar. Se activa por archivo.
  spacingComponentsOnly: false,
  ignorePrefixes: ['_', '.'],
  // Ajustar cambia la medida: es una decisión, así que hay que activarlo.
  snapToScale: false,
  requiredStates: ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'],
  fieldStates: ['Default', 'Hover', 'Focus', 'Disabled'],
  // En los seis idiomas que entiende el plugin (ver `names.ts`).
  interactivePattern: INTERACTIVE_PATTERN,
  minDescriptionLength: 20,
  // Muchos equipos no los usan: se piden si se activa.
  requireDocLinks: false,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;

/** ¿Tiene `value` el tipo de `key`? Lo guardado en el archivo puede venir de otra versión del plugin. */
function fits(key: keyof Settings, value: unknown): boolean {
  const expected = DEFAULT_SETTINGS[key];
  if (Array.isArray(expected)) return Array.isArray(value) && value.every((v) => typeof v === 'string');
  return typeof value === typeof expected;
}

/** Combina ajustes guardados con los valores por defecto, tolerando versiones anteriores. */
export function mergeSettings(...layers: Array<Partial<Settings> | null | undefined>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, enabled: { ...DEFAULT_SETTINGS.enabled } };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const key of Object.keys(layer) as Array<keyof Settings>) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) continue;
      const value = layer[key];
      if (value === undefined || value === null) continue;
      if (key === 'enabled' && typeof value === 'object') {
        for (const id of ALL_CHECKS) {
          const v = (value as Record<string, unknown>)[id];
          if (typeof v === 'boolean') out.enabled[id] = v;
        }
      } else if (key !== 'enabled' && fits(key, value)) {
        (out as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  return out;
}

/**
 * Lo que `draft` cambia respecto a `base`, y de `enabled` solo las reglas que cambian. Al guardar se escribe eso
 * encima de lo que haya en el archivo, para no pisar lo que otra persona cambió con el plugin abierto.
 */
export function settingsEdits(base: Settings, draft: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    if (key === 'enabled') {
      const changed = ALL_CHECKS.filter((id) => draft.enabled[id] !== base.enabled[id]);
      if (changed.length) out.enabled = Object.fromEntries(changed.map((id) => [id, draft.enabled[id]]));
    } else if (JSON.stringify(draft[key]) !== JSON.stringify(base[key])) {
      out[key] = draft[key];
    }
  }
  return out as Partial<Settings>;
}

/**
 * La Definición de hecho del archivo, la misma para quien lo abra con el plugin. Lleva solo lo que difiere de
 * los valores por defecto: lo que nadie ha cambiado sigue a la versión del plugin.
 */
export function readFileSettings(): Partial<Settings> {
  let parsed: unknown;
  try {
    const raw = figma.root.getPluginData(SETTINGS_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const file = { ...(parsed as Partial<Settings>) };
  // El idioma es de cada persona.
  delete file.language;
  // Ajustes de una versión anterior: la lista de primitivas a mano, sin el interruptor de la detección.
  if (typeof file.primitiveAuto !== 'boolean' && Array.isArray(file.primitiveCollectionIds) && file.primitiveCollectionIds.length) {
    file.primitiveAuto = false;
  }
  return file;
}

/** Los ajustes del archivo con el idioma de quien usa el plugin. */
export async function loadSettings(): Promise<Settings> {
  let user: unknown = null;
  try {
    user = await figma.clientStorage.getAsync(SETTINGS_KEY);
  } catch {
    user = null;
  }
  // Antes se guardaba por usuario casi todo: de aquello solo sigue contando el idioma.
  const language = user && typeof user === 'object' ? (user as Partial<Settings>).language : undefined;
  return mergeSettings(readFileSettings(), { language });
}

/**
 * El idioma se guarda para quien usa el plugin y lo demás en el archivo. setPluginData cambia el documento, así
 * que el archivo solo se escribe si cambia su Definición de hecho: cambiar el idioma no lo toca.
 */
export async function saveSettings(next: Settings): Promise<void> {
  await figma.clientStorage.setAsync(SETTINGS_KEY, { language: next.language });
  const current = mergeSettings(readFileSettings(), { language: next.language });
  if (!Object.keys(settingsEdits(current, next)).length) return;
  const { language: _language, ...file } = settingsEdits(DEFAULT_SETTINGS, next);
  figma.root.setPluginData(SETTINGS_KEY, Object.keys(file).length ? JSON.stringify(file) : '');
}
