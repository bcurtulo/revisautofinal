/** Versão publicada do app (alinhada às lojas). */
export const APP_VERSION = '1.0.0';

/**
 * Compara semver simples (major.minor.patch). Retorna true se current < minimum.
 * Segmentos ausentes contam como 0. Valores não numéricos contam como 0.
 */
export function isAppVersionBelowMinimum(current: string, minimum: string): boolean {
  const parse = (s: string) =>
    String(s || '')
      .split('.')
      .map((part) => {
        const n = parseInt(part.replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) ? n : 0;
      });
  const a = parse(current);
  const b = parse(minimum);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
