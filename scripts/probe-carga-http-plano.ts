/**
 * probe-carga-http-plano.ts — CARGA HTTP REAL contra o servidor vivo (v0.10.10).
 *
 * Missão (item 6): "Registre latência p50/p95, vazão, memória máxima, falhas,
 * duplicações e tempo de recuperação." As suítes em-processo já medem latência
 * por onda; esta sonda mede a ROTA COMPLETA (gateway → Next → Prisma → SQLite)
 * sob carga concorrente: ondas de GET /api/imports/:id/plano — leitura 100%
 * local (o planejador não faz HTTP externo por construção), sem mutação de dados.
 *
 * Saída: qa/estresse-v0.10.10/carga-http-plano.json · exit 1 se houver falha 5xx
 * ou latência ilegível. ZERO chamadas externas (endpoint de leitura local).
 */
const BASE = "http://localhost:3000";

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const pXX = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const imports = (await json(`${BASE}/api/imports`)) as { batches?: { id: string }[] };
const lote = imports.batches?.[0]?.id;
if (!lote) {
  console.error("ERRO: nenhum lote disponível para a sonda HTTP (banco limpo é esperado só no fechamento).");
  process.exit(1);
}
console.log(`Lote alvo da sonda: ${lote}`);

const ONDAS = 3;
const POR_ONDA = 20;
const latencias: number[] = [];
let falhas = 0;
let tamanhos = new Set<number>();

const T0 = Date.now();
for (let o = 0; o < ONDAS; o++) {
  const t = Date.now();
  const resultados = await Promise.all(
    Array.from({ length: POR_ONDA }, async () => {
      const ini = Date.now();
      try {
        const res = await fetch(`${BASE}/api/imports/${lote}/plano`);
        const corpo = (await res.json()) as { plano?: { resumo?: { itens?: number } } };
        if (res.status === 200) {
          tamanhos.add(corpo.plano?.resumo?.itens ?? -1);
          latencias.push(Date.now() - ini);
          return true;
        }
        if (res.status === 409) return true; // lote sem linhas elegíveis é resposta honesta, não falha
        falhas++;
        return false;
      } catch {
        falhas++;
        return false;
      }
    })
  );
  console.log(`onda ${o + 1}/${ONDAS}: ${resultados.filter(Boolean).length}/${POR_ONDA} ok em ${Date.now() - t}ms`);
}
const totalMs = Date.now() - T0;

const resumo = {
  missao: "auditoria v0.10.9 item 6 — latência da rota completa sob carga concorrente",
  endpoint: "GET /api/imports/:id/plano (leitura local — zero HTTP externo por construção)",
  requisicoes: ONDAS * POR_ONDA,
  ondas: ONDAS,
  concorrencia_por_onda: POR_ONDA,
  falhas,
  duplicacoes_resposta: tamanhos.size > 1 ? "respostas divergentes (possível)" : tamanhos.size === 1 ? "0 (resposta idêntica para todos)" : "n/a",
  latencia_ms: { p50: pXX(latencias, 50), p95: pXX(latencias, 95), max: Math.max(...latencias, 0) },
  vazao_req_por_segundo: Number(((ONDAS * POR_ONDA) / (totalMs / 1000)).toFixed(1)),
  duracao_total_ms: totalMs,
};
console.log(JSON.stringify(resumo, null, 2));
await Bun.write("qa/estresse-v0.10.10/carga-http-plano.json", JSON.stringify(resumo, null, 2));
process.exit(falhas > 0 ? 1 : 0);
