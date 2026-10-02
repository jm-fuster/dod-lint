// Deshacer la última tanda de correcciones desde el plugin, con el deshacer de Figma.
import type { FixHint } from './types';
import { fixApplied } from './fixes';

/** Una capa corregida en la tanda y lo que se le hizo. */
export interface FixedLayer {
  node: SceneNode | PageNode;
  fix: FixHint;
}

/**
 * undone: Figma ha quitado la tanda. expired: ya no era lo último del historial. other: Figma ha deshecho
 * otra cosa, posterior, y las correcciones siguen puestas.
 */
export type UndoResult = 'undone' | 'expired' | 'other';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * La última tanda corregida. triggerUndo deshace el último paso del historial, sea de quien sea, así que la
 * tanda solo vale mientras sea ese paso: cualquier otro cambio en el archivo la olvida.
 */
export class LastFix {
  private batch: { id: number; done: FixedLayer[] } | null = null;
  private seq = 0;

  /** Guarda la tanda recién corregida y devuelve su número; nada si no cambió ninguna capa. */
  remember(done: FixedLayer[]): number | undefined {
    this.batch = done.length ? { id: ++this.seq, done } : null;
    return this.batch?.id;
  }

  /** La olvida y devuelve su número, para que la UI deje de ofrecer «Deshacer». */
  forget(): number | undefined {
    const id = this.batch?.id;
    this.batch = null;
    return id;
  }

  /**
   * Deshace la tanda si sigue siendo la última y sus correcciones siguen puestas. Después comprueba que se han
   * quitado: si no, lo que Figma ha deshecho era otra cosa.
   */
  async undo(id: number, triggerUndo: () => void, wait: (ms: number) => Promise<void> = sleep): Promise<UndoResult> {
    // Otro número es una tanda anterior: la última sigue en pie.
    const batch = this.batch?.id === id ? this.batch : null;
    if (!batch) return 'expired';
    this.batch = null;
    if (!batch.done.every(({ node, fix }) => !node.removed && fixApplied(node, fix) === true)) return 'expired';
    triggerUndo();
    // Figma lo aplica al momento; por si tardara, se mira unas veces más antes de darla por no deshecha.
    for (let i = 0; i < 10; i++) {
      if (batch.done.every(({ node, fix }) => !node.removed && fixApplied(node, fix) === false)) return 'undone';
      await wait(50);
    }
    return 'other';
  }
}
