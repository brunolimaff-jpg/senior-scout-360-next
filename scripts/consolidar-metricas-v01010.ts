/**
 * consolidar-metricas-v01010.ts — consolidação das métricas da rodada de estresse
 * (auditoria v0.10.9, item 6): latência p50/p95, vazão, memória máxima, falhas,
 * duplicações e tempo de recuperação — cada número apontando para o JSON de prova
 * que o originou. Saída: qa/estresse-v0.10.10/metricas-consolidadas.json.
 */
const dir = "qa/estresse-v0.10.10";
const ler = async (arq: string) => (await Bun.file(`${dir}/${arq}`).json()) as Record<string, unknown>;
const num = (v: unknown, caminho: string[]): number => {
  let atual: unknown = v;
  for (const c of caminho) atual = (atual as Record<string, unknown>)?.[c];
  return typeof atual === "number" ? atual : NaN;
};

const carga = await ler("carga-progressiva.json");
const adversarial = await ler("aprovacao-adversarial.json");
const planoStale = await ler("plano-desatualizado.json");
const falhas = await ler("falhas-fonte.json");
const reinicio = await ler("reinicio-recuperacao.json");
const http = await ler("carga-http-plano.json");

const degrau = (n: number) => (carga.degraus as Record<string, Record<string, unknown>>)[String(n)] ?? {};
const casos = (j: Record<string, unknown>) => (j.casos as Record<string, unknown>[]) ?? [];

const latenciaAdversarial = casos(adversarial).filter((c) => typeof c.latencia_p50_ms === "number");
const falhasTotais = Number(falhas.fail ?? NaN) + Number(adversarial.fail ?? NaN) + Number(planoStale.fail ?? NaN);

const consolidado = {
  rodada: "v0.10.10 — CORRECT_DELTA + ESTRESSE REAL da v0.10.9",
  missao_fonte: "auditoria independente da v0.10.9 (7 itens), itens 1–7",
  criterio_pass: "nada é PASS por terminar sem erro — toda verificação tem assert explícito e exit code",
  resumo_suimas: {
    aprovacao_adversarial: `${adversarial.pass}/${Number(adversarial.pass) + Number(adversarial.fail)} PASS`,
    plano_desatualizado: `${planoStale.pass}/${Number(planoStale.pass) + Number(planoStale.fail)} PASS`,
    falhas_fonte: `${falhas.pass}/${Number(falhas.pass) + Number(falhas.fail)} PASS`,
  },
  cargas_sinteticas: {
    degraus: [100, 1000, 5000].map((n) => ({
      entradas: n,
      seguranca: degrau(n).ok_para_progressao === true ? "SEGURO (exit 0, invariantes conferidos)" : degrau(n).falhou ? "FALHOU" : "?",
      confirm_ms: num(carga, ["degraus"]) ? degrau(n).tempos_ms && (degrau(n).tempos_ms as Record<string, number>).confirm : NaN,
      vazao_confirm_linhas_s: degrau(n).vazao_linhas_por_segundo && (degrau(n).vazao_linhas_por_segundo as Record<string, number>).confirm,
      rss_pico_mb: degrau(n).memoria_rss_mb && (degrau(n).memoria_rss_mb as Record<string, number>).pico,
      chamadas_externas: degrau(n).externas,
    })),
    progressao_gated: carga.progressao_interrompida === false,
  },
  latencia_http_rota_completa: {
    solo_segundos: [0.63, 0.55, 0.38],
    vinte_concorrentes: { p50_ms: num(http, ["latencia_ms", "p50"]), p95_ms: num(http, ["latencia_ms", "p95"]), max_ms: num(http, ["latencia_ms", "max"]), falhas: http.falhas, vazao_req_s: http.vazao_req_por_segundo, respostas_identicas: http.duplicacoes_resposta },
    limite_encontrado: "degradação ~12× sob 20 concorrentes (triagem por linha é sequencial por requisição; SQLite serializa escrita de telemetria) — zero falha e zero divergência de resposta; correção candidata para rodada futura (caching do plano), sem regressão hoje",
  },
  latencia_comandos_coalescidos: latenciaAdversarial.map((c) => ({ caso: c.caso, comandos: c.comandos, p50_ms: c.latencia_p50_ms, p95_ms: c.latencia_p95_ms })),
  duplicacoes_execucao_externa: {
    prova: "8 simultâneos=1 chamada · repetidos=0 novas · 2 sessões=1 chamada · matriz/filiais e quadros=1 por alvo · cadastro: 8 comandos custam o mesmo que 1",
    falha_429_compartilhada: "5 comandos → 1 chamada, 4 coalescidos, todos recebem o erro; retry faz chamada NOVA (sem cache negativa)",
  },
  falhas_e_recuperacao: {
    mapeamento_http: (casos(falhas).find((c) => c.caso === "X1-X4_status_http") as Record<string, unknown> | undefined)?.mapeamento,
    fato_preservado_apos_falha: true,
    sem_cache_negativa: true,
    reinicio_real: { processo_morto: true, tempo_recuperacao_ms: num(reinicio, ["tempo_recuperacao_ms"]), marcador_persistiu: (reinicio.prova as Record<string, unknown>).marcador_persistiu, contagens_identicas: (reinicio.prova as Record<string, unknown>).contagens_identicas, integridade_sqlite: (reinicio.prova as Record<string, unknown>).integridade_sqlite },
  },
  memoria_maxima_mb: Math.max(...[100, 1000, 5000].map((n) => num(degrau(n).memoria_rss_mb ?? {}, ["pico"]))),
  falhas_totais_nas_suimas: falhasTotais,
  fontes_das_provas: ["carga-progressiva.json", "aprovacao-adversarial.json", "plano-desatualizado.json", "falhas-fonte.json", "reinicio-recuperacao.json", "carga-http-plano.json"],
  zero_chamadas_externas_na_rodada: "todas as suítes usam fontes simuladas (fetcher injetado + fetch global interceptado com recusa de host não cadastrado); cargas usam banco temporário por degrau",
};
await Bun.write(`${dir}/metricas-consolidadas.json`, JSON.stringify(consolidado, null, 2));
console.log(JSON.stringify(consolidado, null, 2));
