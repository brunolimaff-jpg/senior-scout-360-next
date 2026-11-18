/**
 * auth.ts — FRONTEIRA DE ACESSO server-side (G9, auditoria v0.6.1).
 *
 * Problema anterior: a guarda era "ativa quando SCOUT_EXPORT_TOKEN existe" e só
 * aceitava header — a UI (que nunca pode guardar o token no código do cliente)
 * ficava bloqueada, e sem env a fronteira abria em silêncio.
 *
 * Modelo agora:
 *  1. SESSÃO DE SERVIDOR — o operador informa o token UMA vez na UI; o servidor
 *     valida contra o segredo do ambiente e emite um cookie httpOnly assinado
 *     (HMAC-SHA256 sobre um timestamp). O token em si NUNCA volta ao browser.
 *  2. Todas as rotas de leitura e escrita de dados (incluindo export, worker/tick
 *     e upload) passam por assertAccess(): aceita cookie de sessão válido OU o
 *     header x-export-token/Bearer (chamadas diretas, curl/CLI).
 *  3. Modo de execução explícito:
 *     - SCOUT_EXPORT_TOKEN definido ............ modo TOKEN (fechado — 401 sem sessão)
 *     - SCOUT_AUTH_REQUIRED=1 sem token ........ modo TOKEN com segredo AUTO-GERADO e
 *       persistido em db/.scout-token (deploy não fica aberto por esquecimento)
 *     - nenhum dos dois ........................ modo OPEN (kit local) — estado visível
 *       em GET /api/auth/session e na UI; em produção, OPEN vira 503 AUTH_MISCONFIG
 *       (fail-closed) em toda rota de dados.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const SESSION_COOKIE = "scout_session";
const SESSION_TTL_MS = 12 * 3600 * 1000; // 12h de operação normal
const AUTO_TOKEN_FILE = path.join(process.cwd(), "db", ".scout-token");

let cachedAutoToken: string | null = null;

/** Garante existência do token auto-gerado (modo SCOUT_AUTH_REQUIRED=1). */
async function ensureAutoToken(): Promise<string | null> {
  if (cachedAutoToken) return cachedAutoToken;
  try {
    const existing = (await fs.readFile(AUTO_TOKEN_FILE, "utf8")).trim();
    if (existing) {
      cachedAutoToken = existing;
      return existing;
    }
  } catch {
    /* arquivo ainda não existe — gera abaixo */
  }
  const generated = `scout_${randomBytes(24).toString("hex")}`;
  await fs.mkdir(path.dirname(AUTO_TOKEN_FILE), { recursive: true });
  await fs.writeFile(AUTO_TOKEN_FILE, generated, { mode: 0o600 });
  cachedAutoToken = generated;
  return generated;
}

/** Estado do modo de acesso — exposto na UI via GET /api/auth/session (sem segredo). */
export type AuthMode = "OPEN" | "TOKEN";
export function authMode(): AuthMode {
  const explicit = (process.env.SCOUT_EXPORT_TOKEN ?? "").trim();
  if (explicit) return "TOKEN";
  if ((process.env.SCOUT_AUTH_REQUIRED ?? "").trim() === "1") return "TOKEN";
  return "OPEN";
}

/**
 * Configuração de autenticação inválida para o ambiente? (P0 fail-closed)
 *
 * Em produção, o modo OPEN significa que nenhum segredo foi configurado: as
 * rotas de dados devem recusar em vez de abrir. Fora de produção o OPEN é o
 * "kit local" documentado e continua válido.
 */
export function authConfigError(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (authMode() !== "OPEN") return null;
  return "Autenticação não configurada neste ambiente: defina SCOUT_EXPORT_TOKEN (segredo do servidor) e reinicie o serviço. Enquanto isso, as rotas de dados respondem 503.";
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function makeSessionValue(secret: string): string {
  const ts = Date.now().toString(36);
  return `${ts}.${sign(ts, secret)}`;
}

function verifySessionValue(value: string, secret: string): boolean {
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const ts = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(ts, secret);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const age = Date.now() - parseInt(ts, 36);
  return Number.isFinite(age) && age >= 0 && age < SESSION_TTL_MS;
}

function providedHeaderToken(req: NextRequest): string {
  return (req.headers.get("x-export-token") ?? "").trim() ||
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** O pedido está autorizado? (sessão httpOnly válida OU header com o token correto) */
export function isAuthorized(req: NextRequest, secret: string | null): boolean {
  if (!secret) return true; // modo OPEN — decisão de ambiente, visível na UI e nos logs
  if (providedHeaderToken(req)) {
    const provided = providedHeaderToken(req);
    return provided.length === secret.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  return cookie.length > 0 && verifySessionValue(cookie, secret);
}

/**
 * GUARDA ÚNICA de todas as rotas de dados (leitura e mutação — G9).
 * Uso na rota:
 *   const denied = await assertAccess(req);
 *   if (denied) return denied;
 */
export async function assertAccess(req: NextRequest): Promise<NextResponse | null> {
  if (authMode() === "OPEN") {
    const configError = authConfigError();
    if (configError) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "AUTH_MISCONFIG", message: configError },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    return null;
  }
  const secret = (process.env.SCOUT_EXPORT_TOKEN ?? "").trim() || (await ensureAutoToken());
  if (isAuthorized(req, secret)) return null;
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message:
          "Acesso protegido: abra a aplicação e desbloqueie com o token de acesso (a sessão fica em cookie httpOnly — o token nunca vai ao código do cliente). Chamadas diretas (curl/CLI) aceitam o header x-export-token.",
      },
    },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

/** Compatibilidade com as rotas já guardadas (mesma fronteira, escopo ampliado). */
export function assertExportAllowed(req: NextRequest): Promise<NextResponse | null> {
  return assertAccess(req);
}
export function assertMutationAllowed(req: NextRequest): Promise<NextResponse | null> {
  return assertAccess(req);
}

/** Emite o cookie de sessão após validação do token (POST /api/auth/session). */
export async function tryIssueSession(rawToken: string): Promise<string | null> {
  const explicit = (process.env.SCOUT_EXPORT_TOKEN ?? "").trim();
  const secret = explicit || (authMode() === "TOKEN" ? await ensureAutoToken() : null);
  if (!secret) return null;
  const provided = rawToken.trim();
  if (provided.length !== secret.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) return null;
  const value = makeSessionValue(secret);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

/** Cookie de logout (expirado). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Sessão atual válida? (para o estado da UI — não devolve segredo) */
export function hasValidSession(req: NextRequest, secret: string | null): boolean {
  if (!secret) return false;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  return verifySessionValue(cookie, secret);
}

export function currentSecret(): Promise<string | null> {
  const explicit = (process.env.SCOUT_EXPORT_TOKEN ?? "").trim();
  if (explicit) return Promise.resolve(explicit);
  if (authMode() === "TOKEN") return ensureAutoToken();
  return Promise.resolve(null);
}
