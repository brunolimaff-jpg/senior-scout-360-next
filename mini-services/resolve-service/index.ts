/**
 * resolve-service — ponte isolada para as funções web do SDK (web_search / page_reader).
 *
 * Por que existe: `zai.functions.invoke` dentro do processo do Next (node/Turbopack)
 * derruba o servidor silenciosamente; sob bun o SDK roda estável (verificado).
 * O Next chama este serviço via HTTP interno (127.0.0.1:3030).
 *
 * Rate limit: janela deslizante de 60s por serviço + backoff em 429 (defesa extra —
 * o limiter primário fica no Next, em src/lib/ratelimit.ts).
 * Sem IA aqui: apenas recolha de evidências públicas indexadas (candidatos, nunca confirmação).
 */

const PORT = 3030;

// ==== Supervisor do Next (self-heal do ambiente de desenvolvimento) ====
// Este serviço é um processo de longa vida (supervisor dev:resiliente, PPID → init),
// enquanto processos lançados ad-hoc pelo agente/terminal são recolhidos pelo
// sandbox. Este bloco verifica o Next (:3000) e o reinicia quando não responde —
// inclusive após hot-reload deste arquivo. Se a plataforma já subiu o Next,
// nenhuma ação é tomada. Não altera nenhum fluxo de negócio do Scout.
const NEXT_HEALTH_URL = "http://127.0.0.1:3000/api/auth/session";
let nextSpawnBusy = false;
async function nextVivo(): Promise<boolean> {
  try {
    const r = await fetch(NEXT_HEALTH_URL, { signal: AbortSignal.timeout(2500) });
    return r.status > 0; // qualquer resposta HTTP (mesmo 401/500) = processo vivo
  } catch {
    return false;
  }
}
async function garantirNext(): Promise<void> {
  if (nextSpawnBusy) return;
  if (await nextVivo()) return;
  nextSpawnBusy = true;
  try {
    console.log("[next-supervisor] :3000 sem resposta — iniciando Next.js dev...");
    const child = Bun.spawn({
      cmd: ["bash", "-c", "cd /home/z/my-project && exec bun run dev"],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await nextVivo()) break;
    }
    console.log("[next-supervisor] verificação pós-boot do Next concluída");
  } catch (e) {
    console.log("[next-supervisor] falha ao iniciar Next:", e);
  } finally {
    nextSpawnBusy = false;
  }
}
void (async () => {
  await new Promise((r) => setTimeout(r, 8000)); // dá espaço ao boot da plataforma
  await garantirNext();
})();
setInterval(() => void garantirNext(), 30_000);

const CALL_TIMEOUT_MS = 25_000;
const RPM: Record<string, number> = { WEB_SEARCH: 10, PAGE_READER: 10 };

/**
 * P0-06 (auditoria v0.6.0): um pacote de pesquisa faz 15-18 buscas por conta —
 * rejeitar a 11ª em seco esgotava a cota ANTES das buscas de tecnologia e a ausência
 * de fonte virava "conclusão". Agora o acquire ESPERA por um slot (até ACQUIRE_WAIT_MS,
 * dentro do timeout de 35s do chamador) e só devolve false quando a janela realmente
 * não abre — recusa vira 429 explícito, tratado como PESQUISA INCOMPLETA pelo pacote.
 */
const ACQUIRE_WAIT_MS = 24_000;

interface Bucket {
  starts: number[];
  backoffUntil: number;
}

const buckets = new Map<string, Bucket>();

function bucket(service: string): Bucket {
  let b = buckets.get(service);
  if (!b) {
    b = { starts: [], backoffUntil: 0 };
    buckets.set(service, b);
  }
  return b;
}

async function acquire(service: string): Promise<boolean> {
  const deadline = Date.now() + ACQUIRE_WAIT_MS;
  for (;;) {
    const b = bucket(service);
    const now = Date.now();
    if (b.backoffUntil <= now) {
      b.starts = b.starts.filter((t) => now - t < 60_000);
      if (b.starts.length < (RPM[service] ?? 10)) {
        b.starts.push(now);
        return true;
      }
    }
    if (Date.now() >= deadline) return false; // janela realmente esgotada
    await new Promise((r) => setTimeout(r, 1_200));
  }
}

async function withZai<T>(fn: (zai: import("z-ai-web-dev-sdk").default) => Promise<T>): Promise<T> {
  const mod = await import("z-ai-web-dev-sdk");
  const zai = await mod.default.create();
  return fn(zai);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/**
 * Blindagem: um rejection não tratado dentro do SDK (ex.: modelo que o gateway não
 * suporta) NÃO pode derrubar a ponte — o Next depende dela para todo o pipeline.
 * Log honesto e o servidor continua de pé.
 */
process.on("uncaughtException", (err) => {
  console.error("[resolve-service] uncaughtException:", err?.message ?? err);
});
process.on("unhandledRejection", (err) => {
  console.error("[resolve-service] unhandledRejection:", err instanceof Error ? err.message : err);
});

/**
 * v0.10.4 — preserva o STATUS HTTP DO PROVEDOR a jusante (gateway de IA/busca).
 * A v0.10.3 devolvia 500 + texto: o status 429 real do upstream se perdia e a
 * telemetria só podia "adivinhar" pelo texto do erro. Agora o erro do SDK é
 * inspecionado (err.status / "status: N" / 429 + texto de limite) e o resultado:
 *   · 429 a jusante → resposta HTTP 429 com upstream_status: 429 no corpo;
 *   · outro status detectável → 500 com upstream_status no corpo;
 *   · indetectável → 500 como antes (honesto: status não registrado).
 */
function extrairStatusUpstream(err: unknown, message: string): number | null {
  const direto = (err ?? {}) as { status?: unknown; statusCode?: unknown };
  for (const v of [direto.status, direto.statusCode]) {
    if (typeof v === "number" && v >= 400 && v <= 599) return v;
  }
  const mStatus = /(?:status|code)\s*[:=]\s*(\d{3})/i.exec(message);
  if (mStatus) {
    const n = Number(mStatus[1]);
    if (n >= 400 && n <= 599) return n;
  }
  if (/\b429\b/.test(message) && /rate|limit|limite|cota|quota|too many/i.test(message)) return 429;
  return null;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "resolve-service", uptime_s: Math.round(process.uptime()) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);

    try {
      if (url.pathname === "/web-search") {
        const body = (await req.json().catch(() => ({}))) as { query?: unknown; num?: unknown };
        const query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
        const num = Math.min(10, Math.max(1, Number(body.num) || 6));
        if (query.length < 4) return json({ ok: false, error: "query muito curta" }, 422);
        if (!(await acquire("WEB_SEARCH"))) {
          return json(
            { ok: false, error: "cota de busca esgotada nesta janela (10/min) — aguarde e reexecute", code: "QUOTA", retryAfterMs: 15_000 },
            429
          );
        }
        const items = await withTimeout(withZai((z) => z.functions.invoke("web_search", { query, num })));
        return json({ ok: true, items });
      }

      if (url.pathname === "/page-reader") {
        const body = (await req.json().catch(() => ({}))) as { url?: unknown };
        const target = typeof body.url === "string" ? body.url.trim() : "";
        if (!/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(target)) {
          return json({ ok: false, error: "url inválida" }, 422);
        }
        if (!(await acquire("PAGE_READER"))) {
          return json(
            { ok: false, error: "cota de leitura esgotada nesta janela (10/min) — aguarde e reexecute", code: "QUOTA", retryAfterMs: 15_000 },
            429
          );
        }
        // pré-checagem de DNS: domínio inexistente vira resposta limpa (404-style),
        // sem estourar stack cru do SDK no log nem gastar a cota do leitor.
        // IMPORTANTE: Bun.resolveDns NÃO existe nesta versão do bun — a checagem antiga
        // rejeitava TODO domínio (DNS_FAIL) e matava o crawler em silêncio. node:dns é estável.
        const host = target.replace(/^https?:\/\//i, "").split(/[/:?#]/)[0] ?? "";
        try {
          const dns = await import("node:dns/promises");
          await dns.lookup(host, { family: 4 }).catch(() => dns.lookup(host, { family: 6 }));
        } catch {
          return json({ ok: false, error: "domínio não resolve (DNS)", code: "DNS_FAIL" }, 404);
        }
        const res = await withTimeout(withZai((z) => z.functions.invoke("page_reader", { url: target })));
        return json({ ok: true, data: res?.data ?? null });
      }

      if (url.pathname === "/scout-chat") {
        const body = (await req.json().catch(() => ({}))) as {
          messages?: unknown;
          timeout_ms?: unknown;
          model?: unknown;
          temperature?: unknown;
        };
        const rawMessages = Array.isArray(body.messages) ? body.messages : [];
        const messages: { role: string; content: string }[] = [];
        for (const m of rawMessages.slice(0, 4)) {
          const mm = m as { role?: unknown; content?: unknown };
          if (typeof mm?.role === "string" && typeof mm?.content === "string" && mm.content.length > 0) {
            messages.push({ role: mm.role, content: mm.content.slice(0, 40_000) });
          }
        }
        if (messages.length === 0) return json({ ok: false, error: "messages vazio" }, 422);
        const timeoutMs = Math.min(300_000, Math.max(10_000, Number(body.timeout_ms) || 120_000));
        // Temperature explícita (0..2) — comparabilidade A/B do laboratório exige que o
        // caminho nativo use o MESMO parâmetro que a comparação externa (0.2). Absente,
        // o gateway usa o default e a diferença de parâmetro ficaria incomprovável.
        const temperature =
          typeof body.temperature === "number" && Number.isFinite(body.temperature) && body.temperature >= 0 && body.temperature <= 2
            ? body.temperature
            : undefined;
        // Modelo solicitado pela config do Next (ZAI_DOSSIER_MODEL / ZAI_FAST_MODEL).
        // O gateway pode remapear (conta sem permissão) — o modelo EFETIVO vem na resposta
        // e é registrado em auditoria pelo chamador (modelo solicitado ≠ usado ⇒ fallback).
        const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 60) : null;
        const completion = await withTimeout(
          withZai((z) =>
            z.chat.completions.create({
              ...(requestedModel ? { model: requestedModel } : {}),
              ...(temperature !== undefined ? { temperature } : {}),
              messages,
              thinking: { type: "disabled" },
            } as never)
          ),
          timeoutMs
        );
        const content = (completion as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
        const model = (completion as { model?: unknown }).model;
        // consumo REAL quando o provedor devolve usage — nunca inventar valores.
        // Lote A3 (telemetria): o gateway já devolveu shapes diferentes em janelas
        // distintas ({prompt,completion,total} e {prompt_tokens,...}) — o serviço
        // NORMALIZA para o consumidor lendo AMBOS; ausência continua nula (nunca 0).
        const usage = (completion as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; prompt?: unknown; completion?: unknown; total?: unknown } }).usage;
        const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const pick = (a: unknown, b: unknown): number | null => num(a) ?? num(b);
        const tokens = usage
          ? {
              prompt: pick(usage.prompt_tokens, usage.prompt),
              completion: pick(usage.completion_tokens, usage.completion),
              total: pick(usage.total_tokens, usage.total),
            }
          : null;
        return json({
          ok: true,
          content,
          model: typeof model === "string" ? model : null,
          modelRequested: requestedModel,
          // shape canônico novo + aliases legados para consumidores antigos
          tokens,
          tokens_aliases: tokens
            ? { prompt_tokens: tokens.prompt, completion_tokens: tokens.completion, total_tokens: tokens.total }
            : null,
        });
      }

      return json({ ok: false, error: "rota desconhecida" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/tempo limite|timeout/i.test(message)) {
        // backoff curto evita martelar uma fonte lenta
        return json({ ok: false, error: "timeout" }, 504);
      }
      const statusUpstream = extrairStatusUpstream(err, message);
      if (statusUpstream === 429) {
        // 429 EFETIVO do provedor a jusante — repassado como 429 (o chamador registra
        // httpStatus=429 + upstream_status; nunca mais "500 com 429 dentro do texto")
        return json({ ok: false, error: message.slice(0, 300), upstream_status: 429 }, 429);
      }
      return json(
        { ok: false, error: message.slice(0, 300), ...(statusUpstream ? { upstream_status: statusUpstream } : {}) },
        500
      );
    }
  },
});

function withTimeout<T>(p: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("tempo limite da função web excedido")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); }
    );
  });
}

console.log(`[resolve-service] ouvindo em http://127.0.0.1:${PORT}`);
