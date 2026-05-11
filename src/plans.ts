/** Níveis de assinatura — regras compartilhadas front + back (server importa este arquivo). */

export type PlanTier = 'free' | 'plus' | 'premium';

export function normalizePlan(plan: string | null | undefined): PlanTier {
  const p = String(plan ?? 'free')
    .toLowerCase()
    .trim();
  if (p === 'premium') return 'premium';
  if (p === 'plus') return 'plus';
  return 'free';
}

export const VEHICLE_LIMIT: Record<PlanTier, number> = {
  free: 1,
  plus: 3,
  premium: 5,
};

/** Mensagens enviadas ao Dr. Graxa (POST /api/chat) por mês civil (UTC). */
export const AI_MESSAGE_MONTHLY_LIMIT: Record<PlanTier, number> = {
  free: 0,
  plus: 30,
  premium: 60,
};

export const CHECKOUT_PRICES_BRL = {
  plus: { monthly: 14.9, annual: 159.9 },
  premium: { monthly: 29.9, annual: 319.9 },
} as const;

export type CheckoutPlan = keyof typeof CHECKOUT_PRICES_BRL;
export type CheckoutPeriod = 'monthly' | 'annual';

/** Aceita mensal/anual (PT), monthly/annual e sinônimos — default mensal. */
export function normalizeCheckoutPeriod(raw: unknown): CheckoutPeriod {
  const stripped = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const t = stripped.trim();
  if (['anual', 'annual', 'year', 'yearly', 'ano'].includes(t)) {
    return 'annual';
  }
  return 'monthly';
}

export function isFreePlan(plan?: string | null): boolean {
  return normalizePlan(plan) === 'free';
}

export function isPlusOrPremium(plan?: string | null): boolean {
  return normalizePlan(plan) !== 'free';
}

export function isPremiumPlan(plan?: string | null): boolean {
  return normalizePlan(plan) === 'premium';
}

export function maxVehiclesForPlan(plan?: string | null): number {
  return VEHICLE_LIMIT[normalizePlan(plan)];
}

export function aiMonthlyLimitForPlan(plan?: string | null): number {
  return AI_MESSAGE_MONTHLY_LIMIT[normalizePlan(plan)];
}

export function buildMpExternalReference(
  userId: string,
  planType: CheckoutPlan,
  period: CheckoutPeriod,
): string {
  return `revis:${userId}:${planType}:${period}`;
}

export function parseMpExternalReference(ref: string | null | undefined): {
  userId: string;
  planTier: CheckoutPlan;
} {
  const r = String(ref ?? '').trim();
  if (!r) return { userId: '', planTier: 'premium' };
  const parts = r.split(':');
  if (parts.length >= 3 && parts[0] === 'revis' && parts[1]) {
    const userId = parts[1];
    const raw = (parts[2] || 'premium').toLowerCase();
    const planTier: CheckoutPlan = raw === 'plus' ? 'plus' : 'premium';
    return { userId, planTier };
  }
  return { userId: r, planTier: 'premium' };
}
