/**
 * Ceder el hilo con una ida y vuelta a la UI. Con Figma tapado por otra ventana, los setTimeout del sandbox no se
 * disparan (medido en octubre de 2026: uno de 0 ms no volvió en 30 s), y una auditoría que cedía con ellos se
 * quedaba parada hasta volver a Figma. Los mensajes con la UI sí llegan. Mientras se espera la vuelta, Figma pinta
 * y atiende lo que la UI haya mandado antes, como Cancelar.
 */
export function uiPause(send: (id: number) => void, fallbackMs = 500) {
  let seq = 0;
  const waiting = new Map<number, () => void>();
  return {
    /**
     * Cede hasta que la UI conteste, que es enseguida. Si no contestara, sigue a los `fallbackMs` (con Figma a la
     * vista): una espera larga en cada pausa haría eterna una auditoría de un minuto, que hace cientos.
     */
    pause(): Promise<void> {
      const id = ++seq;
      return new Promise<void>((resolve) => {
        const done = () => {
          if (!waiting.delete(id)) return;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, fallbackMs);
        waiting.set(id, done);
        send(id);
      });
    },
    /** La respuesta de la UI a la pausa `id`. Una que ya no se espera no hace nada. */
    resume(id: number): void {
      waiting.get(id)?.();
    },
  };
}
