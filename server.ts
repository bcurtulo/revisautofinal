import express from "express";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import fetch from "cross-fetch";
import type { User, Vehicle, MaintenanceLog, FinancialRecord } from "./src/types.ts";

dotenv.config();

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

const MILEAGE_LOG_FIELDS = ["date", "mileage", "notes"] as const;

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

      return res.status(200).json({ success: true, user: fullUser });
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
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        const msg = authError.message.includes("Email not confirmed")
          ? "Verifique seu e-mail antes de acessar."
          : "E-mail ou senha incorretos.";
        return res.status(401).json({ success: false, message: msg });
      }

      const { data: profile, error: profileError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("Erro na Rota /api/login (users):", profileError);
        return res.status(500).json({ success: false, message: "Erro ao carregar perfil." });
      }

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: "PROFILE_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        user: { ...profile, access_token: authData.session?.access_token },
      });
    } catch (error: any) {
      console.error("Erro na Rota /api/login:", error);
      res.status(500).json({ success: false, message: "Erro interno no servidor." });
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

  app.get("/api/user", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
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

  app.get("/api/vehicles", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const { data: vehicles, error } = await supabaseAdmin.from("vehicles").select("*").eq("user_id", userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json(vehicles ?? []);
  });

  app.post("/api/vehicles", async (req, res) => {
    const body = (req.body ?? {}) as VehicleCreatePayload;
    const user_id = body.user_id;
    if (user_id == null) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const vehicleData = pickFields<Vehicle, (typeof VEHICLE_INSERT_FIELDS)[number]>(
      body as Partial<Vehicle>,
      VEHICLE_INSERT_FIELDS,
    );

    if (!vehicleData.type || !vehicleData.brand || !vehicleData.model || vehicleData.year == null) {
      return res.status(400).json({ error: "Missing required vehicle fields (type, brand, model, year)" });
    }

    const { data: userRow } = await supabaseAdmin.from("users").select("plan").eq("id", user_id).single();

    const insertPayload: Record<string, unknown> = { user_id, ...vehicleData };
    if (userRow?.plan !== "premium") {
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
      user_id,
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

  app.put("/api/vehicles/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid vehicle id" });

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("vehicles")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (exErr) return res.status(400).json({ error: exErr.message });
    if (!existing) return res.status(404).json({ error: "Vehicle not found" });

    const body = (req.body ?? {}) as Partial<Vehicle>;
    const filtered = pickFields<Vehicle, (typeof VEHICLE_UPDATE_FIELDS)[number]>(
      body,
      VEHICLE_UPDATE_FIELDS,
    );
    const payload: Record<string, unknown> = { ...filtered };

    const { data: owner } = await supabaseAdmin.from("users").select("plan").eq("id", existing.user_id).single();
    if (owner?.plan !== "premium") {
      payload.nickname = null;
      payload.color = null;
    }

    const { data, error } = await supabaseAdmin.from("vehicles").update(payload).eq("id", id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/vehicles/:id/archive", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid vehicle id" });
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

  app.post("/api/vehicles/:id/mileage", async (req, res) => {
    const vehicleId = parseInt(req.params.id, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const mileage = Number(req.body.mileage);
    const date = (req.body.date as string) || new Date().toISOString().split("T")[0];
    if (Number.isNaN(mileage)) return res.status(400).json({ error: "Invalid mileage" });

    const { error: insErr } = await supabaseAdmin.from("mileage_logs").insert({ vehicle_id: vehicleId, date, mileage });
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

  app.get("/api/vehicles/:vehicleId/mileage", async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
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

  app.put("/api/vehicles/:vehicleId/mileage/:logId", async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const logId = req.params.logId;
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (!logId) return res.status(400).json({ error: "Invalid log id" });

      const filtered = pickFields<{ date: string; mileage: number; notes: string }, (typeof MILEAGE_LOG_FIELDS)[number]>(
        (req.body ?? {}) as Partial<{ date: string; mileage: number; notes: string }>,
        MILEAGE_LOG_FIELDS,
      );
      if (filtered.mileage !== undefined) filtered.mileage = Number(filtered.mileage) as any;

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

  app.delete("/api/vehicles/:vehicleId/mileage/:logId", async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const logId = req.params.logId;
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (!logId) return res.status(400).json({ error: "Invalid log id" });

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

  app.get("/api/vehicles/:vehicleId/logs", async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const { data, error } = await supabaseAdmin
      .from("maintenance_logs")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  app.put("/api/vehicles/:vehicleId/maintenance/:recordId", async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });

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

  app.delete("/api/vehicles/:vehicleId/maintenance/:recordId", async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });

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

  app.put("/api/vehicles/:vehicleId/financial/:recordId", async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });

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

  app.delete("/api/vehicles/:vehicleId/financial/:recordId", async (req, res) => {
    try {
      const vehicleId = parseInt(req.params.vehicleId, 10);
      const recordId = parseInt(req.params.recordId, 10);
      if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
      if (Number.isNaN(recordId)) return res.status(400).json({ error: "Invalid record id" });

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

  app.get("/api/vehicles/:vehicleId/financial", async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: "Invalid vehicle id" });
    const { data, error } = await supabaseAdmin.from("financial_records").select("*").eq("vehicle_id", vehicleId);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // --- MANUTENÇÃO / FINANCEIRO ---

  app.post("/api/logs", async (req, res) => {
    const { id: _id, vehicle_id, ...fields } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: "vehicle_id is required" });
    const { data, error } = await supabaseAdmin
      .from("maintenance_logs")
      .insert({ vehicle_id, ...fields })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/financial", async (req, res) => {
    const { id: _id, vehicle_id, ...fields } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: "vehicle_id is required" });
    const { data, error } = await supabaseAdmin
      .from("financial_records")
      .insert({ vehicle_id, ...fields })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // --- CHAT ---

  app.get("/api/chat/sessions", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  app.post("/api/chat/sessions", async (req, res) => {
    try {
      const { user_id, vehicle_id, title } = req.body ?? {};
      if (!user_id) return res.status(400).json({ error: "user_id is required" });
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

  app.delete("/api/chat/sessions/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid session id" });
    const { error } = await supabaseAdmin.from("chat_sessions").delete().eq("id", id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  });

  app.get("/api/chat/sessions/:sessionId/messages", async (req, res) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (Number.isNaN(sessionId)) return res.status(400).json({ error: "Invalid session id" });
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  app.post("/api/chat/messages", async (req, res) => {
    try {
      const { session_id, sender, content } = req.body ?? {};
      if (!session_id || !sender || content == null) {
        return res.status(400).json({ error: "session_id, sender and content are required" });
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

  app.post("/api/chat", async (req, res) => {
    const { message, vehicleId, userId } = req.body ?? {};

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
      const { data: user, error: userErr } = userId
        ? await supabaseAdmin.from("users").select("*").eq("id", userId).maybeSingle()
        : { data: null, error: null };
      if (userErr) console.error("⚠️ chat: erro lendo users:", userErr);

      const { data: vehicle, error: vehErr } = vehicleId
        ? await supabaseAdmin.from("vehicles").select("*").eq("id", vehicleId).maybeSingle()
        : { data: null, error: null };
      if (vehErr) console.error("⚠️ chat: erro lendo vehicles:", vehErr);

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

      res.json({ text });
    } catch (error: any) {
      console.error("🚨 ERRO CHAT IA:", error);
      res.status(500).json({
        text: "O Dr. Graxa está em manutenção. Tente logo mais.",
        details: error?.message || String(error),
      });
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
