import { Hono } from "hono";
import type { Context, Next } from "hono";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { createPreApproval, getPreApproval, getPayment } from "./mp.ts";
import type { User, Vehicle, MaintenanceLog, FinancialRecord } from "./src/types.ts";
import {
  normalizePlan,
  type PlanTier,
  VEHICLE_LIMIT,
  AI_MESSAGE_MONTHLY_LIMIT,
  CHECKOUT_PRICES_BRL,
  buildMpExternalReference,
  parseMpExternalReference,
  normalizeCheckoutPeriod,
  type CheckoutPlan,
  type CheckoutPeriod,
} from "./src/plans.ts";

/**
 * No Cloudflare Workers as variáveis vêm do binding `env`, não de
 * process.env. O fallback mantém o código rodando sob Node puro (ex.: testes).
 */
// No Cloudflare Workers o env é injetado por requisição.
// Usamos uma variável de módulo que é preenchida no primeiro fetch.
let _env: Record<string, string | undefined> = {};
let _envReady = false;

// Guarda o env BRUTO (não só as strings) — é onde vivem os bindings que não
// são texto, como os rate limiters abaixo (cada um é um objeto com método
// .limit(), não uma variável de ambiente comum).
let _rawEnv: any = {};

export function setEnv(e: Record<string, string | undefined>) {
  _rawEnv = e;
  if (_envReady) return;
  _env = e;
  _envReady = true;
}

/** Aplica um rate limit nomeado. Se o binding não existir (ex.: ambiente de
 * teste sem wrangler), deixa passar — nunca bloqueia por causa de infra
 * ausente, só por excesso de uso real. */
async function checkRateLimit(bindingName: string, key: string): Promise<boolean> {
  const limiter = _rawEnv?.[bindingName];
  if (!limiter?.limit) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

function envVar(key: string): string {
  const fromWorker = _env[key];
  if (typeof fromWorker === "string" && fromWorker) return fromWorker;
  const fromNode = (globalThis as any)?.process?.env?.[key];
  return typeof fromNode === "string" ? fromNode : "";
}

// ─── Clients lazy ────────────────────────────────────────────────────────────
// No Workers o env só existe dentro do handler de cada requisição.
// Os clients são criados na primeira chamada e resetados pelo fetch handler.
let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
let _supabase: ReturnType<typeof createClient> | null = null;
let _ai: any = null;

function getSupabaseAdmin() {
  if (!_supabaseAdmin)
    _supabaseAdmin = createClient(envVar("VITE_SUPABASE_URL"), envVar("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  return _supabaseAdmin;
}
function getSupabase() {
  if (!_supabase)
    _supabase = createClient(envVar("VITE_SUPABASE_URL"), envVar("VITE_SUPABASE_ANON_KEY"));
  return _supabase;
}
function getAI() {
  if (!_ai) {
    const key = envVar("GEMINI_API_KEY");
    if (!key) console.error("🚨 GEMINI_API_KEY ausente — Dr. Graxa não funcionará.");
    _ai = new GoogleGenAI({ apiKey: key });
  }
  return _ai;
}
function getMpToken() { return envVar("MP_ACCESS_TOKEN"); }
// ─────────────────────────────────────────────────────────────────────────────

// O cliente REST em ./mp.ts recebe o token por parâmetro — não há objeto
// de configuração global como havia no SDK.

function pickFields<T extends object, K extends keyof T>(
  source: Partial<T> | undefined | null,
  fields: ReadonlyArray<K>,
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  if (!source || typeof source !== "object") return out;
  for (const key of fields) {
    if (key in source) {
      const value = (source as Partial<T>)[key];
      if (value !== undefined) {
        out[key] = value as Pick<T, K>[K];
      }
    }
  }
  return out;
}


if (!envVar("VITE_SUPABASE_URL") || !envVar("VITE_SUPABASE_ANON_KEY") || !envVar("SUPABASE_SERVICE_ROLE_KEY")) {
  console.error("❌ ERRO CRÍTICO: Verifique as chaves no arquivo .env");
}

// clients Supabase/Gemini inicializados via getters lazy acima.

function utcYearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function countActiveVehiclesForUser(userId: string): Promise<number> {
  const { count, error } = await (getSupabaseAdmin() as any)
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "archived");
  if (error) {
    console.error("countActiveVehiclesForUser:", error);
    return 999;
  }
  return count ?? 0;
}

/** Reseta contador IA no banco se mudou o mês UTC; retorna uso efetivo. */
async function getEffectiveAiUsage(userId: string): Promise<{
  tier: PlanTier;
  count: number;
  limit: number;
}> {
  const { data: row, error } = await (getSupabaseAdmin() as any)
    .from("users")
    .select("plan, plan_type, ai_messages_count, last_ai_message_date")
    .eq("id", userId)
    .maybeSingle() as { data: any; error: any };
  if (error) console.error("getEffectiveAiUsage select:", error);
  const tier = effectivePlanTierFromRow(row?.plan as string | undefined, row?.plan_type as string | undefined);
  const lim = AI_MESSAGE_MONTHLY_LIMIT[tier];
  let count = Number(row?.ai_messages_count ?? 0) || 0;
  const last = row?.last_ai_message_date;
  const now = new Date();
  if (last) {
    const lastYm = utcYearMonth(new Date(last));
    if (lastYm !== utcYearMonth(now)) {
      count = 0;
      (await (getSupabaseAdmin() as any).from("users").update({ ai_messages_count: 0 }).eq("id", userId) as any) as any;
    }
  }
  return { tier, count, limit: lim };
}

async function incrementAiMessageCount(userId: string, previousCount: number): Promise<void> {
  await (getSupabaseAdmin() as any)
    .from("users")
    .update({
      ai_messages_count: previousCount + 1,
      last_ai_message_date: new Date().toISOString(),
    })
    .eq("id", userId);
}

function effectivePlanTierFromRow(plan?: string | null, plan_type?: string | null): PlanTier {
  const raw =
    typeof plan_type === "string" && plan_type.trim() ? plan_type : typeof plan === "string" ? plan : "";
  return normalizePlan(raw || "free");
}

async function fetchUserTier(userId: string): Promise<PlanTier> {
  const { data, error } = await (getSupabaseAdmin() as any)
    .from("users")
    .select("plan, plan_type")
    .eq("id", userId)
    .maybeSingle() as { data: any; error: any };
  if (error) console.error("fetchUserTier:", error);
  return effectivePlanTierFromRow(data?.plan as string | undefined, data?.plan_type as string | undefined);
}

async function userHasFinancialAccess(userId: string): Promise<boolean> {
  const tier = await fetchUserTier(userId);
  return tier !== "free";
}

/** Dr. Graxa e histórico de chat: Plus ou Premium. */
async function userCanUseAdvisor(userId: string): Promise<boolean> {
  const tier = await fetchUserTier(userId);
  return tier !== "free";
}

/** Backup de veículos (histórico de veículos arquivados/excluídos): só Premium. */
async function userCanSeeVehicleBackup(userId: string): Promise<boolean> {
  const tier = await fetchUserTier(userId);
  return tier === "premium";
}

function getGeminiModel() { return envVar("GEMINI_MODEL") || "gemini-2.5-flash"; }

const VEHICLE_INSERT_FIELDS = [
  "type",
  "brand",
  "model",
  "year",
  "current_mileage",
  "last_service_date",
  "nickname",
  "color",
  "plate",
  "document_path",
] as const satisfies ReadonlyArray<keyof Vehicle>;

const VEHICLE_UPDATE_FIELDS = [
  ...VEHICLE_INSERT_FIELDS,
  "status",
  "deleted_at",
] as const satisfies ReadonlyArray<keyof Vehicle>;

const USER_PROFILE_FIELDS = [
  "name",
  "nickname",
  "email",
  "birth_date",
  "country",
  "phone",
  "zip_code",
  "state",
  "city",
  "location",
] as const satisfies ReadonlyArray<keyof User>;

type RegisterPayload = Partial<User> & {
  email?: string;
  password?: string;
  name?: string;
};

type VehicleCreatePayload = Partial<Vehicle> & { user_id?: Vehicle["user_id"] };

const MILEAGE_LOG_FIELDS = ["date", "mileage", "notes", "valor", "litros", "attachment_path"] as const;

const MAINTENANCE_LOG_FIELDS = [
  "type",
  "description",
  "date",
  "cost",
  "photo_path",
  "provider",
  "notes",
] as const satisfies ReadonlyArray<keyof MaintenanceLog>;

const FINANCIAL_RECORD_FIELDS = [
  "type",
  "description",
  "due_date",
  "value",
  "status",
  "payment_date",
  "notes",
] as const satisfies ReadonlyArray<keyof FinancialRecord>;

function subscriptionEndFromPreapproval(sub: Record<string, unknown> | null | undefined): string | null {
  if (!sub || typeof sub !== "object") return null;
  const next = sub["next_payment_date"];
  if (typeof next === "string" && next.trim()) return next.trim();
  const ar = sub["auto_recurring"];
  if (ar && typeof ar === "object") {
    const end = (ar as Record<string, unknown>)["end_date"];
    if (typeof end === "string" && end.trim()) return end.trim();
  }
  const summarized = sub["summarized"];
  if (summarized && typeof summarized === "object") {
    const last = (summarized as Record<string, unknown>)["last_charged_date"];
    if (typeof last === "string" && last.trim()) return last.trim();
  }
  return null;
}

function startServer() {
  const app = new Hono();
  // Helper: lê o body JSON com fallback vazio.
  async function getBody<T = Record<string, unknown>>(c: Context): Promise<T> {
    try { return await c.req.json() as T; } catch { return {} as T; }
  }



  const corsOrigin = (envVar("CORS_ORIGIN") || "").trim();
  // Endereços com permissão para chamar a API: o site (definido no segredo
  // CORS_ORIGIN) e o próprio aplicativo nativo Android/iOS, que sempre
  // chama a partir de um desses dois endereços internos do WebView do
  // Capacitor (https://localhost no Android, capacitor://localhost no iOS).
  const allowedOrigins = new Set(
    [corsOrigin, "https://localhost", "capacitor://localhost"].filter(Boolean)
  );
  app.use(async (c: Context, next: Next) => {
    const requestOrigin = c.req.header("Origin");
    if (requestOrigin && allowedOrigins.has(requestOrigin)) {
      c.header("Access-Control-Allow-Origin", requestOrigin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (c.req.method === "OPTIONS") return c.text("", 200);
    await next();
  });

  // Headers de segurança nas respostas de API. O arquivo public/_headers já
  // cobre HTML/JS/CSS (servidos direto pelo binding de assets, sem passar
  // por aqui) — respostas geradas pelo Worker (JSON) precisam do próprio
  // conjunto, mais simples porque não há HTML/CSS/JS para restringir aqui.
  app.use(async (c: Context, next: Next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  });

  app.use(async (c: Context, next: Next) => {
    console.log(`➡️  [REQUEST] ${c.req.method} ${c.req.url}`);
    await next();
  });

  // Hono lê JSON com await getBody(c) em cada rota.

  // --- Config pública (versão mínima do app) ---
  app.get("/api/app-config", async (c: Context) => {
    try {
      const { data, error } = await (getSupabaseAdmin() as any)
        .from("app_config")
        .select("min_app_version")
        .eq("id", 1)
        .maybeSingle() as { data: any; error: any };
      if (error) {
        console.error("[app-config]", error.message);
        return c.json({ min_app_version: "1.0.0" });
      }
      const min =
        typeof data?.min_app_version === "string" && data.min_app_version.trim()
          ? data.min_app_version.trim()
          : "1.0.0";
      return c.json({ min_app_version: min });
    } catch (e) {
      console.error("[app-config] exception", e);
      return c.json({ min_app_version: "1.0.0" });
    }
  });

  // --- MIDDLEWARE DE AUTENTICAÇÃO (Supabase JWT) ---

  type AuthedUser = { id: string; email?: string | null };
  
  async function authenticateUser(c: Context, next: Next) {
    const authHeader = c.req.header("authorization");
    const token =
      typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";

    if (!token) {
      return c.json({ success: false, error: "AUTH_TOKEN_MISSING", message: "Token de autenticação ausente." }, 401);
    }

    try {
      const { data, error } = await getSupabase().auth.getUser(token);
      if (error || !data?.user) {
        return c.json({
          success: false,
          error: "AUTH_TOKEN_INVALID",
          message: "Token inválido ou expirado.",
        }, 401);
      }
      (c as any).set("user", { id: data.user.id, email: data.user.email });
      return next();
    } catch (err: any) {
      console.error("🚨 authenticateUser:", err?.message || err);
      return c.json({
        success: false,
        error: "AUTH_TOKEN_VALIDATION_FAILED",
        message: "Falha ao validar token.",
      }, 401);
    }
  }

  async function vehicleBelongsToUser(userId: string, vehicleId: number): Promise<boolean> {
    if (Number.isNaN(vehicleId)) return false;
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("vehicles")
      .select("user_id")
      .eq("id", vehicleId)
      .maybeSingle() as { data: any; error: any };
    if (error || !data) return false;
    return String(data.user_id) === String(userId);
  }

  async function chatSessionBelongsToUser(userId: string, sessionId: number): Promise<boolean> {
    if (Number.isNaN(sessionId)) return false;
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle() as { data: any; error: any };
    if (error || !data) return false;
    return String(data.user_id) === String(userId);
  }

  // --- AUTENTICAÇÃO ---

  app.post("/api/register", async (c: Context) => {
    const body = (await getBody(c) ?? {}) as RegisterPayload;

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const rawNickname = typeof body.nickname === "string" ? body.nickname.trim() : "";

    if (!email || !password) {
      return c.json({
        success: false,
        error: "REGISTER_MISSING_FIELDS",
        message: "Dados obrigatórios ausentes (email, password).",
      }, 400);
    }

    const profile = pickFields<User, (typeof USER_PROFILE_FIELDS)[number]>(
      body as Partial<User>,
      USER_PROFILE_FIELDS,
    );

    // Fallbacks de segurança para campos obrigatórios no banco
    const finalName = rawName || email.split("@")[0] || "Usuário";
    const finalNickname = rawNickname || finalName;
    const finalCity = (typeof profile.city === "string" && profile.city.trim()) || "";
    const finalState = (typeof profile.state === "string" && profile.state.trim()) || "";
    const finalLocation =
      (typeof profile.location === "string" && profile.location.trim()) ||
      [finalCity, finalState].filter(Boolean).join(" - ") ||
      "Não informado";

    profile.email = email;
    profile.name = finalName;
    profile.nickname = finalNickname;
    profile.location = finalLocation;

    try {
      const { data: authData, error: authError } = await getSupabaseAdmin().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: profile,
      });
      if (authError) {
        console.error("🚨 ERRO AUTH REGISTRO:", authError);
        return c.json({
          success: false,
          error: "REGISTER_AUTH_FAILED",
          message: "Erro no Auth",
          details: authError.message,
        }, 500);
      }

      const authUserId = authData.user?.id;
      if (!authUserId) {
        console.error("auth.admin.createUser sem id de retorno", authData);
        return c.json({ success: false, error: "REGISTER_NO_ID", message: "Falha ao criar usuário (sem id)." }, 500);
      }

      const upsertPayload = {
        id: authUserId,
        ...profile,
        name: finalName,
        nickname: finalNickname,
        email,
        location: finalLocation,
        plan: "free" as const,
        plan_type: "free" as const,
        plan_status: "none",
        mp_preapproval_id: null,
      };

      const { data: profileRow, error: dbError } = await (getSupabaseAdmin() as any)
        .from("users")
        .upsert(upsertPayload)
        .select("*")
        .single() as { data: any; error: any };

      if (dbError) {
        console.error("Erro upsert users:", dbError, "payload:", upsertPayload);
        // rollback auth user para evitar conta órfã
        await getSupabaseAdmin().auth.admin.deleteUser(authUserId).catch((e) => {
          console.error("Falha no rollback do auth user:", e);
        });
        return c.json({
          success: false,
          error: "REGISTER_PROFILE_SAVE_FAILED",
          message: "Erro ao salvar perfil",
          details: dbError.message,
        }, 500);
      }

      const fullUser = profileRow ?? upsertPayload;

      // Faz signInWithPassword logo após criar o usuário para já entregar
      // um access_token válido ao frontend (sem isso ele cairia em 401 nas
      // rotas protegidas durante o onboarding).
      let accessToken: string | undefined;
      let refreshToken: string | undefined;
      try {
        const { data: signIn, error: signInErr } = await getSupabase().auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) {
          console.error("⚠️ register: falha no signIn pós-create:", signInErr.message);
        } else {
          accessToken = signIn.session?.access_token;
          refreshToken = signIn.session?.refresh_token;
        }
      } catch (e: any) {
        console.error("⚠️ register: exceção no signIn pós-create:", e?.message || e);
      }

      return c.json({
        success: true,
        user: { ...fullUser, access_token: accessToken, refresh_token: refreshToken },
      });
    } catch (error: any) {
      console.error("🚨 ERRO FATAL REGISTRO:", error);
      return c.json({
        success: false,
        error: "REGISTER_FAILED",
        message: "Erro ao criar conta.",
        details: error?.message || String(error),
      }, 500);
    }
  });

  /**
   * Renova a sessão usando o refresh_token. Não passa por authenticateUser
   * de propósito — o access_token pode estar vencido, é justamente por
   * isso que o front está aqui. O refresh_token tem vida útil bem mais
   * longa (dias, não minutos) e é o que garante que essa renovação funcione.
   */
  app.post("/api/auth/refresh", async (c: Context) => {
    const { refresh_token } = (await getBody(c) ?? {}) as { refresh_token?: string };
    if (!refresh_token) {
      return c.json({ error: "REFRESH_TOKEN_MISSING", message: "Sessão ausente." }, 400);
    }
    try {
      const { data, error } = await getSupabase().auth.refreshSession({ refresh_token });
      if (error || !data?.session) {
        return c.json({ error: "REFRESH_FAILED", message: "Sessão expirada. Faça login novamente." }, 401);
      }
      return c.json({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }, 200);
    } catch (err: any) {
      console.error("🚨 ERRO REFRESH TOKEN:", err?.message || err);
      return c.json({ error: "REFRESH_FAILED", message: "Sessão expirada. Faça login novamente." }, 500);
    }
  });

  app.post("/api/login", async (c: Context) => {
    const loginBody = (await getBody(c)) as any;
    const email = loginBody.email?.trim().toLowerCase();
    const password = loginBody.password;

    if (!email || !password) {
      console.error("🚨 [LOGIN] payload inválido:", {
        hasEmail: !!email,
        hasPassword: !!password,
      });
      return c.json({
        success: false,
        error: "LOGIN_MISSING_CREDENTIALS",
        message: "E-mail e senha são obrigatórios.",
      }, 400);
    }

    if (!(await checkRateLimit("LOGIN_RATE_LIMITER", email))) {
      return c.json({
        success: false,
        error: "RATE_LIMITED",
        message: "Muitas tentativas de login. Aguarde um minuto e tente novamente.",
      }, 429);
    }

    try {
      const { data: authData, error: authError } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        // Logging detalhado para diagnóstico — mostra o erro REAL do Supabase
        console.error("🚨 [LOGIN] getSupabase().auth.signInWithPassword falhou:", {
          email,
          status: (authError as any)?.status,
          code: (authError as any)?.code,
          name: authError.name,
          message: authError.message,
          stack: authError.stack,
        });

        const isEmailNotConfirmed = authError.message?.toLowerCase().includes("email not confirmed");
        const msg = isEmailNotConfirmed
          ? "Verifique seu e-mail antes de acessar."
          : "E-mail ou senha incorretos.";
        const errCode = isEmailNotConfirmed ? "LOGIN_EMAIL_NOT_CONFIRMED" : "LOGIN_INVALID_CREDENTIALS";
        return c.json({
          success: false,
          error: errCode,
          message: msg,
          // expõe o detalhe real só em dev (NODE_ENV != production)
          ...(envVar("NODE_ENV") !== "production"
            ? { details: authError.message }
            : {}),
        }, 401);
      }

      if (!authData?.user || !authData?.session?.access_token) {
        console.error("🚨 [LOGIN] resposta do Supabase sem user/session:", authData);
        return c.json({
          success: false,
          error: "LOGIN_SESSION_MISSING",
          message: "Falha ao autenticar (sessão ausente).",
        }, 500);
      }

      const { data: profile, error: profileError } = await (getSupabaseAdmin() as any)
        .from("users")
        .select("*")
        .eq("id", authData.user.id)
        .maybeSingle() as { data: any; error: any };

      if (profileError) {
        console.error("🚨 [LOGIN] erro lendo profile (users):", profileError);
        return c.json({
          success: false,
          error: "LOGIN_PROFILE_LOAD_FAILED",
          message: "Erro ao carregar perfil.",
          details: profileError.message,
        }, 500);
      }

      if (!profile) {
        console.error("🚨 [LOGIN] PROFILE_NOT_FOUND para auth user:", authData.user.id);
        return c.json({
          success: false,
          error: "LOGIN_PROFILE_NOT_FOUND",
          message: "PROFILE_NOT_FOUND",
        }, 404);
      }

      // Devolve o objeto completo: user (com access_token mergeado para
      // compatibilidade com o helper getStoredAccessToken do front) E
      // o session no topo, conforme exigido.
      return c.json({
        success: true,
        user: { ...profile, access_token: authData.session.access_token },
        session: {
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token,
          expires_at: authData.session.expires_at,
          expires_in: authData.session.expires_in,
          token_type: authData.session.token_type,
        },
      });
    } catch (error: any) {
      console.error("🚨 [LOGIN] exceção inesperada:", {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        error,
      });
      return c.json({
        success: false,
        error: "LOGIN_FAILED",
        message: "Erro interno no servidor.",
        details: error?.message || String(error),
      }, 500);
    }
  });

  app.post("/api/recover-password", async (c: Context) => {
    const email = ((await getBody(c)) as any).email?.trim().toLowerCase();
    if (!email) {
      return c.json({ success: false, error: "RECOVER_EMAIL_REQUIRED", message: "E-mail obrigatório." }, 400);
    }
    if (!(await checkRateLimit("PASSWORD_RESET_RATE_LIMITER", email))) {
      return c.json({
        success: false,
        error: "RATE_LIMITED",
        message: "Muitas solicitações. Aguarde um minuto e tente novamente.",
      }, 429);
    }
    try {
      const redirectTo =
        envVar("PUBLIC_APP_RESET_URL") ||
        envVar("VITE_APP_URL") ||
        "http://localhost:5173";
      const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) console.error("recover-password:", error);
      return c.json({ success: true });
    } catch (err: any) {
      console.error("Erro na Rota /api/recover-password:", err);
      return c.json({ success: true });
    }
  });

  app.post("/api/reset-password", async (c: Context) => {
    const { access_token, new_password } = await getBody(c) as any;
    if (!access_token || !new_password) {
      return c.json({ success: false, error: "RESET_INVALID_DATA", message: "Dados inválidos." }, 400);
    }
    try {
      const { data: userData, error: userErr } = await getSupabaseAdmin().auth.getUser(access_token);
      if (userErr || !userData?.user) {
        return c.json({ success: false, error: "RESET_TOKEN_INVALID", message: "Token inválido ou expirado." }, 400);
      }
      const { error: updErr } = await getSupabaseAdmin().auth.admin.updateUserById(userData.user.id, {
        password: new_password,
      });
      if (updErr) {
        console.error("reset-password update:", updErr);
        // RESET_UPDATE_FAILED: message é updErr.message do Supabase (variável).
        // O frontend usa o substring matching existente sobre message para traduzir.
        return c.json({ success: false, error: "RESET_UPDATE_FAILED", message: updErr.message }, 400);
      }
      return c.json({ success: true });
    } catch (err: any) {
      console.error("Erro na Rota /api/reset-password:", err);
      return c.json({ success: false, error: "RESET_FAILED", message: "Erro ao redefinir senha." }, 500);
    }
  });

  // --- USUÁRIO ---

  app.get("/api/user", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    try {
      const { data, error } = (await (getSupabaseAdmin() as any).from("users").select("*").eq("id", userId).maybeSingle() as any) as { data: any; error: any } as any;
      if (error) return c.json({ error: error.message }, 400);
      if (!data) return c.json({ error: "User not found" }, 404);
      return c.json(data);
    } catch (err: any) {
      console.error("Erro na Rota /api/user:", err);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // --- ARMAZENAMENTO DE ARQUIVOS (CRLV, comprovantes, fotos) --------------
  //
  // O bucket é privado. O front nunca fala com o Storage diretamente com a
  // chave anônima — sempre passa por aqui, que confere se o caminho pedido
  // pertence ao usuário autenticado antes de gerar a URL assinada.
  const DOCS_BUCKET = "vehicle-documents";

  /** ArrayBuffer → base64, só com Web APIs (sem depender de Buffer do Node). */
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Todo caminho de arquivo começa com o user_id de quem enviou. */
  /** Todo caminho de arquivo começa com o user_id de quem enviou, e não tem
   * segmentos ".." — o Storage do Supabase trata caminhos como chaves
   * planas, não como um filesystem de verdade, mas bloquear isso custa uma
   * linha e fecha a categoria de risco por completo, sem depender de como
   * a Supabase decide tratar isso hoje ou no futuro. */
  function pathBelongsToUser(userId: string, path: string): boolean {
    if (typeof path !== "string" || !path) return false;
    const segments = path.split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
    return segments[0] === userId;
  }

  /**
   * Recebe o arquivo (multipart/form-data) e sobe pro Storage usando o
   * client admin — mais simples e confiável que replicar o contrato de
   * upload assinado do Supabase sem o SDK no navegador. O arquivo passa
   * pelo Worker, mas o bucket já limita a 15 MB, dentro de qualquer
   * limite razoável de corpo de requisição.
   */
  app.post("/api/storage/upload", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      const path = form.get("path");
      if (!(file instanceof File) || typeof path !== "string") {
        return c.json({ error: "Arquivo ou caminho ausente." }, 400);
      }
      if (!pathBelongsToUser(userId, path)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(file.type)) {
        return c.json({ error: "Tipo de arquivo não permitido. Envie PDF, JPG, PNG ou WEBP." }, 400);
      }
      if (file.size > 15 * 1024 * 1024) {
        return c.json({ error: "Arquivo maior que 15 MB." }, 400);
      }

      const { error } = await getSupabaseAdmin()
        .storage.from(DOCS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      if (error) return c.json({ error: error.message }, 400);

      return c.json({ path }, 200);
    } catch (error: any) {
      console.error("🚨 ERRO UPLOAD STORAGE:", error);
      return c.json({ error: error?.message || "Erro ao enviar o arquivo." }, 500);
    }
  });

  /** Gera uma URL assinada de VISUALIZAÇÃO, válida por 5 minutos. */
  app.post("/api/storage/signed-view", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    const { path } = (await getBody(c) ?? {}) as { path?: string };
    if (!path || !pathBelongsToUser(userId, path)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = await getSupabaseAdmin()
      .storage.from(DOCS_BUCKET)
      .createSignedUrl(path, 300);
    if (error) return c.json({ error: error.message }, 400);
    return c.json({ signedUrl: data.signedUrl });
  });

  /**
   * Lê o CRLV (PDF) já enviado ao Storage e pede ao Gemini para extrair os
   * dados do veículo em formato estruturado. Best-effort: campos que o
   * modelo não encontrar voltam como null, e o front decide o que fazer
   * (deixar em branco + avisar o usuário).
   */
  app.post("/api/vehicles/crlv/extract", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    const { path } = (await getBody(c) ?? {}) as { path?: string };
    if (!path || !pathBelongsToUser(userId, path)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const { data: fileBlob, error: downloadErr } = await getSupabaseAdmin()
        .storage.from(DOCS_BUCKET)
        .download(path);
      if (downloadErr || !fileBlob) {
        return c.json({ error: "Não foi possível ler o arquivo enviado." }, 400);
      }

      const arrayBuffer = await (fileBlob as Blob).arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);

      const responseSchema = {
        type: "object",
        properties: {
          plate: { type: "string", nullable: true },
          brand: { type: "string", nullable: true },
          model: { type: "string", nullable: true },
          year: { type: "integer", nullable: true },
          color: { type: "string", nullable: true },
          renavam: { type: "string", nullable: true },
          chassis: { type: "string", nullable: true },
          not_found: {
            type: "array",
            items: { type: "string" },
            description: "Nomes dos campos que não foram encontrados no documento.",
          },
        },
      };

      const result = await getAI().models.generateContent({
        model: getGeminiModel(),
        contents: [
          {
            text:
              "Este é um CRLV (Certificado de Registro e Licenciamento de Veículo) brasileiro. " +
              "Extraia: placa, marca, modelo, ano de fabricação (ano modelo se o de fabricação " +
              "não existir), cor predominante, RENAVAM e chassi. Use exatamente os nomes que " +
              "aparecem no documento, sem traduzir ou abreviar. Se algum campo não existir ou " +
              "estiver ilegível, liste o nome dele em not_found e deixe o valor correspondente nulo.",
          },
          { inlineData: { mimeType: "application/pdf", data: base64 } },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const raw = (result as any).text ?? "{}";
      let extracted: Record<string, unknown>;
      try {
        extracted = JSON.parse(raw);
      } catch {
        console.error("🚨 CRLV: resposta do Gemini não é JSON válido:", raw);
        return c.json({ error: "O documento não pôde ser lido. Tente uma foto mais nítida ou preencha manualmente." }, 502);
      }

      return c.json(extracted, 200);
    } catch (error: any) {
      console.error("🚨 ERRO EXTRAÇÃO CRLV:", error);
      return c.json({ error: error?.message || "Erro ao processar o documento." }, 500);
    }
  });

  // --- VEÍCULOS (service role: compatível com RLS no cliente anônimo) ---

  app.get("/api/vehicles", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    const { data: vehicles, error } = (await (getSupabaseAdmin() as any).from("vehicles").select("*").eq("user_id", userId) as any) as any;
    if (error) return c.json({ error: error.message }, 400);
    const all = (vehicles ?? []) as any[];
    // Backup de veículos (histórico de arquivados) é recurso Premium — outros
    // planos só recebem os veículos ativos. A exclusão em si (archive) continua
    // liberada para todos os planos; isto só restringe a LEITURA do histórico.
    if (await userCanSeeVehicleBackup(userId)) {
      return c.json(all);
    }
    return c.json(all.filter((v) => v?.status !== "archived"));
  });

  app.post("/api/vehicles", authenticateUser, async (c: Context) => {
    const body = (await getBody(c) ?? {}) as VehicleCreatePayload;
    const user_id = (c as any).get("user").id;

    const vehicleData = pickFields<Vehicle, (typeof VEHICLE_INSERT_FIELDS)[number]>(
      body as Partial<Vehicle>,
      VEHICLE_INSERT_FIELDS,
    );

    if (!vehicleData.type || !vehicleData.brand || !vehicleData.model || vehicleData.year == null || !vehicleData.plate) {
      return c.json({ error: "Missing required vehicle fields (type, brand, model, year, plate)" }, 400);
    }

    const { data: userRow } = (await (getSupabaseAdmin() as any).from("users").select("plan, plan_type").eq("id", user_id).single() as any) as { data: any; error: any } as any;
    const tier = effectivePlanTierFromRow(userRow?.plan as string | undefined, userRow?.plan_type as string | undefined);
    const maxV = VEHICLE_LIMIT[tier];

    const activeCount = await countActiveVehiclesForUser(user_id);
    if (activeCount >= maxV) {
      return c.json({
        error: "vehicle_limit_reached",
        message: `Limite de veículos do plano atingido (${maxV}). Faça upgrade para adicionar mais.`,
        maxVehicles: maxV,
        plan: tier,
      }, 403);
    }

    const insertPayload: Record<string, unknown> = { user_id, ...vehicleData };
    if (tier === "free") {
      insertPayload.nickname = null;
      insertPayload.color = null;
    }

    const { data: createdVehicle, error } = await (getSupabaseAdmin() as any)
      .from("vehicles")
      .insert(insertPayload)
      .select()
      .single() as { data: any; error: any };
    if (error) {
      console.error("Erro ao criar veículo:", error, "payload:", insertPayload);
      return c.json({ error: error.message }, 400);
    }

    // Registra a quilometragem inicial no histórico (não-bloqueante)
    const initialMileage = Number(vehicleData.current_mileage ?? 0);
    const { error: mileageLogError } = (await (getSupabaseAdmin() as any).from("mileage_logs").insert({
      vehicle_id: createdVehicle.id,
      date: new Date().toISOString().split("T")[0],
      mileage: initialMileage,
      notes: "Registro inicial",
    })) as any;
    if (mileageLogError) {
      console.error(
        "⚠️ Falha ao registrar mileage_log inicial (veículo criado normalmente):",
        mileageLogError,
      );
    }

    return c.json(createdVehicle);
  });

  app.put("/api/vehicles/:id", authenticateUser, async (c: Context) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Invalid vehicle id" }, 400);

    const userId = (c as any).get("user").id;
    const { data: existing, error: exErr } = await (getSupabaseAdmin() as any)
      .from("vehicles")
      .select("user_id")
      .eq("id", id)
      .maybeSingle() as { data: any; error: any };
    if (exErr) return c.json({ error: exErr.message }, 400);
    if (!existing) return c.json({ error: "Vehicle not found" }, 404);
    if (String(existing.user_id) !== String(userId)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const body = (await getBody(c) ?? {}) as Partial<Vehicle>;
    const filtered = pickFields<Vehicle, (typeof VEHICLE_UPDATE_FIELDS)[number]>(
      body,
      VEHICLE_UPDATE_FIELDS,
    );
    const payload: Record<string, unknown> = { ...filtered };

    const { data: owner } = await (getSupabaseAdmin() as any)
      .from("users")
      .select("plan, plan_type")
      .eq("id", existing.user_id)
      .single() as { data: any; error: any };
    const ownerTier = effectivePlanTierFromRow(owner?.plan as string | undefined, owner?.plan_type as string | undefined);
    if (ownerTier === "free") {
      payload.nickname = null;
      payload.color = null;
    }

    const { data, error } = (await (getSupabaseAdmin() as any).from("vehicles").update(payload).eq("id", id).select().single() as any) as { data: any; error: any } as any;
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data);
  });

  // Arquivar (excluir) veículo continua liberado para TODOS os planos — é o
  // único mecanismo de exclusão de veículo do app. O que é Premium-only é
  // apenas poder VER o histórico de arquivados depois (GET /api/vehicles
  // filtra isso para quem não é Premium), não a ação de arquivar em si.
  app.post("/api/vehicles/:id/archive", authenticateUser, async (c: Context) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Invalid vehicle id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await vehicleBelongsToUser(userId, id))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const deleted_at = new Date().toISOString();
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("vehicles")
      .update({ status: "archived", deleted_at })
      .eq("id", id)
      .select()
      .single() as { data: any; error: any };
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data);
  });

  app.post("/api/vehicles/:id/mileage", authenticateUser, async (c: Context) => {
    const vehicleId = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const mileageBody = (await getBody(c)) as any;
    const mileage = Number(mileageBody.mileage);
    const date = (mileageBody.date as string) || new Date().toISOString().split("T")[0];
    if (Number.isNaN(mileage)) return c.json({ error: "Invalid mileage" }, 400);

    const valorRaw = mileageBody.valor;
    const litrosRaw = mileageBody.litros;
    const valor =
      valorRaw === undefined || valorRaw === null || valorRaw === ""
        ? null
        : Number(valorRaw);
    const litros =
      litrosRaw === undefined || litrosRaw === null || litrosRaw === ""
        ? null
        : Number(litrosRaw);
    if (valor !== null && Number.isNaN(valor)) return c.json({ error: "Invalid valor" }, 400);
    if (litros !== null && Number.isNaN(litros)) return c.json({ error: "Invalid litros" }, 400);

    const notesRaw = mileageBody.notes;
    const notes = typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim() : null;
    const attachmentPath =
      typeof mileageBody.attachment_path === "string" && mileageBody.attachment_path ? mileageBody.attachment_path : null;

    const { error: insErr } = await (getSupabaseAdmin() as any)
      .from("mileage_logs")
      .insert({ vehicle_id: vehicleId, date, mileage, valor, litros, notes, attachment_path: attachmentPath });
    if (insErr) return c.json({ error: insErr.message }, 400);

    const { data: v, error: upErr } = await (getSupabaseAdmin() as any)
      .from("vehicles")
      .update({ current_mileage: mileage })
      .eq("id", vehicleId)
      .select()
      .single() as { data: any; error: any };
    if (upErr) return c.json({ error: upErr.message }, 400);
    return c.json(v);
  });

  app.get("/api/vehicles/:vehicleId/mileage", authenticateUser, async (c: Context) => {
    const vehicleId = parseInt(c.req.param("vehicleId"), 10);
    if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("mileage_logs")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false });
    if (error) {
      console.error("Erro ao buscar mileage_logs:", error);
      return c.json({ error: error.message }, 400);
    }
    return c.json(data ?? []);
  });

  app.put("/api/vehicles/:vehicleId/mileage/:logId", authenticateUser, async (c: Context) => {
    try {
      const vehicleId = parseInt(c.req.param("vehicleId"), 10);
      const logId = c.req.param("logId");
      if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
      if (!logId) return c.json({ error: "Invalid log id" }, 400);
      const userId = (c as any).get("user").id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      type MileageLogUpdate = {
        date: string;
        mileage: number;
        notes: string;
        valor: number | null;
        litros: number | null;
        attachment_path: string | null;
      };
      const filtered = pickFields<MileageLogUpdate, (typeof MILEAGE_LOG_FIELDS)[number]>(
        (await getBody(c) ?? {}) as Partial<MileageLogUpdate>,
        MILEAGE_LOG_FIELDS,
      );
      if (filtered.mileage !== undefined) filtered.mileage = Number(filtered.mileage) as any;
      if (filtered.valor !== undefined) {
        filtered.valor =
          filtered.valor === null || (filtered.valor as unknown) === ""
            ? null
            : (Number(filtered.valor) as any);
      }
      if (filtered.litros !== undefined) {
        filtered.litros =
          filtered.litros === null || (filtered.litros as unknown) === ""
            ? null
            : (Number(filtered.litros) as any);
      }

      const { data, error } = await (getSupabaseAdmin() as any)
        .from("mileage_logs")
        .update(filtered)
        .eq("id", logId)
        .eq("vehicle_id", vehicleId)
        .select()
        .single() as { data: any; error: any };
      if (error) {
        console.error("Erro PUT mileage_logs:", error, "payload:", filtered);
        return c.json({ error: error.message }, 400);
      }
      return c.json(data, 200);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL PUT mileage:", error);
      return c.json({ error: error?.message || "Erro ao atualizar registro de KM." }, 500);
    }
  });

  app.delete("/api/vehicles/:vehicleId/mileage/:logId", authenticateUser, async (c: Context) => {
    try {
      const vehicleId = parseInt(c.req.param("vehicleId"), 10);
      const logId = c.req.param("logId");
      if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
      if (!logId) return c.json({ error: "Invalid log id" }, 400);
      const userId = (c as any).get("user").id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const { error } = await (getSupabaseAdmin() as any)
        .from("mileage_logs")
        .delete()
        .eq("id", logId)
        .eq("vehicle_id", vehicleId);
      if (error) {
        console.error("Erro DELETE mileage_logs:", error);
        return c.json({ error: error.message }, 400);
      }

      // Re-deriva current_mileage do veículo a partir do maior log restante
      const { data: remaining } = await (getSupabaseAdmin() as any)
        .from("mileage_logs")
        .select("mileage")
        .eq("vehicle_id", vehicleId);
      const max = Array.isArray(remaining) && remaining.length
        ? Math.max(...remaining.map((r: any) => Number(r.mileage) || 0))
        : 0;
      (await (getSupabaseAdmin() as any).from("vehicles").update({ current_mileage: max }).eq("id", vehicleId) as any) as any;

      return c.json({ success: true }, 200);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL DELETE mileage:", error);
      return c.json({ error: error?.message || "Erro ao excluir registro de KM." }, 500);
    }
  });

  app.get("/api/vehicles/:vehicleId/logs", authenticateUser, async (c: Context) => {
    const vehicleId = parseInt(c.req.param("vehicleId"), 10);
    if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("maintenance_logs")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false });
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data ?? []);
  });

  app.put("/api/vehicles/:vehicleId/maintenance/:recordId", authenticateUser, async (c: Context) => {
    try {
      const vehicleId = parseInt(c.req.param("vehicleId"), 10);
      const recordId = parseInt(c.req.param("recordId"), 10);
      if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
      if (Number.isNaN(recordId)) return c.json({ error: "Invalid record id" }, 400);
      const userId = (c as any).get("user").id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const filtered = pickFields<MaintenanceLog, (typeof MAINTENANCE_LOG_FIELDS)[number]>(
        (await getBody(c) ?? {}) as Partial<MaintenanceLog>,
        MAINTENANCE_LOG_FIELDS,
      );

      const { data, error } = await (getSupabaseAdmin() as any)
        .from("maintenance_logs")
        .update(filtered)
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId)
        .select()
        .single() as { data: any; error: any };
      if (error) {
        console.error("Erro PUT maintenance_logs:", error, "payload:", filtered);
        return c.json({ error: error.message }, 400);
      }
      return c.json(data, 200);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL PUT maintenance:", error);
      return c.json({ error: error?.message || "Erro ao atualizar manutenção." }, 500);
    }
  });

  app.delete("/api/vehicles/:vehicleId/maintenance/:recordId", authenticateUser, async (c: Context) => {
    try {
      const vehicleId = parseInt(c.req.param("vehicleId"), 10);
      const recordId = parseInt(c.req.param("recordId"), 10);
      if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
      if (Number.isNaN(recordId)) return c.json({ error: "Invalid record id" }, 400);
      const userId = (c as any).get("user").id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const { error } = await (getSupabaseAdmin() as any)
        .from("maintenance_logs")
        .delete()
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId);
      if (error) {
        console.error("Erro DELETE maintenance_logs:", error);
        return c.json({ error: error.message }, 400);
      }
      return c.json({ success: true }, 200);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL DELETE maintenance:", error);
      return c.json({ error: error?.message || "Erro ao excluir manutenção." }, 500);
    }
  });

  app.put("/api/vehicles/:vehicleId/financial/:recordId", authenticateUser, async (c: Context) => {
    try {
      const userId = (c as any).get("user").id;
      if (!(await userHasFinancialAccess(userId))) {
        return c.json({
          error: "financial_plan_required",
          message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
        }, 403);
      }
      const vehicleId = parseInt(c.req.param("vehicleId"), 10);
      const recordId = parseInt(c.req.param("recordId"), 10);
      if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
      if (Number.isNaN(recordId)) return c.json({ error: "Invalid record id" }, 400);
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const filtered = pickFields<FinancialRecord, (typeof FINANCIAL_RECORD_FIELDS)[number]>(
        (await getBody(c) ?? {}) as Partial<FinancialRecord>,
        FINANCIAL_RECORD_FIELDS,
      );

      const { data, error } = await (getSupabaseAdmin() as any)
        .from("financial_records")
        .update(filtered)
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId)
        .select()
        .single() as { data: any; error: any };
      if (error) {
        console.error("Erro PUT financial_records:", error, "payload:", filtered);
        return c.json({ error: error.message }, 400);
      }
      return c.json(data, 200);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL PUT financial:", error);
      return c.json({ error: error?.message || "Erro ao atualizar lançamento financeiro." }, 500);
    }
  });

  app.delete("/api/vehicles/:vehicleId/financial/:recordId", authenticateUser, async (c: Context) => {
    try {
      const userId = (c as any).get("user").id;
      if (!(await userHasFinancialAccess(userId))) {
        return c.json({
          error: "financial_plan_required",
          message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
        }, 403);
      }
      const vehicleId = parseInt(c.req.param("vehicleId"), 10);
      const recordId = parseInt(c.req.param("recordId"), 10);
      if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
      if (Number.isNaN(recordId)) return c.json({ error: "Invalid record id" }, 400);
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return c.json({ error: "Forbidden" }, 403);
      }

      const { error } = await (getSupabaseAdmin() as any)
        .from("financial_records")
        .delete()
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId);
      if (error) {
        console.error("Erro DELETE financial_records:", error);
        return c.json({ error: error.message }, 400);
      }
      return c.json({ success: true }, 200);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL DELETE financial:", error);
      return c.json({ error: error?.message || "Erro ao excluir lançamento financeiro." }, 500);
    }
  });

  app.get("/api/vehicles/:vehicleId/financial", authenticateUser, async (c: Context) => {
    const vehicleId = parseInt(c.req.param("vehicleId"), 10);
    if (Number.isNaN(vehicleId)) return c.json({ error: "Invalid vehicle id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await userHasFinancialAccess(userId))) {
      return c.json({
        error: "financial_plan_required",
        message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
      }, 403);
    }
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = (await (getSupabaseAdmin() as any).from("financial_records").select("*").eq("vehicle_id", vehicleId) as any) as any;
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data ?? []);
  });

  // --- MANUTENÇÃO / FINANCEIRO ---

  app.post("/api/logs", authenticateUser, async (c: Context) => {
    const { id: _id, vehicle_id, ...fields } = await getBody(c) as any;
    if (!vehicle_id) return c.json({ error: "vehicle_id is required" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await vehicleBelongsToUser(userId, Number(vehicle_id)))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("maintenance_logs")
      .insert({ vehicle_id, ...fields })
      .select()
      .single() as { data: any; error: any };
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data);
  });

  app.post("/api/financial", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    if (!(await userHasFinancialAccess(userId))) {
      return c.json({
        error: "financial_plan_required",
        message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
      }, 403);
    }
    const { id: _id, vehicle_id, ...fields } = await getBody(c) as any;
    if (!vehicle_id) return c.json({ error: "vehicle_id is required" }, 400);
    if (!(await vehicleBelongsToUser(userId, Number(vehicle_id)))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("financial_records")
      .insert({ vehicle_id, ...fields })
      .select()
      .single() as { data: any; error: any };
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data);
  });

  // --- CHAT ---

  app.get("/api/chat/sessions", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "Histórico de conversas com o Dr. Graxa está nos planos Plus e Premium.",
      }, 403);
    }
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data ?? []);
  });

  // Prazo de retenção da lixeira: conversas excluídas há mais tempo que isto
  // são apagadas de forma definitiva na próxima vez que a lixeira é aberta.
  const CHAT_TRASH_RETENTION_DAYS = 30;

  /** Lista as conversas na lixeira (excluídas, dentro do prazo de retenção). */
  app.get("/api/chat/sessions/trash", authenticateUser, async (c: Context) => {
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "Histórico de conversas com o Dr. Graxa está nos planos Plus e Premium.",
      }, 403);
    }

    // Purga definitiva (lazy): antes de listar, remove o que já passou do prazo.
    const cutoff = new Date(Date.now() - CHAT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: purgeErr } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .delete()
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (purgeErr) console.error("⚠️ chat trash: erro na purga automática:", purgeErr);

    const { data, error } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) return c.json({ error: error.message }, 400);

    const enriched = (data ?? []).map((session: any) => {
      const deletedAt = new Date(session.deleted_at).getTime();
      const daysLeft = Math.max(
        0,
        CHAT_TRASH_RETENTION_DAYS - Math.floor((Date.now() - deletedAt) / (24 * 60 * 60 * 1000)),
      );
      return { ...session, days_until_permanent_deletion: daysLeft };
    });
    return c.json(enriched);
  });

  /** Restaura uma conversa da lixeira. */
  app.post("/api/chat/sessions/:id/restore", authenticateUser, async (c: Context) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Invalid session id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "O Dr. Graxa está nos planos Plus e Premium.",
      }, 403);
    }
    if (!(await chatSessionBelongsToUser(userId, id))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { error } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .update({ deleted_at: null })
      .eq("id", id);
    if (error) return c.json({ error: error.message }, 400);
    return c.json({ success: true });
  });

  app.post("/api/chat/sessions", authenticateUser, async (c: Context) => {
    try {
      const user_id = (c as any).get("user").id;
      if (!(await userCanUseAdvisor(user_id))) {
        return c.json({
          error: "advisor_plan_required",
          message: "O Dr. Graxa está nos planos Plus e Premium.",
        }, 403);
      }
      const { vehicle_id, title } = await getBody(c) as any ?? {};
      // Se um vehicle_id veio, garante que pertence ao usuário autenticado
      if (vehicle_id != null && !(await vehicleBelongsToUser(user_id, Number(vehicle_id)))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const { data, error } = await (getSupabaseAdmin() as any)
        .from("chat_sessions")
        .insert({
          user_id,
          vehicle_id: vehicle_id ?? null,
          title: title ?? null,
        })
        .select("id")
        .single() as { data: any; error: any };
      if (error) {
        console.error("🚨 ERRO CHAT IA (insert chat_sessions):", error);
        return c.json({ error: error.message }, 400);
      }
      return c.json({ id: data.id });
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA (POST /api/chat/sessions):", error);
      return c.json({ error: error?.message || "Erro ao criar sessão." }, 500);
    }
  });

  /** Move a conversa para a lixeira (soft-delete). Não apaga do banco. */
  app.delete("/api/chat/sessions/:id", authenticateUser, async (c: Context) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Invalid session id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "O Dr. Graxa está nos planos Plus e Premium.",
      }, 403);
    }
    if (!(await chatSessionBelongsToUser(userId, id))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { error } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return c.json({ error: error.message }, 400);
    return c.json({ success: true });
  });

  /** Apaga uma conversa da lixeira em definitivo, sem esperar o prazo de retenção. */
  app.delete("/api/chat/sessions/:id/permanent", authenticateUser, async (c: Context) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Invalid session id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "O Dr. Graxa está nos planos Plus e Premium.",
      }, 403);
    }
    if (!(await chatSessionBelongsToUser(userId, id))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { error } = await (getSupabaseAdmin() as any).from("chat_sessions").delete().eq("id", id);
    if (error) return c.json({ error: error.message }, 400);
    return c.json({ success: true });
  });

  /** Atualiza título da conversa (ex.: primeira pergunta do usuário como título automático). */
  app.patch("/api/chat/sessions/:id", authenticateUser, async (c: Context) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Invalid session id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "O Dr. Graxa está nos planos Plus e Premium.",
      }, 403);
    }
    if (!(await chatSessionBelongsToUser(userId, id))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { title } = (await getBody(c) ?? {}) as { title?: unknown };
    if (typeof title !== "string") {
      return c.json({ error: "title is required string" }, 400);
    }
    const safe = title.trim().replace(/\s+/g, " ").slice(0, 200);
    if (!safe) return c.json({ error: "title cannot be empty" }, 400);
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("chat_sessions")
      .update({ title: safe, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, title, updated_at")
      .single() as { data: any; error: any };
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data);
  });

  app.get("/api/chat/sessions/:sessionId/messages", authenticateUser, async (c: Context) => {
    const sessionId = parseInt(c.req.param("sessionId"), 10);
    if (Number.isNaN(sessionId)) return c.json({ error: "Invalid session id" }, 400);
    const userId = (c as any).get("user").id;
    if (!(await userCanUseAdvisor(userId))) {
      return c.json({
        error: "advisor_plan_required",
        message: "Histórico de conversas está nos planos Plus e Premium.",
      }, 403);
    }
    if (!(await chatSessionBelongsToUser(userId, sessionId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { data, error } = await (getSupabaseAdmin() as any)
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: true });
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data ?? []);
  });

  app.post("/api/chat/messages", authenticateUser, async (c: Context) => {
    try {
      const { session_id, sender, content } = await getBody(c) as any ?? {};
      if (!session_id || !sender || content == null) {
        return c.json({ error: "session_id, sender and content are required" }, 400);
      }
      const userId = (c as any).get("user").id;
      if (!(await userCanUseAdvisor(userId))) {
        return c.json({
          error: "advisor_plan_required",
          message: "O Dr. Graxa está nos planos Plus e Premium.",
        }, 403);
      }
      if (!(await chatSessionBelongsToUser(userId, Number(session_id)))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const { data, error } = await (getSupabaseAdmin() as any)
        .from("chat_messages")
        .insert({ session_id, sender, content })
        .select()
        .single() as { data: any; error: any };
      if (error) {
        console.error("🚨 ERRO CHAT IA (insert chat_messages):", error);
        return c.json({ error: error.message }, 400);
      }
      const { error: updErr } = await (getSupabaseAdmin() as any)
        .from("chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", session_id);
      if (updErr) {
        console.error("⚠️ Falha ao atualizar updated_at em chat_sessions:", updErr);
      }
      return c.json(data);
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA (POST /api/chat/messages):", error);
      return c.json({ error: error?.message || "Erro ao salvar mensagem." }, 500);
    }
  });

  app.post("/api/chat", authenticateUser, async (c: Context) => {
    const { message, vehicleId, session_id: sessionId } = await getBody(c) as any ?? {};
    const userId = (c as any).get("user").id;

    if (!(await checkRateLimit("AI_CHAT_RATE_LIMITER", userId))) {
      return c.json({
        error: "RATE_LIMITED",
        text: "Você está mandando mensagens rápido demais. Aguarde um minuto e tente de novo.",
      }, 429);
    }

    if (!envVar("GEMINI_API_KEY")) {
      console.error("🚨 ERRO CHAT IA: GEMINI_API_KEY ausente no servidor.");
      return c.json({
        error: "AI_SERVICE_UNAVAILABLE",
        text: "O Dr. Graxa está em manutenção (chave de API não configurada).",
        details: "GEMINI_API_KEY ausente",
      }, 500);
    }

    if (typeof message !== "string" || !message.trim()) {
      return c.json({ error: "AI_EMPTY_MESSAGE", text: "Mensagem vazia.", details: "message is required" }, 400);
    }

    try {
      const usage = await getEffectiveAiUsage(userId);
      if (usage.tier === "free") {
        return c.json({
          error: "ADVISOR_FEATURE_REQUIRES_PLUS",
          message: "O Dr. Graxa está disponível nos planos Plus e Premium.",
          text: "O Dr. Graxa está disponível nos planos Plus e Premium. Conheça nossos planos para continuar.",
        }, 403);
      }
      if (usage.limit > 0 && usage.count >= usage.limit) {
        return c.json({
          error: "AI_LIMIT_REACHED",
          limit: usage.limit,
          count: usage.count,
          message: `Limite de ${usage.limit} mensagens mensais do Dr. Graxa atingido. Faça upgrade para aumentar sua cota.`,
          text: `Você atingiu o limite de ${usage.limit} mensagens com o Dr. Graxa neste mês. Faça upgrade do plano para continuar.`,
        }, 429);
      }

      const { data: user, error: userErr } = await (getSupabaseAdmin() as any)
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle() as { data: any; error: any };
      if (userErr) console.error("⚠️ chat: erro lendo users:", userErr);

      // Só carrega o veículo se ele pertencer ao usuário autenticado
      let vehicle: any = null;
      if (vehicleId != null) {
        if (await vehicleBelongsToUser(userId, Number(vehicleId))) {
          const { data: v, error: vehErr } = await (getSupabaseAdmin() as any)
            .from("vehicles")
            .select("*")
            .eq("id", vehicleId)
            .maybeSingle() as { data: any; error: any };
          if (vehErr) console.error("⚠️ chat: erro lendo vehicles:", vehErr);
          vehicle = v ?? null;
        }
      }

      const vehicleContext = vehicle
        ? `${vehicle.brand ?? ""} ${vehicle.model ?? ""} (${vehicle.year ?? "?"})`.trim()
        : "Nenhum veículo selecionado";

      const systemPrompt = `Você é o Dr. Graxa, especialista técnico do RevisAuto. Usuário: ${user?.nickname || "Amigo"}.
Contexto do veículo: ${vehicleContext}. Seja direto, técnico e use jargões de oficina.`;

      // ─── Histórico da conversa ────────────────────────────────────────────
      // Sem isto, cada mensagem era enviada isolada ao Gemini, sem nenhuma
      // memória do que foi dito antes — o Dr. Graxa "esquecia" a conversa a
      // cada pergunta. Busca as últimas mensagens da MESMA sessão (a pessoa
      // já validou a posse dela ao abrir o chat) e monta o histórico
      // multi-turn no formato que a API do Gemini espera.
      const history: { role: "user" | "model"; parts: { text: string }[] }[] = [];
      if (sessionId != null) {
        const numericSessionId = Number(sessionId);
        if (
          Number.isFinite(numericSessionId) &&
          (await chatSessionBelongsToUser(userId, numericSessionId))
        ) {
          const { data: priorMessages, error: historyErr } = await (getSupabaseAdmin() as any)
            .from("chat_messages")
            .select("sender, content")
            .eq("session_id", numericSessionId)
            .order("timestamp", { ascending: true })
            .limit(40) as { data: any; error: any };
          if (historyErr) {
            console.error("⚠️ chat: erro lendo histórico:", historyErr);
          } else if (Array.isArray(priorMessages)) {
            for (const m of priorMessages) {
              const text = typeof m?.content === "string" ? m.content.trim() : "";
              if (!text) continue;
              history.push({
                role: m.sender === "ai" ? "model" : "user",
                parts: [{ text }],
              });
            }
          }
        }
      }

      // A mensagem atual já foi salva no banco pelo front ANTES desta chamada
      // (ver POST /api/chat/messages), então ela já é a última entrada do
      // histórico buscado acima. Remove essa duplicata antes de reanexá-la.
      const trimmedMessage = typeof message === "string" ? message.trim() : "";
      if (
        history.length > 0 &&
        history[history.length - 1].role === "user" &&
        history[history.length - 1].parts[0]?.text === trimmedMessage
      ) {
        history.pop();
      }

      const contents = [
        { role: "user" as const, parts: [{ text: systemPrompt }] },
        { role: "model" as const, parts: [{ text: "Entendido. Estou pronto para ajudar." }] },
        ...history,
        { role: "user" as const, parts: [{ text: message }] },
      ];

      const result = await getAI().models.generateContent({
        model: getGeminiModel(),
        contents,
      });

      const text =
        (typeof (result as any)?.text === "string" && (result as any).text) ||
        (result as any)?.response?.text?.() ||
        (result as any)?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";

      if (!text) {
        console.error("🚨 ERRO CHAT IA: resposta sem texto", result);
        return c.json({
          error: "AI_EMPTY_RESPONSE",
          text: "O Dr. Graxa não conseguiu formular uma resposta agora.",
          details: "empty model response",
        }, 502);
      }

      await incrementAiMessageCount(userId, usage.count);
      return c.json({
        text,
        ai_messages_used: usage.count + 1,
        ai_messages_limit: usage.limit,
      });
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA:", error);
      return c.json({
        error: "AI_SERVICE_ERROR",
        text: "O Dr. Graxa está em manutenção. Tente logo mais.",
        details: error?.message || String(error),
      }, 500);
    }
  });

  // --- PAGAMENTOS / MERCADO PAGO ---

  app.post("/api/checkout", authenticateUser, async (c: Context) => {
    try {
      if (!getMpToken()) {
        return c.json({
          success: false,
          error: "CHECKOUT_MP_NOT_CONFIGURED",
          message: "Mercado Pago não configurado no servidor.",
        }, 500);
      }

      const userId = (c as any).get("user").id;
      const tokenEmail = (c as any).get("user").email || "";
      const checkoutBody = (await getBody(c) ?? {}) as { plan_type?: string; period?: string };
      // O e-mail SEMPRE vem do token autenticado — nunca do corpo da
      // requisição, para eliminar qualquer chance de um cliente malicioso
      // preencher um e-mail alheio no formulário de assinatura do MP.
      const userEmail = tokenEmail;

      if (typeof userEmail !== "string" || !userEmail.trim()) {
        return c.json({
          success: false,
          error: "CHECKOUT_EMAIL_REQUIRED",
          message: "userEmail é obrigatório para criar assinatura no Mercado Pago.",
        }, 400);
      }

      // Retorno ao app após fluxo Mercado Pago: PreApproval só aceita o campo
      // singular `back_url` (não há `back_urls` como em Preference).
      // MP_BACK_URL na web deve ser HTTPS, ex.: https://revisautoapp.com.br/checkout/return
      const backUrl = (envVar("MP_BACK_URL") || "").trim();
      if (!backUrl) {
        console.error("[MP Checkout] MP_BACK_URL ausente no ambiente.");
        return c.json({
          success: false,
          error: "CHECKOUT_BACKURL_MISSING",
          message: "Configuração de retorno Mercado Pago ausente (MP_BACK_URL).",
        }, 500);
      }
      console.log("[MP Checkout] Criando PreApproval", { back_url: backUrl, user_id: userId });

      const rawBody = checkoutBody;
      const planType: CheckoutPlan = rawBody.plan_type === "premium" ? "premium" : "plus";
      const period: CheckoutPeriod = normalizeCheckoutPeriod(rawBody.period);
      const amount = CHECKOUT_PRICES_BRL[planType][period === "monthly" ? "monthly" : "annual"];
      const frequency = period === "annual" ? 12 : 1;
      const reason =
        planType === "plus"
          ? period === "annual"
            ? "RevisAuto Plus - Assinatura Anual"
            : "RevisAuto Plus - Assinatura Mensal"
          : period === "annual"
            ? "RevisAuto Premium - Assinatura Anual"
            : "RevisAuto Premium - Assinatura Mensal";

      console.log("[MP Checkout] Plano", { planType, period, amount, frequency, reason });

      // PreApproval (Assinatura recorrente)
      const preApprovalBody: Record<string, any> = {
        reason,
        auto_recurring: {
          frequency,
          frequency_type: "months",
          transaction_amount: amount,
          currency_id: "BRL",
        },
        back_url: backUrl,
        external_reference: buildMpExternalReference(userId, planType, period),
        payer_email: userEmail.trim().toLowerCase(),
        status: "pending" as const,
      };

      const preApproval = await createPreApproval(getMpToken(), preApprovalBody);

      if (!preApproval?.init_point) {
        console.error("🚨 ERRO CHECKOUT MP (PreApproval): init_point ausente", preApproval);
        return c.json({
          success: false,
          error: "CHECKOUT_NO_INIT_POINT",
          message: "Mercado Pago não retornou um link de assinatura.",
        }, 502);
      }

      return c.json({
        success: true,
        init_point: preApproval.init_point,
        preapproval_id: preApproval.id,
      });
    } catch (error: any) {
      console.error("🚨 ERRO CHECKOUT MP (PreApproval):", error);
      return c.json({
        success: false,
        error: "CHECKOUT_FAILED",
        message: "Erro ao gerar assinatura do Mercado Pago.",
        details: error?.message || String(error),
      }, 500);
    }
  });

  type MpPlanMeta = {
    /** Status espelhado do MP (authorized, active, approved, ...) */
    planStatus?: string;
    /** Só atualiza quando informado — evita sobrescrever mp_preapproval_id nos upgrades via payment-only */
    mpPreapprovalId?: string | null;
    /** ISO ou timestamptz da próxima cobrança / fim do período, quando o MP informar */
    subscriptionPeriodEnd?: string | null;
  };

  async function upgradeUserPlan(
    userId: string,
    planTier: CheckoutPlan,
    sourceLog: string,
    meta: MpPlanMeta = {},
  ) {
    const planStatus =
      typeof meta.planStatus === "string" && meta.planStatus.trim()
        ? meta.planStatus.trim()
        : "active";

    const row: Record<string, unknown> = {
      plan: planTier,
      plan_type: planTier,
      plan_status: planStatus,
    };

    if (meta.mpPreapprovalId != null && meta.mpPreapprovalId !== "") {
      row.mp_preapproval_id = String(meta.mpPreapprovalId);
    }

    if (meta.subscriptionPeriodEnd != null && meta.subscriptionPeriodEnd !== "") {
      row.subscription_period_end = meta.subscriptionPeriodEnd;
    }

    const { error } = (await (getSupabaseAdmin() as any).from("users").update(row).eq("id", String(userId))) as any;

    if (error) {
      console.error("🚨 [MP Webhook] Erro ao atualizar plano (users):", error);
      return;
    }
    console.log(
      `[MP Webhook] UPGRADE ${planTier} user=${userId} (${sourceLog}) plan_status=${planStatus}`,
    );
  }

  async function downgradeUserToFree(
    userId: string,
    reason: string,
    meta: MpPlanMeta = {},
  ) {
    const planStatus =
      typeof meta.planStatus === "string" && meta.planStatus.trim()
        ? meta.planStatus.trim()
        : "inactive";

    const { error } = await (getSupabaseAdmin() as any)
      .from("users")
      .update({
        plan: "free",
        plan_type: "free",
        plan_status: planStatus,
        mp_preapproval_id: null,
        subscription_period_end: null,
      })
      .eq("id", String(userId));

    if (error) {
      console.error("🚨 [MP Webhook] Erro ao rebaixar para free (users):", error);
      return;
    }
    console.log(
      `[MP Webhook] DOWNGRADE free user=${userId} motivo=${reason} plan_status=${planStatus}`,
    );
  }

  /**
   * Valida a assinatura HMAC-SHA256 do webhook do Mercado Pago.
   *
   * Cabeçalhos enviados pelo MP:
   *   x-signature: ts=<unix_ts>,v1=<hex_hmac>
   *   x-request-id: <uuid>
   *
   * Manifest oficial:
   *   id:{data.id};request-id:{x-request-id};ts:{ts};
   *
   * Compara HMAC-SHA256(secret, manifest) com v1 em tempo constante.
   * O secret vem do painel do MP (Webhooks → "Chave secreta") e deve
   * estar em envVar("MP_WEBHOOK_SECRET").
   *
   * Dev local: só se NODE_ENV≠production pode-se definir MP_WEBHOOK_SKIP_SIGNATURE=true
   * para ignorar headers (uso com ngrok/mock); não use em Render.
   */
  async function verifyMercadoPagoSignature(c: Context): Promise<{
    ok: boolean;
    reason?: string;
  }> {
    const secret = envVar("MP_WEBHOOK_SECRET").trim();
    const allowSkip =
      envVar("MP_WEBHOOK_SKIP_SIGNATURE") === "true" && envVar("NODE_ENV") !== "production";

    // MP_WEBHOOK_SECRET obrigatório (Render/produção). Em dev apenas, permite
    // MP_WEBHOOK_SKIP_SIGNATURE=true para testes sem assinatura fake.
    if (!secret && !allowSkip) {
      return { ok: false, reason: "MP_WEBHOOK_SECRET ausente — configure no painel do MP." };
    }
    if (!secret && allowSkip) {
      console.warn("[MP Webhook] Assinatura ignorada (MP_WEBHOOK_SKIP_SIGNATURE=true, dev apenas).");
      return { ok: true };
    }

    const sigHeader = c.req.header("x-signature");
    const requestId = c.req.header("x-request-id");

    if (typeof sigHeader !== "string" || typeof requestId !== "string") {
      return { ok: false, reason: "x-signature/x-request-id ausentes." };
    }

    // Parse "ts=...,v1=..."
    let ts: string | null = null;
    let v1: string | null = null;
    for (const part of sigHeader.split(",")) {
      const [k, v] = part.trim().split("=");
      if (k === "ts") ts = v;
      if (k === "v1") v1 = v;
    }
    if (!ts || !v1) {
      return { ok: false, reason: "x-signature mal formado." };
    }

    // data.id pode chegar via query (?data.id=123) ou no corpo (data.id)
    const dataIdQuery = c.req.query()?.["data.id"];
    const dataIdBody = (await getBody(c) as any)?.data?.id;
    const dataId =
      typeof dataIdQuery === "string"
        ? dataIdQuery
        : dataIdBody != null
          ? String(dataIdBody)
          : "";

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

    // Web Crypto no lugar de node:crypto — API padrão, roda no Workers.
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(manifest),
    );
    const expected = Array.from(new Uint8Array(signatureBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    // Comparação em tempo constante: substitui crypto.timingSafeEqual.
    // Compara a string hex inteira para não vazar informação pelo tamanho.
    const received = v1.toLowerCase();
    if (!/^[0-9a-f]+$/.test(received)) {
      return { ok: false, reason: "v1 não é hex válido." };
    }
    let diff = expected.length ^ received.length;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ received.charCodeAt(i % received.length);
    }
    if (diff !== 0) {
      return { ok: false, reason: "HMAC mismatch." };
    }
    console.log("[MP Webhook] x_signature_valid", {
      requestId,
      manifestLength: manifest.length,
    });
    return { ok: true };
  }

  app.post("/api/webhook", async (c: Context) => {
    const receivedAt = new Date().toISOString();
    const queryDataId =
      typeof c.req.query()?.["data.id"] === "string"
        ? c.req.query()["data.id"]
        : undefined;
    console.log("[MP Webhook] event_received", receivedAt, {
      path: new URL(c.req.url).pathname,
      query_data_id: queryDataId,
      x_request_id: c.req.header("x-request-id"),
      has_x_signature: typeof c.req.header("x-signature") === "string",
    });

    // 1) Validação HMAC usando MP_WEBHOOK_SECRET + headers x-signature / x-request-id
    const sigCheck = await verifyMercadoPagoSignature(c);
    if (!sigCheck.ok) {
      console.error("[MP Webhook] signature_REJECTED:", sigCheck.reason);
      return c.json({ ok: false, error: "invalid_signature" }, 401);
    }
    console.log("[MP Webhook] signature_VERIFIED_ok");

    // 2) Responde 200 cedo para o MP não reenviar
    // Webhook: vamos responder 200 no final (Hono não suporta resposta antecipada sem streaming)

    // 2) O Mercado Pago exige resposta rápida, senão reenvia a notificação.
    //    No Workers, waitUntil() mantém o processamento vivo DEPOIS de responder.
    const payload = (await getBody(c) ?? {}) as Record<string, any>;

    const processWebhook = async () => {

      try {
        const webhookBody = payload;
        console.log("[MP Webhook] body_received", JSON.stringify(webhookBody));

        if (!getMpToken()) {
          console.error("[MP Webhook] SKIP no MP_ACCESS_TOKEN");
          return;
        }

        const type: string = webhookBody.type || webhookBody.topic || "";
        const resourceId =
          webhookBody?.data?.id ||
          webhookBody?.resource ||
          (typeof webhookBody?.id !== "undefined" ? webhookBody.id : undefined);

        console.log("[MP Webhook] parsed", {
          type,
          resourceId,
          action: webhookBody.action,
        });

        if (!type || !resourceId) {
          console.log("[MP Webhook] ignored_missing_type_or_id", { type, resourceId });
          return;
        }

        // --- PreApproval (assinatura) ---
        if (type === "subscription_preapproval" || type === "preapproval") {
          console.log("[MP Webhook] branch=subscription_preapproval", { resourceId });
          const sub = await getPreApproval(getMpToken(), String(resourceId));
          const mpStatus = (sub?.status || "").toLowerCase();
          console.log("[MP Webhook] api_preapproval_loaded", {
            id: sub?.id,
            status: sub?.status,
            status_normalized: mpStatus,
          });

          const rawRef = sub?.external_reference;
          const { userId: extUserId, planTier } = parseMpExternalReference(
            rawRef != null ? String(rawRef) : "",
          );
          if (!extUserId) {
            console.error("[MP Webhook] preapproval_missing_external_reference", { mpId: sub?.id });
            return;
          }

          // authorized/active → ativa Plus ou Premium conforme checkout (idempotente)
          if (mpStatus === "authorized" || mpStatus === "active") {
            console.log("[MP Webhook] plan_action=ensure_plan user=", extUserId, "tier=", planTier);
            const periodEnd = subscriptionEndFromPreapproval(sub as unknown as Record<string, unknown>);
            await upgradeUserPlan(extUserId, planTier, `preapproval ${sub.id} ${mpStatus}`, {
              mpPreapprovalId: sub.id != null ? String(sub.id) : undefined,
              planStatus: mpStatus,
              subscriptionPeriodEnd: periodEnd,
            });
            console.log("[MP Webhook] plan_action_done=ensure_plan");
            return;
          }

          // cancelled / paused / unpaid → downgrade imediato
          if (mpStatus === "cancelled" || mpStatus === "paused" || mpStatus === "unpaid") {
            console.log("[MP Webhook] plan_action=downgrade_to_free user=", extUserId);
            await downgradeUserToFree(extUserId, `preapproval ${sub.id} ${mpStatus}`, {
              planStatus: mpStatus,
            });
            console.log("[MP Webhook] plan_action_done=downgrade_to_free");
            return;
          }

          console.log("[MP Webhook] preapproval_no_plan_change", {
            id: sub?.id,
            status: sub?.status,
          });
          return;
        }

        // Cobrança recorrente dentro de uma assinatura.
        // Pagamento aprovado mantém premium; recusado/charged_back/refunded
        // = inadimplência → rebaixa pra free.
        if (type === "subscription_authorized_payment") {
          console.log("[MP Webhook] branch=subscription_authorized_payment", { resourceId });
          try {
            const payment = await getPayment(getMpToken(), String(resourceId));
            const payStatus = (payment?.status || "").toLowerCase();
            console.log("[MP Webhook] api_payment_loaded", {
              id: payment?.id,
              status: payment?.status,
              status_normalized: payStatus,
            });

            const rawRefPay = payment?.external_reference;
            const { userId: extUserId, planTier } = parseMpExternalReference(
              rawRefPay != null ? String(rawRefPay) : "",
            );
            if (!extUserId) {
              console.error("[MP Webhook] authorized_payment_missing_external_reference id=", payment?.id);
              return;
            }
            switch (payment?.status) {
              case "approved":
                console.log("[MP Webhook] plan_action=ensure_plan_via_payment user=", extUserId);
                await upgradeUserPlan(extUserId, planTier, `authorized_payment ${payment.id} approved`, {
                  planStatus: payment.status ?? "approved",
                });
                console.log("[MP Webhook] plan_action_done=ensure_plan_via_payment");
                break;
              case "rejected":
              case "cancelled":
              case "refunded":
              case "charged_back":
                console.log("[MP Webhook] plan_action=downgrade_payment user=", extUserId, payment?.status);
                await downgradeUserToFree(
                  extUserId,
                  `authorized_payment ${payment.id} ${payment.status}`,
                  { planStatus: payment.status ?? "inactive" },
                );
                console.log("[MP Webhook] plan_action_done=downgrade_payment");
                break;
              default:
                console.log(
                  "[MP Webhook] authorized_payment_no_action id=",
                  payment?.id,
                  "status=",
                  payment?.status,
                );
            }
          } catch (err: any) {
            console.error(
              "[MP Webhook] subscription_authorized_payment_FETCH_ERROR:",
              err?.message || err,
            );
          }
          return;
        }

        // Pagamento avulso (compatibilidade — não é o fluxo principal)
        if (type === "payment") {
          console.log("[MP Webhook] branch=payment", { resourceId });
          const payment = await getPayment(getMpToken(), String(resourceId));
          console.log("[MP Webhook] api_payment_loaded", {
            id: payment?.id,
            status: payment?.status,
          });

          const rawRefPay = payment?.external_reference;
          const { userId: extUserId, planTier } = parseMpExternalReference(
            rawRefPay != null ? String(rawRefPay) : "",
          );
          if (!extUserId) {
            console.error("[MP Webhook] payment_missing_external_reference id=", payment?.id);
            return;
          }
          switch (payment?.status) {
            case "approved":
              console.log("[MP Webhook] plan_action=ensure_plan_oneoff user=", extUserId);
              await upgradeUserPlan(extUserId, planTier, `payment ${payment.id} approved`, {
                planStatus: payment.status ?? "approved",
              });
              console.log("[MP Webhook] plan_action_done=ensure_plan_oneoff");
              break;
            case "rejected":
            case "cancelled":
            case "refunded":
            case "charged_back":
              console.log("[MP Webhook] plan_action=downgrade_oneoff user=", extUserId, payment?.status);
              await downgradeUserToFree(extUserId, `payment ${payment.id} ${payment.status}`, {
                planStatus: payment.status ?? "inactive",
              });
              console.log("[MP Webhook] plan_action_done=downgrade_oneoff");
              break;
            default:
              console.log(
                "[MP Webhook] payment_no_action id=",
                payment?.id,
                "status=",
                payment?.status,
              );
          }
          return;
        }

        console.log("[MP Webhook] type_unhandled=", type);
      } catch (error: any) {
        console.error("🚨 ERRO WEBHOOK MP (pós-200):", error?.message || error);
      }
    };

    // Agenda o processamento em background e responde 200 imediatamente.
    const ctx = (c as any).executionCtx;
    if (ctx?.waitUntil) ctx.waitUntil(processWebhook());
    else await processWebhook(); // fallback (dev local sem executionCtx)

    console.log("[MP Webhook] response_sent_200");
    return c.json({ ok: true }, 200);
  });

  // Os arquivos estáticos do build são servidos pela própria plataforma
  // (binding `assets` no wrangler.jsonc), antes mesmo do Worker rodar.
  // Por isso não há express.static aqui: o Worker só recebe /api/*.



  // Falhas que escapam de async handlers ainda chegam aqui via Node.
  // Cast para `any`: os tipos do Node não estão instalados neste projeto
  // (não são necessários em nenhum outro lugar), e no runtime do Workers,
  // mesmo com nodejs_compat, `process` é um polyfill parcial — o guard
  // evita erro caso `.on` não exista nesse ambiente específico.
  const nodeProcess = (globalThis as any).process;
  if (nodeProcess?.on) {
    nodeProcess.on("unhandledRejection", (reason: unknown) => {
      console.error("🚨 UNHANDLED REJECTION:", reason);
    });
    nodeProcess.on("uncaughtException", (error: unknown) => {
      console.error("🚨 UNCAUGHT EXCEPTION:", error);
    });
  }

  return app;
}

const _app = startServer();

export default {
  async fetch(request: Request, env: Record<string, string>, ctx: any) {
    // O env é idêntico para todas as requisições de um mesmo isolate, então
    // basta injetá-lo uma vez. Os clients lazy (Supabase/Gemini) são criados
    // na primeira requisição e reaproveitados — recriá-los a cada chamada
    // desperdiçaria CPU e descartaria conexões keep-alive.
    setEnv(env);
    return _app.fetch(request, env, ctx);
  },
};
