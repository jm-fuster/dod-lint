// Bundle de prueba sin UI ni pagos. Se ejecuta en cualquier sandbox con el objeto `figma`
// (por ejemplo, pegándolo en figma_execute de figma-console) y expone __dodlint.run(scope, overrides),
// __dodlint.runNodes(ids, overrides), que audita capas concretas sin tocar la selección, y
// __dodlint.recheck(findings, overrides), que vuelve a revisar las capas de unos hallazgos como la UI.
// No cede el hilo: sin UI con la que hacer ida y vuelta, cedería con setTimeout, y con Figma tapado esos no se
// disparan. Una llamada que no cabe en los 30 s del puente sigue en el sandbox, y las siguientes no responden
// hasta que acaba.
import type { Finding, Scope, Settings } from './types';
import { runAudit } from './audit';
import type { AuditResult } from './audit';
import { CHECK_METAS } from './checks';
import { mergeSettings } from './settings';
import { findNode } from './nodes';
import { recheckTargets } from './recheck';

function summarize(result: AuditResult) {
  const byCheck: Record<string, number> = {};
  for (const f of result.findings) byCheck[f.checkId] = (byCheck[f.checkId] ?? 0) + 1;
  return {
    scanned: result.scanned,
    pages: result.pages,
    durationMs: result.durationMs,
    truncated: result.truncated,
    skippedContrast: result.skippedContrast,
    looseNodes: result.looseNodes,
    untokenized: result.untokenized,
    timings: result.timings,
    byCheck,
    sample: result.findings.slice(0, 60).map((f) => ({ check: f.checkId, node: f.nodeName, path: f.path, msg: f.message, sev: f.severity, fix: f.fix?.kind })),
    findings: result.findings,
  };
}

export async function run(scope: Scope = 'page', overrides: Partial<Settings> = {}, maxPerCheck = 200, pageName?: string) {
  const settings = mergeSettings(overrides);
  let pages: PageNode[] | undefined;
  if (pageName) {
    await figma.loadAllPagesAsync();
    const page = figma.root.children.find((p) => p.name.includes(pageName));
    if (!page) throw new Error(`No hay ninguna página que contenga "${pageName}"`);
    pages = [page];
  }
  return summarize(await runAudit(scope, settings, { maxPerCheck, yieldMs: Infinity, pages, profile: true }));
}

export async function runNodes(ids: string[], overrides: Partial<Settings> = {}, maxPerCheck = 200) {
  const roots: SceneNode[] = [];
  for (const id of ids) {
    const node = await findNode(id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'PAGE') throw new Error(`No hay ninguna capa con id ${id}`);
    roots.push(node as SceneNode);
  }
  return summarize(await runAudit('selection', mergeSettings(overrides), { maxPerCheck, yieldMs: Infinity, roots, profile: true }));
}

export async function recheck(findings: Finding[], overrides: Partial<Settings> = {}, maxPerCheck = 200) {
  const targets = recheckTargets(findings);
  return { targets: targets.length, ...summarize(await runAudit('page', mergeSettings(overrides), { maxPerCheck, yieldMs: Infinity, recheck: targets })) };
}

export const checks = CHECK_METAS;
export { rowsOf } from './rows';
