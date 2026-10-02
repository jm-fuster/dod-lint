/**
 * Busca una capa por id. Las capas internas de una instancia (id "I<instancia>;…", también el contenido
 * de sus slots) se buscan desde la instancia exterior: con esos ids, `getNodeByIdAsync` puede quedarse
 * esperando al servidor unos 10 s y fallar, mientras que el id de la instancia resuelve al momento
 * (medido en Figma Desktop en septiembre de 2026).
 */
export async function findNode(id: string): Promise<BaseNode | null> {
  const cut = id.indexOf(';');
  if (id.startsWith('I') && cut > 1) {
    const top = await figma.getNodeByIdAsync(id.slice(1, cut));
    if (!top || !('findOne' in top)) return null;
    return (top as BaseNode & ChildrenMixin).findOne((n) => n.id === id);
  }
  return figma.getNodeByIdAsync(id);
}

/**
 * Busca varias capas. Las de dentro de una misma instancia salen de un solo recorrido de esa instancia: una a
 * una, cada búsqueda la recorre hasta dar con la suya, a unos 100 µs por capa (medido en un sistema de pruebas), y con cien
 * correcciones en una instancia de dos mil capas eran unos diez segundos. Si de una instancia solo hace falta
 * una capa, se busca como en `findNode`, que para al encontrarla.
 */
export async function findNodes(ids: string[]): Promise<Map<string, BaseNode | null>> {
  // Una que falle no tumba las demás: se queda sin capa, como una que ya no existe.
  const byId = async (id: string) => {
    try {
      return await figma.getNodeByIdAsync(id);
    } catch {
      return null;
    }
  };
  const out = new Map<string, BaseNode | null>();
  const inside = new Map<string, Set<string>>();
  for (const id of ids) {
    const cut = id.indexOf(';');
    if (id.startsWith('I') && cut > 1) {
      const top = id.slice(1, cut);
      inside.set(top, (inside.get(top) ?? new Set()).add(id));
    } else if (!out.has(id)) out.set(id, await byId(id));
  }
  for (const [topId, wanted] of inside) {
    for (const id of wanted) out.set(id, null);
    const top = await byId(topId);
    if (!top || !('findOne' in top)) continue;
    const scope = top as BaseNode & ChildrenMixin;
    if (wanted.size === 1) {
      const [id] = wanted;
      out.set(id, scope.findOne((n) => n.id === id));
    } else for (const n of scope.findAll((n) => wanted.has(n.id))) out.set(n.id, n);
  }
  return out;
}
