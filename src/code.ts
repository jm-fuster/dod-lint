// Sandbox del plugin: recibe órdenes de la UI, audita, corrige y gestiona el muro de pago.
import type { CodeToUI, FixItem, Settings, UIToCode } from './types';
import { CHECK_METAS } from './checks';
import { AuditContext } from './context';
import type { FloatKind } from './context';
import { runAudit } from './audit';
import { onLibraryProgress } from './library';
import { applyFix } from './fixes';
import { LastFix } from './undo';
import type { FixedLayer, UndoResult } from './undo';
import { findNodes } from './nodes';
import { writeIgnored } from './ignore';
import { checkout, devSetPayment, isPro, paymentInfo } from './payments';
import { uiPause } from './pause';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings } from './settings';
import { resolveLang } from './i18n';
import type { Lang, Text } from './i18n';

const post = (msg: CodeToUI) => figma.ui.postMessage(msg);

figma.showUI(__html__, { width: 440, height: 700, themeColors: true });

/** La auditoría cede el hilo esperando a la UI: así sigue también con Figma tapado. */
const pauser = uiPause((id) => post({ type: 'pause', id }));

// La primera vez en un archivo, importar las variables de un kit grande tarda: las 196 de Material 3, 9,9 s. El
// panel lo dice, para que la auditoría que espera no parezca colgada.
onLibraryProgress((done, total) => post({ type: 'libraries', done, total }));

let settings: Settings = DEFAULT_SETTINGS;
let busy = false;
/** Lo pone la UI con "Cancelar"; el recorrido lo mira cada vez que cede el hilo. */
let cancelRequested = false;
/** Idioma del sistema, que llega de la UI al arrancar: el sandbox no tiene navigator. */
let locale: string | null = null;

const lang = (): Lang => resolveLang(settings.language, locale);
const say = (text: Text) => text[lang()];

/** Página cuyos cambios se vigilan desde los últimos resultados, para avisar a la UI de que han envejecido. */
let watched: PageNode | null = null;
let staleSent = false;
/**
 * Hasta cuándo no cuentan los cambios: los que hace el propio plugin (corregir, ignorar, guardar ajustes) no
 * dejan viejos los resultados, porque la UI ya los refleja. Figma avisa de ellos un poco después.
 */
let quietUntil = 0;
const quiet = (ms = 1500) => {
  quietUntil = Date.now() + ms;
};
/** Última tanda corregida, mientras «Deshacer» pueda quitarla. */
const lastFix = new LastFix();
/**
 * Los tipos de token que la última auditoría dio por no usados. «Actualizar la lista» decide igual: con solo las
 * capas que tienen hallazgos, haría aparecer o desaparecer lo escrito a mano.
 */
let lastWithoutTokens: FloatKind[] = [];
/** Otro cambio en el archivo: la UI deja de ofrecer «Deshacer». */
function forgetFix(): void {
  const id = lastFix.forget();
  if (id !== undefined) post({ type: 'undo-gone', id });
}
/** Ha cambiado algo: lo tuyo retira «Deshacer», y lo de cualquiera deja viejos los resultados. */
function onChange(local: boolean): void {
  if (Date.now() < quietUntil) return;
  // Lo que cambia otra persona no entra en tu historial de deshacer.
  if (local) forgetFix();
  if (!watched || staleSent) return;
  staleSent = true;
  post({ type: 'stale' });
}
const onPageChange = (event: NodeChangeEvent) => onChange(event.nodeChanges.some((c) => c.origin === 'LOCAL'));
/** La vigilancia sigue a la página actual. */
function followPage(): void {
  const page = figma.currentPage;
  if (watched === page) return;
  watched?.off('nodechange', onPageChange);
  page.on('nodechange', onPageChange);
  watched = page;
}
/** Con unos resultados recién enviados, cualquier cambio posterior los deja viejos. */
function watchChanges(): void {
  staleSent = false;
  followPage();
}

/**
 * Vuelve a leer los ajustes del archivo, que otra persona puede haber cambiado con el plugin abierto. Si han
 * cambiado, la UI recibe los nuevos.
 */
async function refreshSettings(): Promise<void> {
  const fresh = await loadSettings();
  const changed = JSON.stringify(fresh) !== JSON.stringify(settings);
  settings = fresh;
  if (changed) post({ type: 'settings', settings });
}

async function sendReady(): Promise<void> {
  settings = await loadSettings();
  // El panel no espera a las bibliotecas: sus variables se importan después y la lista de colecciones se completa.
  const ctx = new AuditContext(settings);
  await ctx.init({ libraries: false });
  post({
    type: 'ready',
    fileName: figma.root.name,
    payment: paymentInfo(),
    collections: ctx.collectionsInfo(),
    settings,
    selectionCount: figma.currentPage.selection.length,
    checks: CHECK_METAS,
    dev: __DEV__,
  });
  void withLibraries();
}

/** Importa las variables de las bibliotecas (se guardan para la sesión) y manda la lista completa de colecciones. */
async function withLibraries(): Promise<void> {
  try {
    const ctx = new AuditContext(settings);
    // Los kits que usa la página actual también: la primera auditoría ya no tendrá que esperar a importarlos.
    await ctx.init({ scan: figma.currentPage.children });
    if (ctx.libraryCollections.length) post({ type: 'collections', collections: ctx.collectionsInfo() });
  } catch (e) {
    if (__DEV__) console.warn('[dod-lint] no se pudieron leer las bibliotecas', e);
  }
}

async function audit(scope: 'selection' | 'page' | 'file'): Promise<void> {
  if (scope === 'file' && !isPro()) {
    post({ type: 'locked', feature: 'file' });
    return;
  }
  if (busy) {
    post({ type: 'error', message: say({ es: 'Ya hay una auditoría en curso. Espera a que termine.', en: 'An audit is already running. Wait for it to finish.' }) });
    return;
  }
  // Se audita con la Definición de hecho que tiene ahora el archivo.
  await refreshSettings();
  if (!Object.values(settings.enabled).some(Boolean)) {
    post({ type: 'error', message: say({ es: 'Activa al menos una comprobación antes de auditar.', en: 'Turn on at least one check before auditing.' }) });
    return;
  }
  busy = true;
  cancelRequested = false;
  try {
    const phase = say({ es: 'Analizando', en: 'Scanning' });
    const result = await runAudit(scope, settings, {
      lang: lang(),
      onProgress: (scanned, findings) => post({ type: 'progress', phase, scanned, findings }),
      shouldStop: () => cancelRequested,
      pause: pauser.pause,
    });
    lastWithoutTokens = Object.keys(result.untokenized) as FloatKind[];
    post({ type: 'results', scope, ...result });
    watchChanges();
  } finally {
    busy = false;
  }
}

/** Vuelve a revisar solo unas capas, sin bajar a sus hijos, y devuelve lo que sale para sustituir lo suyo. */
async function recheck(msg: Extract<UIToCode, { type: 'recheck' }>): Promise<void> {
  if (busy) {
    post({ type: 'error', message: say({ es: 'Ya hay una auditoría en curso. Espera a que termine.', en: 'An audit is already running. Wait for it to finish.' }) });
    return;
  }
  busy = true;
  cancelRequested = false;
  try {
    // Sin volver a leer el archivo: la lista se actualiza con los ajustes que ya enseña la UI.
    const result = await runAudit('page', settings, { lang: lang(), recheck: msg.targets, shouldStop: () => cancelRequested, withoutTokens: lastWithoutTokens, pause: pauser.pause });
    post({ type: 'rechecked', targets: msg.targets.map((t) => t.nodeId), findings: result.findings, durationMs: result.durationMs, cancelled: result.cancelled });
    watchChanges();
  } finally {
    busy = false;
  }
}

function pageOf(node: BaseNode): PageNode | null {
  let cur: BaseNode | null = node;
  while (cur && cur.type !== 'PAGE') cur = cur.parent;
  return (cur as PageNode | null) ?? null;
}

/** Selecciona las capas de una fila: una, o la misma capa en varias variantes de un set. */
async function select(nodeIds: string[]): Promise<void> {
  const found: BaseNode[] = [];
  const nodes = await findNodes(nodeIds);
  for (const id of nodeIds) {
    const node = nodes.get(id);
    if (node && node.type !== 'DOCUMENT') found.push(node);
  }
  const first = found[0];
  if (!first) {
    figma.notify(say({ es: 'Esa capa ya no existe', en: 'That layer no longer exists' }));
    return;
  }
  // Un hallazgo de la propia página (sus modos): se va a ella sin seleccionar nada.
  if (first.type === 'PAGE') {
    if (first !== figma.currentPage) await figma.setCurrentPageAsync(first);
    figma.currentPage.selection = [];
    figma.notify(say({ es: `Está en la propia página «${first.name}»`, en: `It’s on the page "${first.name}" itself` }));
    return;
  }
  const page = pageOf(first);
  if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
  const scene = found.filter((n): n is SceneNode => n.type !== 'PAGE' && pageOf(n) === figma.currentPage);
  figma.currentPage.selection = scene;
  figma.viewport.scrollAndZoomIntoView(scene);
  if (scene.length > 1) figma.notify(say({ es: `${scene.length} capas seleccionadas`, en: `${scene.length} layers selected` }));
}

async function fix(msg: Extract<UIToCode, { type: 'fix' }>): Promise<void> {
  if (!isPro()) {
    post({ type: 'locked', feature: 'fix' });
    return;
  }
  // Cierra cualquier acción previa del plugin para que el lote sea un paso de deshacer limpio.
  figma.commitUndo();
  quiet(60_000);
  lastFix.forget();
  const fixed: FixItem[] = [];
  const done: FixedLayer[] = [];
  let skipped = 0;
  try {
    const ctx = new AuditContext(settings);
    await ctx.init();
    const nodes = await findNodes(msg.items.map((i) => i.nodeId));
    for (const item of msg.items) {
      try {
        const node = nodes.get(item.nodeId) ?? null;
        if (!node || node.type === 'DOCUMENT') {
          skipped++;
          continue;
        }
        const ok = await applyFix(node as SceneNode | PageNode, item.fix, ctx);
        if (ok) {
          fixed.push(item);
          done.push({ node: node as SceneNode | PageNode, fix: item.fix });
        } else skipped++;
      } catch (e) {
        if (__DEV__) console.warn('[dod-lint] corrección fallida', item, e);
        skipped++;
      }
    }
  } finally {
    // Aunque falle a medias, lo aplicado queda en un solo paso de deshacer y los cambios vuelven a contar.
    figma.commitUndo();
    quiet();
  }
  // Sin aviso de Figma: la UI lo da, con su «Deshacer».
  post({ type: 'fixed', checkId: msg.checkId, fixed, skipped, undoId: lastFix.remember(done) });
}

/** Mensajes para personas; el detalle técnico solo viaja en desarrollo. */
function friendly(type: UIToCode['type'] | undefined): string {
  switch (type) {
    case 'audit':
      return say({ es: 'No se pudo completar la auditoría. Vuelve a intentarlo.', en: 'The audit couldn’t finish. Try again.' });
    case 'recheck':
      return say({ es: 'No se pudo revisar de nuevo. Vuelve a intentarlo.', en: 'Couldn’t check again. Try again.' });
    case 'select':
      return say({ es: 'No se pudo seleccionar la capa; puede que ya no exista.', en: 'Couldn’t select the layer; it may no longer exist.' });
    case 'fix':
      return say({ es: 'No se pudieron aplicar las correcciones.', en: 'Couldn’t apply the fixes.' });
    case 'undo':
      return say({ es: 'No se pudo deshacer. Ctrl+Z (Cmd+Z en Mac) lo deshace a mano.', en: 'Couldn’t undo. Ctrl+Z (Cmd+Z on Mac) undoes it by hand.' });
    case 'save-settings':
      return say({ es: 'No se pudieron guardar los ajustes. ¿Tienes permiso de edición en este archivo?', en: 'Couldn’t save the settings. Do you have edit access to this file?' });
    case 'ignore':
      return say({ es: 'No se pudo guardar. ¿Tienes permiso de edición en este archivo?', en: 'Couldn’t save it. Do you have edit access to this file?' });
    case 'checkout':
      return say({ es: 'No se pudo abrir el pago. Vuelve a intentarlo.', en: 'Couldn’t open the checkout. Try again.' });
    default:
      return say({ es: 'Algo falló. Cierra y vuelve a abrir el plugin.', en: 'Something went wrong. Close and reopen the plugin.' });
  }
}

/**
 * Lo que escribe en el archivo, o lo recorre entero, va de uno en uno. El manejador de mensajes es asíncrono: sin
 * esto, ignorar en mitad de una tanda entraba en su paso de deshacer, y una auditoría leía capas a medio corregir.
 * Cancelar, seleccionar y lo demás no esperan.
 */
let queue: Promise<unknown> = Promise.resolve();
function exclusive(job: () => Promise<void> | void): Promise<void> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

figma.ui.onmessage = async (msg: UIToCode) => {
  try {
    switch (msg.type) {
      case 'init':
        locale = msg.locale ?? null;
        await sendReady();
        break;
      case 'audit':
        await exclusive(() => audit(msg.scope));
        break;
      case 'cancel':
        cancelRequested = true;
        break;
      case 'resume':
        pauser.resume(msg.id);
        break;
      case 'select':
        await select(msg.nodeIds);
        break;
      case 'fix':
        await exclusive(() => fix(msg));
        break;
      case 'undo':
        await exclusive(async () => {
          // El deshacer también llega como cambio de la página, y no deja viejos los resultados.
          quiet(60_000);
          let result: UndoResult;
          try {
            result = await lastFix.undo(msg.id, () => figma.triggerUndo());
          } finally {
            quiet();
          }
          post({ type: 'undone', id: msg.id, result });
        });
        break;
      case 'undo-last':
        await exclusive(() => {
          // Con el foco en el plugin, Figma no recibe Ctrl+Z. Lo que se deshaga sí cuenta como cambio: se acaba
          // cualquier silencio que quedara de lo último del plugin.
          quietUntil = 0;
          figma.triggerUndo();
        });
        break;
      case 'ignore':
        await exclusive(() => {
          quiet();
          forgetFix();
          writeIgnored(msg.keys, msg.ignore);
          post({ type: 'ignored', keys: msg.keys, ignore: msg.ignore });
        });
        break;
      case 'recheck':
        await exclusive(() => recheck(msg));
        break;
      case 'checkout':
        await checkout();
        post({ type: 'payment', payment: paymentInfo() });
        break;
      case 'dev-payment':
        devSetPayment(msg.status);
        post({ type: 'payment', payment: paymentInfo() });
        break;
      case 'save-settings':
        await exclusive(async () => {
          quiet();
          forgetFix();
          try {
            // Lo que has cambiado, encima de lo que tenga ahora el archivo.
            await saveSettings(mergeSettings(await loadSettings(), msg.edits));
          } finally {
            // La UI se queda con lo guardado de verdad, también si no se pudo escribir en el archivo.
            settings = await loadSettings();
            post({ type: 'settings', settings });
          }
          if (!msg.silent) figma.notify(say({ es: 'Ajustes guardados', en: 'Settings saved' }));
          const ctx = new AuditContext(settings);
          await ctx.init();
          post({ type: 'collections', collections: ctx.collectionsInfo() });
        });
        break;
      case 'notify':
        figma.notify(msg.message);
        break;
      case 'resize':
        figma.ui.resize(Math.max(360, Math.round(msg.width)), Math.max(400, Math.round(msg.height)));
        break;
    }
  } catch (e) {
    // busy lo sueltan audit y recheck en su finally: aquí lo soltaría el fallo de cualquier otra petición.
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[dod-lint]', e);
    post({ type: 'error', message: friendly(msg?.type), detail: __DEV__ ? detail : undefined, for: msg?.type });
  }
};

figma.on('selectionchange', () => post({ type: 'selection', count: figma.currentPage.selection.length }));
// Editar un estilo cambia las capas que lo usan sin llegar como cambio de capas, y también entra en el historial.
figma.on('stylechange', (event) => onChange(event.styleChanges.some((c) => c.origin === 'LOCAL')));
figma.on('currentpagechange', () => {
  post({ type: 'selection', count: figma.currentPage.selection.length });
  if (watched) followPage();
});
