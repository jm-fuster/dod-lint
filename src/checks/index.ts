import type { CheckMeta, Finding } from '../types';
import type { AuditContext } from '../context';
import { autoLayoutCheck, spacingCheck } from './layout';
import { colorCheck, primitiveCheck, contrastCheck } from './color';
import { textCheck, placeholderCheck } from './text';
import { statesCheck, stackedCheck, touchCheck, propsCheck, descriptionCheck, detachedCheck } from './components';
import { slotsCheck } from './slots';
import { brokenCheck } from './refs';

export interface Check {
  meta: CheckMeta;
  /**
   * Recibe también los slots de las instancias aunque no se entre en ellas. El resto de reglas
   * solo ve el contenido que se puso en esos slots.
   */
  instanceSlots?: boolean;
  /**
   * Recibe también los textos de las instancias aunque no se entre en ellas, porque su resultado depende
   * de dónde está colocada la instancia y en qué modo.
   */
  placed?: boolean;
  /**
   * Campos que mira en las capas de dentro de una instancia que esta sobrescribe. Recibe esas capas aunque no
   * se entre en la instancia, y en ellas solo debe mirar lo sobrescrito (`ctx.overridesOf`).
   */
  overrides?: readonly string[];
  run(node: SceneNode, ctx: AuditContext, page: PageNode): Promise<Finding[] | null> | Finding[] | null;
  /** Revisa la propia página, una vez, al auditar una página o el archivo (no una selección). */
  runPage?(page: PageNode, ctx: AuditContext): Promise<Finding[] | null> | Finding[] | null;
}

/** Orden de ejecución. La interfaz las agrupa por categoría y, dentro de cada una, respeta este orden. */
export const CHECKS: Check[] = [
  autoLayoutCheck,
  spacingCheck,
  textCheck,
  colorCheck,
  primitiveCheck,
  statesCheck,
  stackedCheck,
  touchCheck,
  placeholderCheck,
  propsCheck,
  slotsCheck,
  descriptionCheck,
  detachedCheck,
  brokenCheck,
  contrastCheck,
];

export const CHECK_METAS: CheckMeta[] = CHECKS.map((c) => c.meta);
