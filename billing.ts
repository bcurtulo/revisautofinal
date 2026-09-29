/**
 * Utilitários relacionados a assinaturas/pagamentos.
 *
 * Antes vivia em biometric.ts, que foi removido junto com todo o sistema de
 * desbloqueio biométrico — este é um webapp, não faz sentido pedir Face ID
 * para abrir uma aba do navegador.
 */
export function mercadoPagoSubscriptionsPortalUrl(): string {
  return (
    (import.meta.env.VITE_MP_SUBSCRIPTIONS_URL as string | undefined)?.trim() ||
    'https://www.mercadopago.com.br/subscriptions'
  );
}
