import './index.css';
import { CustomSelect } from './CustomSelect';
import { generateVehicleReportPdf, downloadPdf } from './pdfReport';
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Car, Bike, Zap, Wrench, Droplets, FileText, Plus, Activity, MessageSquare, MapPin, Calendar, Clock, Gauge, ChevronLeft, ChevronRight, Hop as Home, Menu, Eye, EyeOff, Check, X, Search, Warehouse, ChevronDown, ChevronUp, Shield, Send, Globe, Type, Pencil, Paintbrush, Trash2, Archive, History, Settings, User as UserIcon, DollarSign, CalendarDays, Mail, ArrowLeft, Lightbulb, Layers, Paperclip, Upload, Loader2 } from 'lucide-react';
import { Vehicle, MaintenanceLog, User, MileageLog, FinancialRecord, ChatSession, ChatMessage } from './types';
import { PremiumCrown } from './components/PremiumCrown';
import { CAR_BRANDS, CAR_MODELS, MOTO_BRANDS, MOTO_MODELS, EBIKE_BRANDS, EBIKE_MODELS, OFFENSIVE_WORDS, VEHICLE_COLORS } from './constants';
import { translations } from './translations';
import {
  formatAppDate,
  formatAppCurrency,
  getDefaultDateFormatForLanguage,
  getDateFormatDisplay,
  getLocaleFromLanguage,
  CURRENCY_OPTIONS,
  type DateFormat,
} from './utils/format';
import {
  isFreePlan,
  isPlusOrPremium,
  isPremiumPlan,
  maxVehiclesForPlan,
  CHECKOUT_PRICES_BRL,
  normalizePlan,
  aiMonthlyLimitForPlan,
  type PlanTier,
} from './plans';
import { APP_VERSION, isAppVersionBelowMinimum } from './appVersion';
import { mercadoPagoSubscriptionsPortalUrl } from './billing';

// Base URL para chamadas de API. Em produção (Vercel/Render) DEVE ser
// definida via VITE_API_URL apontando para o backend. Em dev local fica
// vazia e usamos o proxy do Vite (vite.config.js -> server.proxy['/api']).
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Lê o JWT do Supabase a partir do user persistido em localStorage.
// Lemos do storage (em vez do estado React) para que a função possa ser
// chamada logo depois de setUser(...) sem esperar o re-render.
function getStoredAccessToken(): string | undefined {
  try {
    const raw = localStorage.getItem('revis_user');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return typeof parsed?.access_token === 'string' ? parsed.access_token : undefined;
  } catch {
    return undefined;
  }
}

// Lê o refresh_token do Supabase a partir do user persistido em localStorage.
function getStoredRefreshToken(): string | undefined {
  try {
    const raw = localStorage.getItem('revis_user');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return typeof parsed?.refresh_token === 'string' ? parsed.refresh_token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chamado quando a sessão não pôde ser renovada (refresh_token também
 * vencido, ou ausente). Componentes registram um handler aqui no mount
 * para poder reagir imediatamente na UI, sem esperar um reload de página —
 * este arquivo é código de módulo, fora do componente React, então não
 * tem acesso direto a setUser/setAuthScreen.
 */
let sessionExpiredHandler: (() => void) | null = null;
function onSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

// Evita que várias chamadas 401 simultâneas disparem várias renovações ao
// mesmo tempo — todas esperam a MESMA promise em andamento.
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Troca o refresh_token por um access_token novo. Sessões do Supabase
 * expiram por padrão em 1 hora; sem isto, qualquer uso do app mais longo
 * que isso passava a devolver "Token inválido ou expirado" em tudo,
 * exigindo logout manual — o que não é razoável pedir do usuário.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return null;
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null) as { access_token?: string; refresh_token?: string } | null;
      if (!data?.access_token) return null;
      try {
        const raw = localStorage.getItem('revis_user');
        const parsed = raw ? JSON.parse(raw) : {};
        localStorage.setItem('revis_user', JSON.stringify({
          ...parsed,
          access_token: data.access_token,
          refresh_token: data.refresh_token ?? refreshToken,
        }));
      } catch {
        /* se não conseguir persistir, ainda assim usa o token na chamada atual */
      }
      return data.access_token;
    } catch {
      return null;
    }
  })();
  const result = await refreshInFlight;
  refreshInFlight = null;
  return result;
}

/**
 * Núcleo de toda chamada autenticada. Se a resposta vier 401, tenta
 * renovar a sessão UMA vez e repete a requisição original — nem toda
 * expiração de token deveria virar erro visível para quem está usando
 * o app. Se a renovação também falhar, força o logout local.
 */
async function authenticatedFetch(path: string, init: RequestInit = {}, isRetry = false): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getStoredAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (res.status === 401 && !isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return authenticatedFetch(path, init, true);
    }
    try { localStorage.removeItem('revis_user'); } catch { /* ignore */ }
    sessionExpiredHandler?.();
  }
  return res;
}

// Wrapper de fetch que injeta automaticamente o header
// `Authorization: Bearer <access_token>` quando disponível, força o
// Content-Type: application/json em requisições com corpo, e renova a
// sessão sozinho se o token tiver vencido.
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return authenticatedFetch(path, { ...init, headers });
}

/**
 * Sobe um arquivo (CRLV, comprovante, foto) para o Storage e devolve o
 * caminho salvo, ou null se falhar. O caminho segue sempre o padrão
 * `{user_id}/vehicles/...` — é o que autoriza o acesso no backend.
 */
async function uploadFileToStorage(file: File, path: string): Promise<{ path: string | null; error: string | null }> {
  const form = new FormData();
  form.append('file', file);
  form.append('path', path);
  try {
    const res = await authenticatedFetch('/api/storage/upload', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => null) as { path?: string; error?: string; message?: string } | null;
    if (!res.ok) {
      const msg = data?.message || data?.error || `Erro ${res.status} ao enviar o arquivo.`;
      console.error('uploadFileToStorage failed:', res.status, msg);
      return { path: null, error: msg };
    }
    return { path: data?.path ?? null, error: null };
  } catch (err) {
    console.error('uploadFileToStorage network error:', err);
    return { path: null, error: err instanceof Error ? err.message : 'Erro de rede ao enviar o arquivo.' };
  }
}

/** Abre um arquivo já salvo no Storage numa nova aba, sem fechar o app. */
async function openStorageFile(path: string): Promise<void> {
  try {
    const res = await apiFetch('/api/storage/signed-view', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null) as { signedUrl?: string } | null;
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.error('Error opening storage file:', error);
  }
}

/** Caminho único para um novo anexo, sempre prefixado pelo dono do arquivo. */
function newAttachmentPath(userId: string | number, segments: (string | number)[], filename: string): string {
  const safeExt = (filename.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const uid = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [String(userId), ...segments.map(String), `${uid}.${safeExt}`].join('/');
}

function digitsOnlyToNonNegativeInt(raw: string): number {
  const d = raw.replace(/\D/g, '');
  if (!d) return 0;
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Converte quilometragem exibida (ex.: 35.000) + estado em inteiro não negativo para a API. */
function sanitizeVehicleKmForApi(currentMileage: unknown, mileageInputDisplay: string): number {
  if (mileageInputDisplay.trim() !== '') {
    return digitsOnlyToNonNegativeInt(mileageInputDisplay);
  }
  if (typeof currentMileage === 'number' && Number.isFinite(currentMileage)) {
    return Math.max(0, Math.trunc(currentMileage));
  }
  if (currentMileage != null && String(currentMileage).trim() !== '') {
    return digitsOnlyToNonNegativeInt(String(currentMileage));
  }
  return 0;
}

function formatMileageThousandsDots(km: number): string {
  const n = Math.max(0, Math.trunc(Number(km) || 0));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseApiJsonBody(text: string): { json: Record<string, unknown> | null; rawText: string } {
  const trimmed = text.trim();
  if (!trimmed) return { json: null, rawText: '' };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { json: parsed as Record<string, unknown>, rawText: trimmed };
    }
  } catch {
    /* não é JSON */
  }
  return { json: null, rawText: trimmed };
}

function messageFromApiErrorParts(
  json: Record<string, unknown> | null,
  rawText: string,
  status: number,
): string {
  if (json) {
    const msg = json.message;
    const err = json.error;
    const details = json.details;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    if (typeof err === 'string' && err.trim()) return err.trim();
    if (typeof details === 'string' && details.trim()) return details.trim();
  }
  if (rawText.trim()) return rawText.trim();
  return status ? `HTTP ${status}` : '';
}

function isVehiclePlanLimitResponse(status: number, json: Record<string, unknown> | null, rawText: string): boolean {
  if (status !== 403) return false;
  if (json?.error === 'vehicle_limit_reached') return true;
  const blob = `${rawText} ${String(json?.message ?? '')} ${String(json?.error ?? '')}`.toLowerCase();
  if (blob.includes('vehicle_limit_reached')) return true;
  const hasLimit = blob.includes('limite') || blob.includes('limit');
  const hasVehicle =
    blob.includes('veículo') || blob.includes('veiculo') || blob.includes('vehicle');
  return hasLimit && hasVehicle;
}

// Quantos dias um mês tem, sem depender de `new Date()` para evitar shift de
// fuso horário ao validar entradas digitadas pelo usuário.
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

// Soma N dias a uma string ISO (YYYY-MM-DD), retornando outra ISO sem shift de
// timezone (usamos UTC para o cálculo aritmético).
function addDaysISO(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match) return '';
  const y = Number(match[1]);
  const mo = Number(match[2]) - 1;
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Retorna o símbolo da moeda (R$, US$, €, etc.) compatível com o locale do
// usuário. Usado em labels de inputs para indicar a moeda dinamicamente.
function getCurrencySymbol(code: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value || code;
  } catch {
    return code;
  }
}

// Input de data que respeita a preferência de formato do app
// (dd/mm/yyyy ou mm/dd/yyyy). Armazena o valor em ISO (YYYY-MM-DD)
// para compatibilidade com Supabase/back-end e nunca cria um objeto
// Date a partir da string para evitar deslocamentos por timezone.
//
// UX híbrida: o usuário pode (a) digitar com máscara automática
// respeitando a preferência de formato, ou (b) clicar no ícone de
// calendário para abrir um popover visual de seleção.
function LocalizedDateInput({
  value,
  onChange,
  dateFormat,
  required,
  className,
  ariaLabel,
  locale = 'pt-BR',
}: {
  value: string;
  onChange: (iso: string) => void;
  dateFormat: DateFormat;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
  locale?: string;
}) {
  // Resolve rótulos de acessibilidade do calendário a partir do `locale` já
  // recebido (mesmo mecanismo usado para nomes de mês/dia via Intl). Apenas
  // camada de exibição; não altera parsing nem navegação.
  const localeToLang: Record<string, keyof typeof translations> = {
    'pt-BR': 'Português (Brasil)',
    'pt-PT': 'Português (Portugal)',
    'en-US': 'English',
    'es-ES': 'Español',
  };
  const ariaT = (key: keyof typeof translations['Português (Brasil)']): string => {
    const lang = localeToLang[locale] ?? 'Português (Brasil)';
    return translations[lang][key] || translations['Português (Brasil)'][key];
  };

  const isoToText = (iso: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return '';
    const [, yyyy, mm, dd] = match;
    return dateFormat === 'mm/dd/yyyy' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
  };

  const [text, setText] = useState<string>(() => isoToText(value));
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Resolve a "view month" inicial a partir do valor atual, ou hoje quando vazio.
  const computeInitialView = (): { year: number; month: number } => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  };
  const [viewYear, setViewYear] = useState<number>(() => computeInitialView().year);
  const [viewMonth, setViewMonth] = useState<number>(() => computeInitialView().month);

  // Mantém o input sincronizado quando o valor externo muda
  // (ex.: ao abrir o modal em modo edição com data pré-preenchida).
  useEffect(() => {
    setText(isoToText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, dateFormat]);

  // Ao abrir o calendário, posiciona a "view" no mês do valor selecionado.
  useEffect(() => {
    if (!isCalendarOpen) return;
    const init = computeInitialView();
    setViewYear(init.year);
    setViewMonth(init.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCalendarOpen]);

  // Fecha o popover ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!isCalendarOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const node = wrapperRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setIsCalendarOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCalendarOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isCalendarOpen]);

  const placeholder = dateFormat === 'mm/dd/yyyy' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
    let masked = digits;
    if (digits.length > 4) masked = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) masked = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(masked);

    if (digits.length === 0) {
      onChange('');
      return;
    }
    if (digits.length === 8) {
      let dd: string, mm: string, yyyy: string;
      if (dateFormat === 'mm/dd/yyyy') {
        mm = digits.slice(0, 2);
        dd = digits.slice(2, 4);
        yyyy = digits.slice(4, 8);
      } else {
        dd = digits.slice(0, 2);
        mm = digits.slice(2, 4);
        yyyy = digits.slice(4, 8);
      }
      const day = Number(dd);
      const month = Number(mm);
      const year = Number(yyyy);
      if (
        year >= 1900 &&
        month >= 1 && month <= 12 &&
        day >= 1 && day <= daysInMonth(year, month)
      ) {
        onChange(`${yyyy}-${mm}-${dd}`);
      } else {
        onChange('');
      }
    }
  };

  const goPrevMonth = () => {
    let m = viewMonth - 1;
    let y = viewYear;
    if (m < 1) { m = 12; y -= 1; }
    setViewMonth(m);
    setViewYear(y);
  };
  const goNextMonth = () => {
    let m = viewMonth + 1;
    let y = viewYear;
    if (m > 12) { m = 1; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const handleDayClick = (day: number) => {
    const yy = String(viewYear).padStart(4, '0');
    const mm = String(viewMonth).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${yy}-${mm}-${dd}`);
    setIsCalendarOpen(false);
  };

  // Cabeçalho do calendário (mês + ano) localizado via Intl.
  const headerLabel = (() => {
    try {
      return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
        .format(new Date(viewYear, viewMonth - 1, 1));
    } catch {
      return `${viewMonth}/${viewYear}`;
    }
  })();

  // Nomes curtos dos dias da semana (Dom..Sáb) localizados.
  const weekdayLabels = (() => {
    try {
      const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
      // 4 jan 1970 caiu num domingo (em qualquer fuso, basta usar UTC).
      return Array.from({ length: 7 }, (_, i) =>
        fmt.format(new Date(Date.UTC(1970, 0, 4 + i))).replace('.', '').slice(0, 3),
      );
    } catch {
      return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    }
  })();

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const today = new Date();
  const selectedISO = value;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        onChange={handleChange}
        required={required}
        aria-label={ariaLabel}
        maxLength={10}
        className={`${className ?? ''} pr-9`}
      />
      <button
        type="button"
        onClick={() => setIsCalendarOpen(prev => !prev)}
        aria-label={ariaT('calendarOpenAria')}
        aria-expanded={isCalendarOpen}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-[--color-revis-gray] hover:text-[#34a06a] transition-colors"
      >
        <CalendarDays className="w-4 h-4" />
      </button>

      {isCalendarOpen && (
        <div
          role="dialog"
          aria-modal="false"
          className="absolute left-0 top-full mt-2 z-50 w-[260px] max-w-[calc(100vw-2rem)] calendar-panel border border-white/18 rounded-xl p-3 shadow-xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label={ariaT('calendarPrevMonthAria')}
              className="p-1 text-[--color-revis-gray] hover:text-[#34a06a] hover:bg-white/5 rounded-md transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-[--color-heading] font-display capitalize">
              {headerLabel}
            </span>
            <button
              type="button"
              onClick={goNextMonth}
              aria-label={ariaT('calendarNextMonthAria')}
              className="p-1 text-[--color-revis-gray] hover:text-[#34a06a] hover:bg-white/5 rounded-md transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] text-[--color-revis-gray] text-center capitalize">
            {weekdayLabels.map((w, idx) => (
              <span key={`${w}-${idx}`}>{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => {
              const iso = `${String(viewYear).padStart(4, '0')}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = selectedISO === iso;
              const isToday =
                today.getFullYear() === viewYear &&
                today.getMonth() + 1 === viewMonth &&
                today.getDate() === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  className={`h-7 text-[11px] rounded-md transition-colors ${
                    isSelected
                      ? 'bg-[#34a06a] text-black font-bold'
                      : isToday
                      ? 'bg-white/8 text-[--color-heading] font-display'
                      : 'text-[--color-text] hover:bg-white/8'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline WhatsApp brand glyph. lucide-react omits brand logos for trademark
// reasons, so we ship a minimal SVG here to avoid adding a dependency.
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);

function chatTitleFromFirstQuestion(text: string, maxLen = 120): string {
  const c = text.trim().replace(/\s+/g, ' ');
  if (!c) return '';
  return c.length <= maxLen ? c : `${c.slice(0, maxLen - 1).trimEnd()}…`;
}

/** Paths esperados: revisautoapp://checkout/return, revisautoapp://sucesso, ou query status=approved. */
/**
 * Detecta o retorno do checkout do Mercado Pago na URL atual.
 * Na versão nativa isto era um deep link `revisautoapp://checkout/return`.
 * Na web o back_url do MP aponta para https://revisautoapp.com.br/checkout/return
 * (ou qualquer rota com ?status=approved).
 */
function isMercadoPagoCheckoutReturn(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    const segments = parsed.pathname
      .split('/')
      .map((s) => s.toLowerCase())
      .filter(Boolean);
    if (
      segments[0] === 'checkout' &&
      segments.some((s) => ['return', 'sucesso', 'success'].includes(s))
    ) {
      return true;
    }
    if (segments[0] === 'sucesso' || segments[0] === 'success') return true;
    const st = (
      parsed.searchParams.get('status') ||
      parsed.searchParams.get('payment_status') ||
      parsed.searchParams.get('collection_status') ||
      ''
    ).toLowerCase();
    if (['approved', 'success', 'authorized'].includes(st)) return true;
    if (parsed.searchParams.get('checkout') === 'return') return true;
  } catch {
    /* URL malformada — ignora */
  }
  return false;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'garage' | 'advisor' | 'menu' | 'preferences'>('garage');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [financialRecords, setFinancialRecords] = useState<FinancialRecord[]>([]);
  
  // Chat State
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [drGraxaUIMode, setDrGraxaUIMode] = useState<'list' | 'chat'>('list');
  const [showDrGraxaManualModal, setShowDrGraxaManualModal] = useState(false);
  const [showChatTrash, setShowChatTrash] = useState(false);
  const [chatTrashSessions, setChatTrashSessions] = useState<(ChatSession & { days_until_permanent_deletion?: number })[]>([]);
  const [chatTrashLoading, setChatTrashLoading] = useState(false);
  const [showVehicleHistory, setShowVehicleHistory] = useState(false);
  const [archivedVehicles, setArchivedVehicles] = useState<Vehicle[]>([]);
  
  // Delete Confirmation State
  const [showDeleteVehicleModal, setShowDeleteVehicleModal] = useState(false);
  const [showDeleteChatModal, setShowDeleteChatModal] = useState(false);
  const [chatSessionToDelete, setChatSessionToDelete] = useState<number | null>(null);
  
  // Edit Vehicle State
  const [isEditingVehicle, setIsEditingVehicle] = useState(false);
  const [customColor, setCustomColor] = useState('');
  const [otherColor, setOtherColor] = useState('');

  // Date Filter State
  const [showDateFilters, setShowDateFilters] = useState(false);

  // Auth State
  const [authScreen, setAuthScreen] = useState<'login' | 'register' | 'terms' | 'success' | 'app' | 'recover' | 'reset-password' | 'onboarding_preferences'>('login');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverMessage, setRecoverMessage] = useState('');
  const [recoverError, setRecoverError] = useState('');
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Detect password recovery link (URL hash contains type=recovery and access_token)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
      const params = new URLSearchParams(hash.replace('#', ''));
      const token = params.get('access_token');
      if (token) {
        setResetToken(token);
        setAuthScreen('reset-password');
        window.history.replaceState(null, '', window.location.pathname);
        return;
      }
    }

    const storedUser = localStorage.getItem('revis_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setAuthScreen('app');
        fetchVehicles();
      } catch (e) {
        console.error("Failed to parse stored user", e);
        localStorage.removeItem('revis_user');
      }
    }
  }, []);

  // Conecta o módulo de rede (fora da árvore React) ao estado do app: quando
  // uma renovação de sessão falha de verdade (refresh_token também vencido
  // ou ausente), volta pra tela de login com um aviso claro, em vez de
  // deixar a pessoa presa vendo erros repetidos sem entender o motivo.
  useEffect(() => {
    onSessionExpired(() => {
      setUser(null);
      setAuthScreen('login');
      setAuthError(t('sessionExpiredMessage'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/app-config`);
        const data = (await res.json().catch(() => ({}))) as { min_app_version?: string };
        const min =
          typeof data.min_app_version === 'string' && data.min_app_version.trim()
            ? data.min_app_version.trim()
            : '1.0.0';
        if (cancelled) return;
        if (isAppVersionBelowMinimum(APP_VERSION, min)) setForceUpdateStatus('blocked');
        else setForceUpdateStatus('ok');
      } catch {
        if (!cancelled) setForceUpdateStatus('ok');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [authForm, setAuthForm] = useState({ 
    name: '', 
    nickname: '',
    email: '', 
    password: '', 
    confirmPassword: '',
    birthDay: '',
    birthMonth: '',
    birthYear: '',
    country: 'Brasil (+55)',
    phone: '',
    zip_code: '',
    state: '',
    city: ''
  });
  const [authError, setAuthError] = useState('');
  const [cepError, setCepError] = useState(false);
  const [showRegisterHelp, setShowRegisterHelp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authLangMenuOpen, setAuthLangMenuOpen] = useState(false);
  const authLangRef = useRef<HTMLDivElement>(null);

  // Terms State
  const [activeTermsTab, setActiveTermsTab] = useState<'terms' | 'privacy'>('terms');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [hasScrolledTerms, setHasScrolledTerms] = useState(false);
  const [hasScrolledPrivacy, setHasScrolledPrivacy] = useState(false);
  const termsContentRef = React.useRef<HTMLDivElement>(null);

  const handleTermsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isBottom = scrollHeight - scrollTop <= clientHeight + 50;
    
    if (isBottom) {
      if (activeTermsTab === 'terms') setHasScrolledTerms(true);
      if (activeTermsTab === 'privacy') setHasScrolledPrivacy(true);
    }
  };

  // Constants
  const COUNTRIES = [
    "Brasil (+55)", "Estados Unidos (+1)", "Portugal (+351)", "Argentina (+54)", 
    "Uruguai (+598)", "Paraguai (+595)", "Chile (+56)", "Reino Unido (+44)", 
    "França (+33)", "Alemanha (+49)", "Itália (+39)", "Espanha (+34)", 
    "Japão (+81)", "China (+86)", "Canadá (+1)", "Austrália (+61)"
  ];
  
  const DAYS = Array.from({length: 31}, (_, i) => (i + 1).toString().padStart(2, '0'));
  const YEARS = Array.from({length: 100}, (_, i) => (new Date().getFullYear() - i).toString());

  // CEP Lookup
  const handleCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const cleanCep = e.target.value.replace(/\D/g, '');
    if (authForm.country !== 'Brasil (+55)' || cleanCep.length === 0) return;
    if (cleanCep.length !== 8) {
      // CEP incompleto: não sabemos ainda se é inválido, só deixa os campos
      // de cidade/estado vazios (o botão continua desabilitado por isso).
      return;
    }
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      if (res.ok) {
        const data = await res.json();
        if (!data.erro) {
          setCepError(false);
          setAuthForm(prev => ({ ...prev, city: data.localidade, state: data.uf }));
          return;
        }
      }
      // CEP bem formado mas inexistente (ou resposta inesperada da API).
      setCepError(true);
      setAuthForm(prev => ({ ...prev, city: '', state: '' }));
    } catch (err) {
      console.error("Erro ao buscar CEP", err);
      setCepError(true);
      setAuthForm(prev => ({ ...prev, city: '', state: '' }));
    }
  };

  // Password Validation
  const validatePassword = (pass: string) => {
    const hasUpper = /[A-Z]/.test(pass);
    const hasLower = /[a-z]/.test(pass);
    const hasNumber = /[0-9]/.test(pass);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pass);
    const isValidLength = pass.length >= 10 && pass.length <= 20;
    return { hasUpper, hasLower, hasNumber, hasSpecial, isValidLength, isValid: hasUpper && hasLower && hasNumber && hasSpecial && isValidLength };
  };

  const validatePhone = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 11) return false;
    
    // Check for repeated numbers (e.g., 11111111111)
    if (/^(\d)\1+$/.test(cleanPhone)) return false;
    
    // Check for sequential numbers (e.g., 12345678901)
    const sequential = "01234567890123456789";
    if (sequential.includes(cleanPhone)) return false;
    
    return true;
  };

  const validateNickname = (nickname: string) => {
    if (!nickname) return true; // Optional
    const lowerNick = nickname.toLowerCase();
    
    // Check against offensive words
    for (const word of OFFENSIVE_WORDS) {
      if (lowerNick.includes(word)) return false;
    }
    return true;
  };

  const isAgeValid = () => {
    if (!authForm.birthYear || !authForm.birthMonth || !authForm.birthDay) return false;
    const today = new Date();
    const birthDate = new Date(parseInt(authForm.birthYear), parseInt(authForm.birthMonth) - 1, parseInt(authForm.birthDay));
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 18;
  };

  const isFormValid = () => {
    if (!authForm.name || !authForm.email || !authForm.birthDay || !authForm.birthMonth || !authForm.birthYear || !authForm.country) return false;
    if (!validatePassword(authForm.password).isValid) return false;
    if (authForm.password !== authForm.confirmPassword) return false;
    if (!isAgeValid()) return false;
    
    if (authForm.country === 'Brasil (+55)') {
      if (!authForm.phone || !authForm.zip_code || !authForm.city || !authForm.state) return false;
      if (!validatePhone(authForm.phone)) return false;
    } else {
      if (!authForm.city || !authForm.state) return false;
    }
    return true;
  };

  // Forms State
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  /** Qual plano está em checkout Mercado Pago (null = nenhum). */
  const [checkoutLoadingPlan, setCheckoutLoadingPlan] = useState<null | 'plus' | 'premium'>(null);

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [forceUpdateStatus, setForceUpdateStatus] = useState<'checking' | 'ok' | 'blocked'>('checking');
  const [subscriptionManageOpen, setSubscriptionManageOpen] = useState(false);
  const [subscriptionManageView, setSubscriptionManageView] = useState<'menu' | 'changePlan' | 'cancelInfo'>(
    'menu',
  );
  const [pricingPeriod, setPricingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [showAddLog, setShowAddLog] = useState(false);
  const [showAddFinancial, setShowAddFinancial] = useState(false);
  const [expandedCards, setExpandedCards] = useState({ mileage: false, services: false, financial: false });
  const [showAddMileage, setShowAddMileage] = useState(false);
  const [newMileage, setNewMileage] = useState({ date: '', mileage: '', valor: '', litros: '', notes: '', attachment_path: null as string | null });
  const [showMileageHelp, setShowMileageHelp] = useState(false);
  const mileageHelpRef = useRef<HTMLDivElement | null>(null);
  const [isSubmittingVehicle, setIsSubmittingVehicle] = useState(false);
  const [appToast, setAppToast] = useState<{ message: string; tone?: 'neutral' | 'warning' } | null>(null);
  const [isSubmittingLog, setIsSubmittingLog] = useState(false);
  const [isSubmittingFinancial, setIsSubmittingFinancial] = useState(false);
  const [isSubmittingMileage, setIsSubmittingMileage] = useState(false);
  const [isDeletingRecord, setIsDeletingRecord] = useState(false);

  // Edição via modal: id do registro em edição (null = modal está em modo "Criar")
  const [editingMileageLogId, setEditingMileageLogId] = useState<string | null>(null);
  const [editingMaintenanceLogId, setEditingMaintenanceLogId] = useState<number | null>(null);
  const [editingFinancialRecordId, setEditingFinancialRecordId] = useState<number | null>(null);

  // Visualização (read-only) via modal
  type ViewingRecord =
    | { kind: 'mileage'; data: MileageLog }
    | { kind: 'maintenance'; data: MaintenanceLog }
    | { kind: 'financial'; data: FinancialRecord };
  const [viewingRecord, setViewingRecord] = useState<ViewingRecord | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const openViewRecord = (rec: ViewingRecord) => {
    setViewingRecord(rec);
    setIsViewModalOpen(true);
  };
  const closeViewRecord = () => {
    setIsViewModalOpen(false);
    setViewingRecord(null);
  };

  // Filter and Pagination State
  const [mileageFilterDate, setMileageFilterDate] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [activeMileageFilter, setActiveMileageFilter] = useState<{start: string, end: string} | null>(null);
  const [mileageLimit, setMileageLimit] = useState(3);

  const [servicesFilterDate, setServicesFilterDate] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [activeServicesFilter, setActiveServicesFilter] = useState<{start: string, end: string} | null>(null);
  const [servicesLimit, setServicesLimit] = useState(3);

  const [financialFilterDate, setFinancialFilterDate] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [activeFinancialFilter, setActiveFinancialFilter] = useState<{start: string, end: string} | null>(null);
  const [financialLimit, setFinancialLimit] = useState(3);
  
  // Edit State
  const [editingMileageIndex, setEditingMileageIndex] = useState<number | null>(null);
  const [editedMileageItem, setEditedMileageItem] = useState<MileageLog | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editedServiceItem, setEditedServiceItem] = useState<MaintenanceLog | null>(null);
  const [editingFinancialId, setEditingFinancialId] = useState<number | null>(null);
  const [editedFinancialItem, setEditedFinancialItem] = useState<FinancialRecord | null>(null);
  
  // Profile Confirmation State
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  // Edit Confirmation State
  const [showEditConfirmation, setShowEditConfirmation] = useState(false);
  const [showCancelEditConfirmation, setShowCancelEditConfirmation] = useState(false);
  const [pendingAction, setPendingAction] = useState<'saveMileage' | 'saveService' | 'saveFinancial' | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  // Add Vehicle Confirmation State
  const [showCancelAddVehicleConfirmation, setShowCancelAddVehicleConfirmation] = useState(false);

  const handleCancelAddVehicle = () => {
    setShowCancelAddVehicleConfirmation(true);
  };

  /** Upload genérico de comprovante/foto usado nos 3 formulários de lançamento. */
  const handleRecordAttachmentUpload = async (
    file: File,
    recordType: 'mileage' | 'maintenance' | 'financial',
    onDone: (path: string) => void,
  ) => {
    if (!user || !selectedVehicle) return;
    setIsUploadingAttachment(true);
    try {
      const path = newAttachmentPath(user.id, ['vehicles', selectedVehicle.id, recordType], file.name);
      const { path: uploadedPath, error: uploadError } = await uploadFileToStorage(file, path);
      if (!uploadedPath) {
        setAppToast({ message: uploadError || t('attachmentUploadError'), tone: 'warning' });
        return;
      }
      onDone(uploadedPath);
      setAppToast({ message: t('attachmentUploadSuccess'), tone: 'neutral' });
    } catch (error) {
      console.error('Error uploading attachment:', error);
      setAppToast({ message: t('attachmentUploadError'), tone: 'warning' });
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleVehicleDocUploadFromHeader = async (file: File) => {
    if (!user || !selectedVehicle) return;
    setIsUploadingCrlv(true);
    try {
      const path = newAttachmentPath(user.id, ['vehicles', selectedVehicle.id], file.name.endsWith('.pdf') ? 'crlv.pdf' : file.name);
      const { path: uploadedPath, error: uploadError } = await uploadFileToStorage(file, path);
      if (!uploadedPath) {
        setAppToast({ message: uploadError || t('crlvUploadError'), tone: 'warning' });
        return;
      }
      const res = await apiFetch(`/api/vehicles/${selectedVehicle.id}`, {
        method: 'PUT',
        body: JSON.stringify({ document_path: uploadedPath }),
      });
      if (!res.ok) {
        setAppToast({ message: t('crlvUploadError'), tone: 'warning' });
        return;
      }
      setSelectedVehicle(prev => prev ? { ...prev, document_path: uploadedPath } : prev);
      setVehicles(prev => prev.map(v => v.id === selectedVehicle.id ? { ...v, document_path: uploadedPath } : v));
      setAppToast({ message: t('crlvExtractSuccess'), tone: 'neutral' });
    } catch (error) {
      console.error('Error uploading vehicle document:', error);
      setAppToast({ message: t('crlvUploadError'), tone: 'warning' });
    } finally {
      setIsUploadingCrlv(false);
    }
  };

  const handleExportVehicleReport = async () => {
    if (!selectedVehicle) return;
    setIsGeneratingReport(true);
    try {
      const bytes = await generateVehicleReportPdf({
        vehicle: selectedVehicle,
        maintenanceLogs: logs,
        financialRecords: financialRecords,
        dateFormat,
        currency,
        language,
        labels: {
          title: t('reportTitle'),
          generatedOn: t('reportGeneratedOn'),
          vehicleData: t('reportVehicleData'),
          brand: t('brand'),
          model: t('model'),
          year: t('year'),
          plate: t('plateLabel'),
          color: t('color'),
          currentMileage: t('reportCurrentMileage'),
          mileageSummary: t('mileageHistory'),
          totalRecords: t('reportTotalRecords'),
          totalSpentFuel: t('reportTotalSpentFuel'),
          totalLiters: t('reportTotalLiters'),
          maintenanceSection: t('serviceHistory'),
          maintenanceEmpty: t('reportMaintenanceEmpty'),
          colDate: t('date'),
          colType: t('typeLabel'),
          colDescription: t('descriptionLabel'),
          colProvider: t('reportColProvider'),
          colCost: t('reportColCost'),
          financialSection: t('financialSectionTitle'),
          financialEmpty: t('reportFinancialEmpty'),
          colStatus: t('statusLabel'),
          colValue: t('reportColValue'),
          totalSpentMaintenance: t('reportTotalSpentMaintenance'),
          totalSpentFinancial: t('reportTotalSpentFinancial'),
          disclaimer: t('reportDisclaimer'),
          noColor: t('reportNoColor'),
          noPlate: t('reportNoPlate'),
        },
      });
      const safeName = `${selectedVehicle.brand}-${selectedVehicle.model}`.replace(/[^a-zA-Z0-9-]/g, '_');
      downloadPdf(bytes, `revisauto-${safeName}.pdf`);
      setAppToast({ message: t('reportExportSuccess'), tone: 'neutral' });
    } catch (error) {
      console.error('Error generating vehicle report:', error);
      setAppToast({ message: t('reportExportError'), tone: 'warning' });
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleConfirmCancelAddVehicle = () => {
    setShowCancelAddVehicleConfirmation(false);
    setShowAddVehicle(false);
    setMileageInput('');
    setCrlvWarnings([]);
  };
  
  // Preferences State
  const [language, setLanguage] = useState(() => localStorage.getItem('revis_language') || 'Português (Brasil)');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('revis_theme') as 'dark' | 'light') || 'dark');
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('revis_fontSize') || '2')); // 0 to 4

  // i18n: data + moeda globais
  const [dateFormat, setDateFormat] = useState<DateFormat>(() => {
    const stored = localStorage.getItem('revis_date_format');
    if (stored === 'dd/mm/yyyy' || stored === 'mm/dd/yyyy') return stored;
    const lang = localStorage.getItem('revis_language') || 'Português (Brasil)';
    return getDefaultDateFormatForLanguage(lang);
  });
  const [hasManualDateFormat, setHasManualDateFormat] = useState<boolean>(
    () => localStorage.getItem('revis_has_manual_date_format') === 'true',
  );
  const [currency, setCurrency] = useState<string>(() => localStorage.getItem('revis_currency') || 'BRL');

  // Temp Preferences State
  const [tempLanguage, setTempLanguage] = useState(language);
  const [tempTheme, setTempTheme] = useState(theme);
  const [tempFontSize, setTempFontSize] = useState(fontSize);
  const [tempDateFormat, setTempDateFormat] = useState<DateFormat>(dateFormat);
  const [tempCurrency, setTempCurrency] = useState<string>(currency);

  // Snapshot original ao entrar em "Preferências" — usado pelo Cancelar
  // para reverter o que foi aplicado em modo imediato.
  const [originalLanguage, setOriginalLanguage] = useState(language);
  const [originalTheme, setOriginalTheme] = useState(theme);
  const [originalFontSize, setOriginalFontSize] = useState(fontSize);
  const [originalDateFormat, setOriginalDateFormat] = useState<DateFormat>(dateFormat);
  const [originalCurrency, setOriginalCurrency] = useState<string>(currency);
  const [originalHasManualDateFormat, setOriginalHasManualDateFormat] = useState<boolean>(hasManualDateFormat);

  const [showPreferencesSaveConfirmation, setShowPreferencesSaveConfirmation] = useState(false);
  const [showPreferencesCancelConfirmation, setShowPreferencesCancelConfirmation] = useState(false);

  // Sync temp/original state when entering preferences tab
  useEffect(() => {
    if (activeTab === 'preferences') {
      setTempLanguage(language);
      setTempTheme(theme);
      setTempFontSize(fontSize);
      setTempDateFormat(dateFormat);
      setTempCurrency(currency);
      setOriginalLanguage(language);
      setOriginalTheme(theme);
      setOriginalFontSize(fontSize);
      setOriginalDateFormat(dateFormat);
      setOriginalCurrency(currency);
      setOriginalHasManualDateFormat(hasManualDateFormat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Aplica tema imediatamente (modo imediato)
  const applyThemeImmediate = (next: 'dark' | 'light') => {
    setTempTheme(next);
    setTheme(next);
  };

  // Aplica idioma imediatamente. Se o usuário ainda não escolheu manualmente
  // um formato de data, ajustamos automaticamente para casar com o idioma.
  const applyLanguageImmediate = (next: string) => {
    setTempLanguage(next);
    setLanguage(next);
    if (!hasManualDateFormat) {
      const auto = getDefaultDateFormatForLanguage(next);
      setDateFormat(auto);
      setTempDateFormat(auto);
    }
  };

  // Aplica tamanho da fonte imediatamente
  const applyFontSizeImmediate = (next: number) => {
    setTempFontSize(next);
    setFontSize(next);
  };

  // Aplica formato de data imediatamente (escolha manual: trava o auto-derive).
  const applyDateFormatImmediate = (next: DateFormat) => {
    setTempDateFormat(next);
    setDateFormat(next);
    setHasManualDateFormat(true);
  };

  // Aplica moeda imediatamente.
  const applyCurrencyImmediate = (next: string) => {
    setTempCurrency(next);
    setCurrency(next);
  };

  // AI State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  /** Impede dois envios concorrentes (duplo Enter/clique antes do primeiro setState). */
  const drGraxaSendInFlightRef = useRef(false);

  /** Limpa dados da sessão após logout (memória sensível — não cobre apenas localStorage). */
  const resetSensitiveSessionState = () => {
    setVehicles([]);
    setArchivedVehicles([]);
    setSelectedVehicle(null);
    setLogs([]);
    setFinancialRecords([]);
    setChatSessions([]);
    setCurrentSessionId(null);
    setChatMessages([]);
    setDrGraxaUIMode('list');
    setShowDrGraxaManualModal(false);
    setAiPrompt('');
    setAiResponse('');
    drGraxaSendInFlightRef.current = false;
    setIsLoadingAi(false);
    setCheckoutLoadingPlan(null);
    setShowUpgradeModal(false);
    setChatSessionToDelete(null);
    setShowDeleteChatModal(false);
    setExpandedCards({ mileage: false, services: false, financial: false });
  };

  // Apply theme and font size
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.remove('theme-light');
      root.style.setProperty('--color-bg', '#000000');
      root.style.setProperty('--color-text', '#c9cdd1');
      root.style.setProperty('--color-card', 'rgba(255,255,255,0.07)');
      root.style.setProperty('--color-heading', '#ffffff');
      root.style.setProperty('--color-border', 'rgba(255,255,255,0.12)');
      root.style.setProperty('--color-input', 'rgba(255,255,255,0.06)');
      root.style.setProperty('--glass-bg', 'rgba(255,255,255,0.08)');
    } else {
      root.classList.add('theme-light');
      root.style.setProperty('--color-bg', '#eef1f0');
      root.style.setProperty('--color-text', '#374151');
      root.style.setProperty('--color-card', 'rgba(255,255,255,0.55)');
      root.style.setProperty('--color-heading', '#0b0c0d');
      root.style.setProperty('--color-border', 'rgba(0,0,0,0.10)');
      root.style.setProperty('--color-input', 'rgba(255,255,255,0.72)');
      root.style.setProperty('--glass-bg', 'rgba(255,255,255,0.52)');
    }

    // Font size scaling
    const sizes = ['12px', '14px', '16px', '18px', '20px'];
    root.style.fontSize = sizes[fontSize];

    // Persist preferences
    localStorage.setItem('revis_theme', theme);
    localStorage.setItem('revis_fontSize', fontSize.toString());
    localStorage.setItem('revis_language', language);
    localStorage.setItem('revis_date_format', dateFormat);
    localStorage.setItem('revis_has_manual_date_format', hasManualDateFormat ? 'true' : 'false');
    localStorage.setItem('revis_currency', currency);

  }, [theme, fontSize, language, dateFormat, hasManualDateFormat, currency]);

  const t = (key: keyof typeof translations['Português (Brasil)']) => {
    // @ts-ignore
    return translations[language]?.[key] || translations['Português (Brasil)'][key];
  };

  const vehicleLimit = maxVehiclesForPlan(user?.plan);
  const atVehicleLimit = vehicles.length >= vehicleLimit;

  const toggleDateFilters = () => {
    setShowDateFilters(prev => !prev);
  };

  const authLangOptions: { code: string; value: keyof typeof translations }[] = [
    { code: 'EN', value: 'English' },
    { code: 'PT-BR', value: 'Português (Brasil)' },
    { code: 'PT-PT', value: 'Português (Portugal)' },
    { code: 'ES', value: 'Español' },
  ];

  useEffect(() => {
    if (!authLangMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (authLangRef.current && !authLangRef.current.contains(e.target as Node)) {
        setAuthLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [authLangMenuOpen]);

  const renderAuthLanguageSelector = (align: 'left' | 'right' = 'right') => (
    <div className="relative" ref={authLangRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setAuthLangMenuOpen((o) => !o)}
          className="px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 text-xs"
          style={
            theme === 'light'
              ? { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.6)', color: '#1f7a4d' }
              : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)', color: '#34a06a' }
          }
          aria-expanded={authLangMenuOpen}
          aria-label={t('language')}
          aria-haspopup="listbox"
        >
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span>{authLangOptions.find(o => o.value === language)?.code ?? t('languageLabel')}</span>
        </button>
        {authLangMenuOpen && (
          <div
            className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-2 min-w-[7.5rem] rounded-xl py-1 shadow-lg z-30`}
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.94)', border: '1px solid rgba(0,0,0,0.10)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)' }
                : { background: 'rgba(10,12,14,0.92)', border: '1px solid rgba(255,255,255,0.13)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)' }
            }
            role="listbox"
          >
            {authLangOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={language === opt.value}
                onClick={() => {
                  setLanguage(opt.value);
                  setAuthLangMenuOpen(false);
                }}
                className={`flex w-full items-center px-4 py-2 text-left text-xs font-semibold tracking-wide transition-colors hover:glass ${
                  language === opt.value ? 'text-[#34a06a]' : 'text-[--color-text]'
                }`}
              >
                {opt.code}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  type TransKey = keyof typeof translations['Português (Brasil)'];

  // Helpers de exibição: traduzem apenas o LABEL mostrado ao usuário.
  // Os valores internos (value dos selects, estado e payloads de API) continuam
  // sendo os originais em português ("Carro", "Imposto", "Pago", "Amarelo"...).
  const labelFromMap = (map: Record<string, TransKey>, value: string | null | undefined): string => {
    if (value == null || value === '') return '';
    const key = map[value];
    return key ? t(key) : value;
  };

  const SPECIAL_OPTION_LABEL_KEYS: Record<string, TransKey> = {
    Nenhum: 'optionNone',
    Outro: 'optionOther',
    Outra: 'optionOtherFem',
    Customizado: 'optionCustom',
  };
  const VEHICLE_TYPE_LABEL_KEYS: Record<string, TransKey> = {
    Carro: 'vehicleTypeCar',
    Moto: 'vehicleTypeMoto',
    Bike: 'eBikeTypeLabel',
  };
  const FINANCIAL_TYPE_LABEL_KEYS: Record<string, TransKey> = {
    Imposto: 'financialTypeImposto',
    Multa: 'financialTypeMulta',
    Taxa: 'financialTypeTaxa',
  };
  const MAINTENANCE_TYPE_LABEL_KEYS: Record<string, TransKey> = {
    Limpeza: 'maintenanceTypeLimpeza',
    'Mecânica': 'maintenanceTypeMecanica',
    'Documentação': 'maintenanceTypeDocumentacao',
  };
  const FINANCIAL_STATUS_LABEL_KEYS: Record<string, TransKey> = {
    Pago: 'financialStatusPago',
    'Em aberto': 'financialStatusEmAberto',
    Atrasado: 'financialStatusAtrasado',
  };
  const COLOR_LABEL_KEYS: Record<string, TransKey> = {
    Amarelo: 'colorAmarelo',
    Azul: 'colorAzul',
    'Azul Marinho': 'colorAzulMarinho',
    Bege: 'colorBege',
    'Bordô': 'colorBordo',
    Branco: 'colorBranco',
    Bronze: 'colorBronze',
    Cinza: 'colorCinza',
    Cobre: 'colorCobre',
    Dourado: 'colorDourado',
    Laranja: 'colorLaranja',
    Marrom: 'colorMarrom',
    Prata: 'colorPrata',
    Preto: 'colorPreto',
    Rosa: 'colorRosa',
    Roxo: 'colorRoxo',
    Verde: 'colorVerde',
    'Verde Escuro': 'colorVerdeEscuro',
    'Verde Lima': 'colorVerdeLima',
    Vermelho: 'colorVermelho',
    Vinho: 'colorVinho',
    Violeta: 'colorVioleta',
    Customizado: 'optionCustom',
    Outra: 'optionOtherFem',
  };
  const COUNTRY_LABEL_KEYS: Record<string, TransKey> = {
    'Brasil (+55)': 'countryBrasil',
    'Estados Unidos (+1)': 'countryEstadosUnidos',
    'Portugal (+351)': 'countryPortugal',
    'Argentina (+54)': 'countryArgentina',
    'Uruguai (+598)': 'countryUruguai',
    'Paraguai (+595)': 'countryParaguai',
    'Chile (+56)': 'countryChile',
    'Reino Unido (+44)': 'countryReinoUnido',
    'França (+33)': 'countryFranca',
    'Alemanha (+49)': 'countryAlemanha',
    'Itália (+39)': 'countryItalia',
    'Espanha (+34)': 'countryEspanha',
    'Japão (+81)': 'countryJapao',
    'China (+86)': 'countryChina',
    'Canadá (+1)': 'countryCanada',
    'Austrália (+61)': 'countryAustralia',
  };
  const CURRENCY_LABEL_KEYS: Record<string, TransKey> = {
    BRL: 'currencyBRL',
    USD: 'currencyUSD',
    EUR: 'currencyEUR',
    GBP: 'currencyGBP',
    CAD: 'currencyCAD',
    AUD: 'currencyAUD',
    CHF: 'currencyCHF',
    JPY: 'currencyJPY',
    CNY: 'currencyCNY',
    KRW: 'currencyKRW',
    INR: 'currencyINR',
    ARS: 'currencyARS',
    CLP: 'currencyCLP',
    COP: 'currencyCOP',
    MXN: 'currencyMXN',
    UYU: 'currencyUYU',
    PEN: 'currencyPEN',
    PYG: 'currencyPYG',
    BOB: 'currencyBOB',
    VES: 'currencyVES',
    ZAR: 'currencyZAR',
    TRY: 'currencyTRY',
    RUB: 'currencyRUB',
    PLN: 'currencyPLN',
    SEK: 'currencySEK',
    NOK: 'currencyNOK',
    DKK: 'currencyDKK',
    AED: 'currencyAED',
    ILS: 'currencyILS',
    SGD: 'currencySGD',
  };
  const FONT_SIZE_LABEL_KEYS: TransKey[] = [
    'fontSizeVerySmall',
    'fontSizeSmall',
    'fontSizeNormal',
    'fontSizeLarge',
    'fontSizeVeryLarge',
  ];

  const optionLabel = (value: string) => labelFromMap(SPECIAL_OPTION_LABEL_KEYS, value);
  const vehicleTypeLabel = (value: string) => labelFromMap(VEHICLE_TYPE_LABEL_KEYS, value);
  const financialTypeLabel = (value: string) => labelFromMap(FINANCIAL_TYPE_LABEL_KEYS, value);
  const maintenanceTypeLabel = (value: string) => labelFromMap(MAINTENANCE_TYPE_LABEL_KEYS, value);
  const financialStatusLabel = (value: string) => labelFromMap(FINANCIAL_STATUS_LABEL_KEYS, value);
  const colorLabel = (value: string) => labelFromMap(COLOR_LABEL_KEYS, value);
  const countryLabel = (value: string) => labelFromMap(COUNTRY_LABEL_KEYS, value);
  const currencyLabel = (value: string) => labelFromMap(CURRENCY_LABEL_KEYS, value);
  const mileageNotesLabel = (notes: string) => (notes === 'Registro inicial' ? t('initialMileageRecord') : notes);

  const mapAuthErrorMessage = (raw: string | undefined): string => {
    if (raw == null || !String(raw).trim()) return t('serverError');
    const m = String(raw).trim();
    const lower = m.toLowerCase();

    if (raw === 'PROFILE_NOT_FOUND' || lower === 'profile_not_found') return t('profileNotFound');
    if (lower.includes('verifique seu e-mail') || lower.includes('email not confirmed')) return t('emailNotConfirmed');
    if (
      lower.includes('e-mail ou senha incorretos') ||
      lower.includes('incorrect email or password') ||
      lower.includes('correo o contraseña incorrectos') ||
      lower.includes('invalid login credentials') ||
      lower.includes('invalid credentials')
    )
      return t('invalidCredentials');

    if (
      lower.includes('already been registered') ||
      lower.includes('already registered') ||
      lower.includes('user already registered') ||
      lower.includes('email address is already') ||
      lower.includes('already exists') ||
      lower.includes('duplicate key') ||
      lower.includes('already been taken')
    )
      return t('emailAlreadyInUse');

    if (lower.includes('erro ao criar conta') || lower.includes('erro interno no servidor')) return t('serverError');
    if (
      lower.includes('erro interno do servidor') ||
      lower.includes('invalid server response') ||
      lower.includes('server response was not json')
    )
      return t('internalServerError');
    if (lower.includes('failed to fetch') || lower === 'networkerror' || lower.includes('network request failed'))
      return t('connectionError');

    if (lower.includes('password') && lower.includes('at least') && lower.includes('6')) return t('resetPasswordTooShort');

    return t('serverError');
  };

  // Mapeador inteligente: lê details (Supabase/Postgres), message e error code,
  // traduz para uma mensagem amigável e localizada.
  // Para códigos com details específico do Supabase (REGISTER_AUTH_FAILED,
  // REGISTER_PROFILE_SAVE_FAILED, LOGIN_PROFILE_LOAD_FAILED, RESET_UPDATE_FAILED),
  // mapApiErrorCode retorna '' e o fluxo continua no substring matching abaixo.
  const mapAuthError = (errorData: { details?: unknown; message?: unknown; error?: unknown } | null | undefined): string => {
    const fromCode = mapApiErrorCode(errorData?.error);
    if (fromCode) return fromCode;

    const details = typeof errorData?.details === 'string' ? errorData.details : '';
    const message = typeof errorData?.message === 'string' ? errorData.message : '';
    const haystack = `${details}\n${message}`.toLowerCase();

    if (
      haystack.includes('already been registered') ||
      haystack.includes('already registered') ||
      haystack.includes('user already registered') ||
      haystack.includes('email address is already') ||
      haystack.includes('already exists') ||
      haystack.includes('duplicate key') ||
      haystack.includes('email_exists')
    ) {
      return t('errorEmailAlreadyRegistered');
    }

    if (
      (haystack.includes('password') && haystack.includes('at least')) ||
      haystack.includes('weak_password') ||
      haystack.includes('password should be at least') ||
      haystack.includes('senha deve ter')
    ) {
      return t('errorPasswordTooShort');
    }

    if (
      haystack.includes('violates not-null') ||
      haystack.includes('null value in column') ||
      haystack.includes('not null constraint')
    ) {
      return t('errorRequiredFieldsMissing');
    }

    // Fallback: usa o mapeador legado da auth (cobre invalidCredentials, profileNotFound, etc.)
    const legacy = mapAuthErrorMessage(message || details);
    if (legacy && legacy !== t('serverError')) return legacy;

    return message || details || t('serverError');
  };

  // Mapeia códigos UPPER_SNAKE_CASE do backend para mensagens traduzidas.
  // Retorna string vazia se o código não for reconhecido, preservando o fallback
  // original (data.text / data.message) na cadeia de chamada.
  const mapApiErrorCode = (code: unknown): string => {
    const API_ERROR_MAP: Partial<Record<string, TransKey>> = {
      // Chat IA / Checkout (etapa anterior)
      ADVISOR_FEATURE_REQUIRES_PLUS: 'errorAdvisorRequiresPlus',
      AI_LIMIT_REACHED:              'errorAiLimitReached',
      AI_SERVICE_UNAVAILABLE:        'errorAiServiceUnavailable',
      AI_SERVICE_ERROR:              'errorAiServiceError',
      AI_EMPTY_RESPONSE:             'errorAiEmptyResponse',
      AI_EMPTY_MESSAGE:              'errorAiEmptyMessage',
      CHECKOUT_MP_NOT_CONFIGURED:    'errorCheckoutNotConfigured',
      CHECKOUT_EMAIL_REQUIRED:       'errorCheckoutEmailRequired',
      CHECKOUT_BACKURL_MISSING:      'errorCheckoutBackurlMissing',
      CHECKOUT_NO_INIT_POINT:        'errorCheckoutNoInitPoint',
      CHECKOUT_FAILED:               'errorCheckoutFailed',
      // Middleware de autenticação
      AUTH_TOKEN_MISSING:            'errorAuthTokenMissing',
      AUTH_TOKEN_INVALID:            'errorAuthTokenInvalid',
      AUTH_TOKEN_VALIDATION_FAILED:  'errorAuthTokenValidationFailed',
      // Registro
      REGISTER_MISSING_FIELDS:       'errorRegisterMissingFields',
      REGISTER_NO_ID:                'errorRegisterNoId',
      REGISTER_FAILED:               'errorRegisterFailed',
      // REGISTER_AUTH_FAILED e REGISTER_PROFILE_SAVE_FAILED: omitidos
      // intencionalmente — details do Supabase tratado por substring matching.
      // Login
      LOGIN_MISSING_CREDENTIALS:     'errorLoginMissingCredentials',
      LOGIN_EMAIL_NOT_CONFIRMED:     'emailNotConfirmed',
      LOGIN_INVALID_CREDENTIALS:     'invalidCredentials',
      LOGIN_SESSION_MISSING:         'errorLoginSessionMissing',
      LOGIN_PROFILE_NOT_FOUND:       'profileNotFound',
      LOGIN_FAILED:                  'errorLoginFailed',
      // Rate limiting (login, recuperação de senha, chat)
      RATE_LIMITED:                  'errorRateLimited',
      // LOGIN_PROFILE_LOAD_FAILED: omitido — details do Supabase tem prioridade.
      // Recuperação / reset
      RECOVER_EMAIL_REQUIRED:        'errorRecoverEmailRequired',
      RESET_INVALID_DATA:            'errorResetInvalidData',
      RESET_TOKEN_INVALID:           'errorResetTokenInvalid',
      RESET_FAILED:                  'errorResetFailed',
      // RESET_UPDATE_FAILED: omitido — message é updErr.message variável do Supabase.
    };
    if (typeof code !== 'string' || !code) return '';
    const key = API_ERROR_MAP[code];
    return key ? t(key) : '';
  };

  const MONTHS = React.useMemo(() => {
    const keys: TransKey[] = [
      'monthJan', 'monthFeb', 'monthMar', 'monthApr', 'monthMay', 'monthJun',
      'monthJul', 'monthAug', 'monthSep', 'monthOct', 'monthNov', 'monthDec',
    ];
    const vals = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const;
    return vals.map((val, i) => ({ val, label: t(keys[i]) }));
  }, [language]);

  const handleNativePurchase = async (
    plan_type: 'plus' | 'premium' = 'plus',
    period: 'monthly' | 'annual' = 'monthly',
  ) => {
    if (!user) return;
    if (checkoutLoadingPlan) return;

    setCheckoutLoadingPlan(plan_type);

    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), 45_000);
    try {
      const res = await apiFetch(`/api/checkout`, {
        method: 'POST',
        signal: ac.signal,
        body: JSON.stringify({
          userEmail: user.email,
          userName: user.name,
          plan_type,
          period: period === 'annual' ? 'anual' : 'mensal',
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.init_point) {
        const message =
          mapApiErrorCode(data?.error) ||
          (data && typeof data.message === 'string' && data.message) ||
          t('checkoutRequestFailed');
        throw new Error(message);
      }

      // Redireciona para o checkout do Mercado Pago.
      window.location.href = data.init_point;
    } catch (err: unknown) {
      console.error('Erro ao iniciar checkout Mercado Pago:', err);
      const e = err as { name?: string; message?: string };
      const msg =
        e?.name === 'AbortError'
          ? t('checkoutTimeout')
          : e?.message && String(e.message).trim()
            ? e.message
            : t('checkoutRequestFailed');
      setAppToast({ message: msg, tone: 'warning' });
      setCheckoutLoadingPlan(null);
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  // New Vehicle State
  const [newVehicle, setNewVehicle] = useState<Partial<Vehicle>>(() => ({
    type: 'Carro',
    brand: '',
    model: '',
    year: new Date().getFullYear(),
    current_mileage: 0,
    last_service_date: new Date().toISOString().split('T')[0],
    plate: '',
    document_path: null,
  }));
  const [customBrand, setCustomBrand] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [mileageInput, setMileageInput] = useState('');
  const [isUploadingCrlv, setIsUploadingCrlv] = useState(false);
  const [crlvWarnings, setCrlvWarnings] = useState<string[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // New Log State
  const [newLog, setNewLog] = useState<Partial<MaintenanceLog>>(() => ({
    type: 'Mecânica',
    description: '',
    date: new Date().toISOString().split('T')[0],
    cost: 0,
    provider: '',
    notes: ''
  }));

  // New Financial Record State
  const [newFinancial, setNewFinancial] = useState<Partial<FinancialRecord>>(() => ({
    type: 'Imposto',
    description: '',
    due_date: new Date().toISOString().split('T')[0],
    value: 0,
    status: 'Em aberto',
    payment_date: '',
    notes: ''
  }));

  // Profile State
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Support modal
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportMethod, setSupportMethod] = useState<'email' | 'whatsapp' | null>(null);
  const closeSupportModal = () => {
    setIsSupportModalOpen(false);
    setSupportMethod(null);
  };
  const [profileForm, setProfileForm] = useState({
    nickname: '',
    email: '',
    phone: '',
    zip_code: '',
    city: '',
    state: ''
  });

  useEffect(() => {
    if (user) {
      setProfileForm({
        nickname: user.nickname || '',
        email: user.email,
        phone: user.phone || '',
        zip_code: user.zip_code || '',
        city: user.city || '',
        state: user.state || ''
      });
    }
  }, [user]);

  // Body Scroll Lock for Modals
  useEffect(() => {
    if (showDrGraxaManualModal || showVehicleHistory || showProfileEdit || showTermsModal || showPrivacyModal || showAddVehicle || showAddLog || showAddFinancial || showAddMileage || isSupportModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showDrGraxaManualModal, showVehicleHistory, showProfileEdit, showTermsModal, showPrivacyModal, showAddVehicle, showAddLog, showAddFinancial, showAddMileage, isSupportModalOpen]);

  useEffect(() => {
    if (!appToast) return;
    const timer = window.setTimeout(() => setAppToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [appToast]);

  // Fecha o tooltip de ajuda do card de abastecimento ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!showMileageHelp) return;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const node = mileageHelpRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setShowMileageHelp(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMileageHelp(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showMileageHelp]);

  // -----------------------------------------------------------------------
  // Handlers reativos dos filtros de data por card.
  // - "start" sempre dispara autofill para "end" (+30 dias) quando este último
  //   está vazio, facilitando a navegação inicial.
  // - Cada alteração atualiza o filtro ativo e reseta a paginação local para 3.
  // - "Limpar" zera ambos os campos e desativa o filtro.
  // -----------------------------------------------------------------------
  const handleMileageStartChange = (iso: string) => {
    const next = {
      start: iso,
      end: mileageFilterDate.end || (iso ? addDaysISO(iso, 30) : ''),
    };
    setMileageFilterDate(next);
    setActiveMileageFilter(iso || next.end ? next : null);
    setMileageLimit(3);
  };
  const handleMileageEndChange = (iso: string) => {
    const next = { ...mileageFilterDate, end: iso };
    setMileageFilterDate(next);
    setActiveMileageFilter(next.start || next.end ? next : null);
    setMileageLimit(3);
  };
  const handleMileageFilterClear = () => {
    setMileageFilterDate({ start: '', end: '' });
    setActiveMileageFilter(null);
    setMileageLimit(3);
  };

  const handleServicesStartChange = (iso: string) => {
    const next = {
      start: iso,
      end: servicesFilterDate.end || (iso ? addDaysISO(iso, 30) : ''),
    };
    setServicesFilterDate(next);
    setActiveServicesFilter(iso || next.end ? next : null);
    setServicesLimit(3);
  };
  const handleServicesEndChange = (iso: string) => {
    const next = { ...servicesFilterDate, end: iso };
    setServicesFilterDate(next);
    setActiveServicesFilter(next.start || next.end ? next : null);
    setServicesLimit(3);
  };
  const handleServicesFilterClear = () => {
    setServicesFilterDate({ start: '', end: '' });
    setActiveServicesFilter(null);
    setServicesLimit(3);
  };

  const handleFinancialStartChange = (iso: string) => {
    const next = {
      start: iso,
      end: financialFilterDate.end || (iso ? addDaysISO(iso, 30) : ''),
    };
    setFinancialFilterDate(next);
    setActiveFinancialFilter(iso || next.end ? next : null);
    setFinancialLimit(3);
  };
  const handleFinancialEndChange = (iso: string) => {
    const next = { ...financialFilterDate, end: iso };
    setFinancialFilterDate(next);
    setActiveFinancialFilter(next.start || next.end ? next : null);
    setFinancialLimit(3);
  };
  const handleFinancialFilterClear = () => {
    setFinancialFilterDate({ start: '', end: '' });
    setActiveFinancialFilter(null);
    setFinancialLimit(3);
  };

  const handleProfileCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const cleanCep = e.target.value.replace(/\D/g, '');
    if (cleanCep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        if (res.ok) {
          const data = await res.json();
          if (!data.erro) {
            setProfileForm(prev => ({ ...prev, city: data.localidade, state: data.uf }));
          }
        }
      } catch (e) {
        console.error("Erro ao buscar CEP", e);
      }
    }
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSaveConfirmation(true);
  };

  const confirmSaveProfile = () => {
    setUser(prev => prev ? ({ ...prev, ...profileForm }) : null);
    setShowSaveConfirmation(false);
    setShowProfileEdit(false);
  };

  const handleCancelProfile = () => {
    setShowCancelConfirmation(true);
  };

  const confirmCancelProfile = () => {
    setShowCancelConfirmation(false);
    setShowProfileEdit(false);
    // Reset form to user data
    if (user) {
      setProfileForm({
        nickname: user.nickname || '',
        email: user.email,
        phone: user.phone || '',
        zip_code: user.zip_code || '',
        city: user.city || '',
        state: user.state || ''
      });
    }
  };

  // Edit Handlers
  const handleSaveMileage = (index: number, newItem: MileageLog) => {
    setPendingAction('saveMileage');
    setPendingIndex(index);
    setPendingPayload(newItem);
    setShowEditConfirmation(true);
  };

  const handleSaveService = (newItem: MaintenanceLog) => {
    setPendingAction('saveService');
    setPendingPayload(newItem);
    setShowEditConfirmation(true);
  };

  const handleSaveFinancial = (newItem: FinancialRecord) => {
    setPendingAction('saveFinancial');
    setPendingPayload(newItem);
    setShowEditConfirmation(true);
  };

  const handleConfirmSave = () => {
    if (pendingAction === 'saveMileage' && selectedVehicle && pendingIndex !== null) {
      const updatedHistory = [...(selectedVehicle.mileage_history || [])];
      updatedHistory[pendingIndex] = pendingPayload;
      updatedHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      const updatedVehicle = { ...selectedVehicle, mileage_history: updatedHistory };
      const maxMileage = Math.max(...updatedHistory.map(l => l.mileage), 0);
      updatedVehicle.current_mileage = maxMileage;
      
      const updatedVehicles = vehicles.map(v => v.id === updatedVehicle.id ? updatedVehicle : v);
      setVehicles(updatedVehicles);
      setSelectedVehicle(updatedVehicle);
      
      setEditingMileageIndex(null);
      setEditedMileageItem(null);
    } else if (pendingAction === 'saveService') {
      setLogs(prevLogs => prevLogs.map(log => log.id === pendingPayload.id ? pendingPayload : log));
      setEditingServiceId(null);
      setEditedServiceItem(null);
    } else if (pendingAction === 'saveFinancial') {
      setFinancialRecords(prev => prev.map(rec => rec.id === pendingPayload.id ? pendingPayload : rec));
      setEditingFinancialId(null);
      setEditedFinancialItem(null);
    }
    setShowEditConfirmation(false);
    setPendingAction(null);
    setPendingPayload(null);
    setPendingIndex(null);
  };

  const handleCancelEdit = () => {
    setShowCancelEditConfirmation(true);
  };

  const handleConfirmCancel = () => {
    setEditingMileageIndex(null);
    setEditedMileageItem(null);
    setEditingServiceId(null);
    setEditedServiceItem(null);
    setEditingFinancialId(null);
    setEditedFinancialItem(null);
    setShowCancelEditConfirmation(false);
  };

  // ---- Helpers para os modais mistos (Criar/Editar) ----

  // Mapa rápido idioma -> locale (Intl). Usado para detectar separadores
  // decimal/milhar consistentes com o resto do app (utils/format.ts).
  const APP_LANGUAGE_TO_LOCALE: Record<string, string> = {
    'Português (Brasil)': 'pt-BR',
    'Português (Portugal)': 'pt-PT',
    English: 'en-US',
    Español: 'es-ES',
  };
  const getLocaleDecimalSeparator = (lang: string): string => {
    const locale = APP_LANGUAGE_TO_LOCALE[lang] || 'pt-BR';
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
      return parts.find(p => p.type === 'decimal')?.value ?? ',';
    } catch {
      return ',';
    }
  };
  // Converte uma string digitada no input (ex.: "1.234,56" ou "1,234.56")
  // para Number conforme separador do locale atual.
  const parseLocaleDecimal = (raw: string, lang: string): number | null => {
    if (!raw || !raw.trim()) return null;
    const dec = getLocaleDecimalSeparator(lang);
    const thou = dec === ',' ? '.' : ',';
    const cleaned = raw
      .replace(new RegExp(`\\${thou}`, 'g'), '')
      .replace(dec, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  // Formata número decimal para exibição: usa Intl com separadores locais.
  const formatDecimal = (n: number | null | undefined, lang: string, fractionDigits = 2): string => {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '';
    const locale = APP_LANGUAGE_TO_LOCALE[lang] || 'pt-BR';
    try {
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(Number(n));
    } catch {
      return Number(n).toFixed(fractionDigits);
    }
  };

  const openCreateMileage = () => {
    setEditingMileageLogId(null);
    setNewMileage({ date: new Date().toISOString().split('T')[0], mileage: '', valor: '', litros: '' });
    setShowAddMileage(true);
  };
  const openEditMileage = (log: MileageLog) => {
    if (!log.id) return; // mileage_logs gerados antes do schema novo podem não ter id
    const formatted = String(log.mileage ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    // Para os campos decimais reabrimos o registro mantendo o separador local do usuário.
    const localeDecimal = getLocaleDecimalSeparator(language);
    const stringifyDecimal = (n: number | null | undefined): string => {
      if (n === null || n === undefined || !Number.isFinite(Number(n))) return '';
      return String(n).replace('.', localeDecimal);
    };
    setEditingMileageLogId(log.id);
    setNewMileage({
      date: log.date,
      mileage: formatted,
      valor: stringifyDecimal(log.valor),
      litros: stringifyDecimal(log.litros),
      notes: log.notes && log.notes !== 'Registro inicial' ? log.notes : '',
      attachment_path: log.attachment_path ?? null,
    });
    setShowAddMileage(true);
  };
  const closeMileageModal = () => {
    setShowAddMileage(false);
    setEditingMileageLogId(null);
    setNewMileage({ date: '', mileage: '', valor: '', litros: '', notes: '', attachment_path: null });
  };

  const openCreateLog = () => {
    setEditingMaintenanceLogId(null);
    setNewLog({
      type: 'Mecânica',
      description: '',
      date: new Date().toISOString().split('T')[0],
      cost: 0,
      provider: '',
    });
    setShowAddLog(true);
  };
  const openEditLog = (log: MaintenanceLog) => {
    setEditingMaintenanceLogId(log.id);
    setNewLog({
      type: log.type,
      description: log.description,
      date: log.date,
      cost: log.cost,
      provider: log.provider ?? '',
      photo_path: log.photo_path,
      notes: log.notes ?? '',
    });
    setShowAddLog(true);
  };
  const closeLogModal = () => {
    setShowAddLog(false);
    setEditingMaintenanceLogId(null);
  };

  const openCreateFinancial = () => {
    setEditingFinancialRecordId(null);
    setNewFinancial({
      type: 'Imposto',
      description: '',
      due_date: new Date().toISOString().split('T')[0],
      value: 0,
      status: 'Em aberto',
      payment_date: '',
      notes: '',
    });
    setShowAddFinancial(true);
  };
  const openEditFinancial = (rec: FinancialRecord) => {
    setEditingFinancialRecordId(rec.id);
    setNewFinancial({
      type: rec.type,
      description: rec.description,
      due_date: rec.due_date,
      value: rec.value,
      status: rec.status,
      payment_date: rec.payment_date ?? '',
      notes: rec.notes ?? '',
    });
    setShowAddFinancial(true);
  };
  const closeFinancialModal = () => {
    setShowAddFinancial(false);
    setEditingFinancialRecordId(null);
  };

  useEffect(() => {
    if (selectedVehicle) {
      fetchLogs(selectedVehicle.id);
      fetchFinancialRecords(selectedVehicle.id);
      fetchMileageLogs(selectedVehicle.id);
    }
    // depende apenas do id para não entrar em loop quando o próprio fetchMileageLogs
    // hidrata selectedVehicle.mileage_history
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicle?.id]);

  useEffect(() => {
    // Check if terms content is already at bottom (e.g. short content)
    if (authScreen === 'terms' && termsContentRef.current) {
      const { scrollHeight, clientHeight } = termsContentRef.current;
      // If content fits without scrolling, mark as scrolled
      if (scrollHeight <= clientHeight + 50) {
        if (activeTermsTab === 'terms') setHasScrolledTerms(true);
        if (activeTermsTab === 'privacy') setHasScrolledPrivacy(true);
      }
    }
  }, [authScreen, activeTermsTab]);

  const fetchUser = async () => {
    if (!getStoredAccessToken()) return;
    try {
      const res = await apiFetch(`/api/user`);
      if (res.ok) {
        const data = await res.json();
        // Preserva access_token e refresh_token lendo do localStorage (não do
        // estado React, que pode estar desatualizado se uma renovação
        // silenciosa aconteceu entre o disparo desta chamada e sua resposta).
        setUser(prev => {
          const freshAccessToken = getStoredAccessToken() ?? prev?.access_token;
          const freshRefreshToken = getStoredRefreshToken() ?? prev?.refresh_token;
          const merged = { ...data, access_token: freshAccessToken, refresh_token: freshRefreshToken };
          localStorage.setItem('revis_user', JSON.stringify(merged));
          return merged;
        });
      }
    } catch (e) {
      console.error("Failed to fetch user", e);
    }
  };

  const fetchVehicles = async () => {
    if (!getStoredAccessToken()) return;
    try {
      const res = await apiFetch(`/api/vehicles`);
      if (!res.ok) {
        console.error("Failed to fetch vehicles", res.status);
        setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
        return;
      }
      const raw = await res.json();
      const data: Vehicle[] = Array.isArray(raw) ? raw : [];
      setVehicles(data.filter(v => v.status !== 'archived'));
      setArchivedVehicles(data.filter(v => v.status === 'archived'));
    } catch (e) {
      console.error("Failed to fetch vehicles", e);
      setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
    }
    // Don't auto-select first vehicle on mobile to keep dashboard clean
  };

  const fetchUserRef = useRef(fetchUser);
  const fetchVehiclesRef = useRef(fetchVehicles);
  fetchUserRef.current = fetchUser;
  fetchVehiclesRef.current = fetchVehicles;

  // Retorno do checkout do Mercado Pago: na web chega como navegação normal
  // para o back_url configurado (ex.: /checkout/return), e não como deep link.
  useEffect(() => {
    if (!isMercadoPagoCheckoutReturn(window.location.href)) return;
    if (!getStoredAccessToken()) return;

    void fetchUserRef.current();
    void fetchVehiclesRef.current();
    setAuthScreen('app');
    setActiveTab('menu');
    setSubscriptionManageView('menu');
    setShowUpgradeModal(true);

    const langKey = language as keyof typeof translations;
    const message =
      translations[langKey]?.toastCheckoutDeepLinkReturn ??
      translations['Português (Brasil)'].toastCheckoutDeepLinkReturn;
    setAppToast({ message, tone: 'neutral' });

    // Limpa a URL para que um refresh não repita o fluxo.
    window.history.replaceState({}, '', '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmArchiveVehicle = async () => {
    if (!selectedVehicle) return;
    
    try {
      const res = await apiFetch(`/api/vehicles/${selectedVehicle.id}/archive`, {
        method: 'POST'
      });
      
      if (!res.ok) {
        console.error("Failed to archive vehicle", res.status);
        setAppToast({ message: t('errorSavingData'), tone: 'warning' });
        return;
      }
      const updatedVehicle = await res.json();
      setVehicles(prev => prev.filter(v => v.id !== selectedVehicle.id));
      setArchivedVehicles(prev => [...prev, updatedVehicle]);
      setSelectedVehicle(null);
      setActiveTab('garage');
      setShowDeleteVehicleModal(false);
    } catch (e) {
      console.error("Failed to archive vehicle", e);
      setAppToast({ message: t('errorSavingData'), tone: 'warning' });
    }
  };

  const fetchLogs = async (vehicleId: number) => {
    try {
      const res = await apiFetch(`/api/vehicles/${vehicleId}/logs`);
      if (!res.ok) {
        console.error("Failed to fetch logs", res.status);
        setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
        return;
      }
      const raw = await res.json();
      setLogs(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.error("Failed to fetch logs", e);
      setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
    }
  };

  const fetchMileageLogs = async (vehicleId: number) => {
    try {
      const res = await apiFetch(`/api/vehicles/${vehicleId}/mileage`);
      if (!res.ok) {
        console.error("Failed to fetch mileage logs", res.status);
        setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
        return;
      }
      const raw = await res.json();
      const history: MileageLog[] = Array.isArray(raw) ? raw : [];
      setSelectedVehicle(prev => (prev && prev.id === vehicleId ? { ...prev, mileage_history: history } : prev));
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, mileage_history: history } : v));
    } catch (e) {
      console.error("Failed to fetch mileage logs", e);
      setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
    }
  };

  const fetchFinancialRecords = async (vehicleId: number) => {
    try {
      const res = await apiFetch(`/api/vehicles/${vehicleId}/financial`);
      if (!res.ok) {
        console.error("Failed to fetch financial records", res.status);
        setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
        return;
      }
      const raw = await res.json();
      setFinancialRecords(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.error("Failed to fetch financial records", e);
      setAppToast({ message: t('errorLoadingData'), tone: 'warning' });
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await apiFetch(`/api/login`, {
        method: 'POST',
        body: JSON.stringify({ email: authForm.email, password: authForm.password })
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok || !data?.success) {
        console.error('Erro detalhado no login:', { status: res.status, data });
        setAuthError(mapAuthError(data));
        return;
      }

      // Garante que o access_token sempre persista, vindo de user.access_token
      // (shape antigo) ou de session.access_token (shape novo do backend).
      const accessToken: string | undefined =
        data.user?.access_token ?? data.session?.access_token;
      const refreshToken: string | undefined = data.session?.refresh_token;

      if (!accessToken) {
        console.error('🚨 Login retornou sem access_token:', data);
        setAuthError(mapAuthError({ message: 'missing_access_token' }) || t('unexpectedError'));
        return;
      }

      const userToStore = { ...data.user, access_token: accessToken, refresh_token: refreshToken };
      setUser(userToStore);
      localStorage.setItem('revis_user', JSON.stringify(userToStore));
      setAuthScreen('app');
      fetchVehicles();
    } catch (err: any) {
      console.error('Erro detalhado no login (rede/JS):', err);
      setAuthError(mapAuthError({ message: err?.message }) || t('unexpectedError'));
    }
  };

  const handleRecoverPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoverError('');
    setRecoverMessage('');
    setRecoverLoading(true);
    try {
      const res = await apiFetch(`/api/recover-password`, {
        method: 'POST',
        body: JSON.stringify({ email: recoverEmail })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) {
        console.error('Erro detalhado em recover-password:', { status: res.status, data });
        setRecoverError(mapAuthError(data));
      } else {
        setRecoverMessage(t('recoverEmailSent'));
      }
    } catch (err: any) {
      console.error('Erro detalhado em recover-password (rede/JS):', err);
      setRecoverError(mapAuthError({ message: err?.message }) || t('unexpectedError'));
    } finally {
      setRecoverLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');
    if (resetPassword !== resetConfirmPassword) {
      setResetError(t('passwordsDoNotMatch'));
      return;
    }
    if (resetPassword.length < 6) {
      setResetError(t('resetPasswordTooShort'));
      return;
    }
    setResetLoading(true);
    try {
      const res = await apiFetch(`/api/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ access_token: resetToken, new_password: resetPassword })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) {
        console.error('Erro detalhado em reset-password:', { status: res.status, data });
        setResetError(mapAuthError(data));
        return;
      }
      setResetMessage(t('resetPasswordSuccess'));
      setTimeout(() => {
        setAuthScreen('login');
        setResetPassword('');
        setResetConfirmPassword('');
        setResetToken('');
        setResetMessage('');
      }, 2500);
    } catch (err: any) {
      console.error('Erro detalhado em reset-password (rede/JS):', err);
      setResetError(mapAuthError({ message: err?.message }) || t('unexpectedError'));
    } finally {
      setResetLoading(false);
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!isAgeValid()) {
      setAuthError(t('registerMustBe18'));
      return;
    }
    
    if (authForm.country === 'Brasil (+55)' && !validatePhone(authForm.phone)) {
      setAuthError(t('invalidMobileBr'));
      return;
    }

    if (!validateNickname(authForm.nickname)) {
      setAuthError(t('nicknameNotAllowed'));
      return;
    }

    if (!isFormValid()) {
      setAuthError(t('fillAllFields'));
      return;
    }
    setAuthScreen('terms');
  };

  const confirmRegister = async () => {
    const birth_date = `${authForm.birthYear}-${authForm.birthMonth}-${authForm.birthDay}`;
    const payload = { ...authForm, birth_date };

    try {
      const res = await apiFetch(`/api/register`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const errorData = await res.json().catch(() => ({} as any));

      if (!res.ok || !errorData?.success || !errorData?.user) {
        console.error('Erro detalhado no registro:', { status: res.status, errorData });
        setAuthError(mapAuthError(errorData));
        setAuthScreen('register');
        return;
      }

      setUser(errorData.user);
      localStorage.setItem('revis_user', JSON.stringify(errorData.user));
      fetchVehicles();
      setAuthScreen('onboarding_preferences');
    } catch (err: any) {
      console.error('Erro detalhado no registro (rede/JS):', err);
      setAuthError(mapAuthError({ message: err?.message }) || t('connectionError'));
      setAuthScreen('register');
    }
  };

  const handleMileageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    const mileage = parseInt(String(newMileage.mileage).replace(/\D/g, ''));
    if (Number.isNaN(mileage)) {
      setAppToast({ message: t('errorSavingData'), tone: 'warning' });
      return;
    }
    const valor = parseLocaleDecimal(newMileage.valor || '', language);
    const litros = parseLocaleDecimal(newMileage.litros || '', language);

    setIsSubmittingMileage(true);
    try {
      const isEdit = !!editingMileageLogId;
      const url = isEdit
        ? `/api/vehicles/${selectedVehicle.id}/mileage/${editingMileageLogId}`
        : `/api/vehicles/${selectedVehicle.id}/mileage`;

      const res = await apiFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify({
          mileage,
          date: newMileage.date,
          valor,
          litros,
          notes: newMileage.notes || null,
          attachment_path: newMileage.attachment_path,
        })
      });
      if (!res.ok) {
        console.error('Error saving mileage:', res.status, await res.text().catch(() => ''));
        setAppToast({ message: t('errorSavingData'), tone: 'warning' });
        return;
      }

      if (!isEdit) {
        setSelectedVehicle(prev => prev ? { ...prev, current_mileage: mileage } : prev);
        setVehicles(prev => prev.map(v => v.id === selectedVehicle.id ? { ...v, current_mileage: mileage } : v));
      }
      await fetchMileageLogs(selectedVehicle.id);

      setShowAddMileage(false);
      setEditingMileageLogId(null);
      setNewMileage({ date: '', mileage: '', valor: '', litros: '', notes: '', attachment_path: null });
    } catch (error) {
      console.error('Error saving mileage:', error);
      setAppToast({ message: t('errorSavingData'), tone: 'warning' });
    } finally {
      setIsSubmittingMileage(false);
    }
  };

  const handleDeleteMileage = async () => {
    if (!selectedVehicle || !editingMileageLogId) return;
    if (!window.confirm(t('confirmDeleteRecord'))) return;
    setIsDeletingRecord(true);
    try {
      const res = await apiFetch(`/api/vehicles/${selectedVehicle.id}/mileage/${editingMileageLogId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error('Error deleting mileage:', res.status, await res.text().catch(() => ''));
        setAppToast({ message: t('errorDeletingData'), tone: 'warning' });
        return;
      }
      await fetchMileageLogs(selectedVehicle.id);
      // re-busca veículos para refletir current_mileage recalculado pelo backend
      await fetchVehicles();
      setShowAddMileage(false);
      setEditingMileageLogId(null);
      setNewMileage({ date: '', mileage: '', valor: '', litros: '', notes: '', attachment_path: null });
    } catch (error) {
      console.error('Error deleting mileage:', error);
      setAppToast({ message: t('errorDeletingData'), tone: 'warning' });
    } finally {
      setIsDeletingRecord(false);
    }
  };

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();

    const vehicleToSubmit = { ...newVehicle };

    // Handle Custom Brand
    if (vehicleToSubmit.brand === 'Outra') {
      vehicleToSubmit.brand = customBrand;
    }

    // Handle Custom Model (if brand is Outra or model is Outro)
    if (vehicleToSubmit.brand === 'Outra' || vehicleToSubmit.model === 'Outro') {
      vehicleToSubmit.model = customModel;
    }

    // Handle Color
    if (vehicleToSubmit.color === 'Customizado') {
      vehicleToSubmit.color = customColor;
    } else if (vehicleToSubmit.color === 'Outra') {
      vehicleToSubmit.color = otherColor;
    }

    vehicleToSubmit.current_mileage = sanitizeVehicleKmForApi(vehicleToSubmit.current_mileage, mileageInput);

    const payload: Record<string, unknown> = { ...vehicleToSubmit };
    const plusOrPremium = isPlusOrPremium(user?.plan);
    if (!plusOrPremium) {
      payload.nickname = null;
      payload.color = null;
    } else {
      const nick = typeof payload.nickname === 'string' ? payload.nickname.trim() : '';
      const col = typeof payload.color === 'string' ? payload.color.trim() : '';
      payload.nickname = nick === '' ? null : nick;
      payload.color = col === '' ? null : col;
    }

    setIsSubmittingVehicle(true);
    try {
      let res: Response;
      if (isEditingVehicle && selectedVehicle) {
        res = await apiFetch(`/api/vehicles/${selectedVehicle.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        res = await apiFetch(`/api/vehicles`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        const { json } = parseApiJsonBody(errorText);
        const apiMsg = messageFromApiErrorParts(json, errorText, res.status);
        console.error('Failed to add/update vehicle', res.status, apiMsg);
        const limitReached = isVehiclePlanLimitResponse(res.status, json, errorText);
        if (limitReached) {
          setAppToast({ message: t('toastVehicleLimitReached'), tone: 'warning' });
        } else {
          setAppToast({ message: apiMsg || t('errorSavingData'), tone: 'warning' });
        }
        return;
      }

      const data = await res.json();

      if (isEditingVehicle && selectedVehicle) {
        setVehicles(prev => prev.map(v => (v.id === selectedVehicle.id ? { ...v, ...data } : v)));
        setSelectedVehicle(prev => (prev ? { ...prev, ...data } : null));
      } else {
        setVehicles(prev => [...prev, data]);
        setSelectedVehicle(data);
        setExpandedCards({ mileage: false, services: false, financial: false });
      }

      setActiveTab('garage');
      setShowAddVehicle(false);
      setIsEditingVehicle(false);
      setNewVehicle({
        type: 'Carro',
        brand: '',
        model: '',
        year: new Date().getFullYear(),
        current_mileage: 0,
        last_service_date: new Date().toISOString().split('T')[0],
        nickname: '',
        color: '',
      });
      setCustomBrand('');
      setCustomModel('');
      setCustomColor('');
      setOtherColor('');
      setMileageInput('');
    } catch (e) {
      console.error('Failed to add/update vehicle', e);
      const msg = e instanceof Error && e.message.trim() ? e.message.trim() : '';
      setAppToast({ message: msg || t('errorSavingData'), tone: 'warning' });
    } finally {
      setIsSubmittingVehicle(false);
    }
  };

  const getBrandList = () => {
    if (newVehicle.type === 'Carro') return CAR_BRANDS;
    if (newVehicle.type === 'Moto') return MOTO_BRANDS;
    if (newVehicle.type === 'Bike') return EBIKE_BRANDS;
    return [];
  };

  const getModelList = () => {
    if (newVehicle.brand === 'Outra') return [];
    let models: string[] = [];
    const brand = newVehicle.brand ?? '';
    if (newVehicle.type === 'Carro') models = CAR_MODELS[brand] || [];
    if (newVehicle.type === 'Moto') models = MOTO_MODELS[brand] || [];
    if (newVehicle.type === 'Bike') models = EBIKE_MODELS[brand] || [];
    return models.sort();
  };

  /** Compara ignorando maiúsculas/acentos — o Gemini às vezes devolve "Chevrolet" e nossa lista tem "CHEVROLET". */
  const looseMatch = (value: string, options: readonly string[]): string | null => {
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const target = norm(value);
    return options.find(opt => norm(opt) === target) ?? null;
  };

  const handleCrlvUpload = async (file: File) => {
    if (!user) return;
    setIsUploadingCrlv(true);
    setCrlvWarnings([]);
    try {
      const scope = isEditingVehicle && selectedVehicle ? String(selectedVehicle.id) : 'pending';
      const path = newAttachmentPath(user.id, ['vehicles', scope], file.name.endsWith('.pdf') ? 'crlv.pdf' : file.name);

      const { path: uploadedPath, error: uploadError } = await uploadFileToStorage(file, path);
      if (!uploadedPath) {
        setAppToast({ message: uploadError || t('crlvUploadError'), tone: 'warning' });
        return;
      }
      setNewVehicle(prev => ({ ...prev, document_path: uploadedPath }));

      const res = await apiFetch('/api/vehicles/crlv/extract', {
        method: 'POST',
        body: JSON.stringify({ path: uploadedPath }),
      });
      if (!res.ok) {
        setAppToast({ message: t('crlvExtractError'), tone: 'warning' });
        return;
      }
      const extracted = await res.json().catch(() => ({})) as {
        plate?: string | null;
        brand?: string | null;
        model?: string | null;
        year?: number | null;
        color?: string | null;
        not_found?: string[];
      };

      const warnings: string[] = [];
      const patch: Partial<Vehicle> = {};

      if (extracted.plate) {
        patch.plate = extracted.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
      } else {
        warnings.push(t('crlvFieldPlate'));
      }

      if (extracted.year && extracted.year >= 1950 && extracted.year <= new Date().getFullYear() + 1) {
        patch.year = extracted.year;
      } else {
        warnings.push(t('crlvFieldYear'));
      }

      if (extracted.brand) {
        const brandList = getBrandList();
        const matchedBrand = looseMatch(extracted.brand, brandList);
        if (matchedBrand) {
          patch.brand = matchedBrand;
          setCustomBrand('');
        } else {
          patch.brand = 'Outra';
          setCustomBrand(extracted.brand.replace(/[^a-zA-Z ]/g, ''));
          warnings.push(t('crlvFieldBrandNotListed'));
        }
      } else {
        warnings.push(t('crlvFieldBrand'));
      }

      if (extracted.model) {
        // Marca precisa estar resolvida para checar a lista de modelos certa.
        const modelsForBrand = patch.brand && patch.brand !== 'Outra'
          ? (newVehicle.type === 'Carro' ? CAR_MODELS[patch.brand] : newVehicle.type === 'Moto' ? MOTO_MODELS[patch.brand] : EBIKE_MODELS[patch.brand]) || []
          : [];
        const matchedModel = looseMatch(extracted.model, modelsForBrand);
        if (matchedModel) {
          patch.model = matchedModel;
          setCustomModel('');
        } else {
          patch.model = patch.brand === 'Outra' ? undefined : 'Outro';
          setCustomModel(extracted.model.replace(/[^a-zA-Z0-9 ]/g, ''));
          if (patch.brand === 'Outra') patch.model = 'Outro';
          warnings.push(t('crlvFieldModelNotListed'));
        }
      } else {
        warnings.push(t('crlvFieldModel'));
      }

      if (extracted.color && isPlusOrPremium(user?.plan)) {
        const matchedColor = looseMatch(extracted.color, VEHICLE_COLORS || []);
        if (matchedColor) {
          setNewVehicle(prev => ({ ...prev, ...patch, color: matchedColor }));
        } else {
          setCustomColor(extracted.color.replace(/[^a-zA-Z ]/g, ''));
          setNewVehicle(prev => ({ ...prev, ...patch, color: 'Customizado' }));
        }
      } else {
        setNewVehicle(prev => ({ ...prev, ...patch }));
      }

      if (extracted.not_found?.length) {
        warnings.push(...extracted.not_found);
      }
      setCrlvWarnings(warnings);
      setAppToast({
        message: warnings.length ? t('crlvExtractPartial') : t('crlvExtractSuccess'),
        tone: warnings.length ? 'warning' : 'neutral',
      });
    } catch (error) {
      console.error('Error processing CRLV:', error);
      setAppToast({ message: t('crlvExtractError'), tone: 'warning' });
    } finally {
      setIsUploadingCrlv(false);
    }
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setIsSubmittingLog(true);
    try {
      const isEdit = editingMaintenanceLogId !== null;
      const res = await apiFetch(
        isEdit
          ? `/api/vehicles/${selectedVehicle.id}/maintenance/${editingMaintenanceLogId}`
          : `/api/logs`,
        {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify(isEdit ? newLog : { ...newLog, vehicle_id: selectedVehicle.id }),
        },
      );
      if (!res.ok) {
        console.error('Failed to save log', res.status, await res.text().catch(() => ''));
        setAppToast({ message: t('errorSavingData'), tone: 'warning' });
        return;
      }
      setShowAddLog(false);
      setEditingMaintenanceLogId(null);
      fetchLogs(selectedVehicle.id);
    } catch (err) {
      console.error('Failed to save log', err);
      setAppToast({ message: t('errorSavingData'), tone: 'warning' });
    } finally {
      setIsSubmittingLog(false);
    }
  };

  const handleDeleteLog = async () => {
    if (!selectedVehicle || editingMaintenanceLogId === null) return;
    if (!window.confirm(t('confirmDeleteRecord'))) return;
    setIsDeletingRecord(true);
    try {
      const res = await apiFetch(`/api/vehicles/${selectedVehicle.id}/maintenance/${editingMaintenanceLogId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error('Failed to delete log', res.status, await res.text().catch(() => ''));
        setAppToast({ message: t('errorDeletingData'), tone: 'warning' });
        return;
      }
      await fetchLogs(selectedVehicle.id);
      setShowAddLog(false);
      setEditingMaintenanceLogId(null);
    } catch (err) {
      console.error('Failed to delete log', err);
      setAppToast({ message: t('errorDeletingData'), tone: 'warning' });
    } finally {
      setIsDeletingRecord(false);
    }
  };

  const handleAddFinancial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setIsSubmittingFinancial(true);
    try {
      const isEdit = editingFinancialRecordId !== null;
      const res = await apiFetch(
        isEdit
          ? `/api/vehicles/${selectedVehicle.id}/financial/${editingFinancialRecordId}`
          : `/api/financial`,
        {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify(isEdit ? newFinancial : { ...newFinancial, vehicle_id: selectedVehicle.id }),
        },
      );
      if (!res.ok) {
        console.error('Failed to save financial record', res.status, await res.text().catch(() => ''));
        setAppToast({ message: t('errorSavingData'), tone: 'warning' });
        return;
      }
      setShowAddFinancial(false);
      setEditingFinancialRecordId(null);
      fetchFinancialRecords(selectedVehicle.id);
    } catch (err) {
      console.error('Failed to save financial record', err);
      setAppToast({ message: t('errorSavingData'), tone: 'warning' });
    } finally {
      setIsSubmittingFinancial(false);
    }
  };

  const handleDeleteFinancial = async () => {
    if (!selectedVehicle || editingFinancialRecordId === null) return;
    if (!window.confirm(t('confirmDeleteRecord'))) return;
    setIsDeletingRecord(true);
    try {
      const res = await apiFetch(`/api/vehicles/${selectedVehicle.id}/financial/${editingFinancialRecordId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        console.error('Failed to delete financial record', res.status, await res.text().catch(() => ''));
        setAppToast({ message: t('errorDeletingData'), tone: 'warning' });
        return;
      }
      await fetchFinancialRecords(selectedVehicle.id);
      setShowAddFinancial(false);
      setEditingFinancialRecordId(null);
    } catch (err) {
      console.error('Failed to delete financial record', err);
      setAppToast({ message: t('errorDeletingData'), tone: 'warning' });
    } finally {
      setIsDeletingRecord(false);
    }
  };

  // Chat Functions
  const fetchChatSessions = async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/api/chat/sessions`);
      if (res.ok) {
        const raw = await res.json();
        const sessions = Array.isArray(raw) ? raw : [];
        // Backend já filtra pelo user autenticado; mantemos a checagem por defesa
        setChatSessions(sessions.filter((s: ChatSession) => String(s.user_id) === String(user.id)));
      }
    } catch (error) {
      console.error("Error fetching chat sessions:", error);
    }
  };

  const confirmDeleteChatSession = async () => {
    if (!chatSessionToDelete) return;
    
    try {
      const res = await apiFetch(`/api/chat/sessions/${chatSessionToDelete}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== chatSessionToDelete));
        if (currentSessionId === chatSessionToDelete) {
          setCurrentSessionId(null);
          setChatMessages([]);
          setDrGraxaUIMode('list');
        }
        setShowDeleteChatModal(false);
        setChatSessionToDelete(null);
      }
    } catch (error) {
      console.error("Error deleting chat session:", error);
    }
  };

  const fetchChatTrash = async () => {
    if (!user) return;
    setChatTrashLoading(true);
    try {
      const res = await apiFetch(`/api/chat/sessions/trash`);
      if (res.ok) {
        const raw = await res.json();
        setChatTrashSessions(Array.isArray(raw) ? raw : []);
      }
    } catch (error) {
      console.error("Error fetching chat trash:", error);
    } finally {
      setChatTrashLoading(false);
    }
  };

  const restoreChatSession = async (sessionId: number) => {
    try {
      const res = await apiFetch(`/api/chat/sessions/${sessionId}/restore`, { method: 'POST' });
      if (res.ok) {
        setChatTrashSessions(prev => prev.filter(s => s.id !== sessionId));
        void fetchChatSessions();
        setAppToast({ message: t('chatTrashRestored'), tone: 'neutral' });
      }
    } catch (error) {
      console.error("Error restoring chat session:", error);
    }
  };

  const permanentlyDeleteChatSession = async (sessionId: number) => {
    try {
      const res = await apiFetch(`/api/chat/sessions/${sessionId}/permanent`, { method: 'DELETE' });
      if (res.ok) {
        setChatTrashSessions(prev => prev.filter(s => s.id !== sessionId));
      }
    } catch (error) {
      console.error("Error permanently deleting chat session:", error);
    }
  };

  const loadChatSession = async (sessionId: number) => {
    try {
      const res = await apiFetch(`/api/chat/sessions/${sessionId}/messages`);
      if (res.ok) {
        const raw = await res.json();
        setChatMessages(Array.isArray(raw) ? raw : []);
        setCurrentSessionId(sessionId);
        setDrGraxaUIMode('chat');
      }
    } catch (error) {
      console.error("Error loading chat session:", error);
    }
  };

  /** Produto ai_chats. `title: null` até o PATCH da primeira troca válida com a IA. Pode ser chamado apenas no primeiro envio (sessão lazy). */
  const createChatSessionRecord = async (title: string | null): Promise<number | null> => {
    if (!user) return null;
    try {
      const res = await apiFetch(`/api/chat/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: selectedVehicle?.id ?? null,
          title,
        })
      });
      if (res.ok) {
        const { id } = await res.json();
        setCurrentSessionId(id);
        fetchChatSessions();
        return id;
      }
    } catch (error) {
      console.error("Error creating chat session:", error);
    }
    return null;
  };

  const patchChatSessionTitleAfterFirstQuestion = async (sessionId: number, question: string) => {
    const safe = chatTitleFromFirstQuestion(question, 200);
    if (!safe) return;
    try {
      const res = await apiFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: safe }),
      });
      if (res.ok) fetchChatSessions();
    } catch (e) {
      console.error('Error updating chat title:', e);
    }
  };

  const askAi = async () => {
    const userMessageText = aiPrompt.trim();
    if (!userMessageText || drGraxaSendInFlightRef.current) return;

    const limit = aiMonthlyLimitForPlan(user?.plan);
    const used = user?.ai_messages_count ?? 0;
    if (limit > 0 && used >= limit) {
      return;
    }

    const hadNoPriorMessages = chatMessages.length === 0;

    drGraxaSendInFlightRef.current = true;
    setAiPrompt('');
    setIsLoadingAi(true);

    let sessionId = currentSessionId;
    try {
      if (!sessionId) {
        sessionId = await createChatSessionRecord(null);
      }

      if (!sessionId) {
        setAiPrompt(userMessageText);
        setAppToast({ message: t('aiConnectionError'), tone: 'warning' });
        return;
      }

      const userMsg: ChatMessage = {
        id: Date.now(),
        session_id: sessionId,
        sender: 'user',
        content: userMessageText,
        timestamp: new Date().toISOString()
      };
      setChatMessages(prev => [...prev, userMsg]);

      await apiFetch(`/api/chat/messages`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          sender: 'user',
          content: userMessageText
        })
      });

      const response = await apiFetch(`/api/chat`, {
        method: 'POST',
        body: JSON.stringify({
          message: userMessageText,
          vehicleId: selectedVehicle?.id,
          session_id: sessionId,
        })
      });

      const data = await response.json().catch(() => ({}) as Record<string, unknown>);
      if (!response.ok) {
        const msg =
          mapApiErrorCode(data.error) ||
          (typeof data.text === 'string' && data.text) ||
          (typeof data.message === 'string' && data.message) ||
          t('aiConnectionError');
        if (response.status === 403 || response.status === 429) setShowUpgradeModal(true);
        const errMsg: ChatMessage = {
          id: Date.now() + 2,
          session_id: sessionId,
          sender: 'ai',
          content: msg,
          timestamp: new Date().toISOString()
        };
        setChatMessages(prev => [...prev, errMsg]);
        void fetchUser();
        return;
      }

      const aiText =
        (typeof data.text === 'string' && data.text) || t('aiProcessingError');

      const aiMsg: ChatMessage = {
        id: Date.now() + 1,
        session_id: sessionId,
        sender: 'ai',
        content: aiText,
        timestamp: new Date().toISOString()
      };
      setChatMessages(prev => [...prev, aiMsg]);

      await apiFetch(`/api/chat/messages`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          sender: 'ai',
          content: aiText
        })
      });

      if (hadNoPriorMessages) {
        void patchChatSessionTitleAfterFirstQuestion(sessionId, userMessageText);
      }

      void fetchUser();
      fetchChatSessions();

    } catch (error) {
      console.error(error);
      if (sessionId != null && sessionId > 0) {
        const errorMsg: ChatMessage = {
          id: Date.now() + 2,
          session_id: sessionId,
          sender: 'ai',
          content: t('aiConnectionError'),
          timestamp: new Date().toISOString()
        };
        setChatMessages(prev => [...prev, errorMsg]);
      } else {
        setAiPrompt(userMessageText);
        setAppToast({ message: t('aiConnectionError'), tone: 'warning' });
      }
    } finally {
      setIsLoadingAi(false);
      drGraxaSendInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (activeTab !== 'advisor') {
      setDrGraxaUIMode('list');
      setShowDrGraxaManualModal(false);
      setCurrentSessionId(null);
      setChatMessages([]);
      setAiPrompt('');
    }
  }, [activeTab]);

  useEffect(() => {
    if (user && activeTab === 'advisor') {
      fetchChatSessions();
    }
  }, [user, activeTab]);

  const getHealthStatus = (vehicle: Vehicle) => {
    if (vehicle.current_mileage > 100000) return 'text-[#e0473f]';
    if (vehicle.current_mileage > 50000) return 'text-[#ffcc00]';
    return 'text-[#34a06a]';
  };

  // Footer Component
  // showHelp: exibe o link "Precisa de ajuda?" — usado só nas telas de criação
  // de conta (cadastro, termos, preferências de onboarding), onde o usuário
  // ainda não tem acesso ao menu Suporte do app autenticado.
  const Footer = ({ showHelp = false }: { showHelp?: boolean } = {}) => (
    <div className="mt-8 py-6 text-center border-t border-revis-dark-gray/50">
      {showHelp && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowRegisterHelp(v => !v)}
            className="text-xs text-[--color-revis-gray] underline decoration-dotted underline-offset-2 hover:text-[#34a06a] transition-colors"
          >
            {t('needHelp')}
          </button>
          {showRegisterHelp && (
            <div className="mt-3 max-w-xs mx-auto glass rounded-xl border border-[--color-border] p-2 flex flex-col gap-1">
              <a
                href="mailto:dev@revisautoapp.com.br"
                className="flex items-center justify-center gap-2 text-sm font-medium text-[--color-text] py-2 rounded-lg hover:bg-white/5 hover:text-[#34a06a] transition-colors"
              >
                <Mail className="w-4 h-4" />
                {t('supportEmail')}
              </a>
              <a
                href="https://wa.me/5511918540985"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm font-medium text-[--color-text] py-2 rounded-lg hover:bg-white/5 hover:text-[#25D366] transition-colors"
              >
                <WhatsAppIcon className="w-4 h-4 text-[#25D366]" />
                {t('supportWhatsapp')}
              </a>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-[--color-revis-gray] font-medium">{t('footerCopyright')}</p>
      <p className="text-xs text-[#34a06a] mt-1">dev@revisautoapp.com.br</p>
    </div>
  );

  // Mobile View Renderers
  const renderLogin = () => (
    <div className="relative min-h-screen w-full overflow-hidden bg-black">

      {/* Imagem de fundo full-bleed */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
        aria-hidden="true"
      />

      {/* Overlay escuro gradiente: mais denso nos cantos, transparente no centro */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to right, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.38) 48%, rgba(0,0,0,0.68) 100%)',
        }}
        aria-hidden="true"
      />

      {/* Conteúdo sobre o overlay */}
      <div className="relative z-10 min-h-screen flex flex-col">

        {/* Header: logo + seletores */}
        <div className="flex items-center justify-between px-8 pt-7 pb-4">
          <span className="font-display font-semibold text-xl tracking-tight select-none">
            <span className="text-white">Revis</span>
            <span className="text-[#34a06a]">Auto</span>
          </span>
          <div className="flex items-center gap-3">
            {renderAuthLanguageSelector('right')}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 text-xs"
              style={
                theme === 'light'
                  ? { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.6)', color: '#1f7a4d' }
                  : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)', color: '#34a06a' }
              }
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span>{t('authTheme')}</span>
            </button>
          </div>
        </div>

        {/* Layout principal: headline esquerda + formulário direita */}
        <div className="flex-1 flex items-center justify-between px-8 md:px-14 pb-10 gap-8">

          {/* Headline — visível apenas em desktop */}
          <div className="hidden md:flex flex-col justify-end pb-4 flex-1 max-w-md">
            <h1 className="font-display text-4xl font-semibold text-white leading-tight tracking-tight mb-3"
              style={{ textShadow: '0 2px 24px rgba(0,0,0,0.6)' }}
            >
              {t('loginHeroTitle')}
            </h1>
            <p className="text-[#c9cdd1] text-base leading-relaxed"
              style={{ textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}
            >
              {t('loginHeroSubtitle')}
            </p>
          </div>

          {/* Formulário glass — cores mudam de verdade com o tema (a foto de fundo continua escura) */}
          <div className="w-full max-w-sm md:max-w-[380px] flex-shrink-0">
            <div
              className="rounded-2xl p-8"
              style={
                theme === 'light'
                  ? {
                      background: 'rgba(255,255,255,0.92)',
                      backdropFilter: 'blur(40px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                      border: '1px solid rgba(255,255,255,0.6)',
                      boxShadow: '0 24px 64px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
                    }
                  : {
                      background: 'rgba(18,20,22,0.82)',
                      backdropFilter: 'blur(40px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow: '0 24px 64px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
                    }
              }
            >
              <h2 className={`font-display text-2xl font-semibold tracking-tight mb-7 ${theme === 'light' ? 'text-[#0b0c0d]' : 'text-white'}`}>
                {t('welcomeBack')}
              </h2>

              <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
                <div>
                  <label className={`block mb-1.5 text-[11px] font-medium tracking-[0.07em] uppercase ${theme === 'light' ? 'text-[#6b7280]' : 'text-[--color-revis-gray]'}`}>{t('email')}</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="voce@email.com"
                    className="w-full px-4 py-3 text-sm rounded-[10px] outline-none transition-colors"
                    style={
                      theme === 'light'
                        ? { background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.10)', color: '#0b0c0d' }
                        : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#ffffff' }
                    }
                    value={authForm.email}
                    onChange={e => setAuthForm({...authForm, email: e.target.value})}
                  />
                </div>

                <div>
                  <label className={`block mb-1.5 text-[11px] font-medium tracking-[0.07em] uppercase ${theme === 'light' ? 'text-[#6b7280]' : 'text-[--color-revis-gray]'}`}>{t('password')}</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="w-full px-4 py-3 text-sm pr-12 rounded-[10px] outline-none transition-colors"
                      style={
                        theme === 'light'
                          ? { background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.10)', color: '#0b0c0d' }
                          : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#ffffff' }
                      }
                      value={authForm.password}
                      onChange={e => setAuthForm({...authForm, password: e.target.value})}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className={`absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors ${theme === 'light' ? 'text-[#6b7280] hover:text-[#0b0c0d]' : 'text-[#9aa0a8] hover:text-white'}`}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setAuthError(''); setRecoverEmail(authForm.email); setRecoverError(''); setRecoverMessage(''); setAuthScreen('recover'); }}
                    className="text-[#34a06a] text-sm hover:text-[#2d8f5d] transition-colors"
                  >
                    {t('forgotPassword')}
                  </button>
                </div>

                {authError && (
                  <p className="text-[#e0473f] text-sm text-center py-2 px-3 rounded-lg bg-[#e0473f]/10 border border-[#e0473f]/20">
                    {authError}
                  </p>
                )}

                <button
                  type="submit"
                  className="btn-primary w-full mt-2 py-3"
                >
                  {t('loginButton')}
                </button>
              </form>

              <p className={`mt-6 text-center text-sm ${theme === 'light' ? 'text-[#6b7280]' : 'text-[#9aa0a8]'}`}>
                {t('noAccount')}{' '}
                <button
                  onClick={() => { setAuthError(''); setAuthScreen('register'); }}
                  className="text-[#34a06a] font-medium hover:text-[#2d8f5d] transition-colors"
                >
                  {t('registerTitle')}
                </button>
              </p>
            </div>
          </div>
        </div>

        {/* Mobile: headline abaixo do formulário */}
        <div className="md:hidden px-8 pb-10">
          <h1 className="font-display text-2xl font-semibold text-white leading-tight tracking-tight mb-2">
            {t('loginHeroTitle')}
          </h1>
          <p className="text-[#c9cdd1] text-sm leading-relaxed">
            {t('loginHeroSubtitle')}
          </p>
        </div>

      </div>
    </div>
  );

  const renderRecover = () => (
    <div className="flex flex-col min-h-screen p-6 bg-black">
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
        <div className="mb-8 text-center">
          <div className="glass p-3 rounded-2xl inline-block mb-4">
            <Wrench className="w-8 h-8 text-[#34a06a]" />
          </div>
          <h1 className="text-xl font-bold text-[--color-heading] font-display mb-1">{t('forgotPassword')}</h1>
          <p className="text-sm text-[--color-revis-gray]">{t('recoverInstructions')}</p>
        </div>

        {recoverMessage ? (
          <div className="bg-[#34a06a]/10 border border-[#34a06a] rounded-xl p-4 text-center">
            <Check className="w-8 h-8 text-[#34a06a] mx-auto mb-2" />
            <p className="text-[#34a06a] text-sm font-medium">{recoverMessage}</p>
            <button
              onClick={() => { setAuthScreen('login'); setRecoverMessage(''); }}
              className="mt-4 text-xs text-[--color-revis-gray] hover:text-[#34a06a] transition-colors"
            >
              {t('backToLogin')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleRecoverPassword} className="space-y-4">
            <div>
              <label className="block text-xs text-[--color-revis-gray] mb-1">{t('email')}</label>
              <input
                type="email"
                required
                autoComplete="email"
                className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                value={recoverEmail}
                onChange={e => setRecoverEmail(e.target.value)}
                placeholder={t('placeholderEmailExample')}
              />
            </div>

            {recoverError && <p className="text-[#e0473f] text-sm text-center">{recoverError}</p>}

            <button
              type="submit"
              disabled={recoverLoading}
              className="w-full bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm disabled:opacity-60"
            >
              {recoverLoading ? t('sending') : t('sendRecoveryLink')}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => { setAuthScreen('login'); setRecoverError(''); setRecoverMessage(''); }}
            className="text-[--color-revis-gray] text-sm hover:text-[#34a06a] transition-colors flex items-center gap-1 mx-auto"
          >
            <ChevronLeft className="w-4 h-4" />
            {t('back')}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );

  const renderResetPassword = () => (
    <div className="flex flex-col min-h-screen p-6 bg-black">
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
        <div className="mb-8 text-center">
          <div className="glass p-3 rounded-2xl inline-block mb-4">
            <Shield className="w-8 h-8 text-[#34a06a]" />
          </div>
          <h1 className="text-xl font-bold text-[--color-heading] font-display mb-1">{t('newPassword')}</h1>
          <p className="text-sm text-[--color-revis-gray]">{t('resetPasswordIntro')}</p>
        </div>

        {resetMessage ? (
          <div className="bg-[#34a06a]/10 border border-[#34a06a] rounded-xl p-4 text-center">
            <Check className="w-8 h-8 text-[#34a06a] mx-auto mb-2" />
            <p className="text-[#34a06a] text-sm font-medium">{resetMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs text-[--color-revis-gray] mb-1">{t('newPasswordLabel')}</label>
              <input
                type="password"
                required
                className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder={t('placeholderPasswordMask')}
              />
            </div>
            <div>
              <label className="block text-xs text-[--color-revis-gray] mb-1">{t('confirmPassword')}</label>
              <input
                type="password"
                required
                className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                value={resetConfirmPassword}
                onChange={e => setResetConfirmPassword(e.target.value)}
                placeholder={t('placeholderPasswordMask')}
              />
            </div>

            {resetError && <p className="text-[#e0473f] text-sm text-center">{resetError}</p>}

            <button
              type="submit"
              disabled={resetLoading}
              className="w-full bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm disabled:opacity-60"
            >
              {resetLoading ? t('saving') : t('saveNewPassword')}
            </button>
          </form>
        )}
      </div>
      <Footer />
    </div>
  );

  const renderRegister = () => (
    <div className="flex flex-col min-h-screen p-6 bg-black relative">
      <div className="absolute top-6 left-6 z-20 flex items-center gap-3">
        {renderAuthLanguageSelector('left')}
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 text-xs"
          style={
            theme === 'light'
              ? { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.6)', color: '#1f7a4d' }
              : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.13)', color: '#34a06a' }
          }
        >
          <Paintbrush className="w-3.5 h-3.5" />
          <span>{t('authTheme')}</span>
        </button>
      </div>
      <div className="w-full max-w-md mx-auto my-auto flex flex-col">
      <h1 className="text-xl font-bold text-[--color-heading] font-display mb-6 mt-2">{t('registerTitle')}</h1>

      <form onSubmit={handleRegister} className="space-y-5 flex-1" autoComplete="off">
        {/* 1. Nome Completo */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('name')}*</label>
          <input 
            required
            autoComplete="name"
            className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
            value={authForm.name}
            onChange={e => setAuthForm({...authForm, name: e.target.value})}
          />
        </div>

        {/* 2. Como quer ser chamado */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('nickname')}</label>
          <input 
            autoComplete="username"
            className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
            value={authForm.nickname}
            onChange={e => setAuthForm({...authForm, nickname: e.target.value})}
          />
          {!validateNickname(authForm.nickname) && authForm.nickname.length > 0 && (
             <p className="text-xs text-[#e0473f] mt-1 ml-1">{t('nicknameNotAllowed')}</p>
          )}
        </div>

        {/* 3. E-mail */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('email')}*</label>
          <input 
            type="email"
            required
            autoComplete="email"
            className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
            value={authForm.email}
            onChange={e => setAuthForm({...authForm, email: e.target.value})}
          />
          <p className="text-[10px] text-[--color-revis-gray] mt-1 ml-1">{t('registerEmailHint')}</p>
        </div>

        {/* 4. Data de Nascimento */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('birthDate')}*</label>
          <div className="grid grid-cols-3 gap-2">
            <CustomSelect required value={authForm.birthDay} onChange={v=>setAuthForm({...authForm,birthDay:v})} options={[{value:'',label:t('labelDay')},...DAYS.map(d=>({value:d,label:d}))]} placeholder={t('labelDay')} />
            <CustomSelect required value={authForm.birthMonth} onChange={v=>setAuthForm({...authForm,birthMonth:v})} options={[{value:'',label:t('labelMonth')},...MONTHS.map(m=>({value:m.val,label:m.label}))]} placeholder={t('labelMonth')} />
            <CustomSelect required value={authForm.birthYear} onChange={v=>setAuthForm({...authForm,birthYear:v})} options={[{value:'',label:t('labelYear')},...YEARS.map(y=>({value:y,label:y}))]} placeholder={t('labelYear')} />
          </div>
          {!isAgeValid() && authForm.birthYear && (
             <p className="text-xs text-[#e0473f] mt-1 ml-1">{t('ageRequirement18')}</p>
          )}
        </div>

        {/* 5. País */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('country')}*</label>
          <CustomSelect required value={authForm.country} onChange={v=>setAuthForm({...authForm,country:v})} options={COUNTRIES.map(c=>({value:c,label:countryLabel(c)}))} />
        </div>

        {/* 5.1 / 5.2 Condicionais */}
        {authForm.country === 'Brasil (+55)' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[--color-revis-gray] mb-1">{t('zipCode')}*</label>
                <input 
                  required
                  placeholder={t('placeholderCepMask')}
                  maxLength={9}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                  value={authForm.zip_code}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2');
                    setCepError(false);
                    setAuthForm({...authForm, zip_code: val});
                  }}
                  onBlur={handleCepBlur}
                />
                {cepError && (
                  <p className="text-xs text-[#e0473f] mt-1 ml-1">{t('cepNotFound')}</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-[--color-revis-gray] mb-1">{t('phone')}*</label>
                <input
                  required
                  placeholder={t('placeholderPhoneBrMask')}
                  maxLength={15}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                  value={authForm.phone}
                  onChange={e => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 11) val = val.slice(0, 11);
                    val = val.replace(/^(\d{2})(\d)/, '($1) $2');
                    val = val.replace(/(\d{5})(\d)/, '$1-$2');
                    setAuthForm({...authForm, phone: val});
                  }}
                />
                {authForm.phone.replace(/\D/g, '').length >= 10 && !validatePhone(authForm.phone) && (
                  <p className="text-xs text-[#e0473f] mt-1 ml-1">{t('invalidMobileBr')}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[--color-revis-gray] mb-1">{t('city')}</label>
                <input 
                  readOnly
                  className="w-full glass opacity-70 border border-transparent rounded-xl p-3 text-sm text-[--color-revis-gray] outline-none cursor-not-allowed"
                  value={authForm.city}
                />
              </div>
              <div>
                <label className="block text-xs text-[--color-revis-gray] mb-1">{t('state')}</label>
                <input 
                  readOnly
                  className="w-full glass opacity-70 border border-transparent rounded-xl p-3 text-sm text-[--color-revis-gray] outline-none cursor-not-allowed"
                  value={authForm.state}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs text-[--color-revis-gray] mb-1">{t('phone')}</label>
              <input 
                className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                value={authForm.phone}
                onChange={e => {
                  const val = e.target.value.replace(/[^0-9()]/g, '');
                  setAuthForm({...authForm, phone: val});
                }}
              />
              {authForm.country === 'Brasil (+55)' && authForm.phone.length >= 10 && !validatePhone(authForm.phone) && (
                 <p className="text-xs text-[#e0473f] mt-1 ml-1">{t('invalidMobileBr')}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[--color-revis-gray] mb-1">{t('city')}</label>
                <input 
                  maxLength={25}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                  value={authForm.city}
                  onChange={e => {
                    const val = e.target.value.replace(/[^a-zA-Z\u00C0-\u00FF ]/g, '');
                    setAuthForm({...authForm, city: val});
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-[--color-revis-gray] mb-1">{t('state')}</label>
                <input 
                  maxLength={25}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors"
                  value={authForm.state}
                  onChange={e => {
                    const val = e.target.value.replace(/[^a-zA-Z\u00C0-\u00FF ]/g, '');
                    setAuthForm({...authForm, state: val});
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* 6. Senha */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('password')}*</label>
          <div className="relative">
            <input 
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              maxLength={20}
              className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors pr-12"
              value={authForm.password}
              onChange={e => setAuthForm({...authForm, password: e.target.value})}
            />
            <button 
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[--color-revis-gray]"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          
          <div className="mt-2 grid grid-cols-1 gap-2">
            {[
              { label: t('passwordReqUpper'), valid: validatePassword(authForm.password).hasUpper },
              { label: t('passwordReqLower'), valid: validatePassword(authForm.password).hasLower },
              { label: t('passwordReqNumber'), valid: validatePassword(authForm.password).hasNumber },
              { label: t('passwordReqSpecial'), valid: validatePassword(authForm.password).hasSpecial },
              { label: t('passwordReqLength'), valid: validatePassword(authForm.password).isValidLength },
            ].map((req, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {req.valid ? (
                  <Check className="w-3 h-3 text-[#34a06a]" />
                ) : (
                  <div className="w-3 h-3 rounded-full border border-revis-gray" />
                )}
                <span className={`text-[10px] ${req.valid ? 'text-[#34a06a]' : 'text-[--color-revis-gray]'}`}>
                  {req.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Repetir Senha */}
        <div>
          <label className="block text-xs text-[--color-revis-gray] mb-1">{t('confirmPassword')}*</label>
          <div className="relative">
            <input 
              type={showConfirmPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              className={`w-full glass border rounded-xl p-3 text-sm text-[--color-text] outline-none transition-colors pr-12 ${
                authForm.confirmPassword && authForm.password !== authForm.confirmPassword 
                  ? 'border-revis-alert-critical focus:border-revis-alert-critical' 
                  : 'border-transparent focus:border-[#34a06a]'
              }`}
              value={authForm.confirmPassword}
              onChange={e => setAuthForm({...authForm, confirmPassword: e.target.value})}
            />
            <button 
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[--color-revis-gray]"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {authForm.confirmPassword && authForm.password !== authForm.confirmPassword && (
            <p className="text-xs text-[#e0473f] mt-1 ml-1">{t('passwordsDoNotMatch')}</p>
          )}
        </div>

        {authError && <p className="text-[#e0473f] text-sm text-center">{authError}</p>}

        <div className="flex gap-4 pt-4 mt-auto">
          <button 
            type="button" 
            onClick={() => { setAuthError(''); setAuthScreen('login'); }}
            className="flex-1 glass text-gray-500 font-bold py-3 rounded-xl hover:bg-white/8 transition-colors text-sm"
          >
            &lt; {t('back')}
          </button>
          <button 
            type="submit" 
            disabled={!isFormValid()}
            className="flex-1 bg-[#34a06a] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm"
          >
            {t('next')}
          </button>
        </div>
      </form>
      <Footer showHelp />
      </div>
    </div>
  );

  const renderTerms = () => (
    <div className="flex flex-col h-[100dvh] p-6 bg-black">
      
      <div className="flex gap-4 mb-6 border-b border-revis-dark-gray">
        <button 
          onClick={() => {
            setActiveTermsTab('terms');
            if (termsContentRef.current) termsContentRef.current.scrollTop = 0;
          }}
          className={`pb-2 px-2 font-medium transition-colors flex-1 text-sm ${activeTermsTab === 'terms' ? 'text-[#34a06a] border-b-2 border-[#34a06a]' : 'text-[--color-revis-gray]'}`}
        >
          {t('terms')}
        </button>
        <button 
          onClick={() => {
            setActiveTermsTab('privacy');
            if (termsContentRef.current) termsContentRef.current.scrollTop = 0;
          }}
          className={`pb-2 px-2 font-medium transition-colors flex-1 text-sm ${activeTermsTab === 'privacy' ? 'text-[#34a06a] border-b-2 border-[#34a06a]' : 'text-[--color-revis-gray]'}`}
        >
          {t('privacy')}
        </button>
      </div>
      
      <div 
        ref={termsContentRef}
        onScroll={handleTermsScroll}
        className="flex-1 glass rounded-xl p-4 overflow-y-auto mb-6 text-xs text-[--color-text] space-y-4"
      >
        {activeTermsTab === 'privacy' ? (
          <>
            <h3 className="font-bold text-[--color-heading] font-display mb-2 text-sm">POLÍTICA DE PRIVACIDADE – REVISAUTO</h3>
            <p className="text-[10px] text-[--color-revis-gray] mb-4">{t('legalLastUpdated')}<br/>{t('legalUpdatesNotice')}</p>
            
            <p>A plataforma RevisAuto tem o compromisso de proteger a privacidade e os dados pessoais de seus usuários. Esta Política descreve como coletamos, usamos, armazenamos e protegemos suas informações, em total conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD).</p>
            
            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">1. DADOS COLETADOS</h4>
            <p>Para o funcionamento adequado do aplicativo, coletamos os seguintes dados:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Informações de Cadastro: Nome completo, e-mail, apelido, data de nascimento, país, celular, CEP, cidade e estado.</li>
              <li>Informações do Veículo: Placa, marca, modelo, ano, cor, quilometragem, RENAVAM e chassi (quando informados ou extraídos automaticamente do CRLV), além do histórico de abastecimentos, manutenções e impostos, taxas e multas registrados por você.</li>
              <li>Documentos e Comprovantes: Fotos e arquivos anexados aos lançamentos de abastecimento, manutenção e impostos/multas, além do documento do veículo (CRLV) enviado para preenchimento automático do cadastro.</li>
              <li>Interações com a IA: O conteúdo das mensagens e fotos enviadas ao assistente virtual (Dr. Graxa).</li>
            </ul>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">2. FINALIDADE DO TRATAMENTO DE DADOS</h4>
            <p>Os dados coletados são utilizados exclusivamente para:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Gerenciar sua garagem virtual e histórico automotivo.</li>
              <li>Personalizar as respostas e diagnósticos da Inteligência Artificial, inclusive a leitura automática do CRLV.</li>
              <li>Processar as validações de pagamento das assinaturas escolhidas pelo usuário.</li>
              <li>Garantir a segurança da conta e prevenir acessos fraudulentos.</li>
            </ul>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">3. COMPARTILHAMENTO DE DADOS E INFRAESTRUTURA</h4>
            <p>3.1. Não Comercialização: O RevisAuto não vende seus dados pessoais a terceiros para fins publicitários.</p>
            <p>3.2. Parceiros Técnicos e Nuvem: Seus dados cadastrais e o histórico de veículos são armazenados de forma criptografada em nosso parceiro de nuvem, o Supabase. O aplicativo é hospedado na infraestrutura da Cloudflare, que processa as requisições e o envio de arquivos antes de chegarem ao armazenamento.</p>
            <p>3.3. Inteligência Artificial: Para o funcionamento do assistente &quot;Dr. Graxa&quot; e para a leitura automática do CRLV, as mensagens e documentos enviados são processados através da API do Gemini (Google). O processamento é feito de maneira segura, e os seus dados não são utilizados para treinar modelos públicos de IA.</p>
            <p>3.4. Processamento de Pagamentos: Transações financeiras (Planos Plus e Premium) são geridas e processadas pelo Mercado Pago. O RevisAuto não armazena os dados completos de seu cartão de crédito em seus servidores.</p>
            <p>3.5. Ordens Judiciais: Poderemos compartilhar dados caso sejamos obrigados por lei ou decisão judicial, conforme o Marco Civil da Internet.</p>
            <p>3.6. Transferência Internacional de Dados: Nossos parceiros de nuvem e de inteligência artificial (Supabase, Cloudflare e Google) podem processar ou armazenar dados em servidores localizados fora do Brasil. Esse tratamento segue o disposto no art. 33 da LGPD, com garantias contratuais de proteção equivalente à legislação brasileira.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">4. SEGURANÇA DA INFORMAÇÃO</h4>
            <p>4.1. Criptografia: Utilizamos protocolos de criptografia de ponta a ponta (SSL/TLS) para o tráfego de informações entre o seu dispositivo e nossa nuvem.</p>
            <p>4.2. Proteção: Nossos bancos de dados contam com rigorosos controles de acesso baseados em políticas de segurança modernas.</p>
            <p>4.3. Responsabilidade do Usuário: Mantenha suas credenciais seguras e desconfie de abordagens externas solicitando dados em nome do RevisAuto.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">5. SEUS DIREITOS (LGPD)</h4>
            <p>Como titular dos dados, você tem o direito de:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Confirmar a existência de tratamento de seus dados.</li>
              <li>Acessar e corrigir dados incompletos ou desatualizados a qualquer momento no perfil do app.</li>
              <li>Solicitar a portabilidade dos seus dados a outro fornecedor de serviço.</li>
              <li>Solicitar a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD.</li>
              <li>Obter informação sobre as entidades com as quais o RevisAuto compartilha seus dados (ver seção 3).</li>
              <li>Revogar seu consentimento a qualquer momento e se opor a um tratamento realizado sem consentimento, quando exigido por lei.</li>
              <li>Exclusão (Direito ao Esquecimento): Solicitar a eliminação definitiva e irrevogável de todos os seus dados cadastrais, histórico de veículos e conversas dos nossos servidores, utilizando o botão específico de exclusão de conta dentro das configurações do próprio aplicativo.</li>
            </ul>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">6. TECNOLOGIAS DE RASTREIO E SESSÃO</h4>
            <p>Utilizamos identificadores seguros e tokens de sessão (access tokens) do seu dispositivo móvel exclusivamente para manter o aplicativo logado e funcional durante o uso, melhorando a fluidez da sua experiência.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">7. RETENÇÃO DE DADOS</h4>
            <p>Mantemos seus dados ativos apenas enquanto a sua conta existir para cumprir as finalidades desta política. Caso opte por deletar a conta, os dados serão expurgados dos nossos servidores primários, ressalvada a guarda necessária para o cumprimento de obrigações legais impostas pelo Marco Civil da Internet.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">8. CONTATO E ENCARREGADO DE DADOS (DPO)</h4>
            <p>Para exercer seus direitos, relatar vulnerabilidades ou tirar dúvidas sobre sua privacidade, entre em contato através do e-mail oficial: dev@revisautoapp.com.br.</p>
          </>
        ) : (
          <>
            <h3 className="font-bold text-[--color-revis-gray] mb-2 text-sm">TERMOS E CONDIÇÕES DE USO – PLATAFORMA REVISAUTO</h3>
            <p className="text-[10px] text-[--color-revis-gray] mb-4">{t('legalLastUpdated')}<br/>{t('legalUpdatesNotice')}</p>
            
            <div className="bg-revis-alert-medium/10 border border-revis-alert-medium p-3 rounded-lg mb-4">
              <p className="text-[#ffcc00] font-bold text-[10px]">{t('majorityWarningTitle')}</p>
              <p className="text-[10px] mt-1">O RevisAuto é uma plataforma destinada exclusivamente a usuários maiores de 18 (dezoito) anos. Ao acessar ou utilizar este aplicativo, você declara possuir a idade mínima exigida e plena capacidade civil, compreendendo que a gestão e condução de veículos automotores e elétricos no Brasil requerem maioridade e habilitação legal específica.</p>
            </div>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">1. CADASTRO E SEGURANÇA DE DADOS (CONFORMIDADE LGPD)</h4>
            <p>1.1. Elegibilidade: O Usuário declara ser maior de 18 anos e ser o proprietário ou possuidor legítimo do veículo cadastrado.</p>
            <p>1.2. Veracidade das Informações: O Usuário é o único responsável pela precisão e atualização dos dados inseridos (quilometragem, datas de manutenção, histórico de reparos).</p>
            <p>1.3. Confidencialidade: As credenciais de acesso são pessoais e intransferíveis. O Usuário compromete-se a notificar a administração do RevisAuto imediatamente sobre qualquer uso não autorizado de sua conta.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">2. COMUNIDADE E REDE SOCIAL (DIRETRIZES DE CONDUTA)</h4>
            <p>2.1. Conteúdo Gerado pelo Usuário (UGC): O Usuário concede ao RevisAuto uma licença gratuita e global para exibir conteúdos postados em áreas comuns do app.</p>
            <p>2.2. Proibições: É proibida a publicação de conteúdo difamatório, obsceno, abusivo, ilegal ou propaganda não autorizada (SPAM).</p>
            <p>2.3. Moderação: O RevisAuto reserva-se o direito de remover conteúdos e banir usuários que violem estas diretrizes.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">3. PROPRIEDADE INTELECTUAL E PROTEÇÃO CONTRA PLÁGIO</h4>
            <p>3.1. Propriedade Intelectual: Todo o código-fonte, interface gráfica, prompts e integrações de Inteligência Artificial, identidade visual e a marca RevisAuto são de propriedade exclusiva da desenvolvedora, protegidos pela legislação de direitos autorais e de propriedade intelectual aplicável, incluindo o registro da marca RevisAuto junto ao INPI.</p>
            <p>3.2. Proibição de Plágio: É terminantemente proibida a reprodução total ou parcial da lógica ou design da plataforma.</p>
            <p>3.3. Procedimentos Judiciais: A prática de plágio sujeitará o infrator a procedimentos judiciais nas esferas cível e criminal, incluindo indenizações por danos materiais e lucros cessantes.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">4. PROTOCOLOS DE SEGURANÇA E PREVENÇÃO A FRAUDES</h4>
            <p>4.1. Cuidado com Credenciais: O RevisAuto jamais solicitará sua senha de acesso por telefone, e-mail, SMS ou redes sociais. O compartilhamento de senhas com terceiros é de inteira responsabilidade do Usuário.</p>
            <p>4.2. Canais Oficiais de Cobrança: Todas as transações financeiras e cobranças de assinaturas de planos são processadas exclusivamente através de plataformas verificadas, notadamente pelo sistema integrado do Mercado Pago ou pelas lojas oficiais (App Store e Google Play).</p>
            <p>4.3. Alertas de Golpes: O RevisAuto não realiza cobranças nem solicita pagamentos via WhatsApp, ligações telefônicas, SMS ou links diretos enviados por e-mail.</p>
            <p>4.4. Isenção de Responsabilidade por Engenharia Social: O RevisAuto não se responsabiliza por prejuízos financeiros decorrentes de golpes de terceiros, phishing ou transferências realizadas pelo usuário para contas não oficiais.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">5. ASSINATURAS E PAGAMENTOS</h4>
            <p>5.1. Serviços Premium: O RevisAuto oferece planos de assinatura (como Plus e Premium) para desbloqueio de limites de veículos e maior interação com a inteligência artificial. Estas funcionalidades estão sujeitas a termos de recorrência apresentados no momento da contratação.</p>
            <p>5.2. Reajustes: Alterações de valores serão comunicadas com 30 (trinta) dias de antecedência.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">6. DISPONIBILIDADE E MODIFICAÇÕES</h4>
            <p>6.1. Interrupções de Serviço: O serviço pode sofrer instabilidades técnicas devido a manutenções ou fatores externos em nossos provedores de nuvem.</p>
            <p>6.2. Alteração dos Termos: A continuidade do uso do app após atualizações constitui aceitação dos novos termos.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">7. NATUREZA DO SERVIÇO E ISENÇÃO DE RESPONSABILIDADE</h4>
            <p>7.1. Consultoria via IA (Dr. Graxa): O Usuário reconhece que o assistente virtual &quot;Dr. Graxa&quot; fornece recomendações geradas por Inteligência Artificial com caráter meramente informativo e consultivo.</p>
            <p>7.2. Responsabilidade Técnica: A plataforma, incluindo sua inteligência artificial, não substitui o manual oficial do fabricante, laudos técnicos ou a avaliação presencial de um profissional mecânico qualificado. O RevisAuto não se responsabiliza por danos físicos ou materiais decorrentes da aplicação de sugestões geradas no aplicativo.</p>
            <p>7.3. Dicas de Produtos: A compatibilidade de produtos químicos ou peças automotivas é de inteira responsabilidade do Usuário.</p>

            <h4 className="font-bold text-[--color-revis-gray] mt-4 text-sm">8. FORO E LEGISLAÇÃO APLICÁVEL</h4>
            <p>8.1. Regido pelas leis da República Federativa do Brasil (Marco Civil da Internet e LGPD).</p>
            <p>8.2. Eleito o Foro da Comarca de Vila Velha, Estado do Espírito Santo.</p>
          </>
        )}
      </div>

      <div className="space-y-3 mb-6">
        <label className={`flex items-center gap-3 cursor-pointer transition-opacity duration-300 ${hasScrolledTerms ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${acceptedTerms ? 'bg-[#34a06a] border-[#34a06a]' : 'border-revis-gray'}`}>
            {acceptedTerms && <Check className="w-3 h-3 text-black" />}
          </div>
          <input
            type="checkbox"
            className="hidden"
            checked={acceptedTerms}
            onChange={() => {
              const next = !acceptedTerms;
              setAcceptedTerms(next);
              // Ao aceitar os Termos, leva o usuário automaticamente para a Política de Privacidade.
              if (next && activeTermsTab === 'terms') {
                setActiveTermsTab('privacy');
                if (termsContentRef.current) termsContentRef.current.scrollTop = 0;
              }
            }}
          />
          <span className="text-xs text-[--color-text]">{t('readAndAcceptTerms')} <span className="text-[#34a06a] font-bold">{t('terms')}</span></span>
        </label>
        
        <label className={`flex items-center gap-3 cursor-pointer transition-opacity duration-300 ${hasScrolledPrivacy ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${acceptedPrivacy ? 'bg-[#34a06a] border-[#34a06a]' : 'border-revis-gray'}`}>
            {acceptedPrivacy && <Check className="w-3 h-3 text-black" />}
          </div>
          <input type="checkbox" className="hidden" checked={acceptedPrivacy} onChange={() => setAcceptedPrivacy(!acceptedPrivacy)} />
          <span className="text-xs text-[--color-text]">{t('readAndAcceptPrivacy')} <span className="text-[#34a06a] font-bold">{t('privacy')}</span></span>
        </label>
      </div>
      
      {((activeTermsTab === 'terms' && !hasScrolledTerms) || (activeTermsTab === 'privacy' && !hasScrolledPrivacy)) && (
        <p className="text-[11px] text-center text-[#ffcc00] font-bold mb-2 animate-pulse">{t('scrollDown')}</p>
      )}

      <div className="flex gap-4">
        <button 
          onClick={() => setAuthScreen('register')}
          className="flex-1 glass text-gray-500 font-bold py-3 rounded-xl hover:bg-white/8 transition-colors text-sm"
        >
          &lt; {t('back')}
        </button>
        <button 
          onClick={confirmRegister} 
          disabled={!acceptedTerms || !acceptedPrivacy}
          className="flex-1 bg-[#34a06a] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm"
        >
          {t('next')}
        </button>
      </div>
      <Footer showHelp />
    </div>
  );

  const renderSuccess = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-black text-center">
      <h1 className="text-2xl font-bold text-[--color-heading] font-display mb-2">{t('accountCreated')}</h1>
      <p className="text-gray-500 mb-8 max-w-xs text-xs">
        {t('journeyBegins')}
      </p>
      <button 
        onClick={() => { setAuthScreen('app'); setMileageInput(''); setShowAddVehicle(true); }}
        className="w-full max-w-sm bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors text-sm mb-3"
      >
        {t('addVehicle')}
      </button>
      <button 
        onClick={() => { setAuthScreen('app'); setActiveTab('garage'); }}
        className="w-full max-w-sm glass text-[--color-heading] font-display font-bold py-3 rounded-xl hover:bg-white/8 transition-colors text-sm"
      >
        {t('goToGarage')}
      </button>
      <p className="text-xs text-[--color-revis-gray] mt-4">
        {t('manageFree')} <span className="text-[#34a06a] font-bold cursor-pointer">{t('viewPlans')}</span>
      </p>
      <Footer />
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-4 pb-24">
      <div className="glass rounded-2xl p-6 border border-white/12">
        <h2 className="text-xl font-bold text-[--color-heading] font-display mb-2">{t('welcomeUser')} {user?.nickname || user?.name?.split(' ')[0]}!</h2>
        <p className="text-[--color-revis-gray] text-sm">
          {t('vehiclesRegistered').replace('{count}', vehicles.length.toString()).replace(/{s}/g, vehicles.length !== 1 ? 's' : '')}
        </p>
        <div className="mt-4 flex gap-2">
          <button 
            onClick={() => setActiveTab('garage')}
            className="bg-[#34a06a] text-black font-bold py-2 px-4 rounded-xl text-sm hover:bg-opacity-90 transition-colors"
          >
            {t('goToGarage')}
          </button>
          <button 
            type="button"
            onClick={() => {
              setActiveTab('advisor');
              setDrGraxaUIMode('list');
              setShowDrGraxaManualModal(false);
              setCurrentSessionId(null);
              setChatMessages([]);
              setAiPrompt('');
            }}
            className="glass border border-white/18 text-white font-bold py-2 px-4 rounded-xl text-sm hover:bg-white/8 transition-colors"
          >
            {t('talkToDrGraxa')}
          </button>
        </div>
      </div>
    </div>
  );

  const [vehicleSearch, setVehicleSearch] = useState('');

  const renderMenu = () => (
    <div className="space-y-4 animate-in fade-in duration-300">
      <h2 className="text-2xl font-bold text-[--color-heading] font-display mb-6">{t('menu')}</h2>
      
      <div className="glass rounded-xl p-4 flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-full bg-[--color-bg] border border-[--color-border] flex items-center justify-center text-[#34a06a] font-bold text-xl">
          {user?.name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
        <div>
          <h3 className="font-bold text-[--color-heading] font-display">{user?.name}</h3>
          <p className="text-sm text-[--color-revis-gray]">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-3">
        <button 
          onClick={() => setShowProfileEdit(true)}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <UserIcon className="w-5 h-5 text-[#34a06a]" />
            <span className="font-medium">{t('profileData')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>

        <button 
          type="button"
          onClick={() => { 
            if (isPlusOrPremium(user?.plan)) {
              setActiveTab('advisor');
              setDrGraxaUIMode('list');
              setShowDrGraxaManualModal(false);
              setCurrentSessionId(null);
              setChatMessages([]);
              setAiPrompt('');
              setShowChatTrash(true);
              void fetchChatTrash();
            } else {
              setShowUpgradeModal(true);
            }
          }}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-[#34a06a]" />
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('chatHistory')}</span>
              <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="xs" />
            </div>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (isPremiumPlan(user?.plan)) setShowVehicleHistory(true);
            else setShowUpgradeModal(true);
          }}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-[#34a06a]" />
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('vehicleHistory')}</span>
              <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="xs" />
            </div>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>

        <button 
          onClick={() => setShowUpgradeModal(true)}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="sm" />
            <span className="font-medium">{isPlusOrPremium(user?.plan) ? t('managePlan') : t('plans')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>

        <button
          type="button"
          onClick={() => { setSupportMethod(null); setIsSupportModalOpen(true); }}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-[#34a06a]" />
            <span className="font-medium">{t('support')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>

        <button 
          onClick={() => setShowTermsModal(true)}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-[#34a06a]" />
            <span className="font-medium">{t('terms')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>

        <button 
          onClick={() => setShowPrivacyModal(true)}
          className="w-full glass p-4 rounded-xl flex justify-between items-center text-[--color-heading] font-display hover:bg-white/8 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-[#34a06a]" />
            <span className="font-medium">{t('privacy')}</span>
          </div>
          <ChevronLeft className="w-5 h-5 rotate-180 text-[--color-revis-gray]" />
        </button>
      </div>

      <button 
        onClick={() => {
          resetSensitiveSessionState();
          localStorage.removeItem('revis_user');
          setUser(null);
          setAuthScreen('login');
          setActiveTab('garage');
        }}
        className="w-full glass p-4 rounded-xl flex justify-between items-center text-[#e0473f] hover:bg-white/8 transition-colors mt-8"
      >
        <span className="font-medium">{t('logout')}</span>
      </button>

      <div className="mt-8">
        <Footer />
      </div>
    </div>
  );

  const renderPreferences = () => (
    <div className="space-y-4 animate-in fade-in duration-300 pb-20">
      <h2 className="text-2xl font-bold text-[--color-heading] font-display mb-6">{t('preferences')}</h2>
      
      <div className="space-y-6">
        {/* Theme */}
        <div className="glass p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
            <Paintbrush className="w-5 h-5 text-[#34a06a]" />
            {t('themeLabel')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => applyThemeImmediate('dark')}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${tempTheme === 'dark' ? 'bg-[#34a06a] text-black border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
            >
              {t('darkTheme')}
            </button>
            <button
              onClick={() => applyThemeImmediate('light')}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${tempTheme === 'light' ? 'bg-[#34a06a] text-black border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
            >
              {t('lightTheme')}
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="glass p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#34a06a]" />
            {t('languageLabel')}
          </h3>
          <div className="space-y-2">
            {Object.keys(translations).map((lang) => (
              <button
                key={lang}
                onClick={() => applyLanguageImmediate(lang)}
                className={`w-full p-3 rounded-lg border text-sm font-medium transition-colors flex justify-between items-center ${tempLanguage === lang ? 'bg-[#34a06a]/10 text-[#34a06a] border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
              >
                {lang}
                {tempLanguage === lang && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div className="glass p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
            <Type className="w-5 h-5 text-[#34a06a]" />
            {t('fontSizeLabel')}
          </h3>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[--color-revis-gray]">A</span>
            <input
              type="range"
              min="0"
              max="4"
              step="1"
              value={tempFontSize}
              onChange={(e) => applyFontSizeImmediate(parseInt(e.target.value))}
              className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-revis-green"
              style={{ background: theme === 'light' ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.18)' }}
            />
            <span className="text-xl text-[--color-heading] font-display">A</span>
          </div>
          <p className="text-xs text-[--color-revis-gray] text-center">
            {tempFontSize === 0 && t(FONT_SIZE_LABEL_KEYS[0])}
            {tempFontSize === 1 && t(FONT_SIZE_LABEL_KEYS[1])}
            {tempFontSize === 2 && t(FONT_SIZE_LABEL_KEYS[2])}
            {tempFontSize === 3 && t(FONT_SIZE_LABEL_KEYS[3])}
            {tempFontSize === 4 && t(FONT_SIZE_LABEL_KEYS[4])}
          </p>
        </div>

        {/* Date Format */}
        <div className="glass p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[#34a06a]" />
            {t('dateFormatLabel')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${tempDateFormat === 'dd/mm/yyyy' ? 'bg-[#34a06a]/10 text-[#34a06a] border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
            >
              <input
                type="radio"
                name="dateFormat"
                value="dd/mm/yyyy"
                checked={tempDateFormat === 'dd/mm/yyyy'}
                onChange={() => applyDateFormatImmediate('dd/mm/yyyy')}
                className="accent-revis-green"
              />
              <span>{getDateFormatDisplay('dd/mm/yyyy', language)}</span>
            </label>
            <label
              className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${tempDateFormat === 'mm/dd/yyyy' ? 'bg-[#34a06a]/10 text-[#34a06a] border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
            >
              <input
                type="radio"
                name="dateFormat"
                value="mm/dd/yyyy"
                checked={tempDateFormat === 'mm/dd/yyyy'}
                onChange={() => applyDateFormatImmediate('mm/dd/yyyy')}
                className="accent-revis-green"
              />
              <span>{getDateFormatDisplay('mm/dd/yyyy', language)}</span>
            </label>
          </div>
          <p className="text-xs text-[--color-revis-gray]">
            {t('dateFormatPreview')}: <span className="text-[--color-text] font-medium">{formatAppDate(new Date(), tempDateFormat)}</span>
          </p>
        </div>

        {/* Currency */}
        <div className="glass p-4 rounded-xl space-y-4">
          <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#34a06a]" />
            {t('currencyLabel')}
          </h3>
          <CustomSelect value={tempCurrency} onChange={v=>applyCurrencyImmediate(v)} options={CURRENCY_OPTIONS.map(opt=>({"value":opt.code,"label":`${opt.code} — ${currencyLabel(opt.code)}`}))} />
          <p className="text-xs text-[--color-revis-gray]">
            {t('currencyPreview')}: <span className="text-[--color-text] font-medium">{formatAppCurrency(1234.56, tempCurrency, tempLanguage)}</span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4">
          <button 
            onClick={() => setShowPreferencesCancelConfirmation(true)}
            className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/8 transition-colors"
          >
            {t('cancel')}
          </button>
          <button 
            onClick={() => setShowPreferencesSaveConfirmation(true)}
            className="flex-1 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderGarage = () => {
    if (!selectedVehicle) {
      const searchLower = (vehicleSearch || '').toLowerCase();
      const filteredVehicles = vehicles.filter(v => 
        (v.model || '').toLowerCase().includes(searchLower) || 
        (v.brand || '').toLowerCase().includes(searchLower) ||
        (v.nickname || '').toLowerCase().includes(searchLower)
      );

      return (
        <div className="space-y-4 pb-24 md:pb-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-bold text-[--color-heading] font-display flex items-center gap-2">
              {t('garageOf')} {user?.nickname || user?.name?.split(' ')[0]}
              {isPlusOrPremium(user?.plan) && (
                <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="sm" />
              )}
            </h2>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[--color-revis-gray]" />
            <input 
              type="text"
              placeholder={t('searchVehicle')}
              className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl py-3 pl-10 pr-4 text-[--color-text] outline-none transition-colors text-sm"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
            />
          </div>

          <button 
            onClick={() => {
              if (atVehicleLimit) {
                setShowUpgradeModal(true);
              } else {
                setNewVehicle({
                  type: 'Carro',
                  brand: '',
                  model: '',
                  year: new Date().getFullYear(),
                  current_mileage: 0,
                  last_service_date: new Date().toISOString().split('T')[0],
                  nickname: '',
                  color: '',
                  plate: '',
                  document_path: null,
                });
                setCustomBrand('');
                setCustomModel('');
                setCustomColor('');
                setOtherColor('');
                setIsEditingVehicle(false);
                setMileageInput('');
                setCrlvWarnings([]);
                setShowAddVehicle(true);
              }
            }}
            className={`w-full font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 mb-4 ${
              atVehicleLimit 
                ? 'glass text-[--color-revis-gray] cursor-not-allowed border border-[--color-border]' 
                : 'bg-[#34a06a] text-black hover:bg-opacity-90'
            }`}
          >
            {atVehicleLimit ? (
              <>
                <PremiumCrown tooltip={t('vehicleLimitTooltip')} decorative size="sm" />
                {t('addVehicle')}
              </>
            ) : (
              <>
                <Plus className="w-5 h-5" />
                {t('addVehicle')}
              </>
            )}
          </button>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredVehicles.map(vehicle => (
              <div
                key={vehicle.id}
                className="glass rounded-xl p-4 border border-[--color-border] flex items-center gap-4"
              >
                <div className="p-3 bg-black/30 rounded-full flex-shrink-0">
                  {vehicle.type === 'Carro' && <Car className="w-5 h-5 text-[#34a06a]" />}
                  {vehicle.type === 'Moto' && <Bike className="w-5 h-5 text-[#34a06a]" />}
                  {vehicle.type === 'Bike' && <Zap className="w-5 h-5 text-[#34a06a]" />}
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[--color-heading] font-display text-base truncate">
                    {isPlusOrPremium(user?.plan) && vehicle.nickname ? vehicle.nickname : vehicle.model}
                  </h3>
                  <p className="text-xs text-[--color-revis-gray] truncate">
                    {isPlusOrPremium(user?.plan) && vehicle.nickname ? `${vehicle.model} • ` : ''}
                    {vehicle.brand} • {vehicle.year}
                    {isPlusOrPremium(user?.plan) && vehicle.color ? ` • ${colorLabel(vehicle.color)}` : ''}
                    {!(isPlusOrPremium(user?.plan) && (vehicle.nickname || vehicle.color)) ? ` • ${(vehicle.current_mileage || 0).toLocaleString(getLocaleFromLanguage(language))} km` : ''}
                  </p>
                </div>

                <button 
                  onClick={() => {
                    setSelectedVehicle(vehicle);
                    setExpandedCards({ mileage: false, services: false, financial: false });
                  }}
                  className="text-xs text-[#34a06a] font-medium whitespace-nowrap hover:underline"
                >
                  {t('details')} &gt;
                </button>
              </div>
            ))}
          </div>

          {filteredVehicles.length === 0 && (
            <div className="text-center py-10 text-[--color-revis-gray]">
              <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>{vehicles.length === 0 ? t('noVehicles') : t('noVehiclesFound')}</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-6 pb-24 md:pb-4">
        {/* Header with Back Button */}
        <div
          className="flex items-center gap-2 mb-4 sticky top-16 md:top-0 z-10 py-2 vehicle-header-canvas"
        >
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setSelectedVehicle(null);
            }} 
            className="p-2 -ml-2 text-[--color-revis-gray] hover:text-[#34a06a] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-[--color-heading] font-display">{selectedVehicle.brand} {selectedVehicle.model}</h2>
            {isPlusOrPremium(user?.plan) && (selectedVehicle.nickname || selectedVehicle.color) && (
              <p className="text-sm text-[#34a06a] mb-1">
                {selectedVehicle.nickname && <span className="font-medium">{selectedVehicle.nickname}</span>}
                {selectedVehicle.nickname && selectedVehicle.color && <span className="mx-1">•</span>}
                {selectedVehicle.color && <span>{t('colorLabelPrefix')}: {colorLabel(selectedVehicle.color)}</span>}
              </p>
            )}
            <p className="text-sm text-[--color-revis-gray]">{selectedVehicle.year} • {(selectedVehicle.current_mileage || 0).toLocaleString(getLocaleFromLanguage(language))} km</p>
          </div>
          {selectedVehicle.status !== 'archived' && (
            <div className="flex gap-2">
              <input
                id="crlv-header-input"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={isUploadingCrlv}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) void handleVehicleDocUploadFromHeader(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={isUploadingCrlv}
                onClick={() => {
                  if (selectedVehicle.document_path) {
                    void openStorageFile(selectedVehicle.document_path);
                  } else {
                    document.getElementById('crlv-header-input')?.click();
                  }
                }}
                className={`p-2 rounded-lg transition-colors ${
                  selectedVehicle.document_path
                    ? 'text-[#34a06a] hover:bg-[#34a06a]/10'
                    : 'text-[--color-revis-gray] hover:text-[#34a06a] hover:bg-[#34a06a]/10'
                } ${isUploadingCrlv ? 'opacity-50 cursor-wait' : ''}`}
                title={selectedVehicle.document_path ? t('crlvOpenAria') : t('crlvUploadAria')}
              >
                {isUploadingCrlv ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
              </button>
              <button
                type="button"
                disabled={isGeneratingReport}
                onClick={() => void handleExportVehicleReport()}
                className={`p-2 rounded-lg text-[--color-revis-gray] hover:text-[#34a06a] hover:bg-[#34a06a]/10 transition-colors ${isGeneratingReport ? 'opacity-50 cursor-wait' : ''}`}
                title={t('exportReportAria')}
              >
                {isGeneratingReport ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => {
                  setNewVehicle(selectedVehicle);
                  setCustomBrand(selectedVehicle.brand);
                  setCustomModel(selectedVehicle.model);
                  setCustomColor(selectedVehicle.color || '');
                  setOtherColor(selectedVehicle.color || '');
                  setIsEditingVehicle(true);
                  setMileageInput(formatMileageThousandsDots(selectedVehicle.current_mileage ?? 0));
                  setShowAddVehicle(true);
                }}
                className="p-2 text-[--color-revis-gray] hover:text-[#34a06a] hover:bg-[#34a06a]/10 rounded-lg transition-colors"
                title={t('editVehicleAria')}
              >
                <Pencil className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setShowDeleteVehicleModal(true)}
                className="p-2 text-[#e0473f] hover:bg-revis-alert-critical/10 rounded-lg transition-colors"
                title={t('deleteVehicleAria')}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* Fueling History Card */}
        <div className="glass rounded-2xl p-5 border border-[--color-border]">
          <div
            className="flex justify-between items-center cursor-pointer gap-2"
            onClick={() => setExpandedCards(prev => ({ ...prev, mileage: !prev.mileage }))}
          >
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-bold text-[--color-heading] font-display truncate">{t('mileageHistory')}</h3>
              <div
                ref={mileageHelpRef}
                className="relative shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label={t('mileageHelpTooltip')}
                  aria-expanded={showMileageHelp}
                  onClick={() => setShowMileageHelp(prev => !prev)}
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-white/8 text-[--color-revis-gray] text-[11px] font-bold leading-none hover:bg-[#34a06a]/20 hover:text-[#34a06a] transition-colors"
                >
                  ?
                </button>
                {showMileageHelp && (
                  <div
                    role="tooltip"
                    className="absolute left-0 top-full mt-2 z-30 w-[260px] max-w-[calc(100vw-2.5rem)] bg-[--color-bg] border border-[--color-border] rounded-lg p-3 text-xs text-[--color-text] leading-relaxed shadow-lg"
                  >
                    {t('mileageHelpTooltip')}
                  </div>
                )}
              </div>
            </div>
            {expandedCards.mileage ? <ChevronUp className="w-5 h-5 text-[--color-revis-gray] shrink-0" /> : <ChevronDown className="w-5 h-5 text-[--color-revis-gray] shrink-0" />}
          </div>
          
          {expandedCards.mileage && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
              {selectedVehicle.status !== 'archived' && (
                <button 
                  onClick={openCreateMileage}
                  className="w-full bg-[#34a06a]/10 text-[#34a06a] font-medium px-4 py-3 rounded-xl text-sm hover:bg-[#34a06a]/20 transition-colors mb-4 text-left"
                >
                  {t('addLog')}
                </button>
              )}

              <div className="mb-4 relative">
                <button
                  onClick={toggleDateFilters}
                  className="flex items-center gap-2 text-xs text-[--color-revis-gray] hover:text-[#34a06a] transition-colors mb-2"
                >
                  <Calendar className="w-4 h-4" />
                  {t('filterByDate')}
                  {showDateFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showDateFilters && (
                  <div className="glass animate-in fade-in slide-in-from-top-2 duration-200 absolute z-30 top-full mt-2 left-0 rounded-xl p-3 w-[17.5rem] shadow-xl">
                    <div
                      className={`flex flex-col gap-2 ${isFreePlan(user?.plan) ? 'opacity-[0.38] pointer-events-none' : ''}`}
                      aria-hidden={isFreePlan(user?.plan)}
                    >
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[10px] text-[--color-revis-gray] mb-1 block">{t('dateStartLabel')}</label>
                          <LocalizedDateInput
                            dateFormat={dateFormat}
                            locale={getLocaleFromLanguage(language)}
                            value={mileageFilterDate.start}
                            onChange={handleMileageStartChange}
                            ariaLabel={t('dateStartLabel')}
                            className="w-full input-glass text-[11px] px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[--color-revis-gray] mb-1 block">{t('dateEndLabel')}</label>
                          <LocalizedDateInput
                            dateFormat={dateFormat}
                            locale={getLocaleFromLanguage(language)}
                            value={mileageFilterDate.end}
                            onChange={handleMileageEndChange}
                            ariaLabel={t('dateEndLabel')}
                            className="w-full input-glass text-[11px] px-2 py-1.5"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleMileageFilterClear}
                        disabled={!mileageFilterDate.start && !mileageFilterDate.end}
                        className="self-end ml-auto flex items-center gap-1 text-[11px] font-medium text-red-500 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                        {t('clear')}
                      </button>
                    </div>
                    {isFreePlan(user?.plan) && (
                      <div className="absolute inset-0 z-10 rounded-lg bg-[--color-bg]/75 border border-[--color-border] flex flex-col items-center justify-center gap-2 p-4 text-center">
                        <PremiumCrown
                          tooltip={t('premiumCrownTooltip')}
                          onOpenPlans={() => setShowUpgradeModal(true)}
                          size="lg"
                        />
                        <p className="text-[11px] text-[--color-text] leading-snug max-w-[14rem]">{t('filtersUpgradeHint')}</p>
                        <button
                          type="button"
                          onClick={() => setShowUpgradeModal(true)}
                          className="text-xs font-bold text-[#34a06a] underline decoration-revis-green/40 hover:text-[#34a06a]/90"
                        >
                          {t('plans')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="hidden sm:grid sm:grid-cols-5 sm:gap-1 sm:text-xs text-[--color-revis-gray] font-medium pl-1 pr-12 text-center">
                  <span>{t('date')}</span>
                  <span>{t('value')}</span>
                  <span>{t('litersLabel')}</span>
                  <span>{t('km')}</span>
                  <span>{t('kmPerLiter')}</span>
                </div>

                {(() => {
                  const allLogs = selectedVehicle.mileage_history || [];

                  // Ordenamos cronologicamente do mais antigo para o mais novo para
                  // calcular o KM/L: rendimento depende do log anterior (mais antigo).
                  // Empates de data são desempatados por id numérico crescente.
                  const chronological = [...allLogs].sort((a, b) => {
                    const da = new Date(a.date).getTime();
                    const db = new Date(b.date).getTime();
                    if (da !== db) return da - db;
                    const ia = Number(a.id ?? 0);
                    const ib = Number(b.id ?? 0);
                    return ia - ib;
                  });

                  // id (ou chave estável) -> rendimento e flag de "registro inicial"
                  const efficiencyByKey = new Map<string, { kmPerLiter: number | null; isInitial: boolean }>();
                  chronological.forEach((log, idx) => {
                    const key = log.id ? String(log.id) : `${log.date}-${log.mileage}-${idx}`;
                    if (idx === 0) {
                      efficiencyByKey.set(key, { kmPerLiter: null, isInitial: true });
                      return;
                    }
                    const prev = chronological[idx - 1];
                    const liters = Number(log.litros);
                    if (!Number.isFinite(liters) || liters <= 0) {
                      efficiencyByKey.set(key, { kmPerLiter: null, isInitial: false });
                      return;
                    }
                    const deltaKm = Number(log.mileage) - Number(prev.mileage);
                    if (!Number.isFinite(deltaKm) || deltaKm <= 0) {
                      efficiencyByKey.set(key, { kmPerLiter: null, isInitial: false });
                      return;
                    }
                    efficiencyByKey.set(key, { kmPerLiter: deltaKm / liters, isInitial: false });
                  });

                  let displayLogs = allLogs;
                  if (activeMileageFilter && (activeMileageFilter.start || activeMileageFilter.end)) {
                    const startIso = activeMileageFilter.start;
                    const endIso = activeMileageFilter.end;
                    displayLogs = displayLogs.filter(log => {
                      const d = String(log.date || '');
                      if (startIso && d < startIso) return false;
                      if (endIso && d > endIso) return false;
                      return true;
                    });
                  }

                  const hasMore = displayLogs.length > mileageLimit;
                  const paginatedLogs = displayLogs.slice(0, mileageLimit);

                  return (
                    <>
                      {paginatedLogs.map((log, index) => {
                        const stableKey = log.id ? String(log.id) : `${log.date}-${log.mileage}-${index}`;
                        const eff = efficiencyByKey.get(stableKey) ?? { kmPerLiter: null, isInitial: false };

                        const valorText = log.valor !== null && log.valor !== undefined
                          ? formatAppCurrency(Number(log.valor), currency, language)
                          : '-';
                        const litrosText = log.litros !== null && log.litros !== undefined
                          ? `${formatDecimal(Number(log.litros), language, 2)} ${t('litersShort')}`
                          : '-';
                        const kmText = (log.mileage || 0).toLocaleString(getLocaleFromLanguage(language));
                        const kmPerLiterText = eff.isInitial
                          ? t('initialRecord')
                          : eff.kmPerLiter !== null
                          ? `${formatDecimal(eff.kmPerLiter, language, 1)} km/l`
                          : '-';

                        return (
                          <div key={stableKey} className="relative border-b border-[--color-border] last:border-0 py-3.5 pr-14 group">
                            {/* Mobile: cartão empilhado, com data/valor em destaque e os 3 dados secundários num mini-grid com rótulo próprio */}
                            <div className="sm:hidden pl-1 space-y-2.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold text-[--color-text]">{formatAppDate(log.date, dateFormat)}</span>
                                <span className="text-sm font-semibold text-[--color-text] break-words text-right">{valorText}</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="text-[9px] uppercase tracking-wide text-[--color-revis-gray]/70">{t('litersLabel')}</span>
                                  <span className="text-xs font-medium text-[--color-text] truncate">{litrosText}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="text-[9px] uppercase tracking-wide text-[--color-revis-gray]/70">{t('km')}</span>
                                  <span className="text-xs font-medium text-[--color-text] truncate">{kmText}</span>
                                </div>
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="text-[9px] uppercase tracking-wide text-[--color-revis-gray]/70">{t('kmPerLiter')}</span>
                                  <span className="text-xs font-medium text-[--color-text] truncate">{kmPerLiterText}</span>
                                </div>
                              </div>
                            </div>
                            {/* sm e acima: grade original em colunas */}
                            <div className="hidden sm:grid sm:grid-cols-5 sm:gap-1 sm:text-xs sm:pl-1 sm:text-center sm:items-center">
                              <span className="text-[--color-text] break-words">{formatAppDate(log.date, dateFormat)}</span>
                              <span className="text-[--color-text] break-words">{valorText}</span>
                              <span className="text-[--color-text] break-words">{litrosText}</span>
                              <span className="text-[--color-text] break-words">{kmText}</span>
                              <span className="text-[--color-text] break-words">{kmPerLiterText}</span>
                            </div>
                            <div className="absolute right-1 top-3.5 -translate-y-0 sm:top-1/2 sm:-translate-y-1/2 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openViewRecord({ kind: 'mileage', data: log })}
                                aria-label={t('viewRecordAria')}
                                className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => { if (log.attachment_path) void openStorageFile(log.attachment_path); }}
                                aria-label={t('attachmentOpenAria')}
                                disabled={!log.attachment_path}
                                className={`p-1 transition-colors ${
                                  log.attachment_path
                                    ? 'text-[#34a06a] hover:text-[#2d8f5d] cursor-pointer'
                                    : 'text-gray-600 cursor-default'
                                }`}
                              >
                                <Paperclip className="w-4 h-4" />
                              </button>
                              {log.id && (
                                <button
                                  type="button"
                                  onClick={() => openEditMileage(log)}
                                  aria-label={t('editFuelingTitle')}
                                  className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {displayLogs.length === 0 && (
                         <div className="text-center text-xs text-[--color-revis-gray] py-2">{t('noRecords')}</div>
                      )}

                      {hasMore && (
                        <button
                          onClick={() => setMileageLimit(prev => prev + 3)}
                          className="mx-auto mt-3 flex items-center justify-center gap-1 px-4 py-2 rounded-full border border-[#34a06a]/40 bg-[#34a06a]/10 text-xs text-[#34a06a] font-medium hover:bg-[#34a06a]/20 hover:border-[#34a06a] transition-colors"
                        >
                          {t('seeMore')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Summary Panel - rodapé unificado com Valor total, Litros e Km rodados */}
              {(() => {
                const allLogs = selectedVehicle.mileage_history || [];
                let footerLogs = allLogs;
                if (activeMileageFilter && (activeMileageFilter.start || activeMileageFilter.end)) {
                  const startIso = activeMileageFilter.start;
                  const endIso = activeMileageFilter.end;
                  footerLogs = footerLogs.filter(log => {
                    const d = String(log.date || '');
                    if (startIso && d < startIso) return false;
                    if (endIso && d > endIso) return false;
                    return true;
                  });
                }
                if (footerLogs.length === 0) return null;
                const totalValue = footerLogs.reduce((acc, log) => acc + (Number(log.valor) || 0), 0);
                const totalLiters = footerLogs.reduce((acc, log) => acc + (Number(log.litros) || 0), 0);
                const mileages = footerLogs.map(l => Number(l.mileage) || 0);
                const totalKm = Math.max(...mileages) - Math.min(...mileages);
                return (
                  <div className="-mx-5 -mb-5 mt-4 px-4 py-3 bg-black/30 border-t border-[--color-border] rounded-b-2xl">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[10px] text-[--color-revis-gray] uppercase tracking-wider mb-0.5">{t('totalValue')}</div>
                        <div className="text-[--color-heading] font-display font-bold text-xs sm:text-sm break-words">
                          {formatAppCurrency(totalValue, currency, language)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[--color-revis-gray] uppercase tracking-wider mb-0.5">{t('totalLiters')}</div>
                        <div className="text-[--color-heading] font-display font-bold text-xs sm:text-sm break-words">
                          {`${formatDecimal(totalLiters, language, 2)} ${t('litersShort')}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[--color-revis-gray] uppercase tracking-wider mb-0.5">{t('kmDriven')}</div>
                        <div className="text-[--color-heading] font-display font-bold text-xs sm:text-sm break-words">
                          {`${totalKm.toLocaleString(getLocaleFromLanguage(language))} km`}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Service History Card */}
        <div className="glass rounded-2xl p-5 border border-[--color-border]">
          <div 
            className="flex justify-between items-center cursor-pointer" 
            onClick={() => setExpandedCards(prev => ({ ...prev, services: !prev.services }))}
          >
            <h3 className="font-bold text-[--color-heading] font-display">{t('serviceHistory')}</h3>
            {expandedCards.services ? <ChevronUp className="w-5 h-5 text-[--color-revis-gray]" /> : <ChevronDown className="w-5 h-5 text-[--color-revis-gray]" />}
          </div>

          {expandedCards.services && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
              {selectedVehicle.status !== 'archived' && (
                <button 
                  onClick={openCreateLog}
                  className="w-full bg-[#34a06a]/10 text-[#34a06a] font-medium px-4 py-3 rounded-xl text-sm hover:bg-[#34a06a]/20 transition-colors mb-4 text-left"
                >
                  {t('addLog')}
                </button>
              )}

              <div className="mb-4 relative">
                <button
                  onClick={toggleDateFilters}
                  className="flex items-center gap-2 text-xs text-[--color-revis-gray] hover:text-[#34a06a] transition-colors mb-2"
                >
                  <Calendar className="w-4 h-4" />
                  {t('filterByDate')}
                  {showDateFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showDateFilters && (
                  <div className="glass animate-in fade-in slide-in-from-top-2 duration-200 absolute z-30 top-full mt-2 left-0 rounded-xl p-3 w-[17.5rem] shadow-xl">
                    <div
                      className={`flex flex-col gap-2 ${isFreePlan(user?.plan) ? 'opacity-[0.38] pointer-events-none' : ''}`}
                      aria-hidden={isFreePlan(user?.plan)}
                    >
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[10px] text-[--color-revis-gray] mb-1 block">{t('dateStartLabel')}</label>
                          <LocalizedDateInput
                            dateFormat={dateFormat}
                            locale={getLocaleFromLanguage(language)}
                            value={servicesFilterDate.start}
                            onChange={handleServicesStartChange}
                            ariaLabel={t('dateStartLabel')}
                            className="w-full input-glass text-[11px] px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[--color-revis-gray] mb-1 block">{t('dateEndLabel')}</label>
                          <LocalizedDateInput
                            dateFormat={dateFormat}
                            locale={getLocaleFromLanguage(language)}
                            value={servicesFilterDate.end}
                            onChange={handleServicesEndChange}
                            ariaLabel={t('dateEndLabel')}
                            className="w-full input-glass text-[11px] px-2 py-1.5"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleServicesFilterClear}
                        disabled={!servicesFilterDate.start && !servicesFilterDate.end}
                        className="self-end ml-auto flex items-center gap-1 text-[11px] font-medium text-red-500 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                        {t('clear')}
                      </button>
                    </div>
                    {isFreePlan(user?.plan) && (
                      <div className="absolute inset-0 z-10 rounded-lg bg-[--color-bg]/75 border border-[--color-border] flex flex-col items-center justify-center gap-2 p-4 text-center">
                        <PremiumCrown
                          tooltip={t('premiumCrownTooltip')}
                          onOpenPlans={() => setShowUpgradeModal(true)}
                          size="lg"
                        />
                        <p className="text-[11px] text-[--color-text] leading-snug max-w-[14rem]">{t('filtersUpgradeHint')}</p>
                        <button
                          type="button"
                          onClick={() => setShowUpgradeModal(true)}
                          className="text-xs font-bold text-[#34a06a] underline decoration-revis-green/40 hover:text-[#34a06a]/90"
                        >
                          {t('plans')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="hidden sm:grid sm:grid-cols-4 sm:text-xs text-[--color-revis-gray] font-medium pl-2 pr-16 gap-2 text-center">
                  <span>{t('date')}</span>
                  <span>{t('service')}</span>
                  <span>{t('responsible')}</span>
                  <span>{t('value')}</span>
                </div>

                {(() => {
                  let displayLogs = logs;

                  if (activeServicesFilter && (activeServicesFilter.start || activeServicesFilter.end)) {
                    const startIso = activeServicesFilter.start;
                    const endIso = activeServicesFilter.end;
                    displayLogs = displayLogs.filter(log => {
                      const d = String(log.date || '');
                      if (startIso && d < startIso) return false;
                      if (endIso && d > endIso) return false;
                      return true;
                    });
                  }

                  const hasMore = displayLogs.length > servicesLimit;
                  const paginatedLogs = displayLogs.slice(0, servicesLimit);

                  return (
                    <>
                      {paginatedLogs.map(log => {
                        const valorText = formatAppCurrency(log.cost, currency, language);
                        return (
                        <div key={log.id} className="relative border-b border-[--color-border] last:border-0 py-3.5 pr-16 group">
                          <div className="sm:hidden pl-2 pr-2 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[--color-text] text-xs">{formatAppDate(log.date, dateFormat)}</span>
                              <span className="text-[#34a06a] text-sm font-semibold">{valorText}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[--color-text] text-sm font-medium truncate" title={log.description}>{log.description}</p>
                              {log.provider ? (
                                <p className="text-[--color-revis-gray] text-[11px] truncate mt-0.5" title={log.provider}>{t('responsible')}: {log.provider}</p>
                              ) : null}
                            </div>
                          </div>
                          <div className="hidden sm:grid sm:grid-cols-4 text-sm pl-2 gap-2 items-center text-center">
                            <span className="text-[--color-text] text-xs">{formatAppDate(log.date, dateFormat)}</span>
                            <span className="text-[--color-text] truncate" title={log.description}>{log.description}</span>
                            <span className="text-[--color-text] truncate" title={log.provider || '-'}>{log.provider || '-'}</span>
                            <span className="text-[#34a06a] text-xs">{valorText}</span>
                          </div>
                          <div className="absolute right-2 top-3.5 -translate-y-0 sm:top-1/2 sm:-translate-y-1/2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openViewRecord({ kind: 'maintenance', data: log })}
                              aria-label={t('viewRecordAria')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { if (log.attachment_path) void openStorageFile(log.attachment_path); }}
                              aria-label={t('attachmentOpenAria')}
                              disabled={!log.attachment_path}
                              className={`p-1 transition-colors ${
                                log.attachment_path
                                  ? 'text-[#34a06a] hover:text-[#2d8f5d] cursor-pointer'
                                  : 'text-gray-600 cursor-default'
                              }`}
                            >
                              <Paperclip className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditLog(log)}
                              aria-label={t('editMaintenanceTitle')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        );
                      })}

                      {displayLogs.length === 0 && (
                        <div className="text-center text-xs text-[--color-revis-gray] py-2">{t('noRecords')}</div>
                      )}

                      {hasMore && (
                        <button 
                          onClick={() => setServicesLimit(prev => prev + 3)}
                          className="mx-auto mt-3 flex items-center justify-center gap-1 px-4 py-2 rounded-full border border-[#34a06a]/40 bg-[#34a06a]/10 text-xs text-[#34a06a] font-medium hover:bg-[#34a06a]/20 hover:border-[#34a06a] transition-colors"
                        >
                          {t('seeMore')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Summary Panel - rodapé unificado com Valor total */}
              {(() => {
                let footerLogs = logs;
                if (activeServicesFilter && (activeServicesFilter.start || activeServicesFilter.end)) {
                  const startIso = activeServicesFilter.start;
                  const endIso = activeServicesFilter.end;
                  footerLogs = footerLogs.filter(log => {
                    const d = String(log.date || '');
                    if (startIso && d < startIso) return false;
                    if (endIso && d > endIso) return false;
                    return true;
                  });
                }
                if (footerLogs.length === 0) return null;
                const totalValue = footerLogs.reduce((acc, log) => acc + (Number(log.cost) || 0), 0);
                return (
                  <div className="-mx-5 -mb-5 mt-4 px-4 py-3 bg-black/30 border-t border-[--color-border] rounded-b-2xl">
                    <div className="grid grid-cols-1 gap-2 text-center">
                      <div>
                        <div className="text-[10px] text-[--color-revis-gray] uppercase tracking-wider mb-0.5">{t('totalValue')}</div>
                        <div className="text-[--color-heading] font-display font-bold text-xs sm:text-sm break-words">
                          {formatAppCurrency(totalValue, currency, language)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Financial Records Card */}
        <div className={`glass rounded-2xl p-5 border ${isFreePlan(user?.plan) ? 'border-[--color-border] opacity-75' : 'border-[--color-border]'}`}>
          <div 
            className="flex justify-between items-center cursor-pointer" 
            onClick={() => {
              if (isFreePlan(user?.plan)) {
                setShowUpgradeModal(true);
              } else {
                setExpandedCards(prev => ({ ...prev, financial: !prev.financial }));
              }
            }}
          >
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[--color-heading] font-display">{t('financialSectionTitle')}</h3>
              <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="xs" />
            </div>
            {isPlusOrPremium(user?.plan) && (
              expandedCards.financial ? <ChevronUp className="w-5 h-5 text-[--color-revis-gray]" /> : <ChevronDown className="w-5 h-5 text-[--color-revis-gray]" />
            )}
          </div>

          {isFreePlan(user?.plan) && (
            <div className="mt-2 text-xs text-[#34a06a] font-medium flex items-center gap-1">
              {t('plansUnlockFinancial')}
            </div>
          )}

          {expandedCards.financial && isPlusOrPremium(user?.plan) && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-200">
              {selectedVehicle.status !== 'archived' && (
                <button 
                  onClick={openCreateFinancial}
                  className="w-full bg-[#34a06a]/10 text-[#34a06a] font-medium px-4 py-3 rounded-xl text-sm hover:bg-[#34a06a]/20 transition-colors mb-4 text-left"
                >
                  {t('addLog')}
                </button>
              )}

              <div className="mb-4 relative">
                <button
                  onClick={toggleDateFilters}
                  className="flex items-center gap-2 text-xs text-[--color-revis-gray] hover:text-[#34a06a] transition-colors mb-2"
                >
                  <Calendar className="w-4 h-4" />
                  {t('filterByDate')}
                  {showDateFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showDateFilters && (
                  <div className="glass animate-in fade-in slide-in-from-top-2 duration-200 absolute z-30 top-full mt-2 left-0 rounded-xl p-3 w-[17.5rem] shadow-xl">
                    <div
                      className={`flex flex-col gap-2 ${isFreePlan(user?.plan) ? 'opacity-[0.38] pointer-events-none' : ''}`}
                      aria-hidden={isFreePlan(user?.plan)}
                    >
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[10px] text-[--color-revis-gray] mb-1 block">{t('dateStartLabel')}</label>
                          <LocalizedDateInput
                            dateFormat={dateFormat}
                            locale={getLocaleFromLanguage(language)}
                            value={financialFilterDate.start}
                            onChange={handleFinancialStartChange}
                            ariaLabel={t('dateStartLabel')}
                            className="w-full input-glass text-[11px] px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[--color-revis-gray] mb-1 block">{t('dateEndLabel')}</label>
                          <LocalizedDateInput
                            dateFormat={dateFormat}
                            locale={getLocaleFromLanguage(language)}
                            value={financialFilterDate.end}
                            onChange={handleFinancialEndChange}
                            ariaLabel={t('dateEndLabel')}
                            className="w-full input-glass text-[11px] px-2 py-1.5"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleFinancialFilterClear}
                        disabled={!financialFilterDate.start && !financialFilterDate.end}
                        className="self-end ml-auto flex items-center gap-1 text-[11px] font-medium text-red-500 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-red-500"
                      >
                        <X className="w-3.5 h-3.5" />
                        {t('clear')}
                      </button>
                    </div>
                    {isFreePlan(user?.plan) && (
                      <div className="absolute inset-0 z-10 rounded-lg bg-[--color-bg]/75 border border-[--color-border] flex flex-col items-center justify-center gap-2 p-4 text-center">
                        <PremiumCrown
                          tooltip={t('premiumCrownTooltip')}
                          onOpenPlans={() => setShowUpgradeModal(true)}
                          size="lg"
                        />
                        <p className="text-[11px] text-[--color-text] leading-snug max-w-[14rem]">{t('filtersUpgradeHint')}</p>
                        <button
                          type="button"
                          onClick={() => setShowUpgradeModal(true)}
                          className="text-xs font-bold text-[#34a06a] underline decoration-revis-green/40 hover:text-[#34a06a]/90"
                        >
                          {t('plans')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="hidden sm:grid sm:grid-cols-4 sm:text-xs text-[--color-revis-gray] font-medium pl-2 pr-16 gap-2 text-center">
                  <span>{t('dueDateLabel')}</span>
                  <span>{t('descriptionLabel')}</span>
                  <span>{t('statusLabel')}</span>
                  <span>{t('value')}</span>
                </div>

                {(() => {
                  let displayRecords = financialRecords;

                  if (activeFinancialFilter && (activeFinancialFilter.start || activeFinancialFilter.end)) {
                    const startIso = activeFinancialFilter.start;
                    const endIso = activeFinancialFilter.end;
                    displayRecords = displayRecords.filter(rec => {
                      const d = String(rec.due_date || '');
                      if (startIso && d < startIso) return false;
                      if (endIso && d > endIso) return false;
                      return true;
                    });
                  }

                  const hasMore = displayRecords.length > financialLimit;
                  const paginatedRecords = displayRecords.slice(0, financialLimit);

                  return (
                    <>
                      {paginatedRecords.map(rec => {
                        const statusClass = rec.status === 'Pago' ? 'text-[#34a06a]' : rec.status === 'Atrasado' ? 'text-[#e0473f]' : 'text-[#ffcc00]';
                        const statusLabelText = financialStatusLabel(rec.status);
                        const valorText = formatAppCurrency(rec.value, currency, language);
                        return (
                        <div key={rec.id} className="relative border-b border-[--color-border] last:border-0 py-3.5 pr-16 group">
                          <div className="sm:hidden pl-2 pr-2 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[--color-text] text-xs">{formatAppDate(rec.due_date, dateFormat)}</span>
                              <span className="text-[#34a06a] text-sm font-semibold">{valorText}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <p className="text-[--color-text] text-sm font-medium truncate" title={rec.description}>{rec.description}</p>
                              <span className={`text-[11px] font-medium shrink-0 ${statusClass}`}>{statusLabelText}</span>
                            </div>
                          </div>
                          <div className="hidden sm:grid sm:grid-cols-4 text-sm pl-2 gap-2 items-center text-center">
                            <span className="text-[--color-text] text-xs">{formatAppDate(rec.due_date, dateFormat)}</span>
                            <span className="text-[--color-text] truncate" title={rec.description}>{rec.description}</span>
                            <span className={`text-xs ${statusClass}`}>{statusLabelText}</span>
                            <span className="text-[#34a06a] text-xs">{valorText}</span>
                          </div>
                          <div className="absolute right-2 top-3.5 -translate-y-0 sm:top-1/2 sm:-translate-y-1/2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openViewRecord({ kind: 'financial', data: rec })}
                              aria-label={t('viewRecordAria')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { if (rec.attachment_path) void openStorageFile(rec.attachment_path); }}
                              aria-label={t('attachmentOpenAria')}
                              disabled={!rec.attachment_path}
                              className={`p-1 transition-colors ${
                                rec.attachment_path
                                  ? 'text-[#34a06a] hover:text-[#2d8f5d] cursor-pointer'
                                  : 'text-gray-600 cursor-default'
                              }`}
                            >
                              <Paperclip className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditFinancial(rec)}
                              aria-label={t('editFinancialTitle')}
                              className="p-1 text-gray-400 hover:text-gray-200 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        );
                      })}

                      {displayRecords.length === 0 && (
                        <div className="text-center text-xs text-[--color-revis-gray] py-2">{t('noRecords')}</div>
                      )}

                      {hasMore && (
                        <button 
                          onClick={() => setFinancialLimit(prev => prev + 3)}
                          className="mx-auto mt-3 flex items-center justify-center gap-1 px-4 py-2 rounded-full border border-[#34a06a]/40 bg-[#34a06a]/10 text-xs text-[#34a06a] font-medium hover:bg-[#34a06a]/20 hover:border-[#34a06a] transition-colors"
                        >
                          {t('seeMore')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Summary Panel - rodapé unificado com Valor total */}
              {(() => {
                let footerRecords = financialRecords;
                if (activeFinancialFilter && (activeFinancialFilter.start || activeFinancialFilter.end)) {
                  const startIso = activeFinancialFilter.start;
                  const endIso = activeFinancialFilter.end;
                  footerRecords = footerRecords.filter(rec => {
                    const d = String(rec.due_date || '');
                    if (startIso && d < startIso) return false;
                    if (endIso && d > endIso) return false;
                    return true;
                  });
                }
                if (footerRecords.length === 0) return null;
                const totalValue = footerRecords.reduce((acc, rec) => acc + (Number(rec.value) || 0), 0);
                return (
                  <div className="-mx-5 -mb-5 mt-4 px-4 py-3 bg-black/30 border-t border-[--color-border] rounded-b-2xl">
                    <div className="grid grid-cols-1 gap-2 text-center">
                      <div>
                        <div className="text-[10px] text-[--color-revis-gray] uppercase tracking-wider mb-0.5">{t('totalValue')}</div>
                        <div className="text-[--color-heading] font-display font-bold text-xs sm:text-sm break-words">
                          {formatAppCurrency(totalValue, currency, language)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAdvisor = () => {
    if (isFreePlan(user?.plan)) {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] text-center px-6">
          <div className="w-20 h-20 glass rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Shield className="w-10 h-10 text-[#34a06a]" />
          </div>
          <h2 className="text-xl font-bold text-[--color-heading] font-display mb-3">{t('premiumFeature')}</h2>
          <p className="text-[--color-revis-gray] mb-8 text-sm leading-relaxed max-w-xs mx-auto">{t('drGraxaLocked')}</p>
          <button
            onClick={() => setShowUpgradeModal(true)}
            className="w-full max-w-xs bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors shadow-lg shadow-revis-green/20"
          >
            {t('knowPlans')}
          </button>
        </div>
      );
    }

    const aiLimit = aiMonthlyLimitForPlan(user?.plan);
    const aiUsed = user?.ai_messages_count ?? 0;
    const quotaReached = aiLimit > 0 && aiUsed >= aiLimit;

    const leaveDrGraxaChat = () => {
      setDrGraxaUIMode('list');
      setCurrentSessionId(null);
      setChatMessages([]);
      setAiPrompt('');
      void fetchChatSessions();
    };

    const quotaHeaderLine = (
      <p
        className={`text-center text-[11px] sm:text-xs font-medium leading-snug px-0.5 ${
          quotaReached ? 'text-amber-800 dark:text-amber-200' : 'text-[--color-revis-gray]'
        }`}
        role="status"
      >
        {t('drGraxaQuotaUsedThisMonth').replace('{used}', String(aiUsed)).replace('{total}', String(aiLimit))}
      </p>
    );

    const vehicleRow = (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-[--color-revis-gray] whitespace-nowrap">{t('advisorVehiclePrompt')}</span>
        <CustomSelect
          className="flex-1"
          value={selectedVehicle?.id?.toString()||''}
          onChange={v=>{const id=parseInt(v,10);const vh=vehicles.find(x=>x.id===id);setSelectedVehicle(vh||null);if(vh){setExpandedCards({mileage:false,services:false,financial:false});fetchLogs(vh.id);fetchFinancialRecords(vh.id);}else{setLogs([]);setFinancialRecords([]);}}}
          options={[{value:'',label:t('optionNone')},...[...vehicles].sort((a,b)=>(a.brand||'').localeCompare(b.brand||'')||(a.model||'').localeCompare(b.model||'')).map(v=>({value:v.id.toString(),label:`${v.brand} ${v.model} (${v.year})`}))]}
          placeholder={t('optionNone')}
        />
      </div>
    );

    if (drGraxaUIMode === 'list') {
      return (
        <div className="flex flex-col h-[calc(100dvh-135px)] md:h-[calc(100vh-4rem)] max-w-4xl mx-auto">
          <div className="mb-3 shrink-0">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-[--color-heading] font-display flex items-center gap-2">
                <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="sm" />
                {t('advisor')}
              </h2>
              <button
                type="button"
                onClick={() => { setShowChatTrash(true); void fetchChatTrash(); }}
                className="text-xs text-[--color-revis-gray] hover:text-[#34a06a] transition-colors flex items-center gap-1"
              >
                <Archive className="w-3.5 h-3.5" />
                {t('chatTrashButton')}
              </button>
            </div>
            <div className="mt-1.5">{quotaHeaderLine}</div>
            {vehicleRow}
          </div>

          <button
            type="button"
            disabled={quotaReached}
            onClick={() => setShowDrGraxaManualModal(true)}
            className="mt-3 w-full py-4 rounded-xl bg-[#34a06a] text-black font-bold text-sm shadow-lg shadow-revis-green/20 hover:bg-opacity-90 transition-colors disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center shrink-0"
          >
            <span>{t('drGraxaNewChat')}</span>
          </button>

          <p className="text-xs font-semibold text-[--color-heading] font-display mt-5 mb-2 shrink-0">{t('drGraxaChatsSubtitle')}</p>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-hide pb-4">
            {chatSessions.map(session => {
              const displayTitle = session.title?.trim() || t('newChatSessionTitle');
              return (
                <div key={session.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => void loadChatSession(session.id)}
                    className="w-full glass p-4 rounded-xl text-left hover:bg-white/8 transition-colors pr-12 border border-[--color-border] hover:border-[#34a06a]/30"
                  >
                    <h4 className="text-[--color-heading] font-display font-medium text-sm line-clamp-2 mb-2">{displayTitle}</h4>
                    <span className="text-[10px] text-[#34a06a] font-semibold inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatAppDate(session.updated_at, dateFormat)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatSessionToDelete(session.id);
                      setShowDeleteChatModal(true);
                    }}
                    className="absolute bottom-3 right-3 p-2 text-[#e0473f] hover:bg-revis-alert-critical/10 rounded-lg transition-colors z-10"
                    title={t('deleteChatAria')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            {chatSessions.length === 0 && (
              <div className="text-center py-12 px-4 text-[--color-revis-gray]">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">{t('drGraxaNoChatsYet')}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
    <div className="flex flex-col h-[calc(100dvh-135px)] md:h-[calc(100vh-4rem)] max-w-4xl mx-auto">
      <div className="mb-3 shrink-0 space-y-2">
        <button
          type="button"
          onClick={leaveDrGraxaChat}
          className="flex items-center gap-1 text-[#34a06a] text-sm font-bold -ml-1"
        >
          <ChevronLeft className="w-5 h-5" />
          {t('drGraxaBackToList')}
        </button>
        {quotaHeaderLine}
        {vehicleRow}
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4 pr-1 scrollbar-hide flex flex-col">
        {chatMessages.length === 0 && (
          <div className="text-center text-[--color-revis-gray] mt-10 px-4">
            <div className="relative w-12 h-12 mx-auto mb-4 opacity-20">
              <Shield className="w-12 h-12" />
              <Wrench className="w-6 h-6 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 fill-current" />
            </div>
            <p className="mb-6 text-[10px]">{t('drGraxaDesc')}</p>
          </div>
        )}
        
        {chatMessages.map((msg) => (
          <div 
            key={msg.id} 
            className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300 ${
              msg.sender === 'user' 
                ? 'bg-[#34a06a] text-black self-end rounded-tr-none' 
                : 'bg-white text-black self-start rounded-tl-none'
            }`}
          >
            <ReactMarkdown>{msg.content}</ReactMarkdown>
            <div className={`text-[9px] mt-1 text-right opacity-60 ${msg.sender === 'user' ? 'text-black' : 'text-gray-500'}`}>
              {new Date(msg.timestamp).toLocaleTimeString(getLocaleFromLanguage(language), { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        {isLoadingAi && (
           <div className="bg-white text-black self-start rounded-2xl rounded-tl-none p-3 shadow-md max-w-[85%]">
             <div className="flex gap-1">
               <div className="w-1.5 h-1.5 bg-[--color-bg] rounded-full animate-bounce"></div>
               <div className="w-1.5 h-1.5 bg-[--color-bg] rounded-full animate-bounce delay-100"></div>
               <div className="w-1.5 h-1.5 bg-[--color-bg] rounded-full animate-bounce delay-200"></div>
             </div>
           </div>
        )}
      </div>

      <div className="mt-auto shrink-0 pt-3 border-t border-[--color-border]">
        <div className="flex gap-2">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={quotaReached ? t('drGraxaLimitReachedBanner') : t('advisorInputPlaceholder')}
            disabled={quotaReached || isLoadingAi}
            className="flex-1 glass border border-[--color-border] rounded-xl px-4 py-3 text-xs text-[--color-text] focus:outline-none focus:border-[#34a06a] transition-colors placeholder:text-[--color-revis-gray]/50 disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!quotaReached && !isLoadingAi && aiPrompt.trim()) void askAi();
              }
            }}
          />
          <button 
            onClick={() => void askAi()}
            disabled={isLoadingAi || !aiPrompt.trim() || quotaReached}
            className="bg-[#34a06a] disabled:opacity-50 disabled:cursor-not-allowed text-black px-4 rounded-xl transition-colors font-bold flex items-center justify-center shrink-0"
          >
            {isLoadingAi ? <Activity className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 fill-black" />}
          </button>
        </div>
        <p className="text-[9px] text-[--color-revis-gray] text-center mt-2 opacity-60">
          {t('advisorDisclaimer')}
        </p>
      </div>
    </div>
    );
  };

  const renderOnboardingPreferences = () => (
    <div className="bg-canvas min-h-screen text-[--color-text] flex flex-col">
      <div className="max-w-md w-full mx-auto px-6 py-10 flex-1 flex flex-col">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[--color-heading] font-display mb-2">{t('onboardingTitle')}</h1>
          <p className="text-[--color-revis-gray] text-sm">{t('onboardingSubtitle')}</p>
        </div>

        <div className="space-y-5 flex-1">
          {/* Theme */}
          <div className="glass p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
              <Paintbrush className="w-5 h-5 text-[#34a06a]" />
              {t('themeLabel')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => applyThemeImmediate('dark')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${theme === 'dark' ? 'bg-[#34a06a] text-black border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
              >
                {t('darkTheme')}
              </button>
              <button
                type="button"
                onClick={() => applyThemeImmediate('light')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${theme === 'light' ? 'bg-[#34a06a] text-black border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
              >
                {t('lightTheme')}
              </button>
            </div>
          </div>

          {/* Language */}
          <div className="glass p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
              <Globe className="w-5 h-5 text-[#34a06a]" />
              {t('languageLabel')}
            </h3>
            <div className="space-y-2">
              {Object.keys(translations).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => applyLanguageImmediate(lang)}
                  className={`w-full p-3 rounded-lg border text-sm font-medium transition-colors flex justify-between items-center ${language === lang ? 'bg-[#34a06a]/10 text-[#34a06a] border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
                >
                  {lang}
                  {language === lang && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div className="glass p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
              <Type className="w-5 h-5 text-[#34a06a]" />
              {t('fontSizeLabel')}
            </h3>
            <div className="flex items-center gap-4">
              <span className="text-xs text-[--color-revis-gray]">A</span>
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={fontSize}
                onChange={(e) => applyFontSizeImmediate(parseInt(e.target.value))}
                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-revis-green"
              style={{ background: theme === 'light' ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.18)' }}
              />
              <span className="text-xl text-[--color-heading] font-display">A</span>
            </div>
          </div>

          {/* Date Format */}
          <div className="glass p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-[#34a06a]" />
              {t('dateFormatLabel')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${dateFormat === 'dd/mm/yyyy' ? 'bg-[#34a06a]/10 text-[#34a06a] border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
              >
                <input
                  type="radio"
                  name="onboardingDateFormat"
                  value="dd/mm/yyyy"
                  checked={dateFormat === 'dd/mm/yyyy'}
                  onChange={() => applyDateFormatImmediate('dd/mm/yyyy')}
                  className="accent-revis-green"
                />
                <span>{getDateFormatDisplay('dd/mm/yyyy', language)}</span>
              </label>
              <label
                className={`p-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-3 cursor-pointer ${dateFormat === 'mm/dd/yyyy' ? 'bg-[#34a06a]/10 text-[#34a06a] border-[#34a06a]' : 'bg-transparent text-[--color-revis-gray] border-[--color-border]'}`}
              >
                <input
                  type="radio"
                  name="onboardingDateFormat"
                  value="mm/dd/yyyy"
                  checked={dateFormat === 'mm/dd/yyyy'}
                  onChange={() => applyDateFormatImmediate('mm/dd/yyyy')}
                  className="accent-revis-green"
                />
                <span>{getDateFormatDisplay('mm/dd/yyyy', language)}</span>
              </label>
            </div>
            <p className="text-xs text-[--color-revis-gray]">
              {t('dateFormatPreview')}: <span className="text-[--color-text] font-medium">{formatAppDate(new Date(), dateFormat)}</span>
            </p>
          </div>

          {/* Currency */}
          <div className="glass p-4 rounded-xl space-y-3">
            <h3 className="font-medium text-[--color-heading] font-display flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-[#34a06a]" />
              {t('currencyLabel')}
            </h3>
            <CustomSelect value={currency} onChange={v=>applyCurrencyImmediate(v)} options={CURRENCY_OPTIONS.map(opt=>({"value":opt.code,"label":`${opt.code} — ${currencyLabel(opt.code)}`}))} />
            <p className="text-xs text-[--color-revis-gray]">
              {t('currencyPreview')}: <span className="text-[--color-text] font-medium">{formatAppCurrency(1234.56, currency, language)}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            // Persistência síncrona: as mudanças já foram aplicadas em modo
            // imediato (ver useEffect que escreve no localStorage). Aqui apenas
            // direcionamos para a tela de boas-vindas com o CTA de primeiro veículo.
            setAuthScreen('success');
          }}
          className="w-full mt-8 bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors text-base"
        >
          {t('onboardingFinishCta')}
        </button>

        <div className="mt-6">
          <Footer showHelp />
        </div>
      </div>
    </div>
  );

  if (forceUpdateStatus === 'checking') {
    return (
      <div className="min-h-screen bg-[--color-bg] text-[--color-text] flex items-center justify-center p-6">
        <p className="text-sm text-[--color-revis-gray]">{t('loading')}</p>
      </div>
    );
  }

  if (forceUpdateStatus === 'blocked') {
    return (
      <div className="min-h-screen bg-[--color-bg] text-[--color-text] flex flex-col items-center justify-center p-6 text-center">
        <p className="text-lg font-semibold text-[--color-heading] font-display max-w-sm mb-8">{t('forceUpdateMessage')}</p>
        <button
          type="button"
          className="w-full max-w-xs bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors"
          onClick={() => window.location.reload()}
        >
          {t('forceUpdateButton')}
        </button>
        <p className="text-[10px] text-[--color-revis-gray] mt-6">
          v{APP_VERSION}
        </p>
      </div>
    );
  }

  if (authScreen === 'login') return renderLogin();
  if (authScreen === 'register') return renderRegister();
  if (authScreen === 'terms') return renderTerms();
  if (authScreen === 'success') return renderSuccess();
  if (authScreen === 'onboarding_preferences') return renderOnboardingPreferences();
  if (authScreen === 'recover') return renderRecover();
  if (authScreen === 'reset-password') return renderResetPassword();

  return (
    <div className="bg-canvas min-h-screen text-[--color-text] font-sans selection:bg-[#34a06a] selection:text-black">
      {/* Mobile Header - hidden on desktop */}
      <header className="md:hidden bg-black/90 backdrop-blur-md border-b border-[--color-border] p-4 sticky top-0 z-20">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-[--color-revis-gray]">Revis</span>
              <span className="text-[#34a06a]">Auto</span>
            </h1>
          </div>
        </div>
      </header>

      <div className="md:flex md:min-h-screen">
        {/* Desktop Sidebar - hidden on mobile */}
        <aside className="hidden md:flex md:flex-col md:w-64 md:fixed md:inset-y-0 md:left-0 bg-[--color-bg] border-r border-[--color-border] z-20">
          <div className="p-6 border-b border-[--color-border]">
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-[--color-revis-gray]">Revis</span>
              <span className="text-[#34a06a]">Auto</span>
            </h1>
          </div>
          <nav className="flex-1 flex flex-col gap-1 p-4">
            <button
              onClick={() => { setSelectedVehicle(null); setActiveTab('garage'); }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'garage' ? 'bg-[#34a06a] text-black' : 'text-[--color-revis-gray] hover:glass hover:text-[--color-heading] font-display'}`}
            >
              <Warehouse className="w-5 h-5 flex-shrink-0" />
              {t('garage')}
            </button>
            <button
              onClick={() => setActiveTab('advisor')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'advisor' ? 'bg-[#34a06a] text-black' : 'text-[--color-revis-gray] hover:glass hover:text-[--color-heading] font-display'}`}
            >
              <div className="relative flex-shrink-0 w-5 h-5">
                <Shield className="w-5 h-5" />
                <Wrench className="w-2.5 h-2.5 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              {t('advisor')}
            </button>
            <button
              onClick={() => setActiveTab('menu')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'menu' ? 'bg-[#34a06a] text-black' : 'text-[--color-revis-gray] hover:glass hover:text-[--color-heading] font-display'}`}
            >
              <Menu className="w-5 h-5 flex-shrink-0" />
              {t('menu')}
            </button>
            <button
              onClick={() => setActiveTab('preferences')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${activeTab === 'preferences' ? 'bg-[#34a06a] text-black' : 'text-[--color-revis-gray] hover:glass hover:text-[--color-heading] font-display'}`}
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
              {t('preferences')}
            </button>
          </nav>
          <div className="p-4 border-t border-[--color-border]">
            <p className="text-[10px] text-[--color-revis-gray] text-center">{t('appShellTagline')}</p>
          </div>
        </aside>

        {/* Main content area */}
        <main className="flex-1 p-4 pb-24 md:ml-64 md:pb-8 md:p-8">
          <div className="max-w-5xl mx-auto">
            {activeTab === 'garage' && renderGarage()}
            {activeTab === 'advisor' && renderAdvisor()}
            {activeTab === 'menu' && renderMenu()}
            {activeTab === 'preferences' && renderPreferences()}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation - hidden on desktop */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black/95 backdrop-blur-lg border-t border-[--color-border] pb-safe z-20">
        <div className="flex justify-around items-center h-16">
          <button
            onClick={() => {
              setSelectedVehicle(null);
              setActiveTab('garage');
            }}
            className={`flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-center ${activeTab === 'garage' ? 'text-[#34a06a]' : 'text-[--color-revis-gray]'}`}
          >
            <Warehouse className="w-6 h-6" />
            <span className="text-[10px] font-medium max-w-full truncate px-0.5">{t('garage')}</span>
          </button>
          <button
            onClick={() => setActiveTab('advisor')}
            className={`flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-center ${activeTab === 'advisor' ? 'text-[#34a06a]' : 'text-[--color-revis-gray]'}`}
          >
            <div className="relative">
              <Shield className={`w-6 h-6 ${activeTab === 'advisor' ? 'fill-current' : ''}`} />
              <Wrench className={`w-3 h-3 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 ${activeTab === 'advisor' ? 'fill-black' : 'fill-current'}`} />
            </div>
            <span className="text-[10px] font-medium max-w-full truncate px-0.5">{t('advisor')}</span>
          </button>
          <button
            onClick={() => setActiveTab('menu')}
            className={`flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-center ${activeTab === 'menu' ? 'text-[#34a06a]' : 'text-[--color-revis-gray]'}`}
          >
            <Menu className="w-6 h-6" />
            <span className="text-[10px] font-medium max-w-full truncate px-0.5">{t('menu')}</span>
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-center ${activeTab === 'preferences' ? 'text-[#34a06a]' : 'text-[--color-revis-gray]'}`}
          >
            <Settings className="w-6 h-6" />
            <span className="text-[10px] font-medium max-w-full truncate px-0.5">{t('preferences')}</span>
          </button>
        </div>
      </nav>

      {/* Full Screen Modals for Mobile */}
      {/* Profile Menu Modal Removed */}

      {/* Mini manual antes de iniciar nova conversa (Dr. Graxa) */}
      {showDrGraxaManualModal && (
        <div
          className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dr-graxa-manual-title"
          onClick={() => setShowDrGraxaManualModal(false)}
        >
          <div
            className="w-full md:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl md:rounded-3xl border border-[--color-border] shadow-2xl p-5 md:p-6"
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)' }
                : { background: 'rgba(20,22,24,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)' }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3 mb-3">
              <h2 id="dr-graxa-manual-title" className="text-base md:text-lg font-bold text-[--color-heading] font-display leading-snug">
                {t('drGraxaOnboardingTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setShowDrGraxaManualModal(false)}
                className="text-[--color-revis-gray] hover:text-[--color-heading] font-display p-1 shrink-0 rounded-lg hover:bg-white/10"
                aria-label={t('closeButton')}
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-[--color-revis-gray] leading-relaxed mb-5">{t('drGraxaOnboardingSubtitle')}</p>
            <ul className="space-y-3 mb-4">
              {(
                [
                  [Lightbulb, t('drGraxaOnboardingTip1')],
                  [Zap, t('drGraxaOnboardingTip2')],
                  [Layers, t('drGraxaOnboardingTip3')],
                  [Wrench, t('drGraxaOnboardingTip4')],
                ] as const
              ).map(([IconC, txt], idx) => (
                <li
                  key={idx}
                  className="flex gap-3 rounded-2xl border border-[--color-border] p-3.5 items-start"
                  style={{ background: theme === 'light' ? 'rgba(0,0,0,0.035)' : 'rgba(0,0,0,0.45)' }}
                >
                  <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#34a06a]/15 flex items-center justify-center mt-0.5">
                    <IconC className="w-[18px] h-[18px] text-[#34a06a]" aria-hidden />
                  </span>
                  <p className="text-xs text-[--color-text] leading-relaxed pt-1">{txt}</p>
                </li>
              ))}
            </ul>
            <div
              className="rounded-xl p-3.5 mb-4 text-xs leading-relaxed border"
              style={
                theme === 'light'
                  ? { background: 'rgba(217,119,6,0.08)', borderColor: 'rgba(217,119,6,0.25)', color: '#78350f' }
                  : { background: 'rgba(234,179,8,0.10)', borderColor: 'rgba(234,179,8,0.20)', color: '#fef9c3' }
              }
              role="note"
            >
              {t('drGraxaMiniManualLegalDisclaimer')}
            </div>
            <button
              type="button"
              disabled={Boolean(user && aiMonthlyLimitForPlan(user.plan) > 0 && (user.ai_messages_count ?? 0) >= aiMonthlyLimitForPlan(user.plan))}
              onClick={() => {
                const limit = aiMonthlyLimitForPlan(user?.plan);
                const used = user?.ai_messages_count ?? 0;
                if (limit > 0 && used >= limit) return;
                setShowDrGraxaManualModal(false);
                setDrGraxaUIMode('chat');
                setCurrentSessionId(null);
                setChatMessages([]);
                setAiPrompt('');
              }}
              className="w-full py-4 rounded-2xl bg-[#34a06a] text-black font-bold text-base shadow-lg shadow-revis-green/25 hover:bg-opacity-90 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {t('drGraxaOnboardingAck')}
            </button>
          </div>
        </div>
      )}

      {/* Lixeira de conversas do Dr. Graxa */}
      {showChatTrash && (
        <div
          className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowChatTrash(false)}
        >
          <div
            className="w-full md:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-3xl md:rounded-3xl border border-[--color-border] shadow-2xl p-5 md:p-6"
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)' }
                : { background: 'rgba(20,22,24,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)' }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3 mb-1">
              <h2 className="text-base md:text-lg font-bold text-[--color-heading] font-display leading-snug flex items-center gap-2">
                <Archive className="w-5 h-5 text-[#34a06a]" />
                {t('chatTrashTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setShowChatTrash(false)}
                className="text-[--color-revis-gray] hover:text-[--color-heading] font-display p-1 shrink-0 rounded-lg hover:bg-white/10"
                aria-label={t('closeButton')}
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-xs text-[--color-revis-gray] leading-relaxed mb-5">{t('chatTrashSubtitle')}</p>

            {chatTrashLoading ? (
              <p className="text-sm text-[--color-revis-gray] text-center py-8">{t('loading')}</p>
            ) : chatTrashSessions.length === 0 ? (
              <div className="text-center py-10 text-[--color-revis-gray]">
                <Archive className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">{t('chatTrashEmpty')}</p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {chatTrashSessions.map(session => {
                  const displayTitle = session.title?.trim() || t('newChatSessionTitle');
                  const daysLeft = session.days_until_permanent_deletion ?? 0;
                  return (
                    <li
                      key={session.id}
                      className="rounded-2xl border border-[--color-border] p-3.5"
                      style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.35)' }}
                    >
                      <p className="text-sm font-medium text-[--color-heading] font-display line-clamp-2 mb-1">{displayTitle}</p>
                      <p className="text-[11px] text-[--color-revis-gray] mb-3">
                        {daysLeft > 0
                          ? t('chatTrashDaysLeft').replace('{days}', String(daysLeft))
                          : t('chatTrashExpiringSoon')}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void restoreChatSession(session.id)}
                          className="flex-1 py-2 rounded-lg bg-[#34a06a]/15 text-[#34a06a] text-xs font-medium hover:bg-[#34a06a]/25 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <History className="w-3.5 h-3.5" />
                          {t('chatTrashRestore')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void permanentlyDeleteChatSession(session.id)}
                          className="flex-1 py-2 rounded-lg bg-[#e0473f]/10 text-[#e0473f] text-xs font-medium hover:bg-[#e0473f]/20 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t('chatTrashDeleteForever')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Vehicle History Modal */}
      {showVehicleHistory && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: theme === 'light' ? '#eef1f0' : '#000000' }}>
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">{t('vehicleHistory')}</h2>
              <button onClick={() => setShowVehicleHistory(false)} className="text-[--color-revis-gray] p-2">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-3">
              {archivedVehicles.map(vehicle => (
                <div 
                  key={vehicle.id} 
                  className="glass rounded-xl p-4 border border-[--color-border] flex items-center gap-4"
                >
                  <div className="p-3 bg-black/30 rounded-full flex-shrink-0 opacity-50">
                    {vehicle.type === 'Carro' && <Car className="w-5 h-5 text-[--color-revis-gray]" />}
                    {vehicle.type === 'Moto' && <Bike className="w-5 h-5 text-[--color-revis-gray]" />}
                    {vehicle.type === 'Bike' && <Zap className="w-5 h-5 text-[--color-revis-gray]" />}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-[--color-heading] font-display text-base truncate">{vehicle.brand} {vehicle.model} ({vehicle.year})</h3>
                    <p className="text-xs text-[--color-revis-gray] truncate">
                      {t('archivedDeletedAtLabel')}: {vehicle.deleted_at ? formatAppDate(vehicle.deleted_at, dateFormat) : t('unknownDateLabel')}
                    </p>
                  </div>

                  <button 
                    onClick={() => {
                      setSelectedVehicle(vehicle);
                      setExpandedCards({ mileage: false, services: false, financial: false });
                      setShowVehicleHistory(false);
                      setActiveTab('garage');
                      fetchLogs(vehicle.id);
                      fetchFinancialRecords(vehicle.id);
                    }}
                    className="text-xs text-[#34a06a] font-medium whitespace-nowrap hover:underline"
                  >
                    {t('viewDetailsWithArrow')}
                  </button>
                </div>
              ))}
              
              {archivedVehicles.length === 0 && (
                <div className="text-center py-10 text-[--color-revis-gray]">
                  <Archive className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>{t('noVehiclesArchived')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Vehicle Confirmation Modal */}
      {showDeleteVehicleModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 w-full max-w-sm border border-[--color-border] shadow-xl">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-6 text-center">{t('deleteVehicleTitle')}</h3>
            
            <div className="flex gap-3 mb-6">
              <button 
                onClick={confirmArchiveVehicle}
                className="flex-1 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
              <button 
                onClick={() => setShowDeleteVehicleModal(false)}
                className="flex-1 bg-revis-alert-critical text-[--color-heading] font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('no')}
              </button>
            </div>
            
            <p className="text-[10px] text-[--color-revis-gray] text-center leading-relaxed">
              {t('deleteVehicleBackupNote')}
            </p>
          </div>
        </div>
      )}

      {/* Delete Chat Confirmation Modal */}
      {showDeleteChatModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 w-full max-w-sm border border-[--color-border] shadow-xl">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-6 text-center">{t('deleteChatTitle')}</h3>
            
            <div className="flex gap-3 mb-6">
              <button 
                onClick={confirmDeleteChatSession}
                className="flex-1 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
              <button 
                onClick={() => {
                  setShowDeleteChatModal(false);
                  setChatSessionToDelete(null);
                }}
                className="flex-1 bg-revis-alert-critical text-[--color-heading] font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('no')}
              </button>
            </div>
            
            <p className="text-[10px] text-[--color-revis-gray] text-center leading-relaxed">
              {t('deleteChatFootnote')}
            </p>
          </div>
        </div>
      )}

      {/* Preferences Save Confirmation Modal */}
      {showPreferencesSaveConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border]">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-2">{t('confirmChanges')}</h3>
            <p className="text-[--color-revis-gray] mb-6 text-sm">{t('confirmChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowPreferencesSaveConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={() => {
                  // Modo imediato: as preferências já foram aplicadas; aqui apenas confirmamos
                  // o snapshot original como o novo "estado salvo".
                  setOriginalTheme(tempTheme);
                  setOriginalLanguage(tempLanguage);
                  setOriginalFontSize(tempFontSize);
                  setShowPreferencesSaveConfirmation(false);
                  setActiveTab('garage');
                }}
                className="flex-1 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preferences Cancel Confirmation Modal */}
      {showPreferencesCancelConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border]">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-2">{t('cancelChanges')}</h3>
            <p className="text-[--color-revis-gray] mb-6 text-sm">{t('cancelChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowPreferencesCancelConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={() => {
                  // Reverter para o snapshot tirado ao entrar na tela
                  setTheme(originalTheme);
                  setLanguage(originalLanguage);
                  setFontSize(originalFontSize);
                  setDateFormat(originalDateFormat);
                  setCurrency(originalCurrency);
                  setHasManualDateFormat(originalHasManualDateFormat);
                  setTempTheme(originalTheme);
                  setTempLanguage(originalLanguage);
                  setTempFontSize(originalFontSize);
                  setTempDateFormat(originalDateFormat);
                  setTempCurrency(originalCurrency);
                  setShowPreferencesCancelConfirmation(false);
                  setActiveTab('garage');
                }}
                className="flex-1 bg-revis-alert-critical text-[--color-heading] font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Edit Modal */}
      {showProfileEdit && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: theme === 'light' ? '#eef1f0' : '#000000' }}>
          <div className="p-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">{t('profileData')}</h2>
            </div>
            
            <form onSubmit={handleUpdateProfile} className="space-y-6">
              {/* Read-only fields */}
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('name')}</label>
                <input 
                  readOnly
                  className="w-full glass opacity-70 border border-transparent rounded-xl p-4 text-[--color-revis-gray] outline-none cursor-not-allowed"
                  value={user?.name || ''}
                />
              </div>
              
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('birthDate')}</label>
                <input 
                  readOnly
                  className="w-full glass opacity-70 border border-transparent rounded-xl p-4 text-[--color-revis-gray] outline-none cursor-not-allowed"
                  value={user?.birth_date ? formatAppDate(user.birth_date, dateFormat) : ''}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('country')}</label>
                <input 
                  readOnly
                  className="w-full glass opacity-70 border border-transparent rounded-xl p-4 text-[--color-revis-gray] outline-none cursor-not-allowed"
                  value={user?.country ? countryLabel(user.country) : ''}
                />
              </div>

              {/* Editable fields */}
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('nickname')}</label>
                <input 
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={profileForm.nickname}
                  onChange={e => setProfileForm({...profileForm, nickname: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('email')}</label>
                <input 
                  type="email"
                  required
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={profileForm.email}
                  onChange={e => setProfileForm({...profileForm, email: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('phone')}</label>
                <input 
                  required
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={profileForm.phone}
                  onChange={e => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.length > 11) val = val.slice(0, 11);
                    val = val.replace(/^(\d{2})(\d)/, '($1) $2');
                    val = val.replace(/(\d{5})(\d)/, '$1-$2');
                    setProfileForm({...profileForm, phone: val});
                  }}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('zipCode')}</label>
                <input 
                  required
                  maxLength={9}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={profileForm.zip_code}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2');
                    setProfileForm({...profileForm, zip_code: val});
                  }}
                  onBlur={handleProfileCepBlur}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('city')}</label>
                  <input 
                    readOnly
                    className="w-full glass opacity-70 border border-transparent rounded-xl p-4 text-[--color-revis-gray] outline-none cursor-not-allowed"
                    value={profileForm.city}
                  />
                </div>
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('state')}</label>
                  <input 
                    readOnly
                    className="w-full glass opacity-70 border border-transparent rounded-xl p-4 text-[--color-revis-gray] outline-none cursor-not-allowed"
                    value={profileForm.state}
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button 
                  type="button" 
                  onClick={handleCancelProfile}
                  className="w-full glass border border-[--color-border] text-[--color-text] font-bold py-4 rounded-xl hover:bg-white/8 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit" 
                  className="w-full bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors"
                >
                  {t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save Confirmation Modal */}
      {showSaveConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border]">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-2">{t('confirmChanges')}</h3>
            <p className="text-[--color-revis-gray] mb-6 text-sm">{t('confirmChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowSaveConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={confirmSaveProfile}
                className="flex-1 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border]">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-2">{t('cancelChanges')}</h3>
            <p className="text-[--color-revis-gray] mb-6 text-sm">{t('cancelChangesMsg')}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCancelConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={confirmCancelProfile}
                className="flex-1 bg-revis-alert-critical text-[--color-heading] font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preferences Save Confirmation Modal Removed */}

      {/* Preferences Cancel Confirmation Modal Removed */}

      {/* Terms Modal (Logged In) */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: theme === 'light' ? '#eef1f0' : '#000000' }}>
          <div className="p-4 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">{t('terms')}</h2>
              <button onClick={() => { setShowTermsModal(false); setActiveTab('menu'); }} className="text-[#34a06a] font-bold text-sm flex items-center gap-1 p-2">
                &lt; {t('back')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto glass rounded-xl p-4 text-xs text-[--color-text] space-y-4">
              <h3 className="font-bold text-[--color-heading] font-display mb-2 text-sm">TERMOS E CONDIÇÕES DE USO – PLATAFORMA REVISAUTO</h3>
              <p className="text-[10px] text-[--color-revis-gray] mb-4">{t('legalLastUpdated')}<br/>{t('legalUpdatesNotice')}</p>
              
              <div className="bg-revis-alert-medium/10 border border-revis-alert-medium p-3 rounded-lg mb-4">
                <p className="text-[#ffcc00] font-bold text-[10px]">{t('majorityWarningTitle')}</p>
                <p className="text-[10px] mt-1">O RevisAuto é uma plataforma destinada exclusivamente a usuários maiores de 18 (dezoito) anos. Ao acessar ou utilizar este aplicativo, você declara possuir a idade mínima exigida e plena capacidade civil, compreendendo que a gestão e condução de veículos automotores e elétricos no Brasil requerem maioridade e habilitação legal específica.</p>
              </div>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">1. CADASTRO E SEGURANÇA DE DADOS (CONFORMIDADE LGPD)</h4>
              <p>1.1. Elegibilidade: O Usuário declara ser maior de 18 anos e ser o proprietário ou possuidor legítimo do veículo cadastrado.</p>
              <p>1.2. Veracidade das Informações: O Usuário é o único responsável pela precisão e atualização dos dados inseridos (quilometragem, datas de manutenção, histórico de reparos).</p>
              <p>1.3. Confidencialidade: As credenciais de acesso são pessoais e intransferíveis. O Usuário compromete-se a notificar a administração do RevisAuto imediatamente sobre qualquer uso não autorizado de sua conta.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">2. COMUNIDADE E REDE SOCIAL (DIRETRIZES DE CONDUTA)</h4>
              <p>2.1. Conteúdo Gerado pelo Usuário (UGC): O Usuário concede ao RevisAuto uma licença gratuita e global para exibir conteúdos postados em áreas comuns do app.</p>
              <p>2.2. Proibições: É proibida a publicação de conteúdo difamatório, obsceno, abusivo, ilegal ou propaganda não autorizada (SPAM).</p>
              <p>2.3. Moderação: O RevisAuto reserva-se o direito de remover conteúdos e banir usuários que violem estas diretrizes.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">3. PROPRIEDADE INTELECTUAL E PROTEÇÃO CONTRA PLÁGIO</h4>
              <p>3.1. Propriedade Intelectual: Todo o código-fonte, interface gráfica, prompts e integrações de Inteligência Artificial, identidade visual e a marca RevisAuto são de propriedade exclusiva da desenvolvedora, protegidos pela legislação de direitos autorais e de propriedade intelectual aplicável, incluindo o registro da marca RevisAuto junto ao INPI.</p>
              <p>3.2. Proibição de Plágio: É terminantemente proibida a reprodução total ou parcial da lógica ou design da plataforma.</p>
              <p>3.3. Procedimentos Judiciais: A prática de plágio sujeitará o infrator a procedimentos judiciais nas esferas cível e criminal, incluindo indenizações por danos materiais e lucros cessantes.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">4. PROTOCOLOS DE SEGURANÇA E PREVENÇÃO A FRAUDES</h4>
              <p>4.1. Cuidado com Credenciais: O RevisAuto jamais solicitará sua senha de acesso por telefone, e-mail, SMS ou redes sociais. O compartilhamento de senhas com terceiros é de inteira responsabilidade do Usuário.</p>
              <p>4.2. Canais Oficiais de Cobrança: Todas as transações financeiras e cobranças de assinaturas de planos são processadas exclusivamente através de plataformas verificadas, notadamente pelo sistema integrado do Mercado Pago ou pelas lojas oficiais (App Store e Google Play).</p>
              <p>4.3. Alertas de Golpes: O RevisAuto não realiza cobranças nem solicita pagamentos via WhatsApp, ligações telefônicas, SMS ou links diretos enviados por e-mail.</p>
              <p>4.4. Isenção de Responsabilidade por Engenharia Social: O RevisAuto não se responsabiliza por prejuízos financeiros decorrentes de golpes de terceiros, phishing ou transferências realizadas pelo usuário para contas não oficiais.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">5. ASSINATURAS E PAGAMENTOS</h4>
              <p>5.1. Serviços Premium: O RevisAuto oferece planos de assinatura (como Plus e Premium) para desbloqueio de limites de veículos e maior interação com a inteligência artificial. Estas funcionalidades estão sujeitas a termos de recorrência apresentados no momento da contratação.</p>
              <p>5.2. Reajustes: Alterações de valores serão comunicadas com 30 (trinta) dias de antecedência.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">6. DISPONIBILIDADE E MODIFICAÇÕES</h4>
              <p>6.1. Interrupções de Serviço: O serviço pode sofrer instabilidades técnicas devido a manutenções ou fatores externos em nossos provedores de nuvem.</p>
              <p>6.2. Alteração dos Termos: A continuidade do uso do app após atualizações constitui aceitação dos novos termos.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">7. NATUREZA DO SERVIÇO E ISENÇÃO DE RESPONSABILIDADE</h4>
              <p>7.1. Consultoria via IA (Dr. Graxa): O Usuário reconhece que o assistente virtual &quot;Dr. Graxa&quot; fornece recomendações geradas por Inteligência Artificial com caráter meramente informativo e consultivo.</p>
              <p>7.2. Responsabilidade Técnica: A plataforma, incluindo sua inteligência artificial, não substitui o manual oficial do fabricante, laudos técnicos ou a avaliação presencial de um profissional mecânico qualificado. O RevisAuto não se responsabiliza por danos físicos ou materiais decorrentes da aplicação de sugestões geradas no aplicativo.</p>
              <p>7.3. Dicas de Produtos: A compatibilidade de produtos químicos ou peças automotivas é de inteira responsabilidade do Usuário.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">8. FORO E LEGISLAÇÃO APLICÁVEL</h4>
              <p>8.1. Regido pelas leis da República Federativa do Brasil (Marco Civil da Internet e LGPD).</p>
              <p>8.2. Eleito o Foro da Comarca de Vila Velha, Estado do Espírito Santo.</p>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Modal (Logged In) */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: theme === 'light' ? '#eef1f0' : '#000000' }}>
          <div className="p-4 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">{t('privacy')}</h2>
              <button onClick={() => { setShowPrivacyModal(false); setActiveTab('menu'); }} className="text-[#34a06a] font-bold text-sm flex items-center gap-1 p-2">
                &lt; {t('back')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto glass rounded-xl p-4 text-xs text-[--color-text] space-y-4">
              <h3 className="font-bold text-[--color-heading] font-display mb-2 text-sm">POLÍTICA DE PRIVACIDADE – REVISAUTO</h3>
              <p className="text-[10px] text-[--color-revis-gray] mb-4">{t('legalLastUpdated')}<br/>{t('legalUpdatesNotice')}</p>
              
              <p>A plataforma RevisAuto tem o compromisso de proteger a privacidade e os dados pessoais de seus usuários. Esta Política descreve como coletamos, usamos, armazenamos e protegemos suas informações, em total conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD).</p>
              
              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">1. DADOS COLETADOS</h4>
              <p>Para o funcionamento adequado do aplicativo, coletamos os seguintes dados:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Informações de Cadastro: Nome completo, e-mail, apelido, data de nascimento, país, celular, CEP, cidade e estado.</li>
                <li>Informações do Veículo: Placa, marca, modelo, ano, cor, quilometragem, RENAVAM e chassi (quando informados ou extraídos automaticamente do CRLV), além do histórico de abastecimentos, manutenções e impostos, taxas e multas registrados por você.</li>
                <li>Documentos e Comprovantes: Fotos e arquivos anexados aos lançamentos de abastecimento, manutenção e impostos/multas, além do documento do veículo (CRLV) enviado para preenchimento automático do cadastro.</li>
                <li>Interações com a IA: O conteúdo das mensagens e fotos enviadas ao assistente virtual (Dr. Graxa).</li>
              </ul>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">2. FINALIDADE DO TRATAMENTO DE DADOS</h4>
              <p>Os dados coletados são utilizados exclusivamente para:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Gerenciar sua garagem virtual e histórico automotivo.</li>
                <li>Personalizar as respostas e diagnósticos da Inteligência Artificial, inclusive a leitura automática do CRLV.</li>
                <li>Processar as validações de pagamento das assinaturas escolhidas pelo usuário.</li>
                <li>Garantir a segurança da conta e prevenir acessos fraudulentos.</li>
              </ul>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">3. COMPARTILHAMENTO DE DADOS E INFRAESTRUTURA</h4>
              <p>3.1. Não Comercialização: O RevisAuto não vende seus dados pessoais a terceiros para fins publicitários.</p>
              <p>3.2. Parceiros Técnicos e Nuvem: Seus dados cadastrais e o histórico de veículos são armazenados de forma criptografada em nosso parceiro de nuvem, o Supabase. O aplicativo é hospedado na infraestrutura da Cloudflare, que processa as requisições e o envio de arquivos antes de chegarem ao armazenamento.</p>
              <p>3.3. Inteligência Artificial: Para o funcionamento do assistente &quot;Dr. Graxa&quot; e para a leitura automática do CRLV, as mensagens e documentos enviados são processados através da API do Gemini (Google). O processamento é feito de maneira segura, e os seus dados não são utilizados para treinar modelos públicos de IA.</p>
              <p>3.4. Processamento de Pagamentos: Transações financeiras (Planos Plus e Premium) são geridas e processadas pelo Mercado Pago. O RevisAuto não armazena os dados completos de seu cartão de crédito em seus servidores.</p>
              <p>3.5. Ordens Judiciais: Poderemos compartilhar dados caso sejamos obrigados por lei ou decisão judicial, conforme o Marco Civil da Internet.</p>
              <p>3.6. Transferência Internacional de Dados: Nossos parceiros de nuvem e de inteligência artificial (Supabase, Cloudflare e Google) podem processar ou armazenar dados em servidores localizados fora do Brasil. Esse tratamento segue o disposto no art. 33 da LGPD, com garantias contratuais de proteção equivalente à legislação brasileira.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">4. SEGURANÇA DA INFORMAÇÃO</h4>
              <p>4.1. Criptografia: Utilizamos protocolos de criptografia de ponta a ponta (SSL/TLS) para o tráfego de informações entre o seu dispositivo e nossa nuvem.</p>
              <p>4.2. Proteção: Nossos bancos de dados contam com rigorosos controles de acesso baseados em políticas de segurança modernas.</p>
              <p>4.3. Responsabilidade do Usuário: Mantenha suas credenciais seguras e desconfie de abordagens externas solicitando dados em nome do RevisAuto.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">5. SEUS DIREITOS (LGPD)</h4>
              <p>Como titular dos dados, você tem o direito de:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Confirmar a existência de tratamento de seus dados.</li>
                <li>Acessar e corrigir dados incompletos ou desatualizados a qualquer momento no perfil do app.</li>
                <li>Solicitar a portabilidade dos seus dados a outro fornecedor de serviço.</li>
                <li>Solicitar a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD.</li>
                <li>Obter informação sobre as entidades com as quais o RevisAuto compartilha seus dados (ver seção 3).</li>
                <li>Revogar seu consentimento a qualquer momento e se opor a um tratamento realizado sem consentimento, quando exigido por lei.</li>
                <li>Exclusão (Direito ao Esquecimento): Solicitar a eliminação definitiva e irrevogável de todos os seus dados cadastrais, histórico de veículos e conversas dos nossos servidores, utilizando o botão específico de exclusão de conta dentro das configurações do próprio aplicativo.</li>
              </ul>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">6. TECNOLOGIAS DE RASTREIO E SESSÃO</h4>
              <p>Utilizamos identificadores seguros e tokens de sessão (access tokens) do seu dispositivo móvel exclusivamente para manter o aplicativo logado e funcional durante o uso, melhorando a fluidez da sua experiência.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">7. RETENÇÃO DE DADOS</h4>
              <p>Mantemos seus dados ativos apenas enquanto a sua conta existir para cumprir as finalidades desta política. Caso opte por deletar a conta, os dados serão expurgados dos nossos servidores primários, ressalvada a guarda necessária para o cumprimento de obrigações legais impostas pelo Marco Civil da Internet.</p>

              <h4 className="font-bold text-[--color-heading] font-display mt-4 text-sm">8. CONTATO E ENCARREGADO DE DADOS (DPO)</h4>
              <p>Para exercer seus direitos, relatar vulnerabilidades ou tirar dúvidas sobre sua privacidade, entre em contato através do e-mail oficial: dev@revisautoapp.com.br.</p>
            </div>
          </div>
        </div>
      )}

      {showAddVehicle && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) handleCancelAddVehicle(); }}
        >
          <div
            className="w-full md:max-w-lg md:mx-auto rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(0,0,0,0.10)', boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }
                : { background: 'rgba(20,22,24,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(255,255,255,0.13)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }
            }
          >
          <div className="p-5">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">{t('newVehicleTitle')}</h2>
            </div>
            
            <form onSubmit={handleAddVehicle} className="space-y-6">
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-2">{t('vehicleType')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Carro', 'Moto', 'Bike'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setNewVehicle({...newVehicle, type: type as any, brand: '', model: ''});
                        setCustomBrand('');
                        setCustomModel('');
                      }}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-colors ${
                        newVehicle.type === type 
                          ? 'bg-[#34a06a]/10 border-[#34a06a] text-[#34a06a]' 
                          : 'glass border-transparent text-[--color-revis-gray]'
                      }`}
                    >
                      {type === 'Carro' && <Car className="w-6 h-6" />}
                      {type === 'Moto' && <Bike className="w-6 h-6" />}
                      {type === 'Bike' && <Zap className="w-6 h-6" />}
                      <span className="text-xs font-medium">{vehicleTypeLabel(type)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Importar dados do CRLV */}
              <div className="rounded-xl border border-dashed border-[--color-border] p-4">
                <label
                  htmlFor="crlv-upload-input"
                  className={`flex items-center justify-center gap-2 text-sm font-medium py-2 rounded-lg cursor-pointer transition-colors ${
                    isUploadingCrlv
                      ? 'text-[--color-revis-gray] cursor-wait'
                      : 'text-[#34a06a] hover:bg-[#34a06a]/10'
                  }`}
                >
                  {isUploadingCrlv ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('crlvUploading')}
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      {newVehicle.document_path ? t('crlvReplaceButton') : t('crlvImportButton')}
                    </>
                  )}
                </label>
                <input
                  id="crlv-upload-input"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={isUploadingCrlv}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void handleCrlvUpload(file);
                    e.target.value = '';
                  }}
                />
                <p className="text-[11px] text-[--color-revis-gray] text-center mt-1">{t('crlvImportHint')}</p>

                {crlvWarnings.length > 0 && (
                  <div className="mt-3 rounded-lg bg-[#ff8a3d]/10 border border-[#ff8a3d]/25 p-3">
                    <p className="text-xs font-medium text-[#ff8a3d] mb-1">{t('crlvWarningsTitle')}</p>
                    <ul className="text-xs text-[--color-revis-gray] list-disc list-inside space-y-0.5">
                      {crlvWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('plateLabel')}*</label>
                <input
                  required
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors uppercase tracking-wider"
                  placeholder="ABC1D23"
                  maxLength={8}
                  value={newVehicle.plate || ''}
                  onChange={e => {
                    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    setNewVehicle({ ...newVehicle, plate: val });
                  }}
                />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('brand')}</label>
                  <CustomSelect required value={newVehicle.brand==='Outra'?'Outra':(newVehicle.brand||'')} onChange={v=>{const val=v;setNewVehicle({...newVehicle,brand:val,model:''});if(val!=='Outra')setCustomBrand('');setCustomModel('');}} options={[{value:'',label:t('selectPlaceholder')},...getBrandList().map(b=>({value:b,label:optionLabel(b)}))]} />
                  
                  {newVehicle.brand === 'Outra' && (
                    <input 
                      required
                      className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors mt-2"
                      placeholder={t('vehicleBrandPlaceholder')}
                      value={customBrand}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                        setCustomBrand(val);
                      }}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('model')}</label>
                  {newVehicle.brand && newVehicle.brand !== 'Outra' && getModelList().length > 0 ? (
                    <>
                      <CustomSelect required value={newVehicle.model==='Outro'?'Outro':(newVehicle.model||'')} onChange={v=>{const val=v;setNewVehicle({...newVehicle,model:val});if(val!=='Outro')setCustomModel('');}} options={[{value:'',label:t('selectPlaceholder')},...getModelList().map(m=>({value:m,label:optionLabel(m)})),{value:'Outro',label:t('optionOther')}]} />
                      {newVehicle.model === 'Outro' && (
                        <input 
                          required
                          className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors mt-2"
                          placeholder={t('vehicleModelPlaceholder')}
                          value={customModel}
                          onChange={e => {
                            const val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                            setCustomModel(val);
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <input 
                      required
                      disabled={!newVehicle.brand}
                      className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={!newVehicle.brand ? t('vehicleModelSelectBrandFirst') : t('vehicleModelPlaceholder')}
                      value={newVehicle.brand === 'Outra' ? customModel : (newVehicle.model || '')}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                        if (newVehicle.brand === 'Outra') {
                          setCustomModel(val);
                        } else {
                          setNewVehicle({...newVehicle, model: val});
                        }
                      }}
                    />
                  )}
                </div>

                {/* Premium Fields */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm text-[--color-revis-gray]">{t('vehicleNicknameLabel')}</label>
                    {!isPlusOrPremium(user?.plan) && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                        <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="xs" className="-my-px" />
                        Premium
                      </span>
                    )}
                  </div>
                  <div
                    onClick={() => {
                      if (!isPlusOrPremium(user?.plan)) {
                        setShowUpgradeModal(true);
                      }
                    }}
                  >
                    <input
                      className={`w-full glass border border-transparent rounded-xl p-4 outline-none transition-colors ${
                        isPlusOrPremium(user?.plan)
                          ? 'focus:border-[#34a06a] text-[--color-text]'
                          : 'text-[--color-revis-gray] cursor-not-allowed opacity-60'
                      }`}
                      placeholder={isPlusOrPremium(user?.plan) ? t('vehicleNicknamePlaceholder') : t('vehicleNicknamePremiumOnly')}
                      maxLength={12}
                      disabled={!isPlusOrPremium(user?.plan)}
                      value={newVehicle.nickname || ''}
                      onChange={e => {
                        const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                        setNewVehicle({...newVehicle, nickname: val});
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm text-[--color-revis-gray]">{t('color')}</label>
                    {!isPlusOrPremium(user?.plan) && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                        <PremiumCrown tooltip={t('premiumCrownTooltip')} decorative size="xs" className="-my-px" />
                        Premium
                      </span>
                    )}
                  </div>
                  <div
                    onClick={() => {
                      if (!isPlusOrPremium(user?.plan)) {
                        setShowUpgradeModal(true);
                      }
                    }}
                  >
                    <CustomSelect disabled={!isPlusOrPremium(user?.plan)} value={newVehicle.color||''} onChange={v=>{const val=v;setNewVehicle({...newVehicle,color:val});if(val!=='Customizado')setCustomColor('');if(val!=='Outra')setOtherColor('');}} options={[{value:'',label:isPlusOrPremium(user?.plan)?t('selectPlaceholder'):t('vehicleNicknamePremiumOnly')},...(VEHICLE_COLORS||[]).map((c:string)=>({value:c,label:optionLabel(c)}))]} />

                    {isPlusOrPremium(user?.plan) && newVehicle.color === 'Customizado' && (
                      <input
                        className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors mt-2"
                        placeholder={t('vehicleCustomColorPlaceholder')}
                        maxLength={30}
                        value={customColor}
                        onChange={e => {
                          const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                          setCustomColor(val);
                        }}
                      />
                    )}

                    {isPlusOrPremium(user?.plan) && newVehicle.color === 'Outra' && (
                      <input
                        className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors mt-2"
                        placeholder={t('vehicleColorPlaceholder')}
                        maxLength={10}
                        value={otherColor}
                        onChange={e => {
                          const val = e.target.value.replace(/[^a-zA-Z ]/g, '');
                          setOtherColor(val);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('year')}</label>
                  <CustomSelect required value={newVehicle.year?.toString()||''} onChange={v=>setNewVehicle({...newVehicle,year:parseInt(v)})} options={Array.from({length:new Date().getFullYear()-1950+1},(_,i)=>new Date().getFullYear()-i).map(y=>({value:y.toString(),label:y.toString()}))} />
                </div>
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('currentKmLabel')}</label>
                  <input 
                    required
                    className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                    value={mileageInput}
                    placeholder={t('mileagePlaceholderZero')}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '');
                      const formatted = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                      setMileageInput(formatted);
                      setNewVehicle({...newVehicle, current_mileage: parseInt(val || '0')});
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('lastGeneralRevision')}</label>
                <LocalizedDateInput
                  required
                  dateFormat={dateFormat}
                  locale={getLocaleFromLanguage(language)}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newVehicle.last_service_date || ''}
                  onChange={iso => setNewVehicle({ ...newVehicle, last_service_date: iso })}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button" 
                  onClick={handleCancelAddVehicle}
                  disabled={isSubmittingVehicle}
                  className="flex-1 glass text-[--color-heading] font-display font-bold py-4 rounded-xl hover:bg-white/8 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmittingVehicle}
                  className="flex-1 bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingVehicle ? t('saving') : t('addButton')}
                </button>
              </div>
            </form>
          </div>
          </div>
        </div>
      )}

      {showAddLog && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) closeLogModal(); }}
        >
          <div
            className="w-full md:max-w-lg md:mx-auto rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(0,0,0,0.10)', boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }
                : { background: 'rgba(20,22,24,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(255,255,255,0.13)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }
            }
          >
          <div className="p-5">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">
                {editingMaintenanceLogId !== null ? t('editMaintenanceTitle') : t('newMaintenanceTitle')}
              </h2>
              <div className="flex items-center gap-1">
                {editingMaintenanceLogId !== null && (
                  <button
                    type="button"
                    onClick={handleDeleteLog}
                    disabled={isDeletingRecord || isSubmittingLog}
                    aria-label={t('deleteRecord')}
                    className="text-[#e0473f] hover:bg-revis-alert-critical/10 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button onClick={closeLogModal} className="text-[--color-revis-gray] p-2">
                  {t('cancel')}
                </button>
              </div>
            </div>
            
            <form onSubmit={handleAddLog} className="space-y-6">
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('descriptionLabel')}</label>
                <input 
                  required
                  placeholder={t('logDescriptionPlaceholder')}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newLog.description || ''}
                  onChange={e => setNewLog({...newLog, description: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('responsible')}</label>
                <input 
                  placeholder={t('logProviderPlaceholder')}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newLog.provider || ''}
                  onChange={e => setNewLog({...newLog, provider: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('date')}</label>
                  <LocalizedDateInput
                    required
                    dateFormat={dateFormat}
                    locale={getLocaleFromLanguage(language)}
                    className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                    value={newLog.date || ''}
                    onChange={iso => setNewLog({ ...newLog, date: iso })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">
                    {t('value')} ({getCurrencySymbol(currency, getLocaleFromLanguage(language))})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                    value={newLog.cost ?? ''}
                    onChange={e => setNewLog({...newLog, cost: parseFloat(e.target.value)})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('notesLabel')}</label>
                <textarea
                  maxLength={200}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors resize-none h-24"
                  value={newLog.notes || ''}
                  onChange={e => setNewLog({...newLog, notes: e.target.value})}
                  placeholder={t('maintenanceNotesPlaceholder')}
                />
                <div className="flex items-center justify-between mt-1">
                  <label
                    htmlFor="maintenance-attachment-input"
                    className={`text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                      newLog.attachment_path ? 'text-[#34a06a]' : 'text-[--color-revis-gray] hover:text-[#34a06a]'
                    }`}
                  >
                    {isUploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                    {newLog.attachment_path ? t('attachmentAdded') : t('attachmentAddButton')}
                  </label>
                  <span className="text-xs text-[--color-revis-gray]">{(newLog.notes?.length || 0)}/200</span>
                </div>
                <input
                  id="maintenance-attachment-input"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={isUploadingAttachment}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void handleRecordAttachmentUpload(file, 'maintenance', path => setNewLog(prev => ({ ...prev, attachment_path: path })));
                    e.target.value = '';
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingLog || isDeletingRecord}
                className="w-full bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingLog
                  ? t('saving')
                  : editingMaintenanceLogId !== null
                  ? t('saveChanges')
                  : t('registerServiceButton')}
              </button>
            </form>
          </div>
          </div>
        </div>
      )}

      {/* Add/Edit Financial Record Modal */}
      {showAddFinancial && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) closeFinancialModal(); }}
        >
          <div
            className="w-full md:max-w-lg md:mx-auto rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(0,0,0,0.10)', boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }
                : { background: 'rgba(20,22,24,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(255,255,255,0.13)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }
            }
          >
          <div className="p-5">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">
                {editingFinancialRecordId !== null ? t('editFinancialTitle') : t('newFinancialTitle')}
              </h2>
              <div className="flex items-center gap-1">
                {editingFinancialRecordId !== null && (
                  <button
                    type="button"
                    onClick={handleDeleteFinancial}
                    disabled={isDeletingRecord || isSubmittingFinancial}
                    aria-label={t('deleteRecord')}
                    className="text-[#e0473f] hover:bg-revis-alert-critical/10 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button onClick={closeFinancialModal} className="text-[--color-revis-gray] p-2">
                  {t('cancel')}
                </button>
              </div>
            </div>
            
            <form onSubmit={handleAddFinancial} className="space-y-6">
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-2">{t('typeLabel')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Imposto', 'Multa', 'Taxa'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={isSubmittingFinancial}
                      onClick={() => setNewFinancial({...newFinancial, type: type as any})}
                      className={`p-3 rounded-xl border flex items-center justify-center transition-colors ${
                        newFinancial.type === type 
                          ? 'bg-[#34a06a]/10 border-[#34a06a] text-[#34a06a]' 
                          : 'glass border-transparent text-[--color-revis-gray]'
                      }`}
                    >
                      <span className="text-sm font-medium">{financialTypeLabel(type)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('descriptionLabel')}</label>
                <input 
                  required
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newFinancial.description || ''}
                  onChange={e => setNewFinancial({...newFinancial, description: e.target.value})}
                  placeholder={t('financialDescPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('dueDateLabel')}</label>
                  <LocalizedDateInput
                    required
                    dateFormat={dateFormat}
                    locale={getLocaleFromLanguage(language)}
                    className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                    value={newFinancial.due_date || ''}
                    onChange={iso => setNewFinancial({ ...newFinancial, due_date: iso })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">
                    {t('value')} ({getCurrencySymbol(currency, getLocaleFromLanguage(language))})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                    value={newFinancial.value ?? ''}
                    onChange={e => setNewFinancial({...newFinancial, value: parseFloat(e.target.value)})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-2">{t('statusLabel')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Pago', 'Em aberto', 'Atrasado'].map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={isSubmittingFinancial}
                      onClick={() => setNewFinancial({...newFinancial, status: status as any})}
                      className={`p-3 rounded-xl border flex items-center justify-center transition-colors ${
                        newFinancial.status === status 
                          ? status === 'Pago' ? 'bg-[#34a06a]/10 border-[#34a06a] text-[#34a06a]' : status === 'Atrasado' ? 'bg-revis-alert-critical/10 border-revis-alert-critical text-[#e0473f]' : 'bg-revis-alert-medium/10 border-revis-alert-medium text-[#ffcc00]'
                          : 'glass border-transparent text-[--color-revis-gray]'
                      }`}
                    >
                      <span className="text-sm font-medium">{financialStatusLabel(status)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {newFinancial.status === 'Pago' && (
                <div>
                  <label className="block text-sm text-[--color-revis-gray] mb-1">{t('paymentDateLabel')}</label>
                  <LocalizedDateInput
                    required
                    dateFormat={dateFormat}
                    locale={getLocaleFromLanguage(language)}
                    className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                    value={newFinancial.payment_date || ''}
                    onChange={iso => setNewFinancial({ ...newFinancial, payment_date: iso })}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('notesLabel')}</label>
                <textarea 
                  maxLength={200}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors resize-none h-24"
                  value={newFinancial.notes || ''}
                  onChange={e => setNewFinancial({...newFinancial, notes: e.target.value})}
                  placeholder={t('financialNotesPlaceholder')}
                />
                <div className="flex items-center justify-between mt-1">
                  <label
                    htmlFor="financial-attachment-input"
                    className={`text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                      newFinancial.attachment_path ? 'text-[#34a06a]' : 'text-[--color-revis-gray] hover:text-[#34a06a]'
                    }`}
                  >
                    {isUploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                    {newFinancial.attachment_path ? t('attachmentAdded') : t('attachmentAddButton')}
                  </label>
                  <span className="text-xs text-[--color-revis-gray]">{(newFinancial.notes?.length || 0)}/200</span>
                </div>
                <input
                  id="financial-attachment-input"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={isUploadingAttachment}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void handleRecordAttachmentUpload(file, 'financial', path => setNewFinancial(prev => ({ ...prev, attachment_path: path })));
                    e.target.value = '';
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingFinancial || isDeletingRecord}
                className="w-full bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingFinancial
                  ? t('saving')
                  : editingFinancialRecordId !== null
                  ? t('saveChanges')
                  : t('saveFinancialRecord')}
              </button>
            </form>
          </div>
          </div>
        </div>
      )}
      {showAddMileage && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) closeMileageModal(); }}
        >
          <div
            className="w-full md:max-w-lg md:mx-auto rounded-t-2xl md:rounded-2xl max-h-[88vh] overflow-y-auto"
            style={
              theme === 'light'
                ? { background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(0,0,0,0.10)', boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }
                : { background: 'rgba(20,22,24,0.96)', backdropFilter: 'blur(36px) saturate(195%)', WebkitBackdropFilter: 'blur(36px) saturate(195%)', border: '1px solid rgba(255,255,255,0.13)', boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }
            }
          >
          <div className="p-5">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-[--color-heading] font-display">
                {editingMileageLogId ? t('editFuelingTitle') : t('newFuelingTitle')}
              </h2>
              <div className="flex items-center gap-1">
                {editingMileageLogId && (
                  <button
                    type="button"
                    onClick={handleDeleteMileage}
                    disabled={isDeletingRecord || isSubmittingMileage}
                    aria-label={t('deleteRecord')}
                    className="text-[#e0473f] hover:bg-revis-alert-critical/10 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button onClick={closeMileageModal} className="text-[--color-revis-gray] p-2">
                  {t('cancel')}
                </button>
              </div>
            </div>

            <form onSubmit={handleMileageSubmit} className="space-y-6">
              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('date')}</label>
                <LocalizedDateInput
                  required
                  dateFormat={dateFormat}
                  locale={getLocaleFromLanguage(language)}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newMileage.date || ''}
                  onChange={iso => setNewMileage({ ...newMileage, date: iso })}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">
                  {t('value')} ({getCurrencySymbol(currency, getLocaleFromLanguage(language))})
                </label>
                <input
                  inputMode="decimal"
                  placeholder={t('valuePlaceholderDecimal')}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newMileage.valor || ''}
                  onChange={e => {
                    const decSep = getLocaleDecimalSeparator(language);
                    const thouSep = decSep === ',' ? '.' : ',';
                    // Mantém apenas dígitos e o separador decimal local; aceita também o separador alternativo digitando rápido.
                    const cleaned = e.target.value
                      .replace(new RegExp(`[^0-9${decSep === '.' ? '\\.' : decSep}${thouSep === '.' ? '\\.' : thouSep}]`, 'g'), '')
                      .replace(new RegExp(`\\${thouSep}`, 'g'), '');
                    setNewMileage({ ...newMileage, valor: cleaned });
                  }}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('litersLabel')}</label>
                <input
                  inputMode="decimal"
                  placeholder={t('litersPlaceholderDecimal')}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newMileage.litros || ''}
                  onChange={e => {
                    const decSep = getLocaleDecimalSeparator(language);
                    const thouSep = decSep === ',' ? '.' : ',';
                    const cleaned = e.target.value
                      .replace(new RegExp(`[^0-9${decSep === '.' ? '\\.' : decSep}${thouSep === '.' ? '\\.' : thouSep}]`, 'g'), '')
                      .replace(new RegExp(`\\${thouSep}`, 'g'), '');
                    setNewMileage({ ...newMileage, litros: cleaned });
                  }}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('currentKmLabel')}</label>
                <input
                  required
                  inputMode="numeric"
                  placeholder={t('mileagePlaceholderZero')}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors"
                  value={newMileage.mileage || ''}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '');
                    const formatted = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                    setNewMileage({...newMileage, mileage: formatted});
                  }}
                />
              </div>

              <div>
                <label className="block text-sm text-[--color-revis-gray] mb-1">{t('notesLabel')}</label>
                <textarea
                  maxLength={200}
                  className="w-full glass border border-transparent focus:border-[#34a06a] rounded-xl p-4 text-[--color-text] outline-none transition-colors resize-none h-24"
                  value={newMileage.notes || ''}
                  onChange={e => setNewMileage({...newMileage, notes: e.target.value})}
                  placeholder={t('mileageNotesPlaceholder')}
                />
                <div className="flex items-center justify-between mt-1">
                  <label
                    htmlFor="mileage-attachment-input"
                    className={`text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                      newMileage.attachment_path ? 'text-[#34a06a]' : 'text-[--color-revis-gray] hover:text-[#34a06a]'
                    }`}
                  >
                    {isUploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                    {newMileage.attachment_path ? t('attachmentAdded') : t('attachmentAddButton')}
                  </label>
                  <span className="text-xs text-[--color-revis-gray]">{(newMileage.notes?.length || 0)}/200</span>
                </div>
                <input
                  id="mileage-attachment-input"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={isUploadingAttachment}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void handleRecordAttachmentUpload(file, 'mileage', path => setNewMileage(prev => ({ ...prev, attachment_path: path })));
                    e.target.value = '';
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingMileage || isDeletingRecord}
                className="w-full bg-[#34a06a] text-black font-bold py-4 rounded-xl hover:bg-opacity-90 transition-colors mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmittingMileage
                  ? t('saving')
                  : editingMileageLogId
                  ? t('saveChanges')
                  : t('addButton')}
              </button>
            </form>
          </div>
          </div>
        </div>
      )}

      {/* View Record Modal (read-only) */}
      {isViewModalOpen && viewingRecord && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={closeViewRecord}
        >
          <div
            className="glass rounded-2xl p-6 max-w-md w-full border border-[--color-border] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-5">
              <h3 className="text-xl font-bold text-[#34a06a]">
                {viewingRecord.kind === 'mileage' && t('viewFuelingTitle')}
                {viewingRecord.kind === 'maintenance' && t('viewMaintenanceTitle')}
                {viewingRecord.kind === 'financial' && t('viewFinancialTitle')}
              </h3>
              <button
                type="button"
                onClick={closeViewRecord}
                aria-label={t('closeButton')}
                className="text-[--color-revis-gray] hover:text-[--color-text] p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <dl className="space-y-4 text-sm max-h-[60vh] overflow-y-auto pr-1">
              {viewingRecord.kind === 'mileage' && (() => {
                // Recalcula o KM/L do registro selecionado a partir do histórico do veículo,
                // respeitando a mesma regra cronológica usada na listagem.
                const mileageNotes = typeof (viewingRecord.data as any)?.notes === 'string'
                  ? (viewingRecord.data as any).notes
                  : '';
                const all = selectedVehicle?.mileage_history || [];
                const sorted = [...all].sort((a, b) => {
                  const da = new Date(a.date).getTime();
                  const db = new Date(b.date).getTime();
                  if (da !== db) return da - db;
                  return Number(a.id ?? 0) - Number(b.id ?? 0);
                });
                const idx = sorted.findIndex(l => l.id === viewingRecord.data.id && l.id !== undefined);
                const isInitial = idx === 0;
                let kmPerLiter: number | null = null;
                if (!isInitial && idx > 0) {
                  const prev = sorted[idx - 1];
                  const liters = Number(viewingRecord.data.litros);
                  const deltaKm = Number(viewingRecord.data.mileage) - Number(prev.mileage);
                  if (Number.isFinite(liters) && liters > 0 && Number.isFinite(deltaKm) && deltaKm > 0) {
                    kmPerLiter = deltaKm / liters;
                  }
                }
                return (
                  <>
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('date')}</dt>
                      <dd className="text-[--color-text]">{formatAppDate(viewingRecord.data.date, dateFormat)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('value')}</dt>
                      <dd className="text-[#34a06a] font-semibold">
                        {viewingRecord.data.valor !== null && viewingRecord.data.valor !== undefined
                          ? formatAppCurrency(Number(viewingRecord.data.valor), currency, language)
                          : '-'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('litersLabel')}</dt>
                      <dd className="text-[--color-text]">
                        {viewingRecord.data.litros !== null && viewingRecord.data.litros !== undefined
                          ? `${formatDecimal(Number(viewingRecord.data.litros), language, 2)} ${t('litersShort')}`
                          : '-'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('km')}</dt>
                      <dd className="text-[--color-text] font-semibold">{(viewingRecord.data.mileage || 0).toLocaleString(getLocaleFromLanguage(language))} km</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('fuelEfficiency')}</dt>
                      <dd className={isInitial ? 'text-[--color-revis-gray]' : 'text-[--color-text] font-semibold'}>
                        {isInitial
                          ? t('initialRecord')
                          : kmPerLiter !== null
                          ? `${formatDecimal(kmPerLiter, language, 1)} km/l`
                          : '-'}
                      </dd>
                    </div>
                    {mileageNotes && (
                      <div>
                        <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('notesLabel')}</dt>
                        <dd className="text-[--color-text] whitespace-pre-wrap break-words">
                          {mileageNotesLabel(mileageNotes)}
                        </dd>
                      </div>
                    )}
                  </>
                );
              })()}

              {viewingRecord.kind === 'maintenance' && (
                <>
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('date')}</dt>
                    <dd className="text-[--color-text]">{formatAppDate(viewingRecord.data.date, dateFormat)}</dd>
                  </div>
                  {viewingRecord.data.type && (
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('typeLabel')}</dt>
                      <dd className="text-[--color-text]">{maintenanceTypeLabel(viewingRecord.data.type)}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('descriptionLabel')}</dt>
                    <dd className="text-[--color-text] whitespace-pre-wrap break-words">{viewingRecord.data.description || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('responsible')}</dt>
                    <dd className="text-[--color-text] break-words">{viewingRecord.data.provider || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('value')}</dt>
                    <dd className="text-[#34a06a] font-semibold">{formatAppCurrency(viewingRecord.data.cost, currency, language)}</dd>
                  </div>
                </>
              )}

              {viewingRecord.kind === 'financial' && (
                <>
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('typeLabel')}</dt>
                    <dd className="text-[--color-text]">{financialTypeLabel(viewingRecord.data.type)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('descriptionLabel')}</dt>
                    <dd className="text-[--color-text] whitespace-pre-wrap break-words">{viewingRecord.data.description || '-'}</dd>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('dueDateLabel')}</dt>
                      <dd className="text-[--color-text]">{formatAppDate(viewingRecord.data.due_date, dateFormat)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('statusLabel')}</dt>
                      <dd className={`font-semibold ${
                        viewingRecord.data.status === 'Pago'
                          ? 'text-[#34a06a]'
                          : viewingRecord.data.status === 'Atrasado'
                          ? 'text-[#e0473f]'
                          : 'text-[#ffcc00]'
                      }`}>
                        {financialStatusLabel(viewingRecord.data.status)}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('value')}</dt>
                    <dd className="text-[#34a06a] font-semibold">{formatAppCurrency(viewingRecord.data.value, currency, language)}</dd>
                  </div>
                  {viewingRecord.data.payment_date && (
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('paymentDateLabel')}</dt>
                      <dd className="text-[--color-text]">{formatAppDate(viewingRecord.data.payment_date, dateFormat)}</dd>
                    </div>
                  )}
                  {viewingRecord.data.notes && (
                    <div>
                      <dt className="text-xs text-[--color-revis-gray] uppercase tracking-wider mb-1">{t('notesLabel')}</dt>
                      <dd className="text-[--color-text] whitespace-pre-wrap break-words">{viewingRecord.data.notes}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>

            <div className="mt-6">
              <button
                type="button"
                onClick={closeViewRecord}
                className="w-full bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('closeButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support Modal */}
      {isSupportModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={closeSupportModal}
        >
          <div
            className="glass rounded-2xl p-6 max-w-md w-full border border-[--color-border] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-2">
                {supportMethod !== null && (
                  <button
                    type="button"
                    onClick={() => setSupportMethod(null)}
                    aria-label={t('back')}
                    className="text-[--color-revis-gray] hover:text-[--color-text] p-1 rounded-lg transition-colors -ml-1"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <h3 className="text-xl font-bold text-[#34a06a]">
                  {supportMethod === 'email'
                    ? t('supportEmailTitle')
                    : supportMethod === 'whatsapp'
                    ? t('supportWhatsappTitle')
                    : t('supportTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeSupportModal}
                aria-label={t('closeButton')}
                className="text-[--color-revis-gray] hover:text-[--color-text] p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {supportMethod === null && (
              <div className="space-y-5">
                <p className="text-sm text-[--color-text]">
                  {t('supportChooseMethod')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSupportMethod('email')}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-[--color-border] bg-black/30 hover:bg-white/5 hover:border-revis-gray/60 transition-colors"
                  >
                    <Mail className="w-8 h-8 text-[--color-text]" />
                    <span className="font-medium text-[--color-heading] font-display">{t('supportEmail')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupportMethod('whatsapp')}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-[--color-border] bg-black/30 hover:bg-white/5 hover:border-revis-gray/60 transition-colors"
                  >
                    <WhatsAppIcon className="w-8 h-8 text-[#25D366]" />
                    <span className="font-medium text-[--color-heading] font-display">{t('supportWhatsapp')}</span>
                  </button>
                </div>
              </div>
            )}

            {supportMethod === 'email' && (
              <div className="space-y-5">
                <p className="text-sm text-[--color-text]">
                  {t('supportEmailDesc')}
                </p>
                <a
                  href="mailto:dev@revisautoapp.com.br"
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
                >
                  <Mail className="w-5 h-5" />
                  {t('supportEmailCta')}
                </a>
              </div>
            )}

            {supportMethod === 'whatsapp' && (
              <div className="space-y-5">
                <p className="text-sm text-[--color-text]">
                  {t('supportWhatsappDesc')}
                </p>
                <a
                  href="https://wa.me/5511918540985"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
                >
                  <WhatsAppIcon className="w-5 h-5" />
                  {t('supportWhatsappCta')}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Preferences Confirmation Modal Removed */}
      {/* Cancel Preferences Confirmation Modal Removed */}

      {/* No Changes Modal Removed */}

      {/* Cancel Add Vehicle Confirmation Modal */}
      {showCancelAddVehicleConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border]">
            <h3 className="text-xl font-bold text-[--color-heading] font-display mb-2">{t('confirmCancelAddVehicle')}</h3>
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setShowCancelAddVehicleConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={handleConfirmCancelAddVehicle}
                className="flex-1 bg-revis-alert-critical text-[--color-heading] font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Confirmation Modal */}
      {showEditConfirmation && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border] shadow-xl">
            <h3 className="text-lg font-bold text-[--color-heading] font-display mb-2">{t('confirmChanges')}</h3>
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setShowEditConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/8 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={handleConfirmSave}
                className="flex-1 bg-[#34a06a] text-black font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Edit Confirmation Modal */}
      {showCancelEditConfirmation && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="glass rounded-2xl p-6 max-w-sm w-full border border-[--color-border] shadow-xl">
            <h3 className="text-lg font-bold text-[--color-heading] font-display mb-2">{t('cancelChanges')}</h3>
            <p className="text-[--color-revis-gray] text-sm">{t('cancelChangesMsg')}</p>
            <div className="flex gap-3 mt-6">
              <button 
                onClick={() => setShowCancelEditConfirmation(false)}
                className="flex-1 glass border border-[--color-border] text-[--color-text] font-bold py-3 rounded-xl hover:bg-white/8 transition-colors"
              >
                {t('no')}
              </button>
              <button 
                onClick={handleConfirmCancel}
                className="flex-1 bg-revis-alert-critical text-[--color-heading] font-bold py-3 rounded-xl hover:bg-opacity-90 transition-colors"
              >
                {t('yes')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Planos / Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200 overflow-y-auto">
          <div className="plans-modal-panel rounded-2xl p-5 sm:p-6 max-w-5xl w-full border border-[--color-border] shadow-xl relative my-4 max-h-[92vh] overflow-y-auto">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-revis-green via-revis-green/70 to-revis-green rounded-t-2xl" />
            <button
              type="button"
              aria-label={t('cancel')}
              onClick={() => !checkoutLoadingPlan && setShowUpgradeModal(false)}
              className="absolute top-3 right-3 p-2 rounded-lg text-[--color-revis-gray] hover:text-[--color-heading] font-display hover:bg-black/30 transition-colors disabled:opacity-40"
              disabled={!!checkoutLoadingPlan}
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 pr-8">
              <div>
                <h3 className="text-2xl font-bold text-[--color-heading] font-display">{t('plans')}</h3>
                <p className="text-[--color-revis-gray] text-sm mt-1 max-w-xl">{t('pricingPageSubtitle')}</p>
                {(normalizePlan(user?.plan) === 'plus' || normalizePlan(user?.plan) === 'premium') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSubscriptionManageView('menu');
                      setSubscriptionManageOpen(true);
                    }}
                    className="mt-3 block text-xs text-[#34a06a]/90 hover:text-[#34a06a] font-medium underline underline-offset-2"
                  >
                    {t('manageSubscription')}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`text-xs font-semibold whitespace-nowrap ${
                    pricingPeriod === 'monthly' ? 'text-[--color-heading] font-display' : 'text-[--color-revis-gray]'
                  }`}
                >
                  {t('billingMonthly')}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pricingPeriod === 'annual'}
                  aria-label={`${t('billingMonthly')} / ${t('billingAnnual')}`}
                  onClick={() =>
                    setPricingPeriod((p) => (p === 'monthly' ? 'annual' : 'monthly'))
                  }
                  className={`relative inline-flex h-7 w-[3.35rem] shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-revis-green/70 ${
                    pricingPeriod === 'annual'
                      ? 'bg-[#34a06a]'
                      : 'bg-black/60 border border-[--color-border]'
                  }`}
                >
                  <span
                    className={`pointer-events-none absolute top-0.5 left-0.5 h-[1.375rem] w-[1.375rem] rounded-full bg-white shadow transition-transform duration-200 ${
                      pricingPeriod === 'annual' ? 'translate-x-[1.375rem]' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span
                  className={`text-xs font-semibold whitespace-nowrap ${
                    pricingPeriod === 'annual' ? 'text-[--color-heading] font-display' : 'text-[--color-revis-gray]'
                  }`}
                >
                  {t('billingAnnual')}
                </span>
              </div>
            </div>

            {(() => {
              const loc = getLocaleFromLanguage(language);
              const fmtMoney = (n: number) =>
                new Intl.NumberFormat(loc, { style: 'currency', currency: 'BRL' }).format(n);
              const plusVal =
                pricingPeriod === 'monthly'
                  ? CHECKOUT_PRICES_BRL.plus.monthly
                  : CHECKOUT_PRICES_BRL.plus.annual;
              const premVal =
                pricingPeriod === 'monthly'
                  ? CHECKOUT_PRICES_BRL.premium.monthly
                  : CHECKOUT_PRICES_BRL.premium.annual;
              const tier = normalizePlan(user?.plan);

              const checklistForPlan = (plan: PlanTier): { excluded: boolean; label: string }[] => {
                const fuel = t('planFeatFuelServices');
                const personalization = t('planFeatPersonalization');
                const taxes = t('planFeatTaxesFines');
                const filters = t('planFeatReportFilters');
                const chats = t('planFeatChatBackup');
                const vehicleBackup = t('planFeatVehicleBackup');

                let rows: { excluded: boolean; label: string }[];
                switch (plan) {
                  case 'free':
                    rows = [
                      { excluded: false, label: t('planFeatVehicleFree') },
                      { excluded: false, label: fuel },
                      { excluded: true, label: personalization },
                      { excluded: true, label: taxes },
                      { excluded: true, label: filters },
                      { excluded: true, label: t('planFeatDrGraxaConsultant') },
                      { excluded: true, label: chats },
                      { excluded: true, label: vehicleBackup },
                    ];
                    break;
                  case 'plus':
                    rows = [
                      { excluded: false, label: t('planFeatVehiclePlus') },
                      { excluded: false, label: fuel },
                      { excluded: false, label: personalization },
                      { excluded: false, label: taxes },
                      { excluded: false, label: filters },
                      { excluded: false, label: t('planFeatDrGraxaConsultantPlus') },
                      { excluded: false, label: chats },
                      { excluded: true, label: vehicleBackup },
                    ];
                    break;
                  default:
                    rows = [
                      { excluded: false, label: t('planFeatVehiclePremium') },
                      { excluded: false, label: fuel },
                      { excluded: false, label: personalization },
                      { excluded: false, label: taxes },
                      { excluded: false, label: filters },
                      { excluded: false, label: t('planFeatDrGraxaConsultantPremium') },
                      { excluded: false, label: chats },
                      { excluded: false, label: vehicleBackup },
                    ];
                }

                return [...rows].sort((a, b) =>
                  a.excluded === b.excluded ? 0 : a.excluded ? 1 : -1,
                );
              };

              const planOrder: PlanTier[] = ['free', 'plus', 'premium'];

              const priceForPlan = (
                plan: PlanTier,
              ): { headline: string; suffix: string; titleKey: keyof typeof translations['Português (Brasil)'] } => {
                if (plan === 'free') {
                  return { headline: fmtMoney(0), suffix: '', titleKey: 'planFree' };
                }
                const v = plan === 'plus' ? plusVal : premVal;
                const suffix =
                  pricingPeriod === 'monthly' ? t('pricingPerMonth') : t('pricingPerYear');
                return {
                  headline: fmtMoney(v),
                  suffix,
                  titleKey: plan === 'plus' ? 'planPlus' : 'planPremium',
                };
              };

              const renderPlanCardCta = (cardTier: PlanTier) => {
                const busy = checkoutLoadingPlan !== null;
                const baseCls =
                  'w-full font-bold py-2.5 sm:py-3 rounded-xl text-sm min-h-[2.75rem] flex items-center justify-center gap-2 transition-colors disabled:opacity-55 disabled:cursor-not-allowed';
                const spacerCls = `${baseCls} invisible shrink-0 pointer-events-none select-none`;

                /** Mantém mesma altura do CTA quando o botão fica oculto (layout alinhado). */
                const ctaGhost = (
                  <div className={spacerCls} aria-hidden>
                    {/* Reserva espaço igual ao texto do maior CTA */}
                    <span className="invisible">{t('pricingSubscribePremium')}</span>
                  </div>
                );

                /* Plano atual: qualquer tier */
                if (tier === cardTier) {
                  return (
                    <button
                      type="button"
                      disabled
                      className={`${baseCls} shrink-0 bg-black/35 text-[--color-revis-gray] border border-revis-gray/35`}
                    >
                      {t('planCtaYourCurrentPlan')}
                    </button>
                  );
                }

                /* FREE: apenas “seu plano” quando já é Free; caso contrário, slot invisível */
                if (cardTier === 'free') {
                  return ctaGhost;
                }

                /* PLUS */
                if (cardTier === 'plus') {
                  if (tier === 'premium') {
                    return ctaGhost;
                  }
                  return (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleNativePurchase('plus', pricingPeriod)}
                      className={`${baseCls} shrink-0 bg-[#34a06a] text-black hover:bg-opacity-90 shadow-md shadow-black/25`}
                    >
                      {checkoutLoadingPlan === 'plus'
                        ? t('checkoutGeneratingLink')
                        : t('pricingSubscribePlus')}
                    </button>
                  );
                }

                /* PREMIUM — upgrade só se ainda não for Premium */
                if (tier !== 'premium') {
                  return (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleNativePurchase('premium', pricingPeriod)}
                      className={`${baseCls} shrink-0 bg-black/55 text-green-400 border-2 border-green-500 hover:bg-green-500/15 shadow-md shadow-black/25`}
                    >
                      {checkoutLoadingPlan === 'premium'
                        ? t('checkoutGeneratingLink')
                        : t('pricingSubscribePremium')}
                    </button>
                  );
                }

                return ctaGhost;
              };

              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:items-stretch">
                    {planOrder.map((plan) => {
                      const { headline, suffix, titleKey } = priceForPlan(plan);
                      const highlightPlus = plan === 'plus';
                      const highlightPremium = plan === 'premium';
                      const rows = checklistForPlan(plan);

                      return (
                        <article
                          key={plan}
                          className={`flex h-full min-h-0 flex-col rounded-xl border p-4 sm:p-5 ${
                            highlightPlus
                              ? 'border-[#34a06a]/50 bg-[#34a06a]/[0.08] md:shadow-md md:shadow-revis-green/5'
                              : highlightPremium
                                ? 'border-amber-400/35 bg-gradient-to-b from-amber-500/[0.08] to-transparent'
                                : 'border-revis-gray/25 bg-black/28'
                          }`}
                        >
                          <div className="shrink-0 flex flex-wrap items-start justify-between gap-2 mb-2">
                            <h4 className="text-lg font-bold text-[--color-heading] font-display">{t(titleKey)}</h4>
                            {tier === plan && (
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-revis-gray/25 text-[--color-revis-gray] whitespace-nowrap">
                                {t('planBadgeCurrent')}
                              </span>
                            )}
                          </div>

                          <div className="shrink-0 text-xl font-bold text-[#34a06a] leading-tight">
                            {headline}
                            {suffix ? (
                              <span className="block sm:inline text-sm font-normal text-[--color-revis-gray] mt-0.5 sm:mt-0 sm:ml-1">
                                {suffix}
                              </span>
                            ) : null}
                          </div>

                          <ul className="mt-4 flex-1 min-h-0 space-y-2.5 border-t border-revis-gray/15 pt-4 text-sm leading-snug">
                            {rows.map((row, idx) => (
                              <li key={`${plan}-${idx}`} className="flex gap-2.5 items-start">
                                <span className="shrink-0 mt-0.5" aria-hidden>
                                  {row.excluded ? (
                                    <X className="w-[1.125rem] h-[1.125rem] text-red-500 stroke-[2.5]" />
                                  ) : (
                                    <Check className="w-[1.125rem] h-[1.125rem] text-green-500 stroke-[2.5]" />
                                  )}
                                </span>
                                <p
                                  className={`text-left font-medium min-w-0 ${
                                    row.excluded
                                      ? 'text-[--color-revis-gray]/55'
                                      : 'text-[--color-heading] font-display'
                                  }`}
                                >
                                  {row.label}
                                </p>
                              </li>
                            ))}
                          </ul>

                          <div className="mt-auto w-full shrink-0 pt-4">{renderPlanCardCta(plan)}</div>
                        </article>
                      );
                    })}
                  </div>

                  <p className="text-[10px] text-[--color-revis-gray] text-center mt-5">{t('premiumFooterNote')}</p>
                </>
              );
            })()}
          </div>
        </div>
      )}
      {subscriptionManageOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subscription-manage-title"
        >
          <div className="glass rounded-2xl p-6 max-w-md w-full border border-revis-gray/25 shadow-xl">
            <h3 id="subscription-manage-title" className="text-lg font-bold text-[--color-heading] font-display mb-4">
              {t('subscriptionManageTitle')}
            </h3>

            {subscriptionManageView === 'menu' && (
              <div className="space-y-4">
                <p className="text-sm text-[--color-revis-gray]">{t('subscriptionManagePickTitle')}</p>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-black/40 border border-revis-gray/25 text-[--color-heading] font-display font-semibold text-sm hover:bg-black/55"
                  onClick={() => setSubscriptionManageView('changePlan')}
                >
                  {t('subscriptionChangePlan')}
                </button>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-black/40 border border-revis-gray/25 text-[--color-heading] font-display font-semibold text-sm hover:bg-black/55"
                  onClick={() => setSubscriptionManageView('cancelInfo')}
                >
                  {t('subscriptionCancelPlan')}
                </button>
                <button
                  type="button"
                  className="w-full py-3 text-[--color-revis-gray] text-sm font-medium"
                  onClick={() => setSubscriptionManageOpen(false)}
                >
                  {t('subscriptionManageClose')}
                </button>
              </div>
            )}

            {subscriptionManageView === 'changePlan' && (
              <div className="space-y-4">
                <p className="text-sm text-[--color-text] leading-relaxed">
                  {user?.subscription_period_end
                    ? t('subscriptionChangePlanExplain').replace(
                        '{date}',
                        formatAppDate(user.subscription_period_end, dateFormat),
                      )
                    : t('subscriptionChangePlanExplainNoDate')}
                </p>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-revis-alert-critical/90 text-[--color-heading] font-bold text-sm"
                  onClick={() =>
                    window.open(mercadoPagoSubscriptionsPortalUrl(), '_blank', 'noopener,noreferrer')
                  }
                >
                  {t('subscriptionCancelPlan')}
                </button>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-[#34a06a] text-black font-bold text-sm"
                  onClick={() => {
                    setSubscriptionManageOpen(false);
                    setShowUpgradeModal(false);
                    setActiveTab('garage');
                  }}
                >
                  {t('subscriptionBackGarage')}
                </button>
              </div>
            )}

            {subscriptionManageView === 'cancelInfo' && (
              <div className="space-y-4">
                <p className="text-sm text-[--color-text] leading-relaxed">{t('subscriptionCancelExplain')}</p>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-[#34a06a] text-black font-bold text-sm"
                  onClick={() =>
                    window.open(mercadoPagoSubscriptionsPortalUrl(), '_blank', 'noopener,noreferrer')
                  }
                >
                  {t('subscriptionOpenMpPortal')}
                </button>
                <button
                  type="button"
                  className="w-full py-3 text-[--color-revis-gray] text-sm font-medium"
                  onClick={() => setSubscriptionManageOpen(false)}
                >
                  {t('subscriptionManageClose')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {appToast && (
        <div
          className="fixed left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[100] bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 animate-in slide-in-from-bottom-2 fade-in duration-200 pointer-events-none"
          role="status"
        >
          <div
            className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg border pointer-events-auto ${
              appToast.tone === 'warning'
                ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                : 'glass border-[--color-border] text-[--color-heading] font-display'
            }`}
          >
            {appToast.message}
          </div>
        </div>
      )}
    </div>
  );
}
