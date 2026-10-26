/**
 * diagnostico-429.ts — DIAGNÓSTICO CONTROLADO de limite de requisições (v0.10.4).
 *
 * Contrato do operador: NÃO declarar problema resolvido/reproduzido sem evidência;
 * NÃO criar loops agressivos de retry; NÃO fazer sondagens agressivas nem testes pagos.
 *
 * Mudanças v0.10.3 (auditoria do operador):
 *   · HTTP 200 com `ok:false` NO CORPO agora é classificado como
 *     "resposta_200_corpo_nao_ok" — NÃO é sucesso (a v0.10.2 olhava só o status);
 *   · FASE 1 separa TRÊS métricas distintas para não inflar conclusões:
 *       (a) eventos de TELEMETRIA registrados (linhas que mencionam 429/cota),
 *       (b) TENTATIVAS HTTP registradas (soma do campo `tentativas`),
 *       (c) OCORRÊNCIAS EFETIVAS de HTTP 429 (linhas com httpStatus=429) —
 *     um evento de telemetria pode conter várias tentativas; tentativa ≠ ocorrência;
 *   · FASE 2 (sondas de rede) agora é OPT-IN (--sonda);
 *   · --banco <arquivo> permite reler o backup pre-limpeza SOMENTE-LEITURA.
 *
 * Mudanças v0.10.4 (auditoria v0.10.3):
 *   · classificarEvento429(): SEIS categorias distintas — (1) limite local;
 *     (2) HTTP 429 efetivo do provedor; (3) erro que apenas MENCIONA 429 (status
 *     não preservado — eventos legados); (4) timeout; (5) backoff aplicado;
 *     (6) operação não executada por cota. Eventos de telemetria NUNCA são
 *     apresentados como número de requisições;
 *   · o resolve-service agora PRESERVA o status upstream (upstream_status no corpo,
 *     429 a jusante repassado como 429) — eventos novos nascem classificáveis;
 *   · eventos legados sem status preservado são contados como "menção" — o total
 *     comprovado de recusas do gateway NÃO é inventado.
 *
 * Uso:
 *   bun scripts/diagnostico-429.ts                        # Fase 1 no banco de dev (leitura)
 *   bun scripts/diagnostico-429.ts --banco db/backup-pre-limpeza-*.db   # Fase 1 no backup (leitura)
 *   bun scripts/diagnostico-429.ts --sonda                # + UMA sonda por canal (sem retry)
 * Saída: qa/diagnostico-429-v0.10.4.json + .md
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT_JSON = "qa/diagnostico-429-v0.10.4.json";
const OUT_MD = "qa/diagnostico-429-v0.10.4.md";

const BANCO_ARG = (() => {
  const i = process.argv.indexOf("--banco");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const COM_SONDA = process.argv.includes("--sonda");

/** Classificação PURA (exportada para teste offline determinístico).
 *  corpoOk: true/false quando o corpo JSON tem campo booleano `ok`; null quando
 *  não há corpo parseável (ex.: HTML) — nesse caso decide o status HTTP. */
export type ClassificacaoSonda =
  | "ok"
  | "resposta_200_corpo_nao_ok" // v0.10.3: HTTP 200 com ok:false NÃO é sucesso
  | "cota_429"
  | "sem_registro_404"
  | "rede_ou_timeout"
  | "erro";

export function classificarSonda(
  status: number | null,
  corpoOk: boolean | null,
  detalhe: string
): ClassificacaoSonda {
  if (status === 200 && corpoOk === false) return "resposta_200_corpo_nao_ok";
  if (status === 200) return "ok";
  if (status === 429) return "cota_429";
  if (status === 404) return "sem_registro_404";
  if (status === null) return detalhe.includes("timeout") ? "rede_ou_timeout" : "erro";
  return "erro";
}

/* ------------------- v0.10.4: SEIS categorias de evento 429/cota ------------------- */

/** Categoria de um evento de telemetria associado a 429/cota (auditoria v0.10.3):
 *  eventos de telemetria NÃO são números de requisições — cada um é classificado. */
export type Categoria429 =
  | "limite_local"          // 1. janela LOCAL do resolve-service recusou (nunca chegou ao provedor)
  | "http_429_provedor"     // 2. HTTP 429 EFETIVO do provedor (status preservado)
  | "erro_mencao_429"       // 3. erro que apenas MENCIONA 429 — status upstream não preservado (legado)
  | "timeout"               // 4. timeout
  | "backoff_aplicado"      // 5. backoff aplicado (fonte pulada/espera pós-429)
  | "nao_executada_cota"    // 6. operação NÃO executada por cota (fila pausada etc.)
  | "outros";               // resto (honesto — sem classificação forçada)

/** Classificador PURO (exportado p/ teste offline). Prioridade: evidência no payload
 *  (upstream_status/origem_recusa) → status HTTP preservado → texto do erro. */
export function classificarEvento429(evt: {
  httpStatus: number | null;
  erro: string | null;
  payloadJson?: string | null;
}): Categoria429 {
  const erro = evt.erro ?? "";
  const payload = evt.payloadJson ?? "";
  const texto = `${erro} ${payload}`;

  // payload v0.10.4: origem da recusa registrada SEM adivinhação
  const origem = /"origem_recusa"\s*:\s*"(limite_local|429_provedor|indeterminada)"/.exec(payload)?.[1];
  const upstream429 = /"upstream_status"\s*:\s*429/.test(payload);
  if (upstream429 || origem === "429_provedor") return "http_429_provedor";
  if (origem === "limite_local") return "limite_local";

  if (evt.httpStatus === 429) {
    // 429 preservado: LOCAL quando o texto é a janela própria do resolve-service
    // (código QUOTA / "esgotada nesta janela" / resumo "recusa por cota (429/QUOTA)"
    // com status 429 — histórico que só o limite local produzia);
    // caso contrário é o 429 EFETIVO do provedor (ex.: ReceitaWS direto)
    if (/esgotada nesta janela|code["':= ]+QUOTA|recusa por cota \(429\/QUOTA\)/i.test(texto)) return "limite_local";
    return "http_429_provedor";
  }

  if (evt.httpStatus === 504 || /timeout|tempo limite/i.test(erro)) return "timeout";
  if (/pulada|backoff|fonte em pausa|cooling/i.test(texto)) return "backoff_aplicado";
  if (/pausad|suspens|n(ã|a)o executad|cota_parcial|fila.*cota|cota.*fila/i.test(texto)) return "nao_executada_cota";
  if (/\b429\b/.test(texto)) return "erro_mencao_429";
  if (/cota|quota|rate.?limit|too many requests|limite/i.test(texto)) return "erro_mencao_429";
  return "outros";
}

/** Extrai o campo booleano `ok` de um corpo JSON (sem lançar). */
function corpoOkDe(body: unknown): boolean | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const ok = (body as Record<string, unknown>)["ok"];
    if (typeof ok === "boolean") return ok;
  }
  return null;
}

interface SondaResultado {
  canal: string;
  alvo: string;
  httpStatus: number | null;
  corpoOk: boolean | null;
  classificacao: ClassificacaoSonda;
  latenciaMs: number;
  detalhe: string;
}

async function sondaHttp(nome: string, alvo: string, url: string, timeoutMs = 10_000): Promise<SondaResultado> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "scout360-diagnostico" } });
    const body: unknown = await res.json().catch(() => null);
    const corpoOk = corpoOkDe(body);
    return {
      canal: nome,
      alvo,
      httpStatus: res.status,
      corpoOk,
      classificacao: classificarSonda(res.status, corpoOk, ""),
      latenciaMs: Date.now() - t0,
      detalhe: corpoOk === false ? `HTTP ${res.status} com ok:false no corpo (NÃO é sucesso)` : `resposta HTTP ${res.status}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      canal: nome,
      alvo,
      httpStatus: null,
      corpoOk: null,
      classificacao: classificarSonda(null, null, msg),
      latenciaMs: Date.now() - t0,
      detalhe: msg.slice(0, 200),
    };
  }
}

async function sondaResolveService(): Promise<SondaResultado> {
  // web_search via resolve-service (o Next chama exatamente este endpoint)
  const t0 = Date.now();
  const alvo = "POST :3030/web-search {num:1}";
  const canal = "web_search (gateway IA via resolve-service)";
  try {
    const res = await fetch("http://127.0.0.1:3030/web-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "diagnóstico controlado scout 360", num: 1 }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; items?: unknown[] };
    const corpoOk = corpoOkDe(j);
    const classificacao = classificarSonda(res.status, corpoOk, j.error ?? "");
    return {
      canal,
      alvo,
      httpStatus: res.status,
      corpoOk,
      classificacao,
      latenciaMs: Date.now() - t0,
      detalhe:
        classificacao === "ok"
          ? `${Array.isArray(j.items) ? j.items.length : 0} resultado(s)`
          : (j.error ?? `HTTP ${res.status}${corpoOk === false ? " com ok:false no corpo" : ""}`).slice(0, 200),
    };
  } catch (e) {
    return {
      canal,
      alvo,
      httpStatus: null,
      corpoOk: null,
      classificacao: "rede_ou_timeout",
      latenciaMs: Date.now() - t0,
      detalhe: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

async function sondaModeloIA(): Promise<SondaResultado> {
  const t0 = Date.now();
  const alvo = "POST :3030/scout-chat (1 prompt mínimo)";
  const canal = "modelo de IA (gateway via resolve-service)";
  try {
    const res = await fetch("http://127.0.0.1:3030/scout-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Responda somente com a palavra OK." }], timeout_ms: 25_000 }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; content?: string; model?: string | null; error?: string };
    const corpoOk = corpoOkDe(j);
    const classificacao = classificarSonda(res.status, corpoOk, j.error ?? "");
    return {
      canal,
      alvo,
      httpStatus: res.status,
      corpoOk,
      classificacao,
      latenciaMs: Date.now() - t0,
      detalhe:
        classificacao === "ok"
          ? `modelo efetivo: ${j.model ?? "?"}`
          : (j.error ?? `HTTP ${res.status}${corpoOk === false ? " com ok:false no corpo" : ""}`).slice(0, 200),
    };
  } catch (e) {
    return {
      canal,
      alvo,
      httpStatus: null,
      corpoOk: null,
      classificacao: "rede_ou_timeout",
      latenciaMs: Date.now() - t0,
      detalhe: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

async function main() {
  const db = new PrismaClient(
    BANCO_ARG
      ? { datasources: { db: { url: `file:${resolve(ROOT, BANCO_ARG)}` } } }
      : undefined
  );

  console.log(`FASE 1 — telemetria e auditoria (fonte: ${BANCO_ARG ?? "banco de dev"}, somente leitura)…`);

  const eventos429 = await db.telemetryEvent.findMany({
    where: { OR: [{ httpStatus: 429 }, { erro: { contains: "429" } }, { erro: { contains: "cota" } }] },
    orderBy: { startedAt: "asc" },
    select: {
      tipo: true, fonte: true, operacao: true, httpStatus: true, erro: true,
      tentativas: true, estadoFinal: true, startedAt: true, duracaoMs: true, batchId: true, rowNumber: true, payloadJson: true,
    },
  });

  // ---- v0.10.3: TRÊS métricas distintas (evento ≠ tentativa ≠ ocorrência efetiva) ----
  const eventosTelemetria = eventos429.length;
  const tentativasHttpRegistradas = eventos429.reduce((s, e) => s + (typeof e.tentativas === "number" ? e.tentativas : 0), 0);
  const ocorrenciasHttp429Efetivas = eventos429.filter((e) => e.httpStatus === 429).length;
  const eventosSemHttpStatus429 = eventos429.filter((e) => e.httpStatus !== 429 && /429/.test(e.erro ?? "")).length;
  const eventosPorCotaTexto = eventos429.filter((e) => e.httpStatus !== 429 && !/429/.test(e.erro ?? "")).length;

  // ---- v0.10.4: SEIS categorias (evento classificado, não somado como requisição) ----
  const categorias: Record<Categoria429, number> = {
    limite_local: 0,
    http_429_provedor: 0,
    erro_mencao_429: 0,
    timeout: 0,
    backoff_aplicado: 0,
    nao_executada_cota: 0,
    outros: 0,
  };
  const classificados = eventos429.map((e) => ({ e, categoria: classificarEvento429(e) }));
  for (const { categoria } of classificados) categorias[categoria]++;

  const porFonte = new Map<string, { fonte: string; tipo: string; eventosTelemetria: number; ocorrencias429: number; tentativasMax: number | null; primeira: Date | null; ultima: Date | null; operacoes: Set<string> }>();
  for (const e of eventos429) {
    const chave = `${e.tipo} · ${e.fonte ?? "?"}`;
    const atual = porFonte.get(chave) ?? { fonte: chave, tipo: e.tipo, eventosTelemetria: 0, ocorrencias429: 0, tentativasMax: null, primeira: null, ultima: null, operacoes: new Set<string>() };
    atual.eventosTelemetria++;
    if (e.httpStatus === 429) atual.ocorrencias429++;
    if (!atual.primeira || e.startedAt < atual.primeira) atual.primeira = e.startedAt;
    if (!atual.ultima || e.startedAt > atual.ultima) atual.ultima = e.startedAt;
    if (typeof e.tentativas === "number") atual.tentativasMax = Math.max(atual.tentativasMax ?? 0, e.tentativas);
    if (e.operacao) atual.operacoes.add(e.operacao);
    porFonte.set(chave, atual);
  }
  const historico = [...porFonte.values()].map((h) => ({
    fonte: h.fonte,
    tipo: h.tipo,
    eventosTelemetria: h.eventosTelemetria,
    ocorrenciasHttp429: h.ocorrencias429,
    tentativasMaxPorEvento: h.tentativasMax,
    primeira: h.primeira?.toISOString() ?? null,
    ultima: h.ultima?.toISOString() ?? null,
    operacoes: [...h.operacoes],
  }));

  const puladasBackoff = await db.auditEvent.findMany({
    where: { OR: [{ event: "LOOKUP_FAIL", detail: { contains: "fontes_puladas_backoff" } }, { event: "RESEARCH_QUEUE_PAUSED" }] },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { event: true, detail: true, createdAt: true },
  });

  const rateLimitedLinhas = await db.importRow.count({ where: { lookupStatus: "RATE_LIMITED" } });
  const fichasPreservadas = await db.auditEvent.count({ where: { event: { contains: "REVALIDACAO" } } });

  console.log(`  eventos de telemetria 429/cota : ${eventosTelemetria}`);
  console.log(`  tentativas HTTP registradas    : ${tentativasHttpRegistradas} (soma do campo tentativas — UMA linha pode cobrir N tentativas)`);
  console.log(`  ocorrências HTTP 429 efetivas  : ${ocorrenciasHttp429Efetivas} (linhas com httpStatus=429)`);
  console.log(`  · por erro-texto 429           : ${eventosSemHttpStatus429} · por regra de cota: ${eventosPorCotaTexto}`);
  console.log(`  fontes afetadas: ${historico.length} · auditorias de backoff/fila: ${puladasBackoff.length}`);

  let sondas: SondaResultado[] = [];
  if (COM_SONDA) {
    console.log("FASE 2 — sonda ÚNICA por canal (sem retry, sem loop; opt-in --sonda)…");
    const CNPJ_CONTROLE = "33000167000101"; // Petrobras HQ — registro público conhecido
    sondas.push(await sondaHttp("ReceitaWS (API cadastral)", `GET receitaws ${CNPJ_CONTROLE}`, `https://receitaws.com.br/v1/cnpj/${CNPJ_CONTROLE}`));
    sondas.push(await sondaHttp("BrasilAPI (API cadastral — controle)", `GET brasilapi ${CNPJ_CONTROLE}`, `https://brasilapi.com.br/api/cnpj/v1/${CNPJ_CONTROLE}`));
    sondas.push(await sondaResolveService());
    sondas.push(await sondaModeloIA());
    for (const s of sondas) console.log(`  [${s.classificacao}] ${s.canal} → ${s.httpStatus ?? "—"} corpo.ok=${s.corpoOk ?? "—"} (${s.latenciaMs}ms) ${s.detalhe.slice(0, 90)}`);
  } else {
    console.log("FASE 2 — NÃO executada nesta rodada (opt-in --sonda; sem sondagem agressiva nem chamada paga).");
    console.log("  Evidência de disponibilidade pontual vigente: sondas do v0.10.2 (21/10/2026 17:11 UTC — 4/4 canais HTTP 200).");
  }

  const relatorio = {
    geradoEm: new Date().toISOString(),
    aviso:
      "Diagnóstico controlado: Fase 1 lê evidência histórica; Fase 2 (sonda de rede) é OPT-IN. Nenhum problema é declarado resolvido sem evidência. Eventos de telemetria, tentativas HTTP e ocorrências efetivas de 429 são MÉTRICAS DISTINTAS — eventos de telemetria NUNCA são números de requisições.",
    fonte_dados: BANCO_ARG ?? "db/custom.db (banco de dev)",
    metricas_separadas: {
      definicoes: {
        eventos_telemetria: "linhas de telemetria associadas a 429/cota (uma linha pode agregar N tentativas) — NÃO são números de requisições",
        tentativas_http: "soma do campo tentativas registrado pela cadeia (backoff)",
        ocorrencias_http_429: "linhas com httpStatus=429 — ocorrência EFETIVA do status",
      },
      eventos_telemetria: eventosTelemetria,
      tentativas_http_registradas: tentativasHttpRegistradas,
      ocorrencias_http_429_efetivas: ocorrenciasHttp429Efetivas,
      eventos_429_por_texto_sem_status: eventosSemHttpStatus429,
      eventos_por_regra_de_cota_sem_429: eventosPorCotaTexto,
      nota: "NÃO somar as três métricas: um evento de telemetria não é uma tentativa, e uma tentativa não é uma ocorrência efetiva de 429.",
    },
    classificacao_por_evento_v0104: {
      definicoes: {
        limite_local: "janela LOCAL do resolve-service recusou (code QUOTA / 'esgotada nesta janela') — a chamada NÃO chegou ao provedor",
        http_429_provedor: "HTTP 429 EFETIVO do provedor (status preservado — ReceitaWS direto ou upstream_status v0.10.4)",
        erro_mencao_429: "erro que apenas MENCIONA 429/cota — status upstream NÃO preservado (eventos legados); o total real de recusas do gateway NÃO é inventado",
        timeout: "timeout (status 504 ou texto de tempo limite)",
        backoff_aplicado: "backoff aplicado (fonte pulada / espera pós-429) — a operação ficou em espera honesta",
        nao_executada_cota: "operação NÃO executada por cota (fila de pesquisa pausada etc.)",
        outros: "sem classificação forçada",
      },
      eventos_por_categoria: categorias,
      nota: "Contagens de EVENTOS de telemetria por categoria — não são requisições nem tentativas.",
    },
    historico429: historico,
    auditoria_backoff_fila: puladasBackoff.map((a) => ({ event: a.event, detail: a.detail.slice(0, 300), createdAt: a.createdAt })),
    linhas_RATE_LIMITED_atuais: rateLimitedLinhas,
    auditorias_revalidacao_preservacao: fichasPreservadas,
    sondas_atuais: sondas,
    sondas_executadas_nesta_rodada: COM_SONDA,
  };
  writeFileSync(resolve(ROOT, OUT_JSON), JSON.stringify(relatorio, null, 2) + "\n");

  const md: string[] = [
    "# Diagnóstico controlado 429 — v0.10.4",
    "",
    `Gerado em: ${relatorio.geradoEm} · Fonte: ${relatorio.fonte_dados} · Método: Fase 1 = telemetria/auditoria (leitura); Fase 2 = sonda OPT-IN.`,
    "",
    "## Métricas separadas (não somar; eventos de telemetria NÃO são requisições)",
    "",
    `- **Eventos de telemetria** (linhas que mencionam 429/cota): **${eventosTelemetria}**`,
    `- **Tentativas HTTP registradas** (soma do campo \`tentativas\`): **${tentativasHttpRegistradas}**`,
    `- **Ocorrências HTTP 429 efetivas** (httpStatus=429): **${ocorrenciasHttp429Efetivas}**`,
    `- Por erro-texto 429 (sem status): ${eventosSemHttpStatus429} · por regra de cota (sem 429): ${eventosPorCotaTexto}`,
    "",
    "> Um evento de telemetria não é uma tentativa; uma tentativa não é uma ocorrência efetiva de 429. As contagens do v0.10.2 (124 IA / 128 busca / 7 ReceitaWS) eram de TELEMETRIA — acima elas aparecem decompostas.",
    "",
    "## Classificação por evento (v0.10.4 — seis categorias, não são requisições)",
    "",
    `| Categoria | Eventos |`,
    `|---|---|`,
    `| Limite local (janela do resolve-service; não chegou ao provedor) | **${categorias.limite_local}** |`,
    `| HTTP 429 efetivo do provedor (status preservado) | **${categorias.http_429_provedor}** |`,
    `| Erro que apenas MENCIONA 429 (status upstream não preservado — legado) | **${categorias.erro_mencao_429}** |`,
    `| Timeout | **${categorias.timeout}** |`,
    `| Backoff aplicado (fonte pulada / espera pós-429) | **${categorias.backoff_aplicado}** |`,
    `| Operação não executada por cota (fila pausada etc.) | **${categorias.nao_executada_cota}** |`,
    `| Outros (sem classificação forçada) | **${categorias.outros}** |`,
    "",
    "> Eventos legados sem status preservado são contados como MENÇÃO — o total comprovado de recusas do gateway NÃO é inventado. A partir da v0.10.4 o resolve-service preserva o status upstream (429 a jusante repassado como 429 + upstream_status no corpo), então eventos novos nascem classificáveis sem adivinhação.",
    "",
  ];
  if (COM_SONDA && sondas.length) {
    md.push("## Sondas desta rodada");
    for (const s of sondas) md.push(`- **${s.canal}** — ${s.alvo}: HTTP ${s.httpStatus ?? "—"} (corpo.ok=${s.corpoOk ?? "—"}) → ${s.classificacao} (${s.latenciaMs}ms) · ${s.detalhe}`);
    md.push("");
  } else {
    md.push("## Sondas de rede");
    md.push("- NÃO executadas nesta rodada (contrato: sem sondagem agressiva; frugalidade de cota).");
    md.push("- Evidência de disponibilidade pontual vigente: **v0.10.2 (21/10/2026 17:11 UTC)** — ReceitaWS 200/447ms · BrasilAPI 200/71ms · Busca web Z.ai 200/2.368ms · Modelo Z.ai 200/360ms (4/4 canais).");
    md.push("- Regra de classificação endurecida (v0.10.3): HTTP 200 com `ok:false` no corpo → `resposta_200_corpo_nao_ok` (NÃO-sucesso); provado offline em qa/guarda-temporalidade-v0.10.3.json (seção classificacao_sonda).");
    md.push("");
  }
  md.push("## Checklist do operador", "");
  md.push(`1. **Qual fonte/serviço responde 429?** Histórico: ${historico.length ? historico.map((h) => `${h.fonte} (${h.ocorrenciasHttp429}× HTTP429 / ${h.eventosTelemetria} eventos)`).join("; ") : "nenhum evento 429/cota registrado"}.`);
  md.push(`2. **Estado AGORA:** ver sondas de rede acima (não executadas nesta rodada — última evidência: v0.10.2, 21/10/2026 17:11 UTC, 4/4 canais 200). A estabilidade da cota NÃO está comprovada.`);
  md.push(`3. **Qual operação e horário?** Ver historico429 (primeira/última por fonte) em ${OUT_JSON}.`);
  md.push(`4. **Quantas tentativas?** Métrica separada: ${tentativasHttpRegistradas} tentativas registradas em ${eventosTelemetria} eventos de telemetria. Backoff de IA: 20s → 45s (máx. 2); busca web: 15s + 1 repetição; cadastro: fonte pulada sem requisição.`);
  md.push(`5. **Qual backoff foi aplicado?** isSourceCoolingDown pausa a fonte pós-429 (sem HTTP); auditorias registradas: ${puladasBackoff.length} (LOOKUP_FAIL.fontes_puladas_backoff / RESEARCH_QUEUE_PAUSED).`);
  md.push(`6. **A fonte foi corretamente ignorada durante a espera?** Evidência: eventos "pulada: fonte em backoff por 429 recente" — consulta continua SEM martelada.`);
  md.push(`7. **Outra API válida permitiu concluir?** Complementação seletiva (v0.10.0): a cadeia segue para a próxima fonte enquanto houver lacuna — linhas RATE_LIMITED atuais: ${rateLimitedLinhas}.`);
  md.push(`8. **A ficha preservou os dados já coletados?** Contrato v0.10.1: falha NUNCA destrói a ficha anterior (auditorias REVALIDACAO: ${fichasPreservadas}).`);
  md.push(`9. **O problema é API cadastral, busca web ou modelo de IA?** Classificar pela sonda quando executada: cadastral → ReceitaWS/BrasilAPI; busca web → gateway web_search; IA → gateway scout-chat. Bloqueio por cota (429) ≠ ausência de registro (404) ≠ erro de rede (timeout/DNS) ≠ HTTP 200 com ok:false (resposta_200_corpo_nao_ok, v0.10.3).`);
  md.push("");
  md.push("## Histórico por fonte (métricas separadas)");
  for (const h of historico) {
    md.push(`- ${h.fonte}: ${h.ocorrenciasHttp429} HTTP429 efetiva(s) em ${h.eventosTelemetria} evento(s) de telemetria, tentativas máx./evento: ${h.tentativasMaxPorEvento ?? "—"}, ${h.primeira ?? "—"} → ${h.ultima ?? "—"}`);
  }
  md.push("");
  md.push("> Nenhum problema é declarado resolvido ou reproduzido sem evidência (contrato).");
  writeFileSync(resolve(ROOT, OUT_MD), md.join("\n") + "\n");
  console.log(`\n✔ Relatórios: ${OUT_JSON} e ${OUT_MD}`);
  await db.$disconnect();
}

if (import.meta.main) {
  if (BANCO_ARG && !existsSync(resolve(ROOT, BANCO_ARG))) {
    console.error(`--banco: arquivo não encontrado: ${BANCO_ARG}`);
    process.exit(1);
  }
  main()
    .catch((e) => { console.error("erro:", e); process.exit(1); });
}
