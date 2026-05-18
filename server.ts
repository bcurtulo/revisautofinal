import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { MercadoPagoConfig, PreApproval, Payment } from "mercadopago";
import fetch from "cross-fetch";
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

dotenv.config();

const mpAccessToken = process.env.MP_ACCESS_TOKEN || "";
if (!mpAccessToken) {
  console.error("🚨 MP_ACCESS_TOKEN ausente no .env — Pagamentos Premium não funcionarão.");
}
const mpClient = new MercadoPagoConfig({
  accessToken: mpAccessToken,
  options: { timeout: 10000 },
});

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

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  console.error("❌ ERRO CRÍTICO: Verifique as chaves no arquivo .env");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch },
});

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch },
});

function utcYearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function countActiveVehiclesForUser(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
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
  const { data: row, error } = await supabaseAdmin
    .from("users")
    .select("plan, plan_type, ai_messages_count, last_ai_message_date")
    .eq("id", userId)
    .maybeSingle();
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
      await supabaseAdmin.from("users").update({ ai_messages_count: 0 }).eq("id", userId);
    }
  }
  return { tier, count, limit: lim };
}

async function incrementAiMessageCount(userId: string, previousCount: number): Promise<void> {
  await supabaseAdmin
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
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("plan, plan_type")
    .eq("id", userId)
    .maybeSingle();
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

const geminiApiKey = process.env.GEMINI_API_KEY || "";
if (!geminiApiKey) {
  console.error("🚨 GEMINI_API_KEY ausente no .env — Dr. Graxa não funcionará.");
}
const ai = new GoogleGenAI({ apiKey: geminiApiKey });
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const VEHICLE_INSERT_FIELDS = [
  "type",
  "brand",
  "model",
  "year",
  "current_mileage",
  "last_service_date",
  "nickname",
  "color",
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

const MILEAGE_LOG_FIELDS = ["date", "mileage", "notes", "valor", "litros"] as const;

const MAINTENANCE_LOG_FIELDS = [
  "type",
  "description",
  "date",
  "cost",
  "photo_path",
  "provider",
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // 🔍 Rastreador global de requisições — TODA request entra aqui
  app.use((req, _res, next) => {
    console.log(`➡️  [REQUEST] ${req.method} ${req.url}`);
    next();
  });

  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        // guarda o body bruto para debug em caso de JSON inválido
        (req as any).rawBody = buf?.toString("utf8");
      },
    }),
  );

  // Captura erros do parser JSON (req.body inválido vira 500 silencioso sem isto)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
      console.error("🚨 ERRO JSON PARSE:", {
        url: req.url,
        method: req.method,
        message: err.message,
        rawBody: (req as any).rawBody,
      });
      return res.status(400).json({
        success: false,
        message: "JSON inválido no corpo da requisição.",
        details: err.message,
      });
    }
    return next(err);
  });

  // --- Config pública (versão mínima do app) ---
  app.get("/api/app-config", async (_req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("min_app_version")
        .eq("id", 1)
        .maybeSingle();
      if (error) {
        console.error("[app-config]", error.message);
        return res.json({ min_app_version: "1.0.0" });
      }
      const min =
        typeof data?.min_app_version === "string" && data.min_app_version.trim()
          ? data.min_app_version.trim()
          : "1.0.0";
      return res.json({ min_app_version: min });
    } catch (e) {
      console.error("[app-config] exception", e);
      return res.json({ min_app_version: "1.0.0" });
    }
  });

  // --- MIDDLEWARE DE AUTENTICAÇÃO (Supabase JWT) ---

  type AuthedUser = { id: string; email?: string | null };
  type AuthedRequest = express.Request & { user: AuthedUser };

  async function authenticateUser(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token de autenticação ausente.",
      });
    }

    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({
          success: false,
          message: "Token inválido ou expirado.",
        });
      }
      (req as AuthedRequest).user = {
        id: data.user.id,
        email: data.user.email,
      };
      return next();
    } catch (err: any) {
      console.error("🚨 authenticateUser:", err?.message || err);
      return res.status(401).json({
        success: false,
        message: "Falha ao validar token.",
      });
    }
  }

  async function vehicleBelongsToUser(userId: string, vehicleId: number): Promise<boolean> {
    if (Number.isNaN(vehicleId)) return false;
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select("user_id")
      .eq("id", vehicleId)
      .maybeSingle();
    if (error || !data) return false;
    return String(data.user_id) === String(userId);
  }

  async function chatSessionBelongsToUser(userId: string, sessionId: number): Promise<boolean> {
    if (Number.isNaN(sessionId)) return false;
    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !data) return false;
    return String(data.user_id) === String(userId);
  }

  // --- AUTENTICAÇÃO ---

  app.post("/api/register", async (req, res) => {
    const body = (req.body ?? {}) as RegisterPayload;

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const rawNickname = typeof body.nickname === "string" ? body.nickname.trim() : "";

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Dados obrigatórios ausentes (email, password).",
      });
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
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: profile,
      });
      if (authError) {
        console.error("🚨 ERRO AUTH REGISTRO:", authError);
        return res.status(500).json({
          success: false,
          message: "Erro no Auth",
          details: authError.message,
        });
      }

      const authUserId = authData.user?.id;
      if (!authUserId) {
        console.error("auth.admin.createUser sem id de retorno", authData);
        return res.status(500).json({ success: false, message: "Falha ao criar usuário (sem id)." });
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

      const { data: profileRow, error: dbError } = await supabaseAdmin
        .from("users")
        .upsert(upsertPayload)
        .select("*")
        .single();

      if (dbError) {
        console.error("Erro upsert users:", dbError, "payload:", upsertPayload);
        // rollback auth user para evitar conta órfã
        await supabaseAdmin.auth.admin.deleteUser(authUserId).catch((e) => {
          console.error("Falha no rollback do auth user:", e);
        });
        return res.status(500).json({
          success: false,
          message: "Erro ao salvar perfil",
          details: dbError.message,
        });
      }

      const fullUser = profileRow ?? upsertPayload;

      // Faz signInWithPassword logo após criar o usuário para já entregar
      // um access_token válido ao frontend (sem isso ele cairia em 401 nas
      // rotas protegidas durante o onboarding).
      let accessToken: string | undefined;
      try {
        const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) {
          console.error("⚠️ register: falha no signIn pós-create:", signInErr.message);
        } else {
          accessToken = signIn.session?.access_token;
        }
      } catch (e: any) {
        console.error("⚠️ register: exceção no signIn pós-create:", e?.message || e);
      }

      return res.status(200).json({
        success: true,
        user: { ...fullUser, access_token: accessToken },
      });
    } catch (error: any) {
      console.error("🚨 ERRO FATAL REGISTRO:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao criar conta.",
        details: error?.message || String(error),
      });
    }
  });

  app.post("/api/login", async (req, res) => {
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;

    if (!email || !password) {
      console.error("🚨 [LOGIN] payload inválido:", {
        hasEmail: !!email,
        hasPassword: !!password,
      });
      return res.status(400).json({
        success: false,
        message: "E-mail e senha são obrigatórios.",
      });
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        // Logging detalhado para diagnóstico — mostra o erro REAL do Supabase
        console.error("🚨 [LOGIN] supabase.auth.signInWithPassword falhou:", {
          email,
          status: (authError as any)?.status,
          code: (authError as any)?.code,
          name: authError.name,
          message: authError.message,
          stack: authError.stack,
        });

        const msg = authError.message?.toLowerCase().includes("email not confirmed")
          ? "Verifique seu e-mail antes de acessar."
          : "E-mail ou senha incorretos.";
        return res.status(401).json({
          success: false,
          message: msg,
          // expõe o detalhe real só em dev (NODE_ENV != production)
          ...(process.env.NODE_ENV !== "production"
            ? { details: authError.message }
            : {}),
        });
      }

      if (!authData?.user || !authData?.session?.access_token) {
        console.error("🚨 [LOGIN] resposta do Supabase sem user/session:", authData);
        return res.status(500).json({
          success: false,
          message: "Falha ao autenticar (sessão ausente).",
        });
      }

      const { data: profile, error: profileError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("🚨 [LOGIN] erro lendo profile (users):", profileError);
        return res.status(500).json({
          success: false,
          message: "Erro ao carregar perfil.",
          details: profileError.message,
        });
      }

      if (!profile) {
        console.error("🚨 [LOGIN] PROFILE_NOT_FOUND para auth user:", authData.user.id);
        return res.status(404).json({
          success: false,
          message: "PROFILE_NOT_FOUND",
        });
      }

      // Devolve o objeto completo: user (com access_token mergeado para
      // compatibilidade com o helper getStoredAccessToken do front) E
      // o session no topo, conforme exigido.
      return res.json({
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
      res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        details: error?.message || String(error),
      });
    }
  });

  app.post("/api/recover-password", async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: "E-mail obrigatório." });
    }
    try {
      const redirectTo =
        process.env.PUBLIC_APP_RESET_URL ||
        process.env.VITE_APP_URL ||
        "http://localhost:5173";
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) console.error("recover-password:", error);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Erro na Rota /api/recover-password:", err);
      res.json({ success: true });
    }
  });

  app.post("/api/reset-password", async (req, res) => {
    const { access_token, new_password } = req.body;
    if (!access_token || !new_password) {
      return res.status(400).json({ success: false, message: "Dados inválidos." });
    }
    try {
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(access_token);
      if (userErr || !userData?.user) {
        return res.status(400).json({ success: false, message: "Token inválido ou expirado." });
      }
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userData.user.id, {
        password: new_password,
      });
      if (updErr) {
        console.error("reset-password update:", updErr);
        return res.status(400).json({ success: false, message: updErr.message });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Erro na Rota /api/reset-password:", err);
      res.status(500).json({ success: false, message: "Erro ao redefinir senha." });
    }
  });

  // --- USUÁRIO ---

  app.get("/api/user", authenticateUser, async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    try {
      const { data, error } = await supabaseAdmin.from("users").select("*").eq("id", userId).maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      if (!data) return res.status(404).json({ error: "User not found" });
      res.json(data);
    } catch (err: any) {
      console.error("Erro na Rota /api/user:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // --- VEÍCULOS (service role: compatível com RLS no cliente anônimo) ---

  app.get("/api/vehicles", authenticateUser, async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    const { data: vehicles, error } = await supabaseAdmin.from("vehicles").select("*").eq("user_id", userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json(vehicles ?? []);
  });

  app.post("/api/vehicles", authenticateUser, async (req, res) => {
    const body = (req.body ?? {}) as VehicleCreatePayload;
    const user_id = (req as AuthedRequest).user.id;

    const vehicleData = pickFields<Vehicle, (typeof VEHICLE_INSERT_FIELDS)[number]>(
      body as Partial<Vehicle>,
      VEHICLE_INSERT_FIELDS,
    );

    if (!vehicleData.type || !vehicleData.brand || !vehicleData.model || vehicleData.year == null) {
      return res.status(400).json({ error: "Missing required vehicle fields (type, brand, model, year)" });
    }

    const { data: userRow } = await supabaseAdmin.from("users").select("plan, plan_type").eq("id", user_id).single();
    const tier = effectivePlanTierFromRow(userRow?.plan as string | undefined, userRow?.plan_type as string | undefined);
    const maxV = VEHICLE_LIMIT[tier];

    const activeCount = await countActiveVehiclesForUser(user_id);
    if (activeCount >= maxV) {
      return res.status(403).json({
        error: "vehicle_limit_reached",
        message: `Limite de veículos do plano atingido (${maxV}). Faça upgrade para adicionar mais.`,
        maxVehicles: maxV,
        plan: tier,
      });
    }

    const insertPayload: Record<string, unknown> = { user_id, ...vehicleData };
    if (tier === "free") {
      insertPayload.nickname = null;
      insertPayload.color = null;
    }

    const { data: createdVehicle, error } = await supabaseAdmin
      .from("vehicles")
      .insert(insertPayload)
      .select()
      .single();
    if (error) {
      console.error("Erro ao criar veículo:", error, "payload:", insertPayload);
      return res.status(400).json({ error: error.message });
    }

    // Registra a quilometragem inicial no histórico (não-bloqueante)
    const initialMileage = Number(vehicleData.current_mileage ?? 0);
    const { error: mileageLogError } = await supabaseAdmin.from("mileage_logs").insert({
      vehicle_id: createdVehicle.id,
      date: new Date().toISOString().split("T")[0],
      mileage: initialMileage,
      notes: "Registro inicial",
    });
    if (mileageLogError) {
      console.error(
        "⚠️ Falha ao registrar mileage_log inicial (veículo criado normalmente):",
        mileageLogError,
      );
    }

    return res.status(200).json(createdVehicle);
  });

  app.put("/api/vehicles/:id", authenticateUser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid vehicle id" });

    const userId = (req as AuthedRequest).user.id;
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("vehicles")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (exErr) return res.status(400).json({ error: exErr.message });
    if (!existing) return res.status(404).json({ error: "Vehicle not found" });
    if (String(existing.user_id) !== String(userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const body = (req.body ?? {}) as Partial<Vehicle>;
    const filtered = pickFields<Vehicle, (typeof VEHICLE_UPDATE_FIELDS)[number]>(
      body,
      VEHICLE_UPDATE_FIELDS,
    );
    const payload: Record<string, unknown> = { ...filtered };

    const { data: owner } = await supabaseAdmin
      .from("users")
      .select("plan, plan_type")
      .eq("id", existing.user_id)
      .single();
    const ownerTier = effectivePlanTierFromRow(owner?.plan as string | undefined, owner?.plan_type as string | undefined);
    if (ownerTier === "free") {
      payload.nickname = null;
      payload.color = null;
    }

    const { data, error } = await supabaseAdmin.from("vehicles").update(payload).eq("id", id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/vehicles/:id/archive", authenticateUser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid vehicle id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await vehicleBelongsToUser(userId, id))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const deleted_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .update({ status: "archived", deleted_at })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/vehicles/:id/mileage", authenticateUser, async (req, res) => {
    const vehicleId = parseInt(req.params.id, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const mileage = Number(req.body.mileage);
    const date = (req.body.date as string) || new Date().toISOString().split("T")[0];
    if (Number.isNaN(mileage)) return res.status(400).json({ error: "Invalid mileage" });

    const valorRaw = req.body.valor;
    const litrosRaw = req.body.litros;
    const valor =
      valorRaw === undefined || valorRaw === null || valorRaw === ""
        ? null
        : Number(valorRaw);
    const litros =
      litrosRaw === undefined || litrosRaw === null || litrosRaw === ""
        ? null
        : Number(litrosRaw);
    if (valor !== null && Number.isNaN(valor)) return res.status(400).json({ error: "Invalid valor" });
    if (litros !== null && Number.isNaN(litros)) return res.status(400).json({ error: "Invalid litros" });

    const { error: insErr } = await supabaseAdmin
      .from("mileage_logs")
      .insert({ vehicle_id: vehicleId, date, mileage, valor, litros });
    if (insErr) return res.status(400).json({ error: insErr.message });

    const { data: v, error: upErr } = await supabaseAdmin
      .from("vehicles")
      .update({ current_mileage: mileage })
      .eq("id", vehicleId)
      .select()
      .single();
    if (upErr) return res.status(400).json({ error: upErr.message });
    res.json(v);
  });

  app.get("/api/vehicles/:vehicleId/mileage", authenticateUser, async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { data, error } = await supabaseAdmin
      .from("mileage_logs")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false });
    if (error) {
      console.error("Erro ao buscar mileage_logs:", error);
      return res.status(400).json({ error: error.message });
    }
    res.json(data ?? []);
  });

  app.put("/api/vehicles/:vehicleId/mileage/:logId", authenticateUser, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const logId = req.params.logId;
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (!logId) return res.status(400).json({ error: "Invalid log id" });
      const userId = (req as AuthedRequest).user.id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      type MileageLogUpdate = {
        date: string;
        mileage: number;
        notes: string;
        valor: number | null;
        litros: number | null;
      };
      const filtered = pickFields<MileageLogUpdate, (typeof MILEAGE_LOG_FIELDS)[number]>(
        (req.body ?? {}) as Partial<MileageLogUpdate>,
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

      const { data, error } = await supabaseAdmin
        .from("mileage_logs")
        .update(filtered)
        .eq("id", logId)
        .eq("vehicle_id", vehicleId)
        .select()
        .single();
      if (error) {
        console.error("Erro PUT mileage_logs:", error, "payload:", filtered);
        return res.status(400).json({ error: error.message });
      }
      res.status(200).json(data);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL PUT mileage:", error);
      res.status(500).json({ error: error?.message || "Erro ao atualizar registro de KM." });
    }
  });

  app.delete("/api/vehicles/:vehicleId/mileage/:logId", authenticateUser, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const logId = req.params.logId;
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (!logId) return res.status(400).json({ error: "Invalid log id" });
      const userId = (req as AuthedRequest).user.id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { error } = await supabaseAdmin
        .from("mileage_logs")
        .delete()
        .eq("id", logId)
        .eq("vehicle_id", vehicleId);
      if (error) {
        console.error("Erro DELETE mileage_logs:", error);
        return res.status(400).json({ error: error.message });
      }

      // Re-deriva current_mileage do veículo a partir do maior log restante
      const { data: remaining } = await supabaseAdmin
        .from("mileage_logs")
        .select("mileage")
        .eq("vehicle_id", vehicleId);
      const max = Array.isArray(remaining) && remaining.length
        ? Math.max(...remaining.map((r: any) => Number(r.mileage) || 0))
        : 0;
      await supabaseAdmin.from("vehicles").update({ current_mileage: max }).eq("id", vehicleId);

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("🚨 ERRO FATAL DELETE mileage:", error);
      res.status(500).json({ error: error?.message || "Erro ao excluir registro de KM." });
    }
  });

  app.get("/api/vehicles/:vehicleId/logs", authenticateUser, async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { data, error } = await supabaseAdmin
      .from("maintenance_logs")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  app.put("/api/vehicles/:vehicleId/maintenance/:recordId", authenticateUser, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });
      const userId = (req as AuthedRequest).user.id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const filtered = pickFields<MaintenanceLog, (typeof MAINTENANCE_LOG_FIELDS)[number]>(
        (req.body ?? {}) as Partial<MaintenanceLog>,
        MAINTENANCE_LOG_FIELDS,
      );

      const { data, error } = await supabaseAdmin
        .from("maintenance_logs")
        .update(filtered)
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId)
        .select()
        .single();
      if (error) {
        console.error("Erro PUT maintenance_logs:", error, "payload:", filtered);
        return res.status(400).json({ error: error.message });
      }
      res.status(200).json(data);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL PUT maintenance:", error);
      res.status(500).json({ error: error?.message || "Erro ao atualizar manutenção." });
    }
  });

  app.delete("/api/vehicles/:vehicleId/maintenance/:recordId", authenticateUser, async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });
      const userId = (req as AuthedRequest).user.id;
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { error } = await supabaseAdmin
        .from("maintenance_logs")
        .delete()
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId);
      if (error) {
        console.error("Erro DELETE maintenance_logs:", error);
        return res.status(400).json({ error: error.message });
      }
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("🚨 ERRO FATAL DELETE maintenance:", error);
      res.status(500).json({ error: error?.message || "Erro ao excluir manutenção." });
    }
  });

  app.put("/api/vehicles/:vehicleId/financial/:recordId", authenticateUser, async (req, res) => {
    try {
      const userId = (req as AuthedRequest).user.id;
      if (!(await userHasFinancialAccess(userId))) {
        return res.status(403).json({
          error: "financial_plan_required",
          message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
        });
      }
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const filtered = pickFields<FinancialRecord, (typeof FINANCIAL_RECORD_FIELDS)[number]>(
        (req.body ?? {}) as Partial<FinancialRecord>,
        FINANCIAL_RECORD_FIELDS,
      );

      const { data, error } = await supabaseAdmin
        .from("financial_records")
        .update(filtered)
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId)
        .select()
        .single();
      if (error) {
        console.error("Erro PUT financial_records:", error, "payload:", filtered);
        return res.status(400).json({ error: error.message });
      }
      res.status(200).json(data);
    } catch (error: any) {
      console.error("🚨 ERRO FATAL PUT financial:", error);
      res.status(500).json({ error: error?.message || "Erro ao atualizar lançamento financeiro." });
    }
  });

  app.delete("/api/vehicles/:vehicleId/financial/:recordId", authenticateUser, async (req, res) => {
    try {
      const userId = (req as AuthedRequest).user.id;
      if (!(await userHasFinancialAccess(userId))) {
        return res.status(403).json({
          error: "financial_plan_required",
          message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
        });
      }
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });
      if (!(await vehicleBelongsToUser(userId, vehicleId))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { error } = await supabaseAdmin
        .from("financial_records")
        .delete()
        .eq("id", recordId)
        .eq("vehicle_id", vehicleId);
      if (error) {
        console.error("Erro DELETE financial_records:", error);
        return res.status(400).json({ error: error.message });
      }
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("🚨 ERRO FATAL DELETE financial:", error);
      res.status(500).json({ error: error?.message || "Erro ao excluir lançamento financeiro." });
    }
  });

  app.get("/api/vehicles/:vehicleId/financial", authenticateUser, async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await userHasFinancialAccess(userId))) {
      return res.status(403).json({
        error: "financial_plan_required",
        message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
      });
    }
    if (!(await vehicleBelongsToUser(userId, vehicleId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { data, error } = await supabaseAdmin.from("financial_records").select("*").eq("vehicle_id", vehicleId);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // --- MANUTENÇÃO / FINANCEIRO ---

  app.post("/api/logs", authenticateUser, async (req, res) => {
    const { id: _id, vehicle_id, ...fields } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: "vehicle_id is required" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await vehicleBelongsToUser(userId, Number(vehicle_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { data, error } = await supabaseAdmin
      .from("maintenance_logs")
      .insert({ vehicle_id, ...fields })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/financial", authenticateUser, async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    if (!(await userHasFinancialAccess(userId))) {
      return res.status(403).json({
        error: "financial_plan_required",
        message: "Impostos e multas estão disponíveis nos planos Plus e Premium.",
      });
    }
    const { id: _id, vehicle_id, ...fields } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: "vehicle_id is required" });
    if (!(await vehicleBelongsToUser(userId, Number(vehicle_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { data, error } = await supabaseAdmin
      .from("financial_records")
      .insert({ vehicle_id, ...fields })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // --- CHAT ---

  app.get("/api/chat/sessions", authenticateUser, async (req, res) => {
    const userId = (req as AuthedRequest).user.id;
    if (!(await userCanUseAdvisor(userId))) {
      return res.status(403).json({
        error: "advisor_plan_required",
        message: "Histórico de conversas com o Dr. Graxa está nos planos Plus e Premium.",
      });
    }
    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  app.post("/api/chat/sessions", authenticateUser, async (req, res) => {
    try {
      const user_id = (req as AuthedRequest).user.id;
      if (!(await userCanUseAdvisor(user_id))) {
        return res.status(403).json({
          error: "advisor_plan_required",
          message: "O Dr. Graxa está nos planos Plus e Premium.",
        });
      }
      const { vehicle_id, title } = req.body ?? {};
      // Se um vehicle_id veio, garante que pertence ao usuário autenticado
      if (vehicle_id != null && !(await vehicleBelongsToUser(user_id, Number(vehicle_id)))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { data, error } = await supabaseAdmin
        .from("chat_sessions")
        .insert({
          user_id,
          vehicle_id: vehicle_id ?? null,
          title: title ?? null,
        })
        .select("id")
        .single();
      if (error) {
        console.error("🚨 ERRO CHAT IA (insert chat_sessions):", error);
        return res.status(400).json({ error: error.message });
      }
      res.json({ id: data.id });
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA (POST /api/chat/sessions):", error);
      res.status(500).json({ error: error?.message || "Erro ao criar sessão." });
    }
  });

  app.delete("/api/chat/sessions/:id", authenticateUser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await userCanUseAdvisor(userId))) {
      return res.status(403).json({
        error: "advisor_plan_required",
        message: "O Dr. Graxa está nos planos Plus e Premium.",
      });
    }
    if (!(await chatSessionBelongsToUser(userId, id))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { error } = await supabaseAdmin.from("chat_sessions").delete().eq("id", id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  });

  /** Atualiza título da conversa (ex.: primeira pergunta do usuário como título automático). */
  app.patch("/api/chat/sessions/:id", authenticateUser, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await userCanUseAdvisor(userId))) {
      return res.status(403).json({
        error: "advisor_plan_required",
        message: "O Dr. Graxa está nos planos Plus e Premium.",
      });
    }
    if (!(await chatSessionBelongsToUser(userId, id))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { title } = (req.body ?? {}) as { title?: unknown };
    if (typeof title !== "string") {
      return res.status(400).json({ error: "title is required string" });
    }
    const safe = title.trim().replace(/\s+/g, " ").slice(0, 200);
    if (!safe) return res.status(400).json({ error: "title cannot be empty" });
    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .update({ title: safe, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, title, updated_at")
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  app.get("/api/chat/sessions/:sessionId/messages", authenticateUser, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (Number.isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const userId = (req as AuthedRequest).user.id;
    if (!(await userCanUseAdvisor(userId))) {
      return res.status(403).json({
        error: "advisor_plan_required",
        message: "Histórico de conversas está nos planos Plus e Premium.",
      });
    }
    if (!(await chatSessionBelongsToUser(userId, sessionId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  app.post("/api/chat/messages", authenticateUser, async (req, res) => {
    try {
      const { session_id, sender, content } = req.body ?? {};
      if (!session_id || !sender || content == null) {
        return res.status(400).json({ error: "session_id, sender and content are required" });
      }
      const userId = (req as AuthedRequest).user.id;
      if (!(await userCanUseAdvisor(userId))) {
        return res.status(403).json({
          error: "advisor_plan_required",
          message: "O Dr. Graxa está nos planos Plus e Premium.",
        });
      }
      if (!(await chatSessionBelongsToUser(userId, Number(session_id)))) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { data, error } = await supabaseAdmin
        .from("chat_messages")
        .insert({ session_id, sender, content })
        .select()
        .single();
      if (error) {
        console.error("🚨 ERRO CHAT IA (insert chat_messages):", error);
        return res.status(400).json({ error: error.message });
      }
      const { error: updErr } = await supabaseAdmin
        .from("chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", session_id);
      if (updErr) {
        console.error("⚠️ Falha ao atualizar updated_at em chat_sessions:", updErr);
      }
      res.json(data);
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA (POST /api/chat/messages):", error);
      res.status(500).json({ error: error?.message || "Erro ao salvar mensagem." });
    }
  });

  app.post("/api/chat", authenticateUser, async (req, res) => {
    const { message, vehicleId } = req.body ?? {};
    const userId = (req as AuthedRequest).user.id;

    if (!geminiApiKey) {
      console.error("🚨 ERRO CHAT IA: GEMINI_API_KEY ausente no servidor.");
      return res.status(500).json({
        text: "O Dr. Graxa está em manutenção (chave de API não configurada).",
        details: "GEMINI_API_KEY ausente",
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ text: "Mensagem vazia.", details: "message is required" });
    }

    try {
      const usage = await getEffectiveAiUsage(userId);
      if (usage.tier === "free") {
        return res.status(403).json({
          error: "advisor_plan_required",
          message: "O Dr. Graxa está disponível nos planos Plus e Premium.",
          text: "O Dr. Graxa está disponível nos planos Plus e Premium. Conheça nossos planos para continuar.",
        });
      }
      if (usage.limit > 0 && usage.count >= usage.limit) {
        return res.status(429).json({
          error: "ai_limit_exceeded",
          limit: usage.limit,
          count: usage.count,
          message: `Limite de ${usage.limit} mensagens mensais do Dr. Graxa atingido. Faça upgrade para aumentar sua cota.`,
          text: `Você atingiu o limite de ${usage.limit} mensagens com o Dr. Graxa neste mês. Faça upgrade do plano para continuar.`,
        });
      }

      const { data: user, error: userErr } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (userErr) console.error("⚠️ chat: erro lendo users:", userErr);

      // Só carrega o veículo se ele pertencer ao usuário autenticado
      let vehicle: any = null;
      if (vehicleId != null) {
        if (await vehicleBelongsToUser(userId, Number(vehicleId))) {
          const { data: v, error: vehErr } = await supabaseAdmin
            .from("vehicles")
            .select("*")
            .eq("id", vehicleId)
            .maybeSingle();
          if (vehErr) console.error("⚠️ chat: erro lendo vehicles:", vehErr);
          vehicle = v ?? null;
        }
      }

      const vehicleContext = vehicle
        ? `${vehicle.brand ?? ""} ${vehicle.model ?? ""} (${vehicle.year ?? "?"})`.trim()
        : "Nenhum veículo selecionado";

      const systemPrompt = `Você é o Dr. Graxa, especialista técnico do RevisAuto. Usuário: ${user?.nickname || "Amigo"}.
Contexto do veículo: ${vehicleContext}. Seja direto, técnico e use jargões de oficina.`;

      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `${systemPrompt}\n\nPergunta: ${message}`,
      });

      const text =
        (typeof (result as any)?.text === "string" && (result as any).text) ||
        (result as any)?.response?.text?.() ||
        (result as any)?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";

      if (!text) {
        console.error("🚨 ERRO CHAT IA: resposta sem texto", result);
        return res.status(502).json({
          text: "O Dr. Graxa não conseguiu formular uma resposta agora.",
          details: "empty model response",
        });
      }

      await incrementAiMessageCount(userId, usage.count);
      res.json({
        text,
        ai_messages_used: usage.count + 1,
        ai_messages_limit: usage.limit,
      });
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA:", error);
      res.status(500).json({
        text: "O Dr. Graxa está em manutenção. Tente logo mais.",
        details: error?.message || String(error),
      });
    }
  });

  // --- PAGAMENTOS / MERCADO PAGO ---

  app.post("/api/checkout", authenticateUser, async (req, res) => {
    try {
      if (!mpAccessToken) {
        return res.status(500).json({
          success: false,
          message: "Mercado Pago não configurado no servidor.",
        });
      }

      const userId = (req as AuthedRequest).user.id;
      const tokenEmail = (req as AuthedRequest).user.email || "";
      const { userEmail: bodyEmail } = (req.body ?? {}) as { userEmail?: string };
      const userEmail =
        typeof bodyEmail === "string" && bodyEmail.trim() ? bodyEmail : tokenEmail;

      if (typeof userEmail !== "string" || !userEmail.trim()) {
        return res.status(400).json({
          success: false,
          message: "userEmail é obrigatório para criar assinatura no Mercado Pago.",
        });
      }

      // Retorno ao app após fluxo Mercado Pago: PreApproval só aceita o campo
      // singular `back_url` (não há `back_urls` como em Preference).
      // MP_BACK_URL deve ser o deep link revisautoapp://... ou HTTPS (App Link).
      const backUrl = (process.env.MP_BACK_URL || "").trim();
      if (!backUrl) {
        console.error("[MP Checkout] MP_BACK_URL ausente no ambiente.");
        return res.status(500).json({
          success: false,
          message: "Configuração de retorno Mercado Pago ausente (MP_BACK_URL).",
        });
      }
      console.log("[MP Checkout] Criando PreApproval", { back_url: backUrl, user_id: userId });

      const rawBody = (req.body ?? {}) as { userEmail?: string; plan_type?: string; period?: string };
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
      const preApprovalClient = new PreApproval(mpClient);
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

      const preApproval = await preApprovalClient.create({ body: preApprovalBody as any });

      if (!preApproval?.init_point) {
        console.error("🚨 ERRO CHECKOUT MP (PreApproval): init_point ausente", preApproval);
        return res.status(502).json({
          success: false,
          message: "Mercado Pago não retornou um link de assinatura.",
        });
      }

      return res.json({
        success: true,
        init_point: preApproval.init_point,
        preapproval_id: preApproval.id,
      });
    } catch (error: any) {
      console.error("🚨 ERRO CHECKOUT MP (PreApproval):", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao gerar assinatura do Mercado Pago.",
        details: error?.message || String(error),
      });
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

    const { error } = await supabaseAdmin.from("users").update(row).eq("id", String(userId));

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

    const { error } = await supabaseAdmin
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
   * estar em process.env.MP_WEBHOOK_SECRET.
   *
   * Dev local: só se NODE_ENV≠production pode-se definir MP_WEBHOOK_SKIP_SIGNATURE=true
   * para ignorar headers (uso com ngrok/mock); não use em Render.
   */
  function verifyMercadoPagoSignature(req: express.Request): {
    ok: boolean;
    reason?: string;
  } {
    const secret = (process.env.MP_WEBHOOK_SECRET || "").trim();
    const allowSkip =
      process.env.MP_WEBHOOK_SKIP_SIGNATURE === "true" && process.env.NODE_ENV !== "production";

    // MP_WEBHOOK_SECRET obrigatório (Render/produção). Em dev apenas, permite
    // MP_WEBHOOK_SKIP_SIGNATURE=true para testes sem assinatura fake.
    if (!secret && !allowSkip) {
      return { ok: false, reason: "MP_WEBHOOK_SECRET ausente — configure no painel do MP." };
    }
    if (!secret && allowSkip) {
      console.warn("[MP Webhook] Assinatura ignorada (MP_WEBHOOK_SKIP_SIGNATURE=true, dev apenas).");
      return { ok: true };
    }

    const sigHeader = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];

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
    const dataIdQuery = (req.query as any)?.["data.id"];
    const dataIdBody = (req.body as any)?.data?.id;
    const dataId =
      typeof dataIdQuery === "string"
        ? dataIdQuery
        : dataIdBody != null
          ? String(dataIdBody)
          : "";

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

    let a: Buffer;
    let b: Buffer;
    try {
      a = Buffer.from(expected, "hex");
      b = Buffer.from(v1, "hex");
    } catch {
      return { ok: false, reason: "v1 não é hex válido." };
    }
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "HMAC mismatch." };
    }
    console.log("[MP Webhook] x_signature_valid", {
      requestId,
      manifestLength: manifest.length,
    });
    return { ok: true };
  }

  app.post("/api/webhook", async (req, res) => {
    const receivedAt = new Date().toISOString();
    const queryDataId =
      typeof (req.query as Record<string, string>)?.["data.id"] === "string"
        ? (req.query as Record<string, string>)["data.id"]
        : undefined;
    console.log("[MP Webhook] event_received", receivedAt, {
      path: req.path,
      query_data_id: queryDataId,
      x_request_id: req.headers["x-request-id"],
      has_x_signature: typeof req.headers["x-signature"] === "string",
    });

    // 1) Validação HMAC usando MP_WEBHOOK_SECRET + headers x-signature / x-request-id
    const sigCheck = verifyMercadoPagoSignature(req);
    if (!sigCheck.ok) {
      console.error("[MP Webhook] signature_REJECTED:", sigCheck.reason);
      return res.status(401).json({ ok: false, error: "invalid_signature" });
    }
    console.log("[MP Webhook] signature_VERIFIED_ok");

    // 2) Responde 200 cedo para o MP não reenviar
    res.status(200).send("ok");
    console.log("[MP Webhook] response_sent_200");

    try {
      const body = (req.body ?? {}) as Record<string, any>;
      console.log("[MP Webhook] body_received", JSON.stringify(body));

      if (!mpAccessToken) {
        console.error("[MP Webhook] SKIP no MP_ACCESS_TOKEN");
        return;
      }

      const type: string = body.type || body.topic || "";
      const resourceId =
        body?.data?.id ||
        body?.resource ||
        (typeof body?.id !== "undefined" ? body.id : undefined);

      console.log("[MP Webhook] parsed", {
        type,
        resourceId,
        action: body.action,
      });

      if (!type || !resourceId) {
        console.log("[MP Webhook] ignored_missing_type_or_id", { type, resourceId });
        return;
      }

      // --- PreApproval (assinatura) ---
      if (type === "subscription_preapproval" || type === "preapproval") {
        console.log("[MP Webhook] branch=subscription_preapproval", { resourceId });
        const sub = await new PreApproval(mpClient).get({ id: String(resourceId) });
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
          const payment = await new Payment(mpClient).get({ id: String(resourceId) });
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
        const payment = await new Payment(mpClient).get({ id: String(resourceId) });
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
  });

  // 404 para rotas desconhecidas (antes ficavam silenciosas)
  app.use((req, res, next) => {
    if (res.headersSent) return next();
    console.error(`🚨 ROTA NÃO ENCONTRADA: ${req.method} ${req.url}`);
    res.status(404).json({ success: false, message: "Rota não encontrada", path: req.url });
  });

  // Capturador de erros global — última linha de defesa
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("🚨 ERRO GLOBAL FATAL:", {
      url: req.url,
      method: req.method,
      message: err?.message,
      stack: err?.stack,
      err,
    });
    if (res.headersSent) return;
    res.status(500).json({
      success: false,
      message: "Erro global",
      details: err?.message || String(err),
    });
  });

  // Falhas que escapam de async handlers ainda chegam aqui via Node
  process.on("unhandledRejection", (reason) => {
    console.error("🚨 UNHANDLED REJECTION:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("🚨 UNCAUGHT EXCEPTION:", error);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Servidor RevisAuto Ativo na porta ${PORT}`);
  });
}

startServer();
