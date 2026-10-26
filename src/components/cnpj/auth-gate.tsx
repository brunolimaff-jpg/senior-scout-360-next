"use client";

/**
 * AuthGate — desbloqueio de sessão do servidor (G9, auditoria v0.6.1).
 *
 * - No boot: consulta GET /api/auth/session e mostra o estado do acesso.
 * - Se alguma chamada /api recebe 401 UNAUTHORIZED (evento "scout:auth-required"
 *   disparado por apiFetch), abre o diálogo: o operador digita o token UMA vez.
 * - O token nunca é armazenado no cliente — o servidor devolve cookie httpOnly
 *   assinado (HMAC), válido por 12h.
 * - Modo OPEN (kit local, sem SCOUT_EXPORT_TOKEN): nada é exibido — acesso aberto
 *   é decisão explícita de ambiente e aparece no tooltip do selo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { endSession, fetchAuthState, requestSession, type AuthState } from "@/lib/client-api";

const AUTH_REQUIRED_EVENT = "scout:auth-required";

export function AuthGate() {
  const [state, setState] = useState<AuthState>({ authMode: "OPEN", authenticated: true });
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const s = await fetchAuthState();
    setState(s);
    return s;
  }, []);

  useEffect(() => {
    // microtask: a consulta inicial não pode setState síncrono no efeito (react-hooks)
    const t = setTimeout(() => void refresh(), 0);
    const onRequired = () => {
      setOpen(true);
      setError(null);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => {
      clearTimeout(t);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
    };
  }, [refresh]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const unlock = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await requestSession(token);
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? "Token inválido.");
      return;
    }
    setToken("");
    setOpen(false);
    setState({ authMode: "TOKEN", authenticated: true });
    // sessão nova: recarrega a visão para todas as chamadas já navegarem com o cookie
    window.location.reload();
  };

  const lock = async () => {
    await endSession();
    setState({ authMode: "TOKEN", authenticated: false });
  };

  const precisaDesbloquear = state.authMode === "TOKEN" && !state.authenticated;

  return (
    <>
      {state.authMode === "TOKEN" && (
        <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-[#DCE9E6] bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80 print:hidden">
          {state.authenticated ? (
            <>
              <ShieldCheck className="size-4 text-[#00968C]" aria-hidden />
              <span className="text-xs font-medium text-[#1F2A2E]">Sessão protegida</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={lock}
                className="h-8 min-h-8 px-2 text-xs text-[#5C6B70] hover:text-[#1F2A2E]"
                title="Encerrar a sessão deste navegador"
              >
                Sair
              </Button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              data-testid="auth-unlock-trigger"
              className="flex h-8 min-h-8 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-[#8C2F39] hover:bg-[#8C2F3910]"
              title="Este ambiente exige token de acesso. Clique para desbloquear."
            >
              <LockKeyhole className="size-4" aria-hidden />
              Acesso restrito: desbloquear
            </button>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="auth-unlock-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="size-5 text-[#00968C]" aria-hidden />
              Desbloquear o Scout 360
            </DialogTitle>
            <DialogDescription>
              Este ambiente está protegido por token. Digite o token de acesso uma única vez.
              a sessão fica em cookie httpOnly do servidor e o token nunca é guardado no navegador.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
            className="grid gap-3"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="scout-token-input">Token de acesso</Label>
              <Input
                id="scout-token-input"
                ref={inputRef}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="valor de SCOUT_EXPORT_TOKEN"
                data-testid="auth-token-input"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-[#8C2F39]" data-testid="auth-error">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={busy || !token.trim()} className="min-h-11" data-testid="auth-unlock-submit">
                {busy ? "Validando…" : "Desbloquear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
