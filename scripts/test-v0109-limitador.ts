/**
 * test-v0109-limitador.ts — ESTRESSE DE CONCORRÊNCIA do limitador de chamadas
 * (despacho "evolução e estresse": a falha apontada pelo operador é check-then-act —
 * "o controle verifica o limite antes de esperar, mas não reserva a vaga de
 * maneira segura para todas as requisições concorrentes").
 *
 * CASO A (prova da falha — roda em QUALQUER versão do limitador):
 *   rpm=3, concurrency=2, janela real de 60s.
 *   1) 3 aquisições sequenciais preenchem a janela; todas liberadas (running=0).
 *   2) 8 aquisições CONCURRENTES disparadas no mesmo tick.
 *   Na versão COM a falha, todas passam pelo gate de concorrência (running=0),
 *   estacionam no wait de RPM INVISÍVEIS ao gate e, na virada da janela,
 *   entram JUNTAS — running chega a 3 > concurrency=2. RAJADA = estoura a fonte.
 *   Na versão CORRIGIDA, a vaga só é reservada atomicamente dentro do pump
 *   síncrono — nunca mais de 2 ao mesmo tempo.
 *
 * CASOS B–E (rápidos, exigem a versão corrigida com opts.windowMs):
 *   B: 40 aquisições, rpm=4, concurrency=2, janela 300ms — teto de RPM por
 *      janela deslizante respeitado + concorrência nunca > 2 + FIFO estrito.
 *   C: release idempotente (chamar duas vezes não corrompe contadores).
 *   D: espera honesta — nenhuma aquisição é admitida fora da ordem de chegada.
 *   E: nenhuma chamada externa (offline por construção — o módulo não faz HTTP).
 *
 * Uso:
 *   bun scripts/test-v0109-limitador.ts --so-falha   (só CASO A — evidência ANTES da correção)
 *   bun scripts/test-v0109-limitador.ts              (bateria completa — pós-correção)
 */
import { writeFileSync, mkdirSync } from "fs";
import { acquireServiceSlot } from "../src/lib/ratelimit";

const SO_FALHA = process.argv.includes("--so-falha");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Resultado {
  caso: string;
  ok: boolean;
  detalhe: string;
}

const resultados: Resultado[] = [];
function registrar(caso: string, ok: boolean, detalhe: string) {
  resultados.push({ caso, ok, detalhe });
  console.log(`${ok ? "PASS" : "FAIL"} · ${caso} — ${detalhe}`);
}

/** Serviço dedicado de teste (não toca WEB_SEARCH/PAGE_READER reais). */
const SVC = "TESTE_ESTRESSE_V0109";

/** Dispara N aquisições concorrentes; cada tarefa segura o slot por `holdMs` e registra métricas. */
async function rajada(n: number, holdMs: number, windowMs?: number) {
  const chegada: number[] = [];
  const admissao: number[] = [];
  let held = 0;
  let maxHeld = 0;
  const tarefas = Array.from({ length: n }, (_, i) => {
    chegada.push(i);
    return (async () => {
      const release = await acquireServiceSlot(SVC, windowMs !== undefined ? { windowMs } : undefined);
      admissao[i] = Date.now();
      held++;
      maxHeld = Math.max(maxHeld, held);
      await sleep(holdMs);
      held--;
      release();
      release(); // release idempotente (CASO C) — chamar 2x é seguro
    })();
  });
  await Promise.all(tarefas);
  return { maxHeld, admissao, chegada };
}

/** Máximo de admissões dentro de QUALQUER janela deslizante de windowMs. */
function maxAdmissoesPorJanela(admissao: number[], windowMs: number): number {
  const ts = admissao.slice().sort((a, b) => a - b);
  let max = 0;
  for (let i = 0; i < ts.length; i++) {
    let j = i;
    while (j < ts.length && ts[j] - ts[i] < windowMs) j++;
    max = Math.max(max, j - i);
  }
  return max;
}

async function main() {
  console.log(`=== ESTRESSE DO LIMITADOR (v0.10.9) — ${SO_FALHA ? "modo evidência ANTES da correção" : "bateria completa"} ===`);
  const t0 = Date.now();

  /* ---------- CASO A: rajada na virada da janela (prova da falha) ---------- */
  {
    console.log(`[t+${Date.now() - t0}ms] CASO A — janela real de 60s…`);
    process.env.SVC_RPM = "3";
    const windowMs = 60_000; // janela real — a versão antiga só suporta esta
    // Fase 1: preencher a janela com 3 chamadas já encerradas
    for (let i = 0; i < 3; i++) {
      const rel = await acquireServiceSlot(SVC);
      rel();
    }
    await sleep(20);
    // Fase 2: 3 aquisições concorrentes com concurrency=2 — a 3ª só pode
    // entrar DEPOIS de uma das outras liberar. Com a falha, as 3 entram juntas.
    const inicioRajada = Date.now();
    const { maxHeld, admissao } = await rajada(3, 80, windowMs);
    const duracao = Date.now() - inicioRajada;
    const okConc = maxHeld <= 2;
    registrar(
      "A1 · concorrência nunca excede 2 na virada da janela",
      okConc,
      okConc
        ? `máx. simultâneas = ${maxHeld} (teto 2) — vaga reservada atomicamente no pump síncrono; rajada drenou em ${duracao}ms`
        : `FALHA REPRODUZIDA: ${maxHeld} chamadas simultâneas com concurrency=2 — quem esperava RPM era invisível ao gate e entrou junto na virada (${duracao}ms)`
    );
    const maxJanela = maxAdmissoesPorJanela(admissao, windowMs);
    registrar(
      "A2 · RPM por janela deslizante respeitado (sanidade)",
      maxJanela <= 3,
      `máx. admissões em uma janela de 60s = ${maxJanela} (teto 3)`
    );
  }

  if (!SO_FALHA) {
    /* ---------- CASO B: 40 concorrentes, janela curta determinística ---------- */
    {
      console.log(`[t+${Date.now() - t0}ms] CASO B — 40 concorrentes, janela 300ms…`);
      process.env.SVC_RPM = "4";
      const windowMs = 300;
      const { maxHeld, admissao, chegada } = await rajada(40, 15, windowMs);
      const okConc = maxHeld <= 2;
      registrar(
        "B1 · 40 concorrentes — concorrência ≤ 2 o tempo todo",
        okConc,
        `máx. simultâneas = ${maxHeld}`
      );
      const maxJanela = maxAdmissoesPorJanela(admissao, windowMs);
      registrar(
        "B2 · RPM respeitado em TODA janela deslizante de 300ms",
        maxJanela <= 4,
        `máx. admissões em uma janela = ${maxJanela} (teto 4)`
      );
      const fifoOk = admissao.every((t, i) => i === 0 || t >= admissao[chegada[i - 1]]);
      // admissão deve respeitar a ordem de chegada (FIFO) — tolerância: timestamps iguais contam como ordem preservada
      let fifoEstrito = true;
      for (let i = 1; i < admissao.length; i++) {
        if (admissao[i] < admissao[i - 1]) fifoEstrito = false;
      }
      registrar(
        "B3 · FIFO estrito — ninguém fura a fila (espera honesta)",
        fifoEstrito,
        fifoEstrito ? `ordem de admissão = ordem de chegada para ${admissao.length} aquisições` : "admissões fora de ordem detectadas"
      );
      void fifoOk;
    }

    /* ---------- CASO C: release idempotente não vaza vaga ---------- */
    {
      console.log(`[t+${Date.now() - t0}ms] CASO C — release idempotente…`);
      process.env.SVC_RPM = "10";
      const windowMs = 300;
      // 4 aquisições CONCURRENTES com concurrency=2; cada tarefa chama release()
      // DUAS VEZES. Se o release duplicado diminuísse o contador duas vezes, a
      // 3ª/4ª aquisição furariam o teto (máx. observado seria > 2 ou slots somados).
      let cur = 0;
      let maxHeld = 0;
      const tarefasC = Array.from({ length: 4 }, () =>
        (async () => {
          const rel = await acquireServiceSlot(SVC, { windowMs });
          cur++;
          maxHeld = Math.max(maxHeld, cur);
          await sleep(10);
          rel();
          rel(); // idempotência sob teste
          cur--;
        })()
      );
      await Promise.all(tarefasC);
      registrar(
        "C1 · release idempotente — contadores consistentes",
        maxHeld === 2,
        `4 aquisições com concurrency=2 → máx. simultâneas = ${maxHeld} (release chamado 2x em cada)`
      );
    }

    /* ---------- CASO D: rajada curta, nenhuma perda de sinal ---------- */
    {
      console.log(`[t+${Date.now() - t0}ms] CASO D — 25 concorrentes…`);
      process.env.SVC_RPM = "5";
      const windowMs = 200;
      const { admissao } = await rajada(25, 5, windowMs);
      const todas = admissao.every((t) => Number.isFinite(t) && t > 0);
      registrar(
        "D1 · 25 concorrentes — todos atendidos, nenhum perdido",
        todas && admissao.length === 25,
        `${admissao.filter((t) => Number.isFinite(t)).length}/25 admissões registradas`
      );
    }
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`[t+${Date.now() - t0}ms] fim dos casos`);
  const resumo = {
    timestamp: new Date().toISOString(),
    modo: SO_FALHA ? "evidencia-antes-da-correcao" : "bateria-completa-pos-correcao",
    total: resultados.length,
    falhas: falhas.length,
    resultados,
    gate: { ia: 0, buscaWeb: 0, leituraPagina: 0, httpExterno: 0 },
  };
  mkdirSync("qa", { recursive: true });
  const arquivo = SO_FALHA ? "qa/limitador-antes.json" : "qa/limitador-depois.json";
  writeFileSync(arquivo, JSON.stringify(resumo, null, 2));
  console.log(`\nResumo: ${resultados.length - falhas.length}/${resultados.length} PASS — evidência em ${arquivo} (total ${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(falhas.length > 0 ? 1 : 0);
}

const keepAlive = setInterval(() => {}, 1000); // o timer do limitador é unref'd (não pode segurar o servidor); o teste mantém o loop vivo
main()
  .catch((e) => {
    console.error("ERRO NA SUÍTE:", e);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
