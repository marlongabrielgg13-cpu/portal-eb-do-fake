require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { z } = require("zod");

const app = express();
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const groupId = process.env.ROBLOX_GROUP_ID || "376496824";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : undefined
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}
required("DATABASE_URL");
required("SESSION_SECRET");
required("ROBLOX_CLIENT_ID");
required("ROBLOX_CLIENT_SECRET");
required("ROBLOX_REDIRECT_URI");
if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
}
if (!process.env.ADMIN_ROBLOX_USER_ID || !/^\d+$/.test(process.env.ADMIN_ROBLOX_USER_ID)) {
  throw new Error("Configure ADMIN_ROBLOX_USER_ID com o ID numérico imutável de yImperador.");
}

app.set("trust proxy", 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://tr.rbxcdn.com"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static("public", { etag: true, maxAge: isProd ? "1h" : 0 }));

app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "ebfake.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inscriptions (
      id BIGSERIAL PRIMARY KEY,
      roblox_user_id TEXT NOT NULL,
      roblox_username TEXT NOT NULL,
      display_name TEXT,
      type TEXT NOT NULL CHECK (type IN ('alistamento','oficiais','tropas-especiais')),
      unit TEXT,
      answers JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente','Aprovado','Reprovado')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS inscriptions_user_idx ON inscriptions(roblox_user_id);
    CREATE INDEX IF NOT EXISTS inscriptions_created_idx ON inscriptions(created_at DESC);
  `);
}

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function robloxFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Roblox API respondeu ${response.status}`);
  return response.json();
}

async function getGroupMembership(userId) {
  const data = await robloxFetch(`https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`);
  return Array.isArray(data.data) && data.data.some(item => String(item.group?.id) === String(groupId));
}

async function getAdminId() {
  return String(process.env.ADMIN_ROBLOX_USER_ID);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Faça login com Roblox." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || String(req.session.user.id) !== String(process.env.ADMIN_ROBLOX_USER_ID)) {
    return res.status(403).json({ error: "Acesso restrito à administração." });
  }
  next();
}
function requireCsrf(req, res, next) {
  const supplied = req.get("x-csrf-token");
  if (!req.session.csrfToken || !safeEqual(supplied, req.session.csrfToken)) {
    return res.status(403).json({ error: "Verificação de segurança falhou. Atualize a página." });
  }
  next();
}

app.get("/auth/roblox", authLimiter, (req, res) => {
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  req.session.oauthState = state;
  req.session.pkceVerifier = verifier;
  const params = new URLSearchParams({
    client_id: required("ROBLOX_CLIENT_ID"),
    redirect_uri: required("ROBLOX_REDIRECT_URI"),
    scope: "openid profile",
    response_type: "code",
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: "S256"
  });
  res.redirect(`https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`);
});

app.get("/auth/roblox/callback", authLimiter, asyncRoute(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect("/?login=cancelado");
  if (!code || !state || !safeEqual(state, req.session.oauthState || "")) {
    return res.status(400).send("Não foi possível validar o login. Tente novamente.");
  }
  const verifier = req.session.pkceVerifier;
  delete req.session.oauthState;
  delete req.session.pkceVerifier;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    client_id: required("ROBLOX_CLIENT_ID"),
    client_secret: required("ROBLOX_CLIENT_SECRET"),
    redirect_uri: required("ROBLOX_REDIRECT_URI"),
    code_verifier: verifier
  });
  const tokens = await robloxFetch("https://apis.roblox.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const profile = await robloxFetch("https://apis.roblox.com/oauth/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });

  const userId = String(profile.sub || "");
  if (!/^\d+$/.test(userId)) return res.status(403).send("A Roblox não retornou um ID válido.");
  const isMember = await getGroupMembership(userId);
  if (!isMember && userId !== await getAdminId()) {
    return res.status(403).send("Acesso negado: entre no grupo EB do Fake e tente novamente.");
  }

  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.user = {
    id: userId,
    username: profile.preferred_username || profile.nickname || profile.name || "Roblox",
    displayName: profile.name || profile.nickname || "",
    picture: profile.picture || null,
    isAdmin: userId === await getAdminId()
  };
  req.session.csrfToken = randomBase64Url();
  res.redirect("/");
}));

app.get("/api/me", (req, res) => {
  res.json({
    user: req.session.user || null,
    csrfToken: req.session.csrfToken || null,
    groupId
  });
});

app.post("/api/logout", requireAuth, requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("ebfake.sid", { httpOnly: true, sameSite: "lax", secure: isProd });
    res.json({ ok: true });
  });
});

const inscriptionSchema = z.object({
  type: z.enum(["alistamento", "oficiais", "tropas-especiais"]),
  unit: z.string().max(80).optional().default(""),
  answers: z.object({
    age: z.string().trim().min(1).max(3),
    reason: z.string().trim().min(10).max(1200),
    experience: z.string().trim().max(1200).optional().default(""),
    availability: z.string().trim().min(1).max(300)
  }).strict()
}).strict();

app.post("/api/inscriptions", requireAuth, requireCsrf, formLimiter, asyncRoute(async (req, res) => {
  const parsed = inscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Confira os campos e tente novamente." });
  const { type, unit, answers } = parsed.data;
  const recent = await pool.query(
    "SELECT id FROM inscriptions WHERE roblox_user_id=$1 AND status='Pendente' AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1",
    [req.session.user.id]
  );
  if (recent.rowCount) return res.status(429).json({ error: "Você já possui uma inscrição pendente. Aguarde a análise." });

  const result = await pool.query(
    `INSERT INTO inscriptions (roblox_user_id, roblox_username, display_name, type, unit, answers)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, created_at`,
    [req.session.user.id, req.session.user.username, req.session.user.displayName, type, unit, JSON.stringify(answers)]
  );
  res.status(201).json({ ok: true, inscription: result.rows[0] });
}));

app.get("/api/my-inscriptions", requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, type, unit, status, created_at, reviewed_at
     FROM inscriptions WHERE roblox_user_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [req.session.user.id]
  );
  res.json({ inscriptions: result.rows });
}));

app.get("/api/admin/inscriptions", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const status = ["Pendente", "Aprovado", "Reprovado"].includes(req.query.status) ? req.query.status : null;
  const result = await pool.query(
    `SELECT id, roblox_user_id, roblox_username, display_name, type, unit, answers, status, created_at
     FROM inscriptions WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 200`,
    [status]
  );
  res.json({ inscriptions: result.rows });
}));

app.patch("/api/admin/inscriptions/:id", requireAuth, requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const schema = z.object({ status: z.enum(["Aprovado", "Reprovado"]) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Dados inválidos." });
  const result = await pool.query(
    `UPDATE inscriptions SET status=$1, reviewed_at=NOW(), reviewed_by=$2
     WHERE id=$3 AND status='Pendente' RETURNING id, status`,
    [parsed.data.status, req.session.user.id, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Inscrição não encontrada ou já analisada." });
  res.json({ ok: true, inscription: result.rows[0] });
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((err, req, res, _next) => {
  console.error("Erro interno:", err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Ocorreu um erro interno. Tente novamente." });
});

initDb().then(() => {
  app.listen(port, () => console.log(`Portal EB do Fake ativo na porta ${port}`));
}).catch(err => {
  console.error("Falha ao iniciar:", err);
  process.exit(1);
});
