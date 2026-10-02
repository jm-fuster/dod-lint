import type { PaymentInfo } from './types';

/**
 * Días de prueba gestionados por el propio plugin (0 = sin prueba propia).
 * El pago, cuando se active, será único (19 $ de referencia, plan del 28-09-2026): Figma solo da prueba en
 * suscripción, y aquí la hace la parte gratuita (selección y página con todas las reglas), así que se queda en 0.
 */
export const TRIAL_DAYS = 0;

/**
 * La API de pagos, si el manifiesto pide el permiso `payments`. El plugin se publica gratis y no lo pide, y Figma
 * no la deja vacía: leerla da error («"payments" permission not specified in manifest.json», comprobado el
 * 01-10-2026).
 */
function paymentsApi(): PaymentsAPI | undefined {
  try {
    return figma.payments;
  } catch {
    return undefined;
  }
}

export function paymentInfo(): PaymentInfo {
  const p = paymentsApi();
  if (!p) return { type: 'FREE', trialDaysLeft: null };
  const type = p.status.type;
  let trialDaysLeft: number | null = null;
  if (TRIAL_DAYS > 0 && type === 'UNPAID') {
    const seconds = p.getUserFirstRanSecondsAgo();
    trialDaysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - seconds / 86400));
  }
  return { type, trialDaysLeft };
}

/**
 * Las funciones Pro se desbloquean si el usuario ha pagado, si no hay pago (sin el permiso en el manifiesto, como
 * ahora, o fuera de Figma) o durante la prueba propia. NOT_SUPPORTED es un error del servicio
 * de pagos: la documentación pide no conceder funciones de pago en ese estado.
 */
export function isPro(): boolean {
  const info = paymentInfo();
  if (info.type === 'PAID' || info.type === 'FREE') return true;
  if (info.type === 'NOT_SUPPORTED') return false;
  return info.trialDaysLeft !== null && info.trialDaysLeft > 0;
}

export async function checkout(): Promise<void> {
  const p = paymentsApi();
  if (!p) return;
  const interstitial = TRIAL_DAYS > 0 && (paymentInfo().trialDaysLeft ?? 0) <= 0 ? 'TRIAL_ENDED' : 'PAID_FEATURE';
  await p.initiateCheckoutAsync({ interstitial });
}

/** Solo en desarrollo: simula el estado de pago para probar el muro de pago. */
export function devSetPayment(type: 'PAID' | 'UNPAID'): void {
  if (!__DEV__) return;
  try {
    paymentsApi()?.setPaymentStatusInDevelopment({ type });
  } catch (e) {
    console.warn('[dod-lint] setPaymentStatusInDevelopment no disponible:', e);
  }
}
