// Universal date and currency formatters used across the app.
// Centralizing here lets us swap rendering globally based on user preferences.

export type DateFormat = 'dd/mm/yyyy' | 'mm/dd/yyyy';

// Map app language labels (used as keys in translations) to BCP-47 locales.
// Used by Intl.NumberFormat for locale-aware grouping/decimal separators.
const LANGUAGE_TO_LOCALE: Record<string, string> = {
  'Português (Brasil)': 'pt-BR',
  'Português (Portugal)': 'pt-PT',
  English: 'en-US',
  Español: 'es-ES',
};

export function getLocaleFromLanguage(language: string): string {
  return LANGUAGE_TO_LOCALE[language] || 'pt-BR';
}

// Auto-derive default dateFormat for a given app language when the user has
// not explicitly chosen one (controlled by the hasManualDateFormat flag).
export function getDefaultDateFormatForLanguage(language: string): DateFormat {
  return language === 'English' ? 'mm/dd/yyyy' : 'dd/mm/yyyy';
}

// Display-only localization of the format token: PT/ES users expect to see
// "aaaa" instead of "yyyy" in UI labels, but the internal state keeps the
// canonical token so format.ts logic stays untouched.
export function getDateFormatDisplay(format: DateFormat, language: string): string {
  return language === 'English' ? format : format.replace('yyyy', 'aaaa');
}

// Parse a date input safely. Treat YYYY-MM-DD as a *local* date to avoid
// timezone shifts that turn "2024-01-15" into Jan 14 in negative offsets.
function toDate(input: string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatAppDate(
  input: string | Date | null | undefined,
  dateFormat: DateFormat,
): string {
  const d = toDate(input);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return dateFormat === 'mm/dd/yyyy' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
}

export function formatAppCurrency(
  value: number | null | undefined,
  currencyCode: string,
  language: string,
): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const locale = getLocaleFromLanguage(language);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(numeric);
  } catch {
    return `${currencyCode} ${numeric.toFixed(2)}`;
  }
}

// Curated list of widely-used currencies. Values are the ISO 4217 codes.
// Labels are kept in Portuguese as a baseline; UI can prepend the code when
// rendering for clarity across languages.
export interface CurrencyOption {
  code: string;
  label: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'BRL', label: 'Real Brasileiro' },
  { code: 'USD', label: 'Dólar Americano' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'Libra Esterlina' },
  { code: 'CAD', label: 'Dólar Canadense' },
  { code: 'AUD', label: 'Dólar Australiano' },
  { code: 'CHF', label: 'Franco Suíço' },
  { code: 'JPY', label: 'Iene Japonês' },
  { code: 'CNY', label: 'Yuan Chinês' },
  { code: 'KRW', label: 'Won Sul-Coreano' },
  { code: 'INR', label: 'Rupia Indiana' },
  { code: 'ARS', label: 'Peso Argentino' },
  { code: 'CLP', label: 'Peso Chileno' },
  { code: 'COP', label: 'Peso Colombiano' },
  { code: 'MXN', label: 'Peso Mexicano' },
  { code: 'UYU', label: 'Peso Uruguaio' },
  { code: 'PEN', label: 'Sol Peruano' },
  { code: 'PYG', label: 'Guarani Paraguaio' },
  { code: 'BOB', label: 'Boliviano' },
  { code: 'VES', label: 'Bolívar Venezuelano' },
  { code: 'ZAR', label: 'Rand Sul-Africano' },
  { code: 'TRY', label: 'Lira Turca' },
  { code: 'RUB', label: 'Rublo Russo' },
  { code: 'PLN', label: 'Złoty Polonês' },
  { code: 'SEK', label: 'Coroa Sueca' },
  { code: 'NOK', label: 'Coroa Norueguesa' },
  { code: 'DKK', label: 'Coroa Dinamarquesa' },
  { code: 'AED', label: 'Dirham (EAU)' },
  { code: 'ILS', label: 'Shekel Israelense' },
  { code: 'SGD', label: 'Dólar de Singapura' },
];
