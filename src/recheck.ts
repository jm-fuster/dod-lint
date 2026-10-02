// Revisar de nuevo: qué capas mirar otra vez tras editarlas a mano y cómo encajar lo nuevo en la lista.
import type { Finding, RecheckTarget } from './types';
import { isPlacedKey } from './ignore';

/**
 * Cada capa con hallazgos, una vez. Un texto de instancia se revisa como en la auditoría, solo por
 * contraste, y con las demás instancias que daban su mismo resultado; una capa sobrescrita en una
 * instancia, solo por lo sobrescrito; una instancia con capas sueltas, entera, porque sus hallazgos
 * venían de dentro.
 */
export function recheckTargets(findings: Finding[]): RecheckTarget[] {
  const out = new Map<string, RecheckTarget>();
  for (const f of findings) {
    const placed = isPlacedKey(f.ignoreKey);
    for (const nodeId of [f.nodeId, ...(f.alsoAt ?? [])]) {
      const target = out.get(nodeId) ?? { nodeId };
      if (placed) target.placed = true;
      if (f.overridden) target.overridden = true;
      if (f.anchored) target.deep = true;
      out.set(nodeId, target);
    }
  }
  return [...out.values()];
}

/**
 * Sustituye los hallazgos de las capas revisadas por los nuevos, en el sitio donde estaban los viejos, para
 * que la lista no se reordene. Lo nuevo de capas que no tenían hallazgo propio (otra instancia que pasa a
 * representar un resultado repetido) va al final.
 */
export function mergeRechecked(old: Finding[], targets: string[], fresh: Finding[]): Finding[] {
  const ids = new Set(targets);
  const byNode = new Map<string, Finding[]>();
  for (const f of fresh) byNode.set(f.nodeId, [...(byNode.get(f.nodeId) ?? []), f]);
  const out: Finding[] = [];
  const done = new Set<string>();
  for (const f of old) {
    if (!ids.has(f.nodeId)) {
      out.push(f);
      continue;
    }
    if (done.has(f.nodeId)) continue;
    done.add(f.nodeId);
    out.push(...(byNode.get(f.nodeId) ?? []));
    byNode.delete(f.nodeId);
  }
  for (const rest of byNode.values()) out.push(...rest);
  return out;
}
