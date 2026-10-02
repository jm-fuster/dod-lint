// Tipos compartidos entre el sandbox (code.ts) y la interfaz (ui/ui.ts).
import type { LanguageSetting, Text } from './i18n';

export type Severity = 'error' | 'warning' | 'info';
export type Scope = 'selection' | 'page' | 'file';

export type CheckId =
  | 'auto-layout'
  | 'spacing'
  | 'text'
  | 'color'
  | 'primitive'
  | 'states'
  | 'stacked'
  | 'touch'
  | 'placeholder'
  | 'props'
  | 'slots'
  | 'description'
  | 'detached'
  | 'broken'
  | 'contrast';

/** Tema con el que la interfaz y el informe agrupan las reglas. */
export type CategoryId = 'layout' | 'tokens' | 'text' | 'components' | 'slots' | 'references' | 'accessibility';

export interface CheckMeta {
  id: CheckId;
  category: CategoryId;
  title: Text;
  description: Text;
  severity: Severity;
  fixable: boolean;
}

/**
 * Pista de corrección que el sandbox sabe aplicar (solo en la versión de pago). Lleva también lo que había
 * al auditar (`from`, `variableId`, `styleId`): si la capa ha cambiado desde entonces, la corrección se omite.
 */
export type FixHint =
  /** `fields`: los lados de un padding con el mismo valor, que se enlazan a la vez; `field` es el primero. */
  | { kind: 'bind-float'; field: string; fields?: string[]; variableId: string; from: number; snapTo?: number }
  | {
      kind: 'bind-color';
      target: 'fills' | 'strokes';
      index: number;
      variableId: string;
      /** Color literal de la pintura, o la primitiva a la que estaba enlazada. */
      from: { color: RGBA } | { variableId: string };
    }
  | { kind: 'unbind'; field: string; variableId: string }
  | { kind: 'unbind-paint'; target: 'fills' | 'strokes'; index: number; variableId: string }
  | { kind: 'clear-style'; field: 'fillStyleId' | 'strokeStyleId' | 'textStyleId' | 'effectStyleId' | 'gridStyleId'; styleId: string }
  | { kind: 'clear-mode'; collectionId: string; modeId: string };

export interface Finding {
  checkId: CheckId;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Ruta de capas desde la página, separada por " / ". */
  path: string;
  pageId: string;
  pageName: string;
  message: string;
  severity: Severity;
  fix?: FixHint;
  /** Con qué se ignora: la regla y la capa, o la capa original del componente si es un texto de instancia. */
  ignoreKey: string;
  /** Ignorado en este archivo: no cuenta ni se corrige, pero se puede ver y recuperar. */
  ignored?: boolean;
  /** Otras capas con el mismo resultado: el mismo texto de un componente en otras instancias. */
  alsoAt?: string[];
  /** Se señala en su instancia porque Figma devolvió la capa suelta (ver `NodeScope.anchor`). */
  anchored?: boolean;
  /** Sale de lo que una instancia sobrescribe en esta capa de dentro: al revisarla de nuevo, solo cuenta eso. */
  overridden?: boolean;
  /** Variable a la que enlaza la corrección, para nombrarla en su botón. */
  fixTo?: string;
  /**
   * Si la capa está dentro de una variante de un set: el set, la variante y la ruta de nombres desde ella.
   * La lista une el mismo hallazgo de la misma capa en varias variantes.
   */
  variantOf?: { setId: string; setName: string; variantId: string; variants: number; layerPath: string };
}

/** Una capa que volver a revisar después de editarla a mano. */
export interface RecheckTarget {
  nodeId: string;
  /** Texto de instancia: solo con las reglas que dependen de dónde está (el contraste). */
  placed?: boolean;
  /** Capa de dentro de una instancia: solo con lo que la instancia le sobrescribe, si aún le sobrescribe algo. */
  overridden?: boolean;
  /** Recorrer también lo que cuelga de ella, como en la auditoría (una instancia con capas sueltas). */
  deep?: boolean;
}

export interface Settings {
  enabled: Record<CheckId, boolean>;
  /** Idioma de la interfaz y de los hallazgos. Se guarda por usuario. */
  language: LanguageSetting;
  /** Detectar las colecciones primitivas automáticamente (ocultas o con nombre de primitiva, sin alias). */
  primitiveAuto: boolean;
  /** Colecciones tratadas como primitivas cuando primitiveAuto es false. Se guarda por archivo. */
  primitiveCollectionIds: string[];
  touchMin: number;
  includeHidden: boolean;
  includeInstanceInternals: boolean;
  includeTopLevelFrames: boolean;
  /** Revisar el espaciado y el radio solo dentro de componentes: para archivos de biblioteca. */
  spacingComponentsOnly: boolean;
  ignorePrefixes: string[];
  snapToScale: boolean;
  /** Estados de los botones y de cualquier control que no sea un campo ni un control de selección. */
  requiredStates: string[];
  /** Estados de los campos y de los controles de selección, que no se pulsan como un botón. */
  fieldStates: string[];
  interactivePattern: string;
  minDescriptionLength: number;
  /** Pedir a cada componente un enlace de documentación. */
  requireDocLinks: boolean;
}

export interface CollectionInfo {
  id: string;
  name: string;
  hidden: boolean;
  colorCount: number;
  floatCount: number;
  modeNames: string[];
  isPrimitive: boolean;
  /** La biblioteca de la que viene, si no es del archivo; vacío si es de un kit, que no lo dice. */
  library?: string;
}

export interface PaymentInfo {
  /** FREE = sin pago: el manifiesto no pide el permiso `payments` (se publica gratis) o estamos fuera de Figma. */
  type: 'PAID' | 'UNPAID' | 'NOT_SUPPORTED' | 'FREE';
  trialDaysLeft: number | null;
}

export interface FixItem {
  nodeId: string;
  fix: FixHint;
}

export type UIToCode =
  | { type: 'init'; locale?: string }
  /** Con los ajustes que tenga el archivo al empezar: el sandbox los lee. */
  | { type: 'audit'; scope: Scope }
  | { type: 'cancel' }
  /** Respuesta a `pause`: la auditoría puede seguir. */
  | { type: 'resume'; id: number }
  | { type: 'select'; nodeIds: string[] }
  | { type: 'fix'; checkId: CheckId; items: FixItem[] }
  /** Deshace la tanda que el sandbox numeró al corregir, si sigue siendo lo último que ha cambiado. */
  | { type: 'undo'; id: number }
  /** Ctrl+Z con el foco en el plugin y nada que deshacer desde el aviso: el deshacer de siempre de Figma. */
  | { type: 'undo-last' }
  | { type: 'ignore'; keys: string[]; ignore: boolean }
  | { type: 'recheck'; targets: RecheckTarget[] }
  | { type: 'checkout' }
  | { type: 'dev-payment'; status: 'PAID' | 'UNPAID' }
  /** Solo lo que cambia el borrador, para no pisar lo que otra persona haya guardado en el archivo. */
  | { type: 'save-settings'; edits: Partial<Settings>; silent?: boolean }
  | { type: 'notify'; message: string }
  | { type: 'resize'; width: number; height: number };

export type CodeToUI =
  | {
      type: 'ready';
      fileName: string;
      payment: PaymentInfo;
      collections: CollectionInfo[];
      settings: Settings;
      selectionCount: number;
      checks: CheckMeta[];
      dev: boolean;
    }
  | { type: 'progress'; phase: string; scanned: number; findings: number }
  /** La auditoría ha cedido el hilo y espera `resume` con el mismo id (ver `uiPause`). */
  | { type: 'pause'; id: number }
  | {
      type: 'results';
      findings: Finding[];
      scope: Scope;
      scanned: number;
      pages: number;
      durationMs: number;
      truncated: CheckId[];
      skippedContrast: number;
      /** La auditoría se canceló a medias: los hallazgos son parciales. */
      cancelled?: boolean;
      /** Capas de slots que Figma devolvió sueltas, sin sitio en la página. */
      looseNodes?: number;
      /** Tipos de token que no se usan, con cuántos valores escritos a mano no se avisan por eso capa a capa. */
      untokenized?: Partial<Record<'spacing' | 'radius', number>>;
    }
  /** undoId: la tanda, mientras «Deshacer» pueda deshacerla; no llega si no se corrigió nada. */
  | { type: 'fixed'; checkId: CheckId; fixed: FixItem[]; skipped: number; undoId?: number }
  /**
   * undone: Figma ha quitado la tanda. expired: ya no era lo último (otro cambio, o las capas cambiaron
   * después). other: Figma ha deshecho otro cambio, posterior, y las correcciones siguen puestas.
   */
  | { type: 'undone'; id: number; result: 'undone' | 'expired' | 'other' }
  /** Ha cambiado algo más en el archivo: esa tanda ya no se puede deshacer desde el plugin. */
  | { type: 'undo-gone'; id: number }
  | { type: 'ignored'; keys: string[]; ignore: boolean }
  /** Los hallazgos nuevos de las capas revisadas otra vez, que sustituyen a los suyos. */
  | { type: 'rechecked'; targets: string[]; findings: Finding[]; durationMs: number; cancelled: boolean }
  /** La página ha cambiado desde los últimos resultados. */
  | { type: 'stale' }
  | { type: 'payment'; payment: PaymentInfo }
  /** Los ajustes que valen: tras guardar, o al auditar si alguien los ha cambiado en el archivo. */
  | { type: 'settings'; settings: Settings }
  | { type: 'collections'; collections: CollectionInfo[] }
  /** Cuántas variables de las bibliotecas y los kits se han importado de cuántas; done = total, que ya acabó. */
  | { type: 'libraries'; done: number; total: number }
  | { type: 'selection'; count: number }
  | { type: 'locked'; feature: 'file' | 'fix' | 'export' }
  /** for: la petición que falló, para que la UI deje de esperar solo esa. Sin ella, un fallo de la auditoría. */
  | { type: 'error'; message: string; detail?: string; for?: UIToCode['type'] };
