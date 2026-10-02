// Filas de la lista: los hallazgos iguales de una capa van juntos, y también el mismo hallazgo de la misma
// capa en varias variantes de un set («en 48 de 100 variantes»). Por debajo siguen siendo hallazgos sueltos.
import type { Finding, FixItem } from './types';

export interface Row {
  key: string;
  /** El primero, que da el mensaje, la severidad y el sitio. */
  finding: Finding;
  findings: Finding[];
  /** Capas distintas de la fila, en orden, para seleccionarlas todas. */
  nodeIds: string[];
  fixes: FixItem[];
  /** Variantes distintas del set en las que sale; 1 si no es de un set. */
  variants: number;
}

/** Mismo hallazgo en la misma capa; en un set, la misma capa es la misma ruta de nombres en cada variante. */
export const rowKeyOf = (f: Finding) =>
  f.variantOf ? `${f.checkId}|set:${f.variantOf.setId}|${f.variantOf.layerPath}|${f.message}` : `${f.checkId}|${f.nodeId}|${f.message}`;

export function rowsOf(findings: Finding[]): Row[] {
  const rows = new Map<string, { row: Row; nodes: Set<string>; variants: Set<string> }>();
  for (const f of findings) {
    const key = rowKeyOf(f);
    let entry = rows.get(key);
    if (!entry) {
      entry = { row: { key, finding: f, findings: [], nodeIds: [], fixes: [], variants: 1 }, nodes: new Set(), variants: new Set() };
      rows.set(key, entry);
    }
    const { row, nodes, variants } = entry;
    row.findings.push(f);
    if (!nodes.has(f.nodeId)) {
      nodes.add(f.nodeId);
      row.nodeIds.push(f.nodeId);
    }
    if (f.variantOf) variants.add(f.variantOf.variantId);
    if (f.fix) row.fixes.push({ nodeId: f.nodeId, fix: f.fix });
    row.variants = Math.max(1, variants.size);
  }
  return [...rows.values()].map((e) => e.row);
}
