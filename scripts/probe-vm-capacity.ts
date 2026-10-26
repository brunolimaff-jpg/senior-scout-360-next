/**
 * probe-vm-capacity.ts — Sonda de capacidade do z-ai-web-dev-sdk nesta VM.
 * Missão diagnóstico: chamadas MÍNIMAS com conteúdo público, medindo
 * latência, status, modelo efetivo e shape REAL de usage/tokens.
 * Não imprime credenciais (o SDK usa o gateway da plataforma).
 * Uso: bun scripts/probe-vm-capacity.ts
 */

interface StepResult {
  passo: string;
  ok: boolean;
  ms: number;
  status?: string | number;
  detalhe: Record<string, unknown>;
}

const results: StepResult[] = [];
const step = async (passo: string, fn: () => Promise<StepResult>) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    r.ms = Date.now() - t0;
    results.push(r);
    console.log(`[OK] ${passo} — ${r.ms}ms — ${JSON.stringify(r.detalhe)}`);
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ passo, ok: false, ms, detalhe: { erro: msg.slice(0, 300) } });
    console.log(`[ERRO] ${passo} — ${ms}ms — ${msg.slice(0, 300)}`);
  }
};

async function main() {
  const mod = await import("z-ai-web-dev-sdk");
  const zai = await mod.default.create();
  console.log(`SDK criado. Versão declarada no package do SDK: ${process.env.npm_package_dependencies_z_ai_web_dev_sdk ?? "n/a"}`);

  // 1) CHAT mínimo — modelo DEFAULT (sem pedir modelo) → qual o efetivo?
  await step("chat.default", async () => {
    const completion = await zai.chat.completions.create({
      messages: [{ role: "user", content: "Responda apenas com a palavra OK." }],
      thinking: { type: "disabled" },
    } as never);
    const c = completion as Record<string, unknown>;
    const choices = c.choices as { message?: { content?: string } }[] | undefined;
    const usage = c.usage as Record<string, unknown> | undefined;
    return {
      passo: "chat.default",
      ok: true,
      ms: 0,
      detalhe: {
        modelo_efetivo: c.model ?? null,
        conteudo_len: choices?.[0]?.message?.content?.length ?? 0,
        usage_keys: usage ? Object.keys(usage) : null,
        usage: usage ?? null,
        top_level_keys: Object.keys(c),
      },
    };
  });

  // 2) CHAT mínimo — modelo SOLICITADO glm-5.3-flash (config default do Scout) → remapeamento?
  await step("chat.glm-5.3-flash", async () => {
    const completion = await zai.chat.completions.create({
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: "Responda apenas com a palavra OK." }],
      thinking: { type: "disabled" },
    } as never);
    const c = completion as Record<string, unknown>;
    const usage = c.usage as Record<string, unknown> | undefined;
    return {
      passo: "chat.glm-5.3-flash",
      ok: true,
      ms: 0,
      detalhe: {
        modelo_efetivo: c.model ?? null,
        usage: usage ?? null,
      },
    };
  });

  // 3) WEB_SEARCH mínimo — consulta pública
  await step("web_search.minimo", async () => {
    const res = await zai.functions.invoke("web_search", {
      query: "BrasilAPI projeto open source consulta CNPJ",
      num: 3,
    });
    const items = Array.isArray(res) ? res : [];
    const first = items[0] as Record<string, unknown> | undefined;
    return {
      passo: "web_search.minimo",
      ok: true,
      ms: 0,
      detalhe: {
        itens: items.length,
        chaves_item: first ? Object.keys(first) : null,
        primeiro_host: first && typeof first.url === "string" ? new URL(first.url).host : null,
      },
    };
  });

  // 4) PAGE_READER mínimo — página pública estável
  await step("page_reader.minimo", async () => {
    const res = await zai.functions.invoke("page_reader", { url: "https://example.com" });
    const r = res as Record<string, unknown>;
    const data = r?.data as Record<string, unknown> | undefined;
    return {
      passo: "page_reader.minimo",
      ok: true,
      ms: 0,
      detalhe: {
        top_level_keys: r ? Object.keys(r) : null,
        data_keys: data ? Object.keys(data) : null,
        titulo: typeof data?.title === "string" ? data.title.slice(0, 60) : null,
        conteudo_len: typeof data?.content === "string" ? data.content.length : null,
      },
    };
  });

  console.log("\n=== RESUMO ===");
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  console.log(JSON.stringify({ passos: results.length, falhas: results.filter((r) => !r.ok).length, totalMs }, null, 0));
}

main().catch((e) => {
  console.error("FALHA GERAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
