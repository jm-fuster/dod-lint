// Interfaz del plugin. Se renderiza entera a partir de `state` en cada cambio,
// conservando scroll y foco para que el re-render sea invisible.
import type { CategoryId, CheckId, CheckMeta, CodeToUI, CollectionInfo, Finding, FixItem, PaymentInfo, Scope, Settings, Severity, UIToCode } from '../types';
import { DEFAULT_SETTINGS, mergeSettings, settingsEdits } from '../settings';
import { resolveLang } from '../i18n';
import type { Lang, LanguageSetting, Text } from '../i18n';
import { isPlacedKey } from '../ignore';
import { mergeRechecked, recheckTargets } from '../recheck';
import { rowsOf } from '../rows';
import type { Row } from '../rows';
import { ANCHORED, splitMessage } from './messages';

/** Lo último que se puede deshacer desde el aviso de abajo: una tanda de correcciones o lo último ignorado. */
type Undo =
  | { kind: 'fix'; id: number; count: number; before: Finding[] }
  | { kind: 'ignore'; keys: string[]; ignore: boolean };
interface Toast {
  text: string;
  undo?: Undo;
}

interface State {
  ready: boolean;
  fileName: string;
  payment: PaymentInfo;
  collections: CollectionInfo[];
  settings: Settings | null;
  selectionCount: number;
  checks: CheckMeta[];
  dev: boolean;
  scope: Scope;
  running: boolean;
  cancelling: boolean;
  progress: { scanned: number; findings: number } | null;
  /** Variables de las bibliotecas y los kits que se están importando: cuántas van de cuántas. */
  libraryLoad: { done: number; total: number } | null;
  results: Extract<CodeToUI, { type: 'results' }> | null;
  findings: Finding[];
  open: Set<CheckId>;
  shown: Map<CheckId, number>;
  view: 'main' | 'settings' | 'report';
  notice: string | null;
  /** Aviso de abajo que se va solo; con «Deshacer» si lo último se puede deshacer desde aquí. */
  toast: Toast | null;
  /** Tanda que el sandbox está deshaciendo. */
  undoing: Extract<Undo, { kind: 'fix' }> | null;
  /** El próximo «ignorado» viene de «Deshacer»: no se ofrece deshacerlo otra vez. */
  undoingIgnore: boolean;
  /** Hay una tanda de correcciones en el sandbox: no se manda otra hasta que vuelva. */
  fixing: boolean;
  /** Lo quitado al corregir desde la auditoría: «Actualizar la lista» revisa también sus capas, por si se deshizo. */
  fixedSince: Finding[];
  error: { message: string; detail?: string } | null;
  draft: Settings | null;
  /** Tras una auditoría, llevar la vista al principio de los resultados. */
  scrollToResults: boolean;
  /** Reglas con la descripción abierta en ajustes. */
  rulesInfo: Set<CheckId>;
  /**
   * Las severidades que se ven. La información empieza oculta: en la página Buttons de Material 3 eran 2.013 de
   * 3.185 hallazgos, y tapaba los 144 errores y los 1.028 avisos (octubre de 2026).
   */
  severities: ReadonlySet<Severity>;
  fixableOnly: boolean;
  /** Ver solo los hallazgos ignorados, para recuperarlos. */
  showIgnored: boolean;
  /** La página ha cambiado desde los resultados: «Revisar de nuevo» se destaca. */
  stale: boolean;
  query: string;
  /** Fila del último hallazgo seleccionado en el lienzo. */
  active: string | null;
}

const state: State = {
  ready: false,
  fileName: '',
  payment: { type: 'FREE', trialDaysLeft: null },
  collections: [],
  settings: null,
  selectionCount: 0,
  checks: [],
  dev: false,
  scope: 'page',
  running: false,
  cancelling: false,
  progress: null,
  libraryLoad: null,
  results: null,
  findings: [],
  open: new Set(),
  shown: new Map(),
  view: 'main',
  notice: null,
  toast: null,
  undoing: null,
  undoingIgnore: false,
  fixing: false,
  fixedSince: [],
  error: null,
  draft: null,
  scrollToResults: false,
  rulesInfo: new Set(),
  severities: new Set<Severity>(['error', 'warning']),
  fixableOnly: false,
  showIgnored: false,
  stale: false,
  query: '',
  active: null,
};

const PAGE_SIZE = 150;
const app = document.getElementById('app')!;
const status = document.getElementById('status')!;
const post = (msg: UIToCode) => parent.postMessage({ pluginMessage: msg }, '*');

/** Idioma de la interfaz: el de los ajustes o, en automático, el del sistema. */
const lang = (): Lang => resolveLang(state.settings?.language, navigator.language);
const tx = (text: Text) => text[lang()];

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Misma regla que payments.ts: NOT_SUPPORTED es un error y no desbloquea nada. */
const isPro = () =>
  state.payment.type === 'PAID' ||
  state.payment.type === 'FREE' ||
  (state.payment.trialDaysLeft !== null && state.payment.trialDaysLeft > 0);

const SEVERITY_LABEL: Record<Severity, Text> = {
  error: { es: 'Error', en: 'Error' },
  warning: { es: 'Aviso', en: 'Warning' },
  info: { es: 'Info', en: 'Info' },
};

/** Nombre de cada categoría, en el orden en que salen en la interfaz y en el informe. */
const CATEGORIES: Record<CategoryId, Text> = {
  layout: { es: 'Layout', en: 'Layout' },
  tokens: { es: 'Tokens', en: 'Tokens' },
  text: { es: 'Texto', en: 'Text' },
  components: { es: 'Componentes', en: 'Components' },
  slots: { es: 'Slots', en: 'Slots' },
  references: { es: 'Referencias', en: 'References' },
  accessibility: { es: 'Accesibilidad', en: 'Accessibility' },
};
const CATEGORY_ORDER = Object.keys(CATEGORIES) as CategoryId[];
/** Reglas agrupadas por categoría; dentro de cada una, en el orden en que las registra el sandbox. */
const orderedChecks = () => [...state.checks].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

const iconRules: string[] = [];
/**
 * Icono de trazo de 16 × 16, pintado con una máscara del color del texto. Un solo elemento por icono: con cientos de
 * filas, los SVG en línea eran un tercio de la página y casi la mitad de lo que costaba pintarla. El CSP de un plugin
 * sin red es `default-src data:`, así que las máscaras en data: cargan.
 */
const svg = (body: string, cls = 'ico') => {
  const name = `i${iconRules.length}`;
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(src)}")`;
  iconRules.push(`.${name}{-webkit-mask-image:${url};mask-image:${url}}`);
  return `<span class="${cls} mask ${name}" aria-hidden="true"></span>`;
};
const ICON = {
  // La marca (docs/brand.md) con sus colores, los mismos con el tema claro y con el oscuro de Figma.
  logo: `<svg class="ico logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#111318"/><g stroke-width="9" stroke-linecap="round"><path d="M15.34 34.14 21 39.8" stroke="#d4ff3f"/><path d="M33 39.8 48.56 24.24" stroke="#eef0f4"/></g></svg>`,
  settings: svg('<path d="M3 5h4M11 5h2M3 11h2M9 11h4"/><circle cx="9" cy="5" r="1.75"/><circle cx="7" cy="11" r="1.75"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7"/>', 'ico sm'),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25L13 13"/>', 'ico sm'),
  close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', 'ico sm'),
  chevron: svg('<path d="M4.5 6.5L8 10l3.5-3.5"/>'),
  // Llave inglesa: corregir es reparar, no magia.
  fix: svg('<path d="M10.2 2.6a3.3 3.3 0 0 0-3.9 4.35L2.7 10.55a1.45 1.45 0 0 0 2.05 2.05l3.6-3.6a3.3 3.3 0 0 0 4.35-3.9l-2.05 2.05-1.75-.35-.35-1.75z"/>', 'ico sm'),
  info: svg('<circle cx="8" cy="8" r="5.75"/><path d="M8 7.5v3.5M8 5.25v.01"/>', 'ico sm'),
  back: svg('<path d="M9.5 4L5.5 8l4 4"/>'),
  grip: svg('<path d="M13 7l-6 6M13 11l-2 2"/>', 'ico sm'),
  refresh: svg('<path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71"/><path d="M13.25 2.5v2.75H10.5"/>', 'ico sm'),
  eye: svg('<path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"/><circle cx="8" cy="8" r="1.75"/>', 'ico sm'),
  unchecked: svg('<rect x="3" y="3" width="10" height="10" rx="2.5"/>', 'ico sm'),
  checked: svg('<rect x="3" y="3" width="10" height="10" rx="2.5"/><path d="M5.5 8.25l1.75 1.75 3.25-3.5"/>', 'ico sm'),
  target: svg('<circle cx="8" cy="8" r="3.25"/><path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5"/>', 'ico xs'),
  eyeOff: svg('<path d="M2.5 2.5l11 11"/><path d="M6.5 4A6 6 0 0 1 8 3.75C12 3.75 14.25 8 14.25 8a11.5 11.5 0 0 1-1.85 2.45M9.6 12a6 6 0 0 1-1.6.25C4 12.25 1.75 8 1.75 8A11.6 11.6 0 0 1 4 5.2"/>', 'ico sm'),
};
document.head.insertAdjacentHTML('beforeend', `<style>${iconRules.join('')}</style>`);

const announce = (text: string) => {
  status.textContent = text;
};

let toastTimer = 0;
/** Aviso de abajo que se va solo: confirma algo que ya se ve en la lista y, si se puede, ofrece deshacerlo. */
function flash(text: string, undo?: Undo) {
  const toast: Toast = { text, undo };
  state.toast = toast;
  clearTimeout(toastTimer);
  const hide = () => {
    if (state.toast !== toast) return;
    // Con el ratón o el foco encima, espera: puede estar a punto de pulsar «Deshacer».
    if (document.querySelector('.toast:hover, .toast:focus-within')) {
      toastTimer = window.setTimeout(hide, 1500);
      return;
    }
    state.toast = null;
    render();
  };
  toastTimer = window.setTimeout(hide, undo ? 8000 : 5000);
}

/** Recuentos con el separador de miles de cada idioma: «8800» en español, donde cuatro cifras van juntas, y «8,800» en inglés. */
const num = (n: number) => n.toLocaleString(lang() === 'es' ? 'es-ES' : 'en-US');

/** Capas, como las llama Figma en su panel; decía «nodos». */
const layersText = (n: number) => (n === 1 ? tx({ es: '1 capa', en: '1 layer' }) : tx({ es: `${num(n)} capas`, en: `${num(n)} layers` }));
const scannedText = (n: number) =>
  n === 1 ? tx({ es: '1 capa analizada', en: '1 layer scanned' }) : tx({ es: `${num(n)} capas analizadas`, en: `${num(n)} layers scanned` });
const findingsText = (n: number) => (n === 1 ? tx({ es: '1 hallazgo', en: '1 finding' }) : tx({ es: `${num(n)} hallazgos`, en: `${num(n)} findings` }));

const progressText = (scanned: number, findings: number) => `${scannedText(scanned)} · ${findingsText(findings)}`;
const libraryLoadText = ({ done, total }: { done: number; total: number }) =>
  tx({ es: `Cargando las variables de las bibliotecas: ${num(done)} de ${num(total)}…`, en: `Loading library variables: ${num(done)} of ${num(total)}…` });
/** Mientras se audita: lo recorrido o, si aún se espera a las bibliotecas, lo que llevan. */
const runningText = () =>
  state.progress && state.progress.scanned
    ? progressText(state.progress.scanned, state.progress.findings)
    : state.libraryLoad
      ? libraryLoadText(state.libraryLoad)
      : tx({ es: 'Preparando…', en: 'Preparing…' });

/** Segundos con la coma o el punto que toque ("0,5 s" en español). */
const seconds = (ms: number) => `${(ms / 1000).toLocaleString(lang() === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;

// ---------- Mensajes del sandbox ----------

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as CodeToUI | undefined;
  if (!msg) return;
  switch (msg.type) {
    case 'pause':
      // La auditoría ha cedido el hilo y espera la vuelta: se contesta enseguida, sin redibujar.
      post({ type: 'resume', id: msg.id });
      return;
    case 'ready':
      state.ready = true;
      state.fileName = msg.fileName;
      state.payment = msg.payment;
      state.collections = msg.collections;
      state.settings = msg.settings;
      state.selectionCount = msg.selectionCount;
      state.checks = msg.checks;
      state.dev = msg.dev;
      if (state.scope === 'selection' && msg.selectionCount === 0) state.scope = 'page';
      break;
    case 'progress': {
      state.progress = { scanned: msg.scanned, findings: msg.findings };
      const text = progressText(msg.scanned, msg.findings);
      announce(text);
      // Actualización en sitio: no hay que reconstruir la vista en cada tick.
      const el = document.getElementById('progress-text');
      if (el) {
        el.textContent = text;
        return;
      }
      if (state.view !== 'main') return;
      break;
    }
    case 'results':
      state.running = false;
      state.cancelling = false;
      state.progress = null;
      state.results = msg;
      state.scrollToResults = true;
      state.findings = msg.findings;
      state.open = new Set();
      state.shown = new Map();
      state.active = null;
      state.showIgnored = false;
      state.stale = false;
      state.fixedSince = [];
      // Una tanda que acabase con la auditoría ya en marcha dejaría un «Deshacer» con la lista de antes.
      if (state.toast?.undo?.kind === 'fix') state.toast.undo = undefined;
      {
        const first = orderedChecks().find((c) => msg.findings.some((f) => f.checkId === c.id && f.severity === 'error' && !f.ignored));
        if (first) state.open.add(first.id);
      }
      {
        const [n, s] = [msg.findings.filter((f) => !f.ignored).length, msg.scanned];
        const notes: string[] = [];
        if (msg.cancelled) notes.push(tx({ es: `Auditoría cancelada: resultados parciales de ${layersText(s)}.`, en: `Audit cancelled: partial results from ${layersText(s)}.` }));
        if (notes.length) state.notice = notes.join(' ');
        announce(tx({ es: `Auditoría terminada: ${findingsText(n)} en ${layersText(s)}`, en: `Audit finished: ${findingsText(n)} in ${layersText(s)}` }));
      }
      break;
    case 'fixed': {
      state.fixing = false;
      clearTimeout(fixingTimer);
      const before = state.findings;
      const done = new Set(msg.fixed.map((i) => i.nodeId + '|' + JSON.stringify(i.fix)));
      const isDone = (f: Finding) => f.checkId === msg.checkId && !!f.fix && done.has(f.nodeId + '|' + JSON.stringify(f.fix));
      state.fixedSince = [...state.fixedSince, ...state.findings.filter(isDone)];
      state.findings = state.findings.filter((f) => !isDone(f));
      const [n, s] = [msg.fixed.length, msg.skipped];
      if (s) {
        // Esas capas ya no están como en la auditoría: la franja de «Actualizar la lista» las revisa de nuevo.
        state.stale = true;
        state.notice = tx({
          es: `${num(s)} sin corregir: la capa o la variable cambiaron desde la auditoría. Actualiza la lista para ver cómo están ahora.`,
          en: `${num(s)} not fixed: the layer or the variable changed after the audit. Update the list to see where they stand now.`,
        });
      }
      // La tanda anterior ya no se puede deshacer desde aquí: el sandbox solo guarda la última.
      state.toast = null;
      if (n) flash(tx({ es: `${num(n)} ${n === 1 ? 'corregido' : 'corregidos'}`, en: `${num(n)} fixed` }), msg.undoId ? { kind: 'fix', id: msg.undoId, count: n, before } : undefined);
      announce(n === 1 ? tx({ es: '1 corrección aplicada', en: '1 fix applied' }) : tx({ es: `${num(n)} correcciones aplicadas`, en: `${num(n)} fixes applied` }));
      break;
    }
    case 'undone': {
      const u = state.undoing;
      if (!u || u.id !== msg.id) return;
      state.undoing = null;
      if (msg.result === 'undone') {
        // Figma ha quitado la tanda entera: la lista vuelve a como estaba justo antes de corregir.
        state.findings = u.before;
        flash(u.count === 1 ? tx({ es: 'Corrección deshecha', en: 'Fix undone' }) : tx({ es: `${num(u.count)} correcciones deshechas`, en: `${num(u.count)} fixes undone` }));
      } else {
        // No se sabe qué ha cambiado: la franja de arriba ofrece actualizar la lista.
        state.stale = true;
        state.notice =
          msg.result === 'other'
            ? tx({
                // Rehacer no llega desde el plugin: la API no tiene triggerRedo y Figma no recibe el atajo con el foco aquí.
                es: 'Figma ha deshecho un cambio posterior en lugar de las correcciones. Para rehacerlo, pulsa en el lienzo y luego Ctrl+Mayús+Z (Cmd+Mayús+Z en Mac).',
                en: 'Figma undid a later change instead of the fixes. To redo it, click the canvas, then press Ctrl+Shift+Z (Cmd+Shift+Z on Mac).',
              })
            : tx({
                es: 'Ya no se puede deshacer desde aquí: ha habido otro cambio después. Usa Ctrl+Z (Cmd+Z en Mac).',
                en: 'Can’t undo from here anymore: something else changed afterwards. Use Ctrl+Z (Cmd+Z on Mac).',
              });
      }
      announce(state.toast?.text ?? state.notice ?? '');
      break;
    }
    case 'undo-gone':
      if (state.toast?.undo?.kind !== 'fix' || state.toast.undo.id !== msg.id) return;
      // Ha cambiado algo más: el aviso se queda, sin «Deshacer».
      state.toast.undo = undefined;
      if (state.view !== 'main') return;
      break;
    case 'rechecked': {
      state.running = false;
      state.cancelling = false;
      state.progress = null;
      if (msg.cancelled) {
        state.notice = tx({ es: 'Revisión cancelada: la lista sigue como estaba.', en: 'Check cancelled: the list is unchanged.' });
        announce(state.notice);
        break;
      }
      const ids = new Set(msg.targets);
      const before = state.findings.filter((f) => ids.has(f.nodeId) && !f.ignored).length;
      const after = msg.findings.filter((f) => !f.ignored).length;
      state.findings = mergeRechecked(state.findings, msg.targets, msg.findings);
      state.stale = false;
      const n = ids.size;
      const time = seconds(msg.durationMs);
      flash(
        tx({
          es: `Lista actualizada: ${num(n)} ${n === 1 ? 'capa revisada' : 'capas revisadas'} en ${time}, ${num(before)} ${before === 1 ? 'hallazgo' : 'hallazgos'} antes y ${num(after)} ahora.`,
          en: `List updated: ${num(n)} ${n === 1 ? 'layer' : 'layers'} checked in ${time}, ${num(before)} ${before === 1 ? 'finding' : 'findings'} before and ${num(after)} now.`,
        }),
      );
      announce(state.toast?.text ?? '');
      break;
    }
    case 'stale':
      if (!state.results) return;
      state.stale = true;
      if (state.view !== 'main') return;
      break;
    case 'ignored': {
      const keys = new Set(msg.keys);
      for (const f of state.findings) if (keys.has(f.ignoreKey)) f.ignored = msg.ignore;
      ignoredVersion++;
      const text = msg.ignore
        ? tx({ es: 'Ignorado en este archivo, también para quien lo abra con DoD Lint. Lo tienes en «Ignorados».', en: 'Ignored in this file, also for anyone who opens it with DoD Lint. It’s under “Ignored”.' })
        : tx({ es: 'Ya no se ignora.', en: 'No longer ignored.' });
      // Lo que viene de «Deshacer» no se ofrece deshacerlo otra vez.
      flash(text, state.undoingIgnore ? undefined : { kind: 'ignore', keys: msg.keys, ignore: msg.ignore });
      state.undoingIgnore = false;
      announce(text);
      break;
    }
    case 'payment':
      state.payment = msg.payment;
      if (msg.payment.type === 'PAID') state.notice = null;
      break;
    case 'settings':
      // Un borrador a medias conserva lo que has cambiado tú, encima de los que llegan.
      if (state.draft && state.settings) state.draft = mergeSettings(msg.settings, settingsEdits(state.settings, state.draft));
      state.settings = msg.settings;
      if (state.view === 'settings') return;
      break;
    case 'collections':
      state.collections = msg.collections;
      if (state.view === 'settings') return;
      break;
    case 'libraries': {
      state.libraryLoad = msg.done < msg.total ? { done: msg.done, total: msg.total } : null;
      // En sitio, como el progreso: en la vista de una auditoría que espera, y en ajustes, junto a las colecciones.
      const running = document.getElementById('progress-text');
      if (running) running.textContent = runningText();
      const inSettings = document.getElementById('library-load');
      if (inSettings) {
        inSettings.textContent = state.libraryLoad ? libraryLoadText(state.libraryLoad) : '';
        inSettings.hidden = !state.libraryLoad;
      }
      return;
    }
    case 'selection': {
      const scope = state.scope;
      state.selectionCount = msg.count;
      if (state.scope === 'selection' && msg.count === 0 && !state.running) state.scope = 'page';
      if (state.view !== 'main') return;
      // Cada clic en el lienzo cambia la selección: con miles de hallazgos, redibujar la lista entera se notaba.
      if (state.scope === scope && swapSelectionButton()) return;
      break;
    }
    case 'locked':
      state.running = false;
      state.cancelling = false;
      state.progress = null;
      state.fixing = false;
      state.notice = lockedMessage(msg.feature);
      break;
    case 'error':
      // Cada fallo suelta solo lo que esperaba su petición: uno al seleccionar no da por acabada una tanda.
      if (!msg.for || msg.for === 'audit' || msg.for === 'recheck') {
        state.running = false;
        state.cancelling = false;
        state.progress = null;
      }
      if (msg.for === 'fix' && state.fixing) {
        state.fixing = false;
        state.toast = null; // «Corrigiendo…»
      }
      if (msg.for === 'undo') state.undoing = null;
      state.error = { message: msg.message, detail: msg.detail };
      announce(msg.message);
      break;
  }
  render();
};

function lockedMessage(feature: 'file' | 'fix' | 'export'): string {
  if (state.payment.type === 'NOT_SUPPORTED') {
    return tx({
      es: 'No se pudo comprobar tu licencia. Pulsa "Licencia no verificada" para reintentarlo.',
      en: 'Your license couldn’t be verified. Click "License not verified" to try again.',
    });
  }
  const sentences: Record<typeof feature, Text> = {
    file: { es: 'Auditar el archivo completo es una función Pro.', en: 'Auditing the whole file is a Pro feature.' },
    fix: { es: 'Corregir automáticamente es una función Pro.', en: 'Automatic fixes are a Pro feature.' },
    export: { es: 'Exportar el informe es una función Pro.', en: 'Exporting the report is a Pro feature.' },
  };
  return tx(sentences[feature]);
}

// ---------- Filas y filtros ----------

/** Ignorar marca los hallazgos en su sitio, sin cambiar de lista: esto cuenta cada vez. */
let ignoredVersion = 0;

/** Una regla en la lista: sus hallazgos visibles, en filas. */
interface Group {
  findings: Finding[];
  rows: Row[];
  fixable: number;
  worst: Severity;
  /** Alguna fila se puede corregir: todas guardan el hueco del botón. */
  hasFixes: boolean;
}
let groupsMemo: { key: unknown[]; groups: Map<CheckId, Group> } | null = null;

/**
 * Los hallazgos visibles, por regla y en filas. Con miles, agruparlos costaba más que pintar la lista, así que solo
 * se rehace cuando cambian ellos o los filtros, no en cada redibujado.
 */
function visibleGroups(): Map<CheckId, Group> {
  const key = [state.findings, state.severities, state.query, state.fixableOnly, state.showIgnored, ignoredVersion];
  if (groupsMemo && key.every((k, i) => k === groupsMemo!.key[i])) return groupsMemo.groups;
  const byCheck = new Map<CheckId, Finding[]>();
  for (const f of state.findings) {
    if (!matches(f)) continue;
    const list = byCheck.get(f.checkId);
    if (list) list.push(f);
    else byCheck.set(f.checkId, [f]);
  }
  const groups = new Map<CheckId, Group>();
  for (const [id, findings] of byCheck) {
    const rows = rowsOf(findings);
    groups.set(id, {
      findings,
      rows,
      fixable: findings.filter((f) => f.fix).length,
      worst: findings.some((f) => f.severity === 'error') ? 'error' : findings.some((f) => f.severity === 'warning') ? 'warning' : 'info',
      hasFixes: rows.some((row) => row.fixes.length > 0),
    });
  }
  groupsMemo = { key, groups };
  return groups;
}

function matches(f: Finding): boolean {
  // Los ignorados solo se ven con su filtro, y entonces solo ellos.
  if (!!f.ignored !== state.showIgnored) return false;
  if (!state.severities.has(f.severity)) return false;
  if (state.fixableOnly && !state.showIgnored && !f.fix) return false;
  const q = state.query.trim().toLowerCase();
  return !q || `${f.message} ${f.nodeName} ${f.path}`.toLowerCase().includes(q);
}

/** Lo que hace una corrección, corto para su botón y entero para su descripción. */
function fixLabel(fix: FixItem['fix'], target?: string): { label: string; title: string } {
  // Los dos últimos tramos del nombre: con uno solo, «space/3» se quedaba en «3».
  const short = target ? target.split('/').slice(-2).join('/') : '';
  switch (fix.kind) {
    case 'bind-float': {
      // Los lados iguales de un padding se enlazan a la vez: se dice cuántos.
      const sides = fix.fields && fix.fields.length > 1 ? fix.fields.length : 0;
      const where = sides ? tx({ es: ` en ${sides} lados`, en: ` on ${sides} sides` }) : '';
      if (fix.snapTo !== undefined && target) {
        return { label: `${fix.snapTo} · ${short}`, title: tx({ es: `Ajustar a ${fix.snapTo} y enlazar ${target}`, en: `Snap to ${fix.snapTo} and bind ${target}` }) + where };
      }
      return target ? { label: short, title: tx({ es: `Enlazar ${target}`, en: `Bind ${target}` }) + where } : { label: tx({ es: 'Corregir', en: 'Fix' }), title: tx({ es: 'Enlazar la variable', en: 'Bind the variable' }) + where };
    }
    case 'bind-color':
      return target ? { label: short, title: tx({ es: `Enlazar ${target}`, en: `Bind ${target}` }) } : { label: tx({ es: 'Corregir', en: 'Fix' }), title: tx({ es: 'Enlazar la variable', en: 'Bind the variable' }) };
    case 'unbind':
    case 'unbind-paint':
      return { label: tx({ es: 'Desenlazar', en: 'Unbind' }), title: tx({ es: 'Quitar el enlace a la variable que ya no existe', en: 'Remove the link to the variable that no longer exists' }) };
    case 'clear-style':
      return { label: tx({ es: 'Quitar estilo', en: 'Remove style' }), title: tx({ es: 'Quitar el estilo que ya no existe', en: 'Remove the style that no longer exists' }) };
    case 'clear-mode':
      return { label: tx({ es: 'Quitar modo', en: 'Remove mode' }), title: tx({ es: 'Quitar el modo de una colección que ya no existe', en: 'Remove the mode of a collection that no longer exists' }) };
  }
}

/** Filas pintadas en la última vista, por clave: las acciones de cada fila las buscan aquí. */
let rowIndex = new Map<string, Row>();

// ---------- Acciones ----------

function startAudit() {
  // Durante una tanda o un deshacer, la lista nueva no casaría con lo que ellos devuelven.
  if (!state.settings || state.running || state.fixing || state.undoing) return;
  if (!state.checks.some((c) => state.settings!.enabled[c.id])) {
    state.error = { message: tx({ es: 'Activa al menos una comprobación antes de auditar.', en: 'Turn on at least one check before auditing.' }) };
    render();
    return;
  }
  state.error = null;
  state.notice = null;
  state.toast = null;
  state.running = true;
  state.cancelling = false;
  state.progress = { scanned: 0, findings: 0 };
  // Se vacía la lista anterior para que los ticks de progreso no reconstruyan cientos de filas.
  state.results = null;
  state.findings = [];
  post({ type: 'audit', scope: state.scope });
  announce(tx({ es: 'Auditoría en curso', en: 'Audit in progress' }));
  render();
}

function setAllChecks(value: boolean) {
  if (!state.draft) return;
  for (const c of state.checks) state.draft.enabled[c.id] = value;
  render();
}

/** Corrige lo que se ve de una regla: si hay un filtro activo, solo las filas visibles. */
function fixGroup(checkId: CheckId) {
  if (!isPro()) {
    state.notice = lockedMessage('fix');
    render();
    return;
  }
  const items: FixItem[] = state.findings.filter((f) => f.checkId === checkId && f.fix && !f.ignored && matches(f)).map((f) => ({ nodeId: f.nodeId, fix: f.fix! }));
  if (!items.length) return;
  sendFix(checkId, items);
}

/** Corrige solo una fila: sus hallazgos, varios si la fila une repetidos. Para probar antes de corregir en bloque. */
function fixRow(key: string) {
  if (!isPro()) {
    state.notice = lockedMessage('fix');
    render();
    return;
  }
  const row = rowIndex.get(key);
  if (!row?.fixes.length) return;
  sendFix(row.finding.checkId, row.fixes);
}

let fixingTimer = 0;
/**
 * Una tanda cada vez: la segunda, mandada antes de que vuelva la primera, daría todo por omitido. Tampoco
 * mientras se actualiza la lista, que podría traer de vuelta lo recién corregido.
 */
function sendFix(checkId: CheckId, items: FixItem[]) {
  if (state.fixing || state.undoing || state.running) return;
  state.fixing = true;
  // La tanda anterior deja de poder deshacerse desde aquí: su «Deshacer», si aún se ve, ya no hace nada.
  if (state.toast?.undo) state.toast.undo = undefined;
  post({ type: 'fix', checkId, items });
  // Una tanda grande tarda: si no ha vuelto en un momento, el aviso de abajo lo dice.
  clearTimeout(fixingTimer);
  fixingTimer = window.setTimeout(() => {
    if (!state.fixing) return;
    state.toast = { text: tx({ es: `Corrigiendo ${num(items.length)}…`, en: `Fixing ${num(items.length)}…` }) };
    render();
  }, 300);
}

function buildReport(): string {
  const r = state.results;
  if (!r || !state.settings) return '';
  const scopeLabel = {
    selection: tx({ es: 'Selección', en: 'Selection' }),
    page: tx({ es: 'Página actual', en: 'Current page' }),
    file: tx({ es: 'Archivo completo', en: 'Whole file' }),
  }[r.scope];
  const date = new Date().toLocaleString(lang() === 'es' ? 'es-ES' : 'en-US');
  const pages = r.pages === 1 ? tx({ es: '1 página', en: '1 page' }) : tx({ es: `${r.pages} páginas`, en: `${r.pages} pages` });
  // Los ignorados no cuentan: van al final, en su propia sección.
  const active = state.findings.filter((f) => !f.ignored);
  const ignored = state.findings.filter((f) => f.ignored);
  const line = (f: Finding) => `${f.path ? `${f.path} / ` : ''}**${f.nodeName}**: ${f.message}`;
  const lines: string[] = [];
  lines.push(tx({ es: `# Informe DoD Lint · ${state.fileName}`, en: `# DoD Lint report · ${state.fileName}` }));
  lines.push('');
  lines.push(tx({ es: `- Fecha: ${date}`, en: `- Date: ${date}` }));
  lines.push(tx({ es: `- Alcance: ${scopeLabel} (${pages})`, en: `- Scope: ${scopeLabel} (${pages})` }));
  lines.push(tx({ es: `- Capas analizadas: ${num(r.scanned)}`, en: `- Layers scanned: ${num(r.scanned)}` }));
  lines.push(tx({ es: `- Hallazgos: ${num(active.length)}`, en: `- Findings: ${num(active.length)}` }));
  if (ignored.length) lines.push(tx({ es: `- Ignorados: ${num(ignored.length)}`, en: `- Ignored: ${num(ignored.length)}` }));
  lines.push(tx({ es: `- Duración: ${seconds(r.durationMs)}`, en: `- Duration: ${seconds(r.durationMs)}` }));
  if (r.cancelled) lines.push(tx({ es: '- Auditoría cancelada: resultados parciales', en: '- Audit cancelled: partial results' }));
  if (r.looseNodes) lines.push(tx({ es: `- Capas de slots sin su sitio en la página: ${r.looseNodes} (señaladas en su instancia, sin correcciones)`, en: `- Slot layers detached from the page: ${r.looseNodes} (shown on their instance, no fixes)` }));
  lines.push('');
  lines.push(tx({ es: '## Resumen', en: '## Summary' }));
  lines.push('');
  lines.push(tx({ es: '| Categoría | Comprobación | Errores | Avisos | Info | Total |', en: '| Category | Check | Errors | Warnings | Info | Total |' }));
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const c of orderedChecks()) {
    if (!state.settings.enabled[c.id]) continue;
    const fs = active.filter((f) => f.checkId === c.id);
    const n = (s: string) => fs.filter((f) => f.severity === s).length;
    const trunc = r.truncated.includes(c.id) ? tx({ es: ' (truncado)', en: ' (truncated)' }) : '';
    lines.push(`| ${tx(CATEGORIES[c.category])} | ${tx(c.title)} | ${n('error')} | ${n('warning')} | ${n('info')} | ${fs.length}${trunc} |`);
  }
  lines.push('');
  lines.push(tx({ es: '## Detalle', en: '## Details' }));
  for (const c of orderedChecks()) {
    const fs = active.filter((f) => f.checkId === c.id);
    if (!fs.length) continue;
    lines.push('');
    lines.push(`### ${tx(c.title)} (${fs.length})`);
    lines.push('');
    lines.push(`_${tx(c.description)}_`);
    lines.push('');
    const byPage = new Map<string, Finding[]>();
    for (const f of fs) byPage.set(f.pageName, [...(byPage.get(f.pageName) ?? []), f]);
    for (const [page, list] of byPage) {
      if (byPage.size > 1) lines.push(`**${page}**`);
      const cap = 300;
      for (const f of list.slice(0, cap)) {
        const fixable = f.fix ? tx({ es: ' _(corregible)_', en: ' _(fixable)_' }) : '';
        lines.push(`- [${tx(SEVERITY_LABEL[f.severity])}] ${line(f)}${fixable}`);
      }
      const more = list.length - cap;
      if (more > 0) lines.push(tx({ es: `- … y ${more} más`, en: `- … and ${more} more` }));
      lines.push('');
    }
  }
  if (ignored.length) {
    lines.push(tx({ es: `## Ignorados (${ignored.length})`, en: `## Ignored (${ignored.length})` }));
    lines.push('');
    for (const c of orderedChecks()) for (const f of ignored.filter((i) => i.checkId === c.id)) lines.push(`- ${tx(c.title)} · ${line(f)}`);
    lines.push('');
  }
  const untokenized = untokenizedTexts(r.untokenized);
  if (r.skippedContrast || untokenized.length) {
    const n = r.skippedContrast;
    lines.push(tx({ es: '## No evaluado', en: '## Not evaluated' }));
    lines.push('');
    if (n) {
      lines.push(tx({
        es: `- Contraste: ${num(n)} ${n === 1 ? 'texto' : 'textos'} sin un fondo sólido determinable (imagen, degradado, color mixto o sin relleno).`,
        en: `- Contrast: ${num(n)} text ${n === 1 ? 'layer' : 'layers'} without a solid background to measure against (image, gradient, mixed color or no fill).`,
      }));
    }
    for (const t of untokenized) lines.push(`- ${t}.`);
    lines.push('');
  }
  lines.push('---');
  lines.push(tx({
    es: 'Generado con DoD Lint. Las reglas siguen la Definición de hecho de un componente: auto layout, tokens, estados, objetivo táctil, contenido real, propiedades, slots, documentación, referencias y contraste.',
    en: 'Generated with DoD Lint. The checks follow a component Definition of Done: auto layout, tokens, states, touch target, real content, properties, slots, documentation, references and contrast.',
  }));
  return lines.join('\n');
}

async function copyReport() {
  const text = buildReport();
  const copied = tx({ es: 'Informe copiado al portapapeles', en: 'Report copied to the clipboard' });
  try {
    await navigator.clipboard.writeText(text);
    post({ type: 'notify', message: copied });
    return;
  } catch {
    // El iframe del plugin suele denegar la Clipboard API: se usa el textarea como alternativa.
  }
  const ta = document.getElementById('report-text') as HTMLTextAreaElement | null;
  if (!ta) return;
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  const manual = tx({ es: 'No se pudo copiar automáticamente: el texto queda seleccionado, pulsa Ctrl/Cmd+C', en: 'Couldn’t copy automatically: the text is selected, press Ctrl/Cmd+C' });
  post({ type: 'notify', message: ok ? copied : manual });
}

function downloadReport() {
  const text = buildReport();
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base =
    state.fileName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || tx({ es: 'informe', en: 'report' });
  a.href = url;
  a.download = `dod-lint-${base}.md`;
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

// ---------- Render ----------

function render() {
  document.documentElement.lang = lang();
  if (!state.ready) {
    app.innerHTML = `<div class="ok"><span class="muted">${tx({ es: 'Cargando variables y ajustes…', en: 'Loading variables and settings…' })}</span></div>`;
    return;
  }
  // Conserva scroll, foco y cursor: el DOM se reconstruye entero.
  const prevBody = app.querySelector<HTMLElement>('.body');
  const scrollTop = prevBody?.scrollTop ?? 0;
  const active = document.activeElement as HTMLElement | null;
  let focusKey: string | null = null;
  let caret: number | null = null;
  if (active && app.contains(active)) {
    const d = active.dataset;
    if (d.field) focusKey = `[data-field="${d.field}"]${d.id ? `[data-id="${d.id}"]` : ''}`;
    else if (d.action) focusKey = `[data-action="${d.action}"]${d.id ? `[data-id="${d.id}"]` : ''}${d.scope ? `[data-scope="${d.scope}"]` : ''}${d.view ? `[data-view="${d.view}"]` : ''}${d.sev ? `[data-sev="${d.sev}"]` : ''}`;
    if (active instanceof HTMLInputElement && active.type === 'text') caret = active.selectionStart;
  }

  let html = '';
  if (state.view === 'settings') html = renderSettings();
  else if (state.view === 'report') html = renderReport();
  else html = renderMain();
  app.innerHTML = html;
  bind();

  const nextBody = app.querySelector<HTMLElement>('.body');
  if (nextBody) nextBody.scrollTop = scrollTop;
  if (state.scrollToResults && state.view === 'main' && nextBody) {
    state.scrollToResults = false;
    nextBody.scrollTop = 0;
  }
  if (focusKey) {
    const el = app.querySelector<HTMLElement>(focusKey);
    el?.focus();
    if (caret !== null && el instanceof HTMLInputElement) el.setSelectionRange(caret, caret);
  }
}

function renderSubheader(title: string): string {
  const back = tx({ es: 'Volver', en: 'Back' });
  return `<div class="subheader"><button class="icon-btn" data-action="view" data-view="main" title="${back}" aria-label="${back}">${ICON.back}</button>${esc(title)}</div>`;
}

/** Solo cuando hay algo que hacer o que avisar; con Pro activo, la falta de candados ya lo dice. */
function renderBadge(): string {
  const p = state.payment;
  if (p.type === 'FREE' || p.type === 'PAID') return '';
  if (p.type === 'NOT_SUPPORTED') {
    const title = tx({ es: 'No se pudo comprobar la licencia; pulsa para reintentar', en: 'The license couldn’t be verified; click to try again' });
    return `<button class="badge" data-action="checkout" title="${title}">${tx({ es: 'Licencia no verificada', en: 'License not verified' })}</button>`;
  }
  if (p.trialDaysLeft !== null && p.trialDaysLeft > 0) return `<span class="badge pro">${tx({ es: 'Prueba', en: 'Trial' })} · ${p.trialDaysLeft} d</span>`;
  const title = tx({ es: 'Pago único: archivo completo, correcciones e informe', en: 'One-time purchase: whole-file audits, fixes and the report' });
  return `<button class="badge" data-action="checkout" title="${title}">${ICON.lock}Pro</button>`;
}

function renderError(): string {
  if (!state.error) return '';
  return `<div class="error-box"><b>${esc(state.error.message)}</b>${state.error.detail ? `<div class="tiny muted">${esc(state.error.detail)}</div>` : ''}</div>`;
}

function renderNotice(): string {
  if (!state.notice) return '';
  const unlock = !isPro() && state.payment.type !== 'NOT_SUPPORTED' ? `<button class="secondary small" data-action="checkout">${tx({ es: 'Desbloquear', en: 'Unlock' })}</button>` : '';
  const close = tx({ es: 'Cerrar', en: 'Close' });
  return `<div class="notice"><span>${esc(state.notice)}</span>${unlock}<button class="icon-btn" data-action="dismiss" title="${close}" aria-label="${close}">${ICON.close}</button></div>`;
}

/** Flota sobre la lista, justo encima del pie: se ve aunque se haya bajado hasta la fila corregida. */
function renderToast(): string {
  const t = state.toast;
  if (!t) return '';
  const close = tx({ es: 'Cerrar', en: 'Close' });
  const undo = t.undo ? `<button class="toast-action" data-action="undo" title="${tx({ es: 'Ctrl+Z (Cmd+Z en Mac)', en: 'Ctrl+Z (Cmd+Z on Mac)' })}">${tx({ es: 'Deshacer', en: 'Undo' })}</button>` : '';
  return `<div class="toast-slot"><div class="toast"><span>${esc(t.text)}</span>${undo}<button class="icon-btn" data-action="dismiss-toast" title="${close}" aria-label="${close}">${ICON.close}</button></div></div>`;
}

const scopeBtn = (scope: Scope, label: string, extra: string, disabled = false, title = '') =>
  `<button data-action="scope" data-scope="${scope}" aria-pressed="${state.scope === scope}" ${disabled ? 'disabled' : ''} ${title ? `title="${title}"` : ''}>${label}${extra}</button>`;

/** El botón de la selección, con cuántas capas hay: cambia con cada clic en el lienzo. */
function selectionScopeBtn(): string {
  const n = state.selectionCount;
  return scopeBtn('selection', tx({ es: 'Selección', en: 'Selection' }), n ? `<span class="count">${num(n)}</span>` : '', n === 0, n ? '' : tx({ es: 'Selecciona capas en el lienzo', en: 'Select layers on the canvas' }));
}

/** Cambia el botón de la selección en su sitio, sin redibujar nada más. false si no está pintado. */
function swapSelectionButton(): boolean {
  const old = app.querySelector<HTMLElement>('[data-action="scope"][data-scope="selection"]');
  if (!old) return false;
  const tmp = document.createElement('template');
  tmp.innerHTML = selectionScopeBtn();
  const next = tmp.content.firstElementChild as HTMLElement;
  const focused = document.activeElement === old;
  old.replaceWith(next);
  bindAction(next);
  if (focused) next.focus();
  return true;
}

function renderMain(): string {
  const s = state.settings!;
  const enabledCount = state.checks.filter((c) => s.enabled[c.id]).length;
  const fileLocked = !isPro();
  const settingsLabel = tx({ es: 'Ajustes', en: 'Settings' });

  const bar = `<div class="bar">
      <div class="segmented" role="group" aria-label="${tx({ es: 'Alcance', en: 'Scope' })}">
        ${selectionScopeBtn()}
        ${scopeBtn('page', tx({ es: 'Página', en: 'Page' }), '')}
        ${scopeBtn('file', tx({ es: 'Archivo', en: 'File' }), fileLocked ? ICON.lock : '', false, fileLocked ? tx({ es: 'Todas las páginas (Pro)', en: 'Every page (Pro)' }) : tx({ es: 'Todas las páginas', en: 'Every page' }))}
      </div>
      ${
        state.running
          ? `<button class="secondary" data-action="cancel" ${state.cancelling ? 'disabled' : ''}>${state.cancelling ? tx({ es: 'Cancelando…', en: 'Cancelling…' }) : tx({ es: 'Cancelar', en: 'Cancel' })}</button>`
          : `<button class="primary" data-action="audit" ${enabledCount === 0 ? 'disabled' : ''}>${tx({ es: 'Auditar', en: 'Audit' })}</button>`
      }
      <button class="icon-btn" data-action="view" data-view="settings" title="${settingsLabel}" aria-label="${settingsLabel}">${ICON.settings}</button>
    </div>`;
  const progress = state.running ? `<div class="progress"><div></div></div>` : '';

  let content: string;
  // Con hallazgos en la lista, los avisos van en su cabecera fija (renderResults).
  const inHeader = !!state.results && state.findings.length > 0;
  if (state.results) content = renderResults(enabledCount);
  else if (state.running) content = renderRunning();
  else content = renderEmpty(enabledCount);

  const ignoredCount = state.findings.filter((f) => f.ignored).length;
  const activeCount = state.findings.length - ignoredCount;
  const footerNote = state.results
    ? tx({
        es: `${findingsText(activeCount)}${ignoredCount ? ` (+${num(ignoredCount)} ignorados)` : ''} · ${layersText(state.results.scanned)} · ${seconds(state.results.durationMs)}`,
        en: `${findingsText(activeCount)}${ignoredCount ? ` (+${num(ignoredCount)} ignored)` : ''} · ${layersText(state.results.scanned)} · ${seconds(state.results.durationMs)}`,
      })
    : state.payment.type === 'FREE'
      ? tx({ es: 'Gratis, y sin conexión a internet: todo se queda en Figma.', en: 'Free, with no network access: everything stays in Figma.' })
      : tx({ es: 'Gratis: selección y página. Pro: archivo, correcciones e informe.', en: 'Free: selection and page. Pro: whole file, fixes and report.' });
  const devToggle = state.payment.type === 'PAID' ? tx({ es: 'Simular no pagado', en: 'Simulate unpaid' }) : tx({ es: 'Simular pagado', en: 'Simulate paid' });

  // Sin cabecera propia: la ventana de Figma ya lleva el nombre del plugin justo encima.
  return `${bar}${progress}
    <div class="body${state.toast ? ' with-toast' : ''}">${inHeader ? '' : renderNotice() + renderError()}${content}</div>
    ${renderToast()}
    <div class="footer">
      ${renderBadge()}<span class="muted tiny">${footerNote}</span>
      <span class="spacer"></span>
      ${state.dev && state.payment.type !== 'FREE' ? `<button class="secondary small" data-action="dev-payment" data-status="${state.payment.type === 'PAID' ? 'UNPAID' : 'PAID'}" title="${tx({ es: 'Solo en desarrollo', en: 'Development only' })}">${devToggle}</button>` : ''}
      ${state.results ? `<button class="secondary small" data-action="view" data-view="report">${isPro() ? '' : ICON.lock}${tx({ es: 'Informe', en: 'Report' })}</button>` : ''}
      <span class="grip" data-action="grip" title="${tx({ es: 'Arrastra para cambiar el tamaño', en: 'Drag to resize' })}">${ICON.grip}</span>
    </div>`;
}

/**
 * Franja de «página cambiada»: el único momento en que tiene sentido revisar de nuevo solo lo señalado, que es
 * más rápido que auditar otra vez.
 */
function renderStale(): string {
  if (!state.stale || state.running || (!state.findings.length && !state.fixedSince.length)) return '';
  const title = tx({ es: 'Vuelve a revisar solo las capas con hallazgos, más rápido que auditar de nuevo', en: 'Checks only the layers with findings again, faster than a new audit' });
  return `<div class="stale">${ICON.refresh}<span>${tx({ es: 'La página ha cambiado desde la auditoría.', en: 'The page changed since the audit.' })}</span>
      <button class="primary small" data-action="recheck" title="${title}">${tx({ es: 'Actualizar la lista', en: 'Update the list' })}</button></div>`;
}

function renderRules(s: Settings): string {
  const infoLabel = tx({ es: 'Qué revisa', en: 'What it checks' });
  const cats = CATEGORY_ORDER.map((cat) => {
    const rows = state.checks
      .filter((c) => c.category === cat)
      .map((c) => {
        const open = state.rulesInfo.has(c.id);
        return `<label class="rule"><input type="checkbox" data-field="check" data-id="${c.id}" ${s.enabled[c.id] ? 'checked' : ''}/>
            <span>${esc(tx(c.title))}</span>
            <span class="dot ${c.severity}" title="${tx(SEVERITY_LABEL[c.severity])}"></span>
            <button class="icon-btn" data-action="rule-info" data-id="${c.id}" aria-expanded="${open}" title="${infoLabel}" aria-label="${infoLabel}">${ICON.info}</button></label>
          ${open ? `<div class="rule-desc">${esc(tx(c.description))}</div>` : ''}`;
      })
      .join('');
    return rows ? `<div class="cat">${tx(CATEGORIES[cat])}</div>${rows}` : '';
  }).join('');
  return `<div class="rules">${cats}
      <div class="rules-actions"><button class="link" data-action="all-checks" data-value="1">${tx({ es: 'Activar todas', en: 'Turn all on' })}</button><button class="link" data-action="all-checks" data-value="0">${tx({ es: 'Desactivar todas', en: 'Turn all off' })}</button></div>
    </div>`;
}

function renderEmpty(enabledCount: number): string {
  const rules = tx({ es: `${enabledCount} de ${state.checks.length} reglas activas`, en: `${enabledCount} of ${state.checks.length} rules on` });
  return `<div class="empty">${ICON.logo}
      <b>${tx({ es: 'Revisa componentes y pantallas contra tu Definición de hecho', en: 'Check components and screens against your Definition of Done' })}</b>
      <p>${tx({
        es: 'Elige qué auditar y pulsa Auditar. Cada hallazgo te lleva a su capa y, si tiene una única solución correcta, se corrige solo.',
        en: 'Pick what to audit and press Audit. Each finding takes you to its layer and, when it has a single right answer, fixes itself.',
      })}</p>
      <div class="tags">${Object.values(CATEGORIES).map((label) => `<span class="tag">${tx(label)}</span>`).join('')}</div>
      <button class="link rules-link" data-action="view" data-view="settings">${rules} · ${tx({ es: 'Elegir', en: 'Choose' })}</button>
    </div>`;
}

function renderRunning(): string {
  const scope = { selection: tx({ es: 'la selección', en: 'the selection' }), page: tx({ es: 'la página', en: 'the page' }), file: tx({ es: 'el archivo', en: 'the file' }) }[state.scope];
  const counts = runningText();
  return `<div class="running">
      <div class="spinner" aria-hidden="true"></div>
      <b>${tx({ es: `Auditando ${scope}`, en: `Auditing ${scope}` })}</b>
      <span id="progress-text">${counts}</span>
      <p>${tx({ es: 'Si cancelas, verás lo encontrado hasta ese momento.', en: 'If you cancel, you’ll see what was found up to that point.' })}</p>
    </div>`;
}

/** Lo escrito a mano que no se avisa capa a capa porque no se usan variables de ese tipo. */
function untokenizedTexts(u: Partial<Record<'spacing' | 'radius', number>> | undefined): string[] {
  const out: string[] = [];
  const s = u?.spacing ?? 0;
  const r = u?.radius ?? 0;
  if (s) {
    out.push(
      s === 1
        ? tx({ es: 'Sin variables de espaciado en uso: 1 padding o gap escrito a mano no se avisa', en: 'No spacing variables in use: 1 hand-typed padding or gap isn’t flagged' })
        : tx({ es: `Sin variables de espaciado en uso: ${num(s)} paddings y gaps escritos a mano no se avisan uno a uno`, en: `No spacing variables in use: ${num(s)} hand-typed paddings and gaps aren’t flagged one by one` }),
    );
  }
  if (r) {
    out.push(
      r === 1
        ? tx({ es: 'Sin variables de radio en uso: 1 radio escrito a mano no se avisa', en: 'No radius variables in use: 1 hand-typed radius isn’t flagged' })
        : tx({ es: `Sin variables de radio en uso: ${num(r)} radios escritos a mano no se avisan uno a uno`, en: `No radius variables in use: ${num(r)} hand-typed radii aren’t flagged one by one` }),
    );
  }
  return out;
}

/** Textos a los que no se les pudo medir el contraste. */
const skippedContrastText = (n: number) =>
  n === 1
    ? tx({ es: '1 texto sin fondo evaluable para contraste', en: '1 text layer without a background to check contrast against' })
    : tx({ es: `${num(n)} textos sin fondo evaluable para contraste`, en: `${num(n)} text layers without a background to check contrast against` });

/**
 * Un sitio que, si no cabe, se recorta por partes: primero lo que agrupa (la carpeta del set, el principio de la
 * ruta), después el nombre del set y lo último la capa, cada parte con sus puntos suspensivos. Recortadas al
 * final, dos filas de sets distintos parecían iguales («Building Blocks/Segmented button/Bu…», en Material 3).
 */
function shrinkable(group: string, set: string, layer: string): string {
  // Un espacio al principio de una parte se perdería al principio de su caja: va como espacio duro.
  const part = (cls: string, text: string) => (text ? `<span class="${cls}">${esc(text.replace(/^ /, ' '))}</span>` : '');
  return part('group', group) + part('set', set) + part('layer', layer);
}

/** Una ruta partida antes de su último tramo, que es lo más cercano a la capa. */
function lastStep(path: string): [string, string] {
  let cut = path.lastIndexOf('/');
  if (cut <= 0) return ['', path];
  if (path[cut - 1] === ' ') cut--;
  return [path.slice(0, cut), path.slice(cut)];
}

function renderResults(enabledCount: number): string {
  const r = state.results!;
  rowIndex = new Map();
  const ignoredTotal = state.findings.filter((f) => f.ignored).length;
  if (!ignoredTotal) state.showIgnored = false;
  // Lo que se ve: los hallazgos vigentes o, con el filtro de ignorados, solo los ignorados.
  const pool = state.findings.filter((f) => !!f.ignored === state.showIgnored);
  const skipped = [...(r.skippedContrast ? [skippedContrastText(r.skippedContrast)] : []), ...untokenizedTexts(r.untokenized)].map((t) => `. ${t}`).join('');
  const verdict = (detail: string) => {
    const head = enabledCount > 0 ? ICON.logo + tx({ es: '<b>Cumple la Definición de hecho</b>', en: '<b>Meets the Definition of Done</b>' }) : tx({ es: '<b>Sin comprobaciones activas</b>', en: '<b>No active checks</b>' });
    return `<div class="ok">${head}${detail}${skipped}.</div>`;
  };
  if (!state.findings.length) {
    // Todo corregido, pero algo ha cambiado después: la franja deja comprobar que sigue corregido.
    const bar = renderStale();
    return `${bar ? `<div class="filters">${bar}</div>` : ''}${verdict(tx({ es: `${scannedText(r.scanned)} sin hallazgos`, en: `${scannedText(r.scanned)}, no findings` }))}`;
  }
  const count = (sev: Severity) => pool.filter((f) => f.severity === sev).length;
  const fixableTotal = pool.filter((f) => f.fix && state.severities.has(f.severity)).length;
  // Cada severidad se enciende y se apaga sola: errores y avisos empiezan a la vista, y la información, no.
  const chip = (sev: Severity, label: string) =>
    `<button class="chip" data-action="sev" data-sev="${sev}" aria-pressed="${state.severities.has(sev)}"><span class="dot ${sev}"></span>${label} <b>${num(count(sev))}</b></button>`;
  const ignoredTitle = tx({ es: 'Ver los hallazgos ignorados en este archivo', en: 'Show the findings ignored in this file' });
  // Severidad en una fila y, debajo, búsqueda, "Corregibles" e "Ignorados": en inglés no caben todos en una.
  // Los avisos y errores van en la cabecera fija: responden a una fila y se ven aunque se haya bajado hasta ella.
  const filters = `<div class="filters">${renderNotice()}${renderError()}${renderStale()}
      <div class="sev">
        ${chip('error', tx({ es: 'Errores', en: 'Errors' }))}
        ${chip('warning', tx({ es: 'Avisos', en: 'Warnings' }))}
        ${chip('info', 'Info')}
      </div>
      <div class="find">
        <label class="search">${ICON.search}<input type="text" data-action="query" value="${esc(state.query)}" placeholder="${tx({ es: 'Buscar por capa o mensaje', en: 'Search layers or messages' })}" aria-label="${tx({ es: 'Buscar', en: 'Search' })}"/></label>
        ${state.showIgnored ? '' : `<button class="chip" data-action="fixable" aria-pressed="${state.fixableOnly}" title="${tx({ es: 'Ver solo los hallazgos que se pueden corregir solos', en: 'Show only the findings that can be fixed automatically' })}">${state.fixableOnly ? ICON.checked : ICON.unchecked}${tx({ es: 'Solo corregibles', en: 'Fixable only' })} <b>${num(fixableTotal)}</b></button>`}
        ${ignoredTotal ? `<button class="chip" data-action="show-ignored" aria-pressed="${state.showIgnored}" title="${ignoredTitle}">${ICON.eyeOff}${tx({ es: 'Ignorados', en: 'Ignored' })} <b>${num(ignoredTotal)}</b></button>` : ''}
      </div>
    </div>`;
  // Todo lo que queda está ignorado: se cumple, y los ignorados siguen a un clic.
  if (!pool.length) {
    const n = ignoredTotal;
    return `${filters}${verdict(tx({ es: `${scannedText(r.scanned)}; ${num(n)} ${n === 1 ? 'hallazgo ignorado' : 'hallazgos ignorados'}`, en: `${scannedText(r.scanned)}; ${num(n)} ${n === 1 ? 'finding' : 'findings'} ignored` }))}`;
  }
  // Sin errores ni avisos también se cumple: la información, oculta, sigue a un clic.
  const infoLeft = count('info');
  if (!state.showIgnored && !state.severities.has('info') && infoLeft && !count('error') && !count('warning')) {
    const rest =
      infoLeft === 1
        ? tx({ es: 'queda 1 hallazgo de información: pulsa Info para verlo', en: '1 info finding left: click Info to see it' })
        : tx({ es: `quedan ${num(infoLeft)} hallazgos de información: pulsa Info para verlos`, en: `${num(infoLeft)} info findings left: click Info to see them` });
    return `${filters}${verdict(tx({ es: `${scannedText(r.scanned)} sin errores ni avisos; ${rest}`, en: `${scannedText(r.scanned)}, no errors or warnings; ${rest}` }))}`;
  }

  let lastCat = '';
  const visible = visibleGroups();
  const groups = orderedChecks()
    .map((c) => {
      const group = visible.get(c.id);
      if (!group) return '';
      const { findings: fs, rows, fixable, worst } = group;
      const open = state.open.has(c.id);
      const shown = state.shown.get(c.id) ?? PAGE_SIZE;
      const truncated = r.truncated.includes(c.id);
      const cat = tx(CATEGORIES[c.category]);
      const catHead = cat !== lastCat ? `<div class="cat">${cat}</div>` : '';
      lastCat = cat;
      const fixBtn =
        c.fixable && fixable && !state.showIgnored
          ? `<button class="fix-btn" data-action="fix" data-id="${c.id}" title="${tx({ es: 'Aplica todas las correcciones seguras de esta regla', en: 'Apply all of this rule’s safe fixes' })}">${isPro() ? ICON.fix : ICON.lock}${fixable > 1 ? tx({ es: `Corregir las ${num(fixable)}`, en: `Fix all ${num(fixable)}` }) : tx({ es: 'Corregir 1', en: 'Fix 1' })}</button>`
          : '';
      // Si alguna fila de la regla se puede corregir, todas guardan el hueco del botón: así los ojos quedan en columna.
      const withFixes = !state.showIgnored && group.hasFixes;
      const items = open
        ? rows
            .slice(0, shown)
            .map((row) => {
              rowIndex.set(row.key, row);
              const f = row.finding;
              const canFix = row.fixes.length > 0 && !state.showIgnored;
              const n = row.fixes.length;
              const parts = splitMessage(f.message);
              const fixer = canFix ? fixLabel(row.fixes[0].fix, f.fixTo) : null;
              // Lo que ya dice el botón de corregir no se repite debajo.
              const notes = parts.notes.filter((note) => !(fixer && f.fixTo && note.includes(f.fixTo)));
              if (parts.arrow && !fixer) notes.unshift(`→ ${parts.arrow}`);
              // La misma capa en varias variantes: en cuántas de sus variantes sale, delante para que no se corte, y
              // el set y la capa. Si no, la capa y dónde está.
              const v = row.variants > 1 ? f.variantOf : undefined;
              let place: string;
              let placeText: string;
              if (v) {
                // Del set se acorta lo que agrupa («Building Blocks/Segmented button/»); su nombre corto y la capa
                // se ven siempre.
                // La barra va con el nombre del set: recortada la carpeta, se lee «…/Button group».
                const cut = Math.max(0, v.setName.lastIndexOf('/'));
                const layer = v.layerPath ? ` / ${v.layerPath}` : '';
                const count = tx({ es: `${row.variants} de ${v.variants} variantes`, en: `${row.variants} of ${v.variants} variants` });
                place = `<span class="fixed">${count} ·</span><b class="mid">${shrinkable(v.setName.slice(0, cut), v.setName.slice(cut), layer)}</b>`;
                placeText = `${count} · ${v.setName}${layer}`;
              } else {
                const route = `${r.scope === 'file' ? `${f.pageName} / ` : ''}${f.path}`;
                const inWord = tx({ es: 'en', en: 'in' });
                const [head, tail] = lastStep(route);
                place = `<b class="name">${esc(f.nodeName)}</b>${route ? `<span class="fixed">${inWord}</span><span class="mid">${shrinkable(head, '', tail)}</span>` : ''}`;
                placeText = route ? `${f.nodeName} ${inWord} ${route}` : f.nodeName;
              }
              const flags = [...parts.flags, ...(f.anchored ? [ANCHORED] : [])].map((flag) => `<span class="flag" title="${esc(tx(flag.title))}">${esc(tx(flag.label))}</span>`).join('');
              const fixTitle = fixer ? (n > 1 ? tx({ es: `Corregir las ${n} de esta fila: `, en: `Fix the ${n} in this row: ` }) : '') + fixer.title : '';
              const times = !v && row.findings.length > 1 ? `<span class="times">×${row.findings.length}</span>` : '';
              const ignoreLabel = state.showIgnored
                ? tx({ es: 'Dejar de ignorar', en: 'Stop ignoring' })
                : isPlacedKey(f.ignoreKey)
                  ? tx({ es: 'Ignorar este texto en todas sus instancias', en: 'Ignore this text in all its instances' })
                  : v
                    ? tx({ es: 'Ignorar esta regla en estas capas', en: 'Ignore this rule on these layers' })
                    : tx({ es: 'Ignorar esta regla en esta capa', en: 'Ignore this rule on this layer' });
              const selectLabel = v ? tx({ es: `Seleccionar las ${row.nodeIds.length} en el lienzo`, en: `Select the ${row.nodeIds.length} on canvas` }) : tx({ es: 'Seleccionar en el lienzo', en: 'Select on canvas' });
              return `<div class="finding-row" aria-current="${state.active === row.key}"><button class="finding" data-action="select" data-key="${esc(row.key)}" title="${selectLabel}">
                  <span class="dot ${f.severity}"></span>
                  <span><span class="msg">${esc(parts.title)}${flags}</span><span class="where" title="${esc(placeText)}">${ICON.target}<span class="place">${place}</span></span>${notes.length ? `<span class="note">${esc(notes.join(' · '))}</span>` : ''}</span>
                  <span class="side">${times}</span></button>
                  <span class="row-actions"><button class="icon-btn ignore" data-action="ignore" data-key="${esc(row.key)}" title="${ignoreLabel}" aria-label="${ignoreLabel}">${state.showIgnored ? ICON.eye : ICON.eyeOff}</button>
                  <span class="fix-slot">${fixer ? `<button class="row-fix" data-action="fix-row" data-key="${esc(row.key)}" title="${esc(fixTitle)}" aria-label="${esc(fixTitle)}">${isPro() ? ICON.fix : ICON.lock}<span>${esc(fixer.label)}</span></button>` : ''}</span></span></div>`;
            })
            .join('') +
          (rows.length > shown
            ? `<button class="more" data-action="more" data-id="${c.id}">${tx({ es: `Mostrar ${Math.min(PAGE_SIZE, rows.length - shown)} más de ${rows.length - shown}`, en: `Show ${Math.min(PAGE_SIZE, rows.length - shown)} more of ${rows.length - shown}` })}</button>`
            : '')
        : '';
      return `${catHead}<div class="group${withFixes ? ' with-fixes' : ''}" data-open="${open}">
          <div class="group-head"><button class="group-toggle" data-action="toggle-group" data-id="${c.id}" aria-expanded="${open}">
            ${ICON.chevron}<span class="dot ${worst}"></span><span class="title">${esc(tx(c.title))}</span><span class="n"${truncated ? ` title="${tx({ es: 'Se cortó a 1.000 hallazgos: corrige estos y vuelve a auditar para ver el resto.', en: 'Cut off at 1,000 findings: fix these and audit again to see the rest.' })}"` : ''}>${num(fs.length)}${truncated ? '+' : ''}</span></button>${fixBtn}</div>
          ${items}</div>`;
    })
    .join('');
  const notes: string[] = [];
  if (r.truncated.length) notes.push(tx({ es: 'Algunas comprobaciones se cortaron a 1.000 hallazgos.', en: 'Some checks were cut off at 1,000 findings.' }));
  if (r.skippedContrast) notes.push(`${skippedContrastText(r.skippedContrast)}.`);
  for (const t of untokenizedTexts(r.untokenized)) notes.push(`${t}.`);
  const none = groups ? '' : `<div class="ok"><span class="muted">${tx({ es: 'Ningún hallazgo con estos filtros.', en: 'No findings match these filters.' })}</span></div>`;
  return `${filters}${groups}${none}${notes.length ? `<div class="notes">${notes.join(' ')}</div>` : ''}`;
}

function renderSettings(): string {
  if (!state.draft) state.draft = JSON.parse(JSON.stringify(state.settings)) as Settings;
  const d = state.draft;
  const auto = d.primitiveAuto;
  const detected = new Set(state.collections.filter((c) => c.isPrimitive).map((c) => c.id));
  const manual = new Set(d.primitiveCollectionIds);
  const marked = (id: string) => (auto ? detected.has(id) : manual.has(id));
  const collections = state.collections.length
    ? state.collections
        .map(
          (c) => `<label class="coll"><input type="checkbox" data-field="primitive" data-id="${c.id}" ${marked(c.id) ? 'checked' : ''} ${auto ? 'disabled' : ''}/>
            <span><b>${esc(c.name)}</b><br/><span class="meta">${tx({
              es: `${c.colorCount} colores · ${c.floatCount} números · modos: ${esc(c.modeNames.join(', '))}${c.hidden ? ' · oculta' : ''}${c.library ? ` · de la biblioteca ${esc(c.library)}` : c.library === '' ? ' · de fuera del archivo' : ''}`,
              en: `${c.colorCount} colors · ${c.floatCount} numbers · modes: ${esc(c.modeNames.join(', '))}${c.hidden ? ' · hidden' : ''}${c.library ? ` · from the ${esc(c.library)} library` : c.library === '' ? ' · from outside the file' : ''}`,
            })}</span></span>
            <span class="badge">${marked(c.id) ? tx({ es: 'primitiva', en: 'primitive' }) : tx({ es: 'semántica', en: 'semantic' })}</span></label>`,
        )
        .join('')
    : `<div class="muted">${tx({ es: 'Este archivo no tiene colecciones de variables locales.', en: 'This file has no local variable collections.' })}</div>`;
  const toggle = (field: keyof Settings, label: Text, help: Text) =>
    `<label class="toggle"><input type="checkbox" data-field="${field}" ${d[field] ? 'checked' : ''}/><span><b>${tx(label)}</b><br/><span class="help">${tx(help)}</span></span></label>`;
  const option = (value: LanguageSetting, label: string) => `<option value="${value}" ${d.language === value ? 'selected' : ''}>${label}</option>`;
  const on = state.checks.filter((c) => d.enabled[c.id]).length;
  return `${renderSubheader(tx({ es: 'Ajustes', en: 'Settings' }))}
    <div class="body">
    ${renderError()}
    <p class="help settings-note">${tx({
      es: 'Estos ajustes se guardan en el archivo y valen para todo el que lo abra con DoD Lint. El idioma, solo para ti.',
      en: 'These settings are saved in the file and apply to everyone who opens it with DoD Lint. The language is just for you.',
    })}</p>
    <div class="section rules-section">
      <div class="section-title">${tx({ es: 'Reglas', en: 'Rules' })} <span class="muted">${tx({ es: `${on} de ${state.checks.length} activas`, en: `${on} of ${state.checks.length} on` })}</span></div>
      ${renderRules(d)}
    </div>
    <div class="section">
      <div class="section-title">${tx({ es: 'Idioma · Language', en: 'Language · Idioma' })}</div>
      <div class="field"><select id="f-lang" data-field="language" aria-label="${tx({ es: 'Idioma', en: 'Language' })}">
        ${option('auto', tx({ es: 'Automático (idioma del sistema)', en: 'Automatic (system language)' }))}${option('en', 'English')}${option('es', 'Español')}
      </select><span class="help">${tx({ es: 'Los hallazgos de una auditoría ya hecha siguen en su idioma hasta que vuelvas a auditar.', en: 'Findings from an audit you already ran stay in their language until you audit again.' })}</span></div>
    </div>
    <div class="section">
      <div class="section-title">${tx({ es: 'Colecciones primitivas', en: 'Primitive collections' })}</div>
      ${toggle('primitiveAuto', { es: 'Detectar automáticamente', en: 'Detect automatically' }, {
        es: 'Se consideran primitivas las colecciones ocultas de publicación o con nombre de primitiva que no contienen alias. Desactívalo para elegirlas a mano; sin ninguna marcada, no se comprueba el uso de primitivas.',
        en: 'Collections hidden from publishing, or named like primitives, that contain no aliases count as primitive. Turn this off to pick them yourself; with none selected, primitive usage isn’t checked.',
      })}
      <p class="help" id="library-load" ${state.libraryLoad ? '' : 'hidden'}>${state.libraryLoad ? libraryLoadText(state.libraryLoad) : ''}</p>
      ${collections}
    </div>
    <div class="section">
      <div class="section-title">${tx({ es: 'Umbrales', en: 'Thresholds' })}</div>
      <div class="field"><label for="f-touch">${tx({ es: 'Tamaño mínimo de un control (px)', en: 'Minimum control size (px)' })}</label><input id="f-touch" type="number" min="24" max="96" data-field="touchMin" value="${d.touchMin}"/><span class="help">${tx({ es: 'El lado más corto. 24 es el mínimo de WCAG 2.2 AA; 44, el de Apple y el de WCAG AAA.', en: 'The shorter side. 24 is the WCAG 2.2 AA minimum; 44 is Apple’s and WCAG AAA’s.' })}</span></div>
      <div class="field"><label for="f-states">${tx({ es: 'Estados de botones y demás controles', en: 'States for buttons and other controls' })}</label><input id="f-states" type="text" data-field="requiredStates" value="${esc(d.requiredStates.join(', '))}"/><span class="help">${tx({ es: 'Separados por comas. Valen los sinónimos, también en otros idiomas (Active o Pulsado = Pressed; Enabled o Défaut = Default).', en: 'Comma-separated. Synonyms count, in other languages too (Active or Gedrückt = Pressed; Enabled or Défaut = Default).' })}</span></div>
      <div class="field"><label for="f-field-states">${tx({ es: 'Estados de campos y controles de selección', en: 'States for fields and selection controls' })}</label><input id="f-field-states" type="text" data-field="fieldStates" value="${esc(d.fieldStates.join(', '))}"/><span class="help">${tx({ es: 'Campos de texto, selectores, casillas, radios e interruptores. No se pulsan como un botón, así que por defecto no piden Pressed.', en: 'Text fields, selects, checkboxes, radios and switches. They aren’t pressed like a button, so by default they don’t need Pressed.' })}</span></div>
      <div class="field"><label for="f-pattern">${tx({ es: 'Nombres que identifican un control interactivo', en: 'Names that identify an interactive control' })}</label><input id="f-pattern" type="text" data-field="interactivePattern" value="${esc(d.interactivePattern)}"/><span class="help">${tx({ es: 'Expresión regular, sin distinguir mayúsculas ni acentos. Trae palabras en seis idiomas; añade las de otro, en cualquier alfabeto. Vacío = valor por defecto.', en: 'Regular expression, ignoring case and accents. It comes with words in six languages; add your own, in any script. Empty = default.' })}</span></div>
      <div class="field"><label for="f-desc">${tx({ es: 'Longitud mínima de la descripción', en: 'Minimum description length' })}</label><input id="f-desc" type="number" min="0" max="500" data-field="minDescriptionLength" value="${d.minDescriptionLength}"/></div>
      ${toggle('requireDocLinks', { es: 'Pedir enlace de documentación', en: 'Require a documentation link' }, { es: 'Cada componente con su enlace en el campo de documentación de Figma. Muchos equipos no lo usan, así que viene desactivado.', en: 'Every component with a link in Figma’s documentation field. Many teams don’t use it, so it’s off by default.' })}
      <div class="field"><label for="f-ignore">${tx({ es: 'Prefijos de capa que se ignoran', en: 'Ignored layer prefixes' })}</label><input id="f-ignore" type="text" data-field="ignorePrefixes" value="${esc(d.ignorePrefixes.join(' '))}"/><span class="help">${tx({ es: 'Separados por espacios. Por defecto "_" y ".".', en: 'Space-separated. Defaults: "_" and ".".' })}</span></div>
    </div>
    <div class="section">
      <div class="section-title">${tx({ es: 'Alcance del recorrido', en: 'Traversal' })}</div>
      ${toggle('includeHidden', { es: 'Incluir capas ocultas', en: 'Include hidden layers' }, {
        es: 'Por defecto se saltan las capas invisibles y todo lo que contienen, salvo las que puede mostrar una propiedad booleana o una variable.',
        en: 'By default, invisible layers and everything inside them are skipped, except those a boolean property or a variable can show.',
      })}
      ${toggle('includeInstanceInternals', { es: 'Entrar en las instancias', en: 'Go inside instances' }, {
        es: 'Audita las capas internas de cada instancia. Sin esto, de una instancia solo se revisan sus overrides propios, lo que se haya puesto en sus slots y el contraste de sus textos.',
        en: 'Audits the inner layers of every instance. Without this, only an instance’s own overrides, the content placed in its slots and the contrast of its text are checked.',
      })}
      ${toggle('includeTopLevelFrames', { es: 'Exigir auto layout a los frames de primer nivel', en: 'Require auto layout on top-level frames' }, { es: 'Los artboards de una página suelen ser lienzos libres; actívalo para bibliotecas.', en: 'Top-level artboards are usually free canvases; turn this on for libraries.' })}
      ${toggle('spacingComponentsOnly', { es: 'Espaciado y radio, solo dentro de componentes', en: 'Spacing and radius, only inside components' }, {
        es: 'Para archivos de biblioteca: la documentación, los bocetos y las pantallas de ejemplo no se revisan. En un archivo de producto, déjalo desactivado para revisar también sus pantallas.',
        en: 'For library files: documentation, sketches and sample screens aren’t checked. In a product file, leave it off so its screens are checked too.',
      })}
      ${toggle('snapToScale', { es: 'Al corregir, ajustar al paso de escala más cercano', en: 'When fixing, snap to the nearest scale step' }, {
        es: 'Si un padding de 10 no existe como variable pero sí 12, la corrección lo mueve a 12 y lo enlaza. Cambia la medida, así que viene desactivado: sin esto solo se enlazan coincidencias exactas, y del resto se dice el paso más cercano.',
        en: 'If there’s no variable for a padding of 10 but there is one for 12, the fix moves it to 12 and binds it. It changes the measurement, so it’s off by default: without it, only exact matches are bound, and the rest show the nearest step.',
      })}
    </div>
    </div>
    <div class="footer">
      <button class="secondary" data-action="cancel-settings">${tx({ es: 'Cancelar', en: 'Cancel' })}</button>
      <span class="spacer"></span>
      <button class="primary" data-action="save-settings">${tx({ es: 'Guardar', en: 'Save' })}</button>
      <span class="grip" data-action="grip">${ICON.grip}</span>
    </div>`;
}

function renderReport(): string {
  const title = tx({ es: 'Informe en Markdown', en: 'Markdown report' });
  if (!isPro()) {
    const unlock = state.payment.type !== 'NOT_SUPPORTED' ? `<button class="secondary small" data-action="checkout">${tx({ es: 'Desbloquear', en: 'Unlock' })}</button>` : '';
    return `${renderSubheader(title)}<div class="body">${renderError()}<div class="notice"><span>${esc(lockedMessage('export'))}</span>${unlock}</div></div>`;
  }
  return `${renderSubheader(title)}
    <div class="body pad report">
      ${renderError()}
      <textarea id="report-text" readonly aria-label="${title}">${esc(buildReport())}</textarea>
      <div class="muted tiny" style="margin-top:6px">${tx({ es: 'Si la descarga no empieza, selecciona el texto y cópialo.', en: 'If the download doesn’t start, select the text and copy it.' })}</div>
    </div>
    <div class="footer">
      <span class="spacer"></span>
      <button class="secondary" data-action="copy-report">${tx({ es: 'Copiar', en: 'Copy' })}</button>
      <button class="primary" data-action="download-report">${tx({ es: 'Descargar .md', en: 'Download .md' })}</button>
      <span class="grip" data-action="grip">${ICON.grip}</span>
    </div>`;
}

// ---------- Eventos (delegados) ----------

function bindGrip(grip: HTMLElement) {
  grip.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const start = { x: ev.clientX, y: ev.clientY, w: window.innerWidth, h: window.innerHeight };
    grip.setPointerCapture(ev.pointerId);
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        post({ type: 'resize', width: start.w + e.clientX - start.x, height: start.h + e.clientY - start.y });
      });
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}

/** Lo que ofrece el aviso de abajo: la última tanda corregida, con el deshacer de Figma, o lo último ignorado. */
function undoFromToast(): boolean {
  const u = state.toast?.undo;
  if (!u) return false;
  state.toast = null;
  if (u.kind === 'fix') {
    state.undoing = u;
    post({ type: 'undo', id: u.id });
  } else {
    state.undoingIgnore = true;
    post({ type: 'ignore', keys: u.keys, ignore: !u.ignore });
  }
  render();
  return true;
}

// Con el foco en el plugin, Figma no recibe sus atajos (una petición abierta en su foro desde 2021). Ctrl+Z
// (Cmd+Z en Mac) hace lo que ofrezca el aviso de abajo y, si no ofrece nada, el deshacer de siempre de Figma.
// En un campo de texto deshace lo escrito, y dejar la tecla pulsada no encadena deshaceres.
document.addEventListener('keydown', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey || ev.key.toLowerCase() !== 'z') return;
  if ((ev.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  ev.preventDefault();
  // Mientras se aplica una tanda, se deshace otra o se audita, el deshacer de Figma se llevaría lo que está a medias.
  if (ev.repeat || !state.ready || state.fixing || state.undoing || state.running) return;
  if (undoFromToast()) return;
  post({ type: 'undo-last' });
  // No se sabe qué deshace Figma, y quitar algo ignorado no llega como cambio de la página: la lista queda por actualizar.
  if (state.results) {
    state.stale = true;
    if (state.view === 'main') render();
  }
});


function bind() {
  app.querySelectorAll<HTMLElement>('[data-action]').forEach(bindAction);
  bindFields();
}

let queryTimer = 0;

/** Ata la acción de un elemento: al pintar la vista, y al cambiar un botón suelto en su sitio. */
function bindAction(el: HTMLElement) {
  const action = el.dataset.action!;
  if (action === 'query') {
    el.addEventListener('input', () => {
      state.query = (el as HTMLInputElement).value;
      // Con miles de hallazgos, cada filtrado cuesta: se espera a que pare de escribir.
      clearTimeout(queryTimer);
      queryTimer = window.setTimeout(render, 150);
    });
    return;
  }
  if (action === 'grip') {
    bindGrip(el);
    return;
  }
  el.addEventListener('click', (ev) => {
    ev.preventDefault();
    // El segundo clic de un doble clic cae en lo que la vista pone en su sitio: la fila de debajo de una corregida,
    // o «Cancelar» donde estaba «Auditar». Ninguna acción cuenta más que el primero.
    if (ev.detail > 1) return;
    switch (action) {
      case 'scope':
        state.scope = el.dataset.scope as Scope;
        if (state.scope === 'file' && !isPro()) {
          state.notice = `${lockedMessage('file')} ${tx({ es: 'Puedes seguir auditando la página actual.', en: 'You can keep auditing the current page.' })}`;
        }
        render();
        break;
      case 'audit':
        startAudit();
        break;
      case 'cancel':
        state.cancelling = true;
        post({ type: 'cancel' });
        render();
        break;
      case 'rule-info': {
        const id = el.dataset.id as CheckId;
        if (state.rulesInfo.has(id)) state.rulesInfo.delete(id);
        else state.rulesInfo.add(id);
        render();
        break;
      }
      case 'all-checks':
        setAllChecks(el.dataset.value === '1');
        break;
      case 'sev': {
        // Cada severidad se enciende y se apaga por su lado; un conjunto nuevo, para que la lista se rehaga.
        const sev = el.dataset.sev as Severity;
        const next = new Set(state.severities);
        if (next.has(sev)) next.delete(sev);
        else next.add(sev);
        state.severities = next;
        render();
        break;
      }
      case 'fixable':
        state.fixableOnly = !state.fixableOnly;
        render();
        break;
      case 'show-ignored':
        state.showIgnored = !state.showIgnored;
        render();
        break;
      case 'recheck':
        if (!state.settings || state.running || state.fixing || state.undoing) break;
        // Se reusa el estado de auditoría en marcha: barra de progreso y Cancelar, con la lista a la vista.
        state.running = true;
        state.cancelling = false;
        state.error = null;
        state.notice = null;
        // La lista va a cambiar: lo corregido antes ya no se deshace desde aquí.
        state.toast = null;
        post({ type: 'recheck', targets: recheckTargets([...state.findings, ...state.fixedSince]) });
        announce(tx({ es: 'Revisando de nuevo las capas con hallazgos', en: 'Checking the layers with findings again' }));
        render();
        break;
      case 'ignore': {
        // Ignorar escribe en el archivo: la última tanda corregida ya no se deshace desde aquí.
        if (state.toast?.undo?.kind === 'fix') state.toast.undo = undefined;
        // En la vista de ignorados, el mismo botón los recupera.
        const row = rowIndex.get(el.dataset.key!);
        if (row) post({ type: 'ignore', keys: [...new Set(row.findings.map((f) => f.ignoreKey))], ignore: !state.showIgnored });
        break;
      }
      case 'toggle-group': {
        const id = el.dataset.id as CheckId;
        if (state.open.has(id)) state.open.delete(id);
        else state.open.add(id);
        render();
        break;
      }
      case 'more': {
        const id = el.dataset.id as CheckId;
        state.shown.set(id, (state.shown.get(id) ?? PAGE_SIZE) + PAGE_SIZE);
        render();
        break;
      }
      case 'select': {
        const row = rowIndex.get(el.dataset.key!);
        if (!row) break;
        state.active = row.key;
        post({ type: 'select', nodeIds: row.nodeIds });
        // Solo cambia la fila marcada: con miles de hallazgos, redibujar la lista en cada clic se notaba.
        app.querySelectorAll('.finding-row[aria-current="true"]').forEach((r) => r.setAttribute('aria-current', 'false'));
        el.closest('.finding-row')?.setAttribute('aria-current', 'true');
        break;
      }
      case 'fix':
        fixGroup(el.dataset.id as CheckId);
        break;
      case 'fix-row':
        fixRow(el.dataset.key!);
        break;
      case 'checkout':
        post({ type: 'checkout' });
        break;
      case 'dev-payment':
        post({ type: 'dev-payment', status: el.dataset.status as 'PAID' | 'UNPAID' });
        break;
      case 'dismiss':
        state.notice = null;
        render();
        break;
      case 'dismiss-toast':
        state.toast = null;
        render();
        break;
      case 'undo':
        undoFromToast();
        break;
      case 'view':
        state.view = el.dataset.view as State['view'];
        state.error = null;
        if (state.view !== 'settings') state.draft = null;
        render();
        break;
      case 'save-settings':
        if (state.draft && state.settings) {
          const before = lang();
          const edits = settingsEdits(state.settings, state.draft);
          state.settings = state.draft;
          // Guardar escribe en el archivo: la última tanda ya no es lo último del historial.
          state.toast = null;
          post({ type: 'save-settings', edits });
          // Los mensajes de los hallazgos los escribe el sandbox al auditar.
          if (state.results && lang() !== before) {
            state.notice = tx({ es: 'Vuelve a auditar para ver los hallazgos en español.', en: 'Audit again to see the findings in English.' });
          }
        }
        state.draft = null;
        state.view = 'main';
        render();
        break;
      case 'cancel-settings':
        state.draft = null;
        state.view = 'main';
        render();
        break;
      case 'copy-report':
        void copyReport();
        break;
      case 'download-report':
        downloadReport();
        break;
    }
  });
}

function bindFields() {
  // Campos de ajustes: escriben en el borrador en cada tecla; el toggle de autodetección sí re-renderiza.
  app.querySelectorAll<HTMLInputElement>('[data-field]').forEach((input) => {
    const handler = () => {
      const d = state.draft;
      if (!d) return;
      const field = input.dataset.field!;
      switch (field) {
        case 'check':
          d.enabled[input.dataset.id as CheckId] = input.checked;
          render();
          break;
        case 'primitive': {
          const current = new Set(d.primitiveCollectionIds);
          if (input.checked) current.add(input.dataset.id!);
          else current.delete(input.dataset.id!);
          d.primitiveCollectionIds = [...current];
          break;
        }
        case 'primitiveAuto':
          d.primitiveAuto = input.checked;
          // Al pasar a manual, se parte de lo detectado para no empezar de cero.
          if (!d.primitiveAuto && !d.primitiveCollectionIds.length) {
            d.primitiveCollectionIds = state.collections.filter((c) => c.isPrimitive).map((c) => c.id);
          }
          render();
          break;
        case 'touchMin':
          d.touchMin = Math.max(0, Number(input.value) || DEFAULT_SETTINGS.touchMin);
          break;
        case 'minDescriptionLength':
          d.minDescriptionLength = Math.max(0, Number(input.value) || 0);
          break;
        case 'requiredStates':
        case 'fieldStates':
          d[field] = input.value.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'interactivePattern': {
          const v = input.value.trim() || DEFAULT_SETTINGS.interactivePattern;
          try {
            new RegExp(v, 'i');
            d.interactivePattern = v;
            input.setCustomValidity('');
          } catch {
            input.setCustomValidity(tx({ es: 'Expresión regular no válida', en: 'Invalid regular expression' }));
            input.reportValidity();
          }
          break;
        }
        case 'language':
          d.language = input.value as LanguageSetting;
          break;
        case 'ignorePrefixes':
          d.ignorePrefixes = input.value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
          break;
        case 'includeHidden':
        case 'includeInstanceInternals':
        case 'includeTopLevelFrames':
        case 'spacingComponentsOnly':
        case 'snapToScale':
        case 'requireDocLinks':
          (d as unknown as Record<string, boolean>)[field] = input.checked;
          break;
      }
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

render();
post({ type: 'init', locale: navigator.language });
