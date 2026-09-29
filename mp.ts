/**
 * Cliente REST mínimo do Mercado Pago.
 *
 * Substitui o pacote `mercadopago`, que depende de `node-fetch@2` — uma
 * biblioteca construída sobre os módulos http/https/stream/zlib do Node e que
 * não roda no runtime do Cloudflare Workers. O SDK também usa
 * `response.headers.raw()`, um método exclusivo do node-fetch que não existe
 * no Headers padrão da web, então um simples alias para o fetch nativo não
 * seria suficiente.
 *
 * O projeto usava apenas 3 chamadas do SDK, todas reproduzidas aqui com
 * `fetch` nativo. Sem dependências.
 *
 * Referência: https://www.mercadopago.com.br/developers/pt/reference
 */

const MP_BASE_URL = 'https://api.mercadopago.com';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 3;

export interface MpPreApproval {
  id?: string;
  init_point?: string;
  status?: string;
  external_reference?: string;
  payer_id?: number;
  auto_recurring?: Record<string, unknown>;
  next_payment_date?: string;
  last_charged_date?: string;
  summarized?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MpPayment {
  id?: number | string;
  status?: string;
  external_reference?: string;
  metadata?: Record<string, unknown>;
  preapproval_id?: string;
  [key: string]: unknown;
}

export class MercadoPagoError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message || `Mercado Pago respondeu ${status}`);
    this.name = 'MercadoPagoError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Chave de idempotência exigida pelo Mercado Pago em requisições de escrita.
 * Usa crypto.randomUUID(), disponível tanto no Workers quanto no Node 19+.
 */
function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function mpRequest<T>(
  accessToken: string,
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PUT';
    body?: unknown;
    retries?: number;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = init;

  if (!accessToken) {
    throw new MercadoPagoError(0, null, 'MP_ACCESS_TOKEN ausente.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (method !== 'GET') {
    headers['X-Idempotency-Key'] = generateIdempotencyKey();
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // AbortSignal.timeout() é suportado no Workers e no Node 18+.
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await fetch(`${MP_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });

      if (response.status === 204) return {} as T;

      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (response.ok) return parsed as T;

      // 4xx é erro definitivo do cliente — não adianta repetir.
      if (response.status < 500) {
        throw new MercadoPagoError(
          response.status,
          parsed,
          typeof parsed === 'object' && parsed !== null && 'message' in parsed
            ? String((parsed as { message: unknown }).message)
            : undefined,
        );
      }

      lastError = new MercadoPagoError(response.status, parsed);
    } catch (error) {
      // Erro definitivo já classificado: propaga sem repetir.
      if (error instanceof MercadoPagoError && error.status > 0 && error.status < 500) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < retries) {
      // Backoff exponencial: 1s, 2s, 4s — mesma política do SDK original.
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new MercadoPagoError(500, lastError, 'Falha ao contatar o Mercado Pago.');
}

/** POST /preapproval — cria uma assinatura recorrente. */
export function createPreApproval(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<MpPreApproval> {
  return mpRequest<MpPreApproval>(accessToken, '/preapproval', {
    method: 'POST',
    body,
  });
}

/** GET /preapproval/{id} — consulta uma assinatura. */
export function getPreApproval(
  accessToken: string,
  id: string,
): Promise<MpPreApproval> {
  return mpRequest<MpPreApproval>(
    accessToken,
    `/preapproval/${encodeURIComponent(id)}`,
  );
}

/** GET /v1/payments/{id} — consulta um pagamento. */
export function getPayment(
  accessToken: string,
  id: string,
): Promise<MpPayment> {
  return mpRequest<MpPayment>(
    accessToken,
    `/v1/payments/${encodeURIComponent(id)}`,
  );
}
