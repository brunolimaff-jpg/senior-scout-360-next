"use client";

/**
 * client-api.ts — camada de fetch do cliente (G9, auditoria v0.6.1).
 *
 * Toda chamada /api passa por apiFetch(): quando o servidor responde 401
 * UNAUTHORIZED (modo TOKEN sem sessão), dispara o evento global "scout:auth-required"
 * que abre o diálogo de desbloqueio (AuthGate). O token NUNCA vive no código do
 * cliente — o operador digita uma vez e o servidor devolve cookie httpOnly.
 */

export class AuthRequiredError extends Error {
  constructor() {
    super("Sessão necessária — informe o token de acesso para continuar.");
    this.name = "AuthRequiredError";
  }
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    try {
      const body = (await res.clone().json()) as { error?: { code?: string } };
      if (body?.error?.code === "UNAUTHORIZED") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("scout:auth-required"));
        }
        throw new AuthRequiredError();
      }
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      // resposta 401 fora do contrato — deixa o chamador tratar
    }
  }
  return res;
}

/** Estado do acesso exposto por GET /api/auth/session (sem segredo). */
export interface AuthState {
  authMode: "OPEN" | "TOKEN";
  authenticated: boolean;
}

export async function fetchAuthState(): Promise<AuthState> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) return { authMode: "OPEN", authenticated: true }; // falha de rede não trava a UI
  const json = (await res.json()) as { data?: AuthState } & Partial<AuthState>;
  const d = json.data ?? json;
  return { authMode: d.authMode ?? "OPEN", authenticated: d.authenticated ?? true };
}

export async function requestSession(token: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.ok) return { ok: true };
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return { ok: false, message: body?.error?.message ?? "Token inválido." };
  } catch {
    return { ok: false, message: "Token inválido." };
  }
}

export async function endSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
}
