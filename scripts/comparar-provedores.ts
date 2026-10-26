/**
 * Comparativo de provedores de cadastro CNPJ (v0.10.0 P2) — rede REAL, sem IA, sem custo.
 *
 * Mede por CNPJ × provedor: HTTP/estado, latência, campos obtidos (cobertura) e lacunas.
 * Inclui OpenCaramelo (kitana.opencnpj.com — INTEGRAÇÃO DISTINTA do OpenCNPJ .org usado
 * na cadeia) SEM alterar a cadeia padrão: é experimento de cobertura, não adoção.
 *
 * Amostra pública diversificada: matriz de companhia aberta, matriz de banco público,
 * filial de banco (ordem 0002) e o exemplo ALFANUMÉRICO oficial da RFB
 * (00.000.000/E08G-12 — as fontes ainda NÃO servem alfanuméricos; o teste documenta isso).
 *
 * Uso: bun scripts/comparar-provedores.ts
 * Saída: qa/comparativo-provedores-v0.10.0.json + .md
 */
import { mkdirSync, writeFileSync } from "fs";
import {
  lookupBrasilApi,
  lookupOpenCnpj,
  lookupReceitaWs,
  lookupMinhaReceita,
  lookupOpenCaramelo,
  gapsOf,
  isSourceCoolingDown,
  type CnpjLookupResult,
} from "../src/lib/enrich/sources";
import { cnpjFromRoot } from "../src/lib/cnpj";

interface Linha {
  rotulo: string;
  cnpj: string;
  expectativa: string;
}

const filialCaixa = cnpjFromRoot("00360305", "0002") ?? "";

const ALVOS: Linha[] = [
  { rotulo: "Companhia aberta (matriz)", cnpj: "33000167000101", expectativa: "Petrobras — QSA extenso, capital alto" },
  { rotulo: "Banco público (matriz)", cnpj: "00000000000191", expectativa: "Banco do Brasil S.A. — raiz com zeros" },
  { rotulo: "Filial de banco (ordem 0002)", cnpj: filialCaixa, expectativa: filialCaixa ? "agência da CAIXA (filial real)" : "(falha ao construir CNPJ)" },
  { rotulo: "CNPJ alfanumérico (exemplo RFB)", cnpj: "00000000E08G12", expectativa: "00.000.000/E08G-12 — 1º alfanumérico emitido (filial BB, 31/07/2026); fontes públicas JÁ respondem" },
];

const PROVEDORES: { fonte: string; fonteInterna: string; fn: (c: string) => Promise<CnpjLookupResult> }[] = [
  { fonte: "BrasilAPI", fonteInterna: "BrasilAPI", fn: lookupBrasilApi },
  { fonte: "OpenCNPJ(.org)", fonteInterna: "OpenCNPJ", fn: lookupOpenCnpj },
  { fonte: "ReceitaWS", fonteInterna: "ReceitaWS", fn: lookupReceitaWs },
  { fonte: "MinhaReceita", fonteInterna: "MinhaReceita", fn: lookupMinhaReceita },
  { fonte: "OpenCaramelo(.com)", fonteInterna: "OpenCaramelo", fn: lookupOpenCaramelo },
];

const CAMPOS: { campo: string; pega: (r: Extract<CnpjLookupResult, { ok: true }>) => string }[] = [
  { campo: "razão social", pega: (r) => r.data.legalName },
  { campo: "nome fantasia", pega: (r) => r.data.tradeName },
  { campo: "situação", pega: (r) => r.data.registrationStatus },
  { campo: "data situação", pega: (r) => r.data.statusDate },
  { campo: "matriz/filial", pega: (r) => r.data.branchType || (r.data.branchIdentifier === 1 ? "MATRIZ" : r.data.branchIdentifier === 2 ? "FILIAL" : "") },
  { campo: "abertura", pega: (r) => r.data.openingDate },
  { campo: "CNAE principal", pega: (r) => r.data.cnaeDescription || r.data.cnaeCode },
  { campo: "município/UF", pega: (r) => [r.data.municipality, r.data.uf].filter(Boolean).join("/") },
  { campo: "QSA (nº)", pega: (r) => (r.data.socios.length > 0 ? String(r.data.socios.length) : "") },
  { campo: "capital social", pega: (r) => r.data.extra.capitalSocial },
  { campo: "natureza jurídica", pega: (r) => r.data.extra.naturezaJuridica },
  { campo: "porte", pega: (r) => r.data.extra.porte },
  { campo: "simples/mei", pega: (r) => [r.data.extra.simples && `S:${r.data.extra.simples}`, r.data.extra.mei && `MEI:${r.data.extra.mei}`].filter(Boolean).join(" ") },
  { campo: "e-mail", pega: (r) => r.data.extra.email },
  { campo: "telefone", pega: (r) => r.data.extra.telefone || r.data.extra.telefone2 },
  { campo: "endereço", pega: (r) => r.data.extra.endereco },
  { campo: "CNAEs secundários (nº)", pega: (r) => (r.data.extra.cnaesSecundarios.length > 0 ? String(r.data.extra.cnaesSecundarios.length) : "") },
  { campo: "regime tributário", pega: (r) => r.data.extra.regimeTributario },
  { campo: "código IBGE município", pega: (r) => r.data.extra.codigoMunicipioIbge },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const inicio = new Date().toISOString();
  console.log(`== Comparativo de provedores — início ${inicio} ==`);
  const resultados: {
    alvo: string; cnpj: string; expectativa: string; fonte: string;
    ok: boolean; errorType: string | null; pulada: boolean; latenciaMs: number;
    camposObtidos: number; camposTotal: number; detalhes: Record<string, string>; lacunas: string[];
  }[] = [];

  for (const alvo of ALVOS) {
    console.log(`\n-- ${alvo.rotulo} (${alvo.cnpj}) — expectativa: ${alvo.expectativa}`);
    for (const prov of PROVEDORES) {
      // cortesia + honestidade: fonte em backoff (429 recente) é PULADA, não martelada
      if (isSourceCoolingDown(prov.fonteInterna)) {
        console.log(`   ${prov.fonte}: PULADA — fonte em backoff por 429 recente`);
        resultados.push({ alvo: alvo.rotulo, cnpj: alvo.cnpj, expectativa: alvo.expectativa, fonte: prov.fonte, ok: false, errorType: "RATE_LIMITED", pulada: true, latenciaMs: 0, camposObtidos: 0, camposTotal: CAMPOS.length, detalhes: {}, lacunas: [] });
        continue;
      }
      const t0 = Date.now();
      let r: CnpjLookupResult;
      try {
        r = await prov.fn(alvo.cnpj);
      } catch (err) {
        r = { ok: false, source: prov.fonte, errorType: "NETWORK_ERROR", message: err instanceof Error ? err.message : String(err) };
      }
      const latenciaMs = Date.now() - t0;
      if (r.ok) {
        const detalhes: Record<string, string> = {};
        let obtidos = 0;
        for (const c of CAMPOS) {
          const v = c.pega(r).trim();
          if (v) { detalhes[c.campo] = v.slice(0, 90); obtidos++; }
        }
        const lacunas = gapsOf(r.data);
        console.log(`   ${prov.fonte}: OK ${latenciaMs}ms · ${obtidos}/${CAMPOS.length} campos · lacunas: ${lacunas.join(", ") || "nenhuma"}`);
        resultados.push({ alvo: alvo.rotulo, cnpj: alvo.cnpj, expectativa: alvo.expectativa, fonte: prov.fonte, ok: true, errorType: null, pulada: false, latenciaMs, camposObtidos: obtidos, camposTotal: CAMPOS.length, detalhes, lacunas });
      } else {
        console.log(`   ${prov.fonte}: ${r.errorType} ${latenciaMs}ms — ${r.message.slice(0, 100)}`);
        resultados.push({ alvo: alvo.rotulo, cnpj: alvo.cnpj, expectativa: alvo.expectativa, fonte: prov.fonte, ok: false, errorType: r.errorType, pulada: !!r.pulada, latenciaMs, camposObtidos: 0, camposTotal: CAMPOS.length, detalhes: {}, lacunas: [] });
      }
      await sleep(300); // cortesia entre consultas (todas as fontes são públicas)
    }
  }

  // resumo por provedor
  const resumo: Record<string, { ok: number; total: number; latMediaMs: number; camposMedio: number; bloqueios429: number }> = {};
  for (const prov of PROVEDORES) {
    const rs = resultados.filter((x) => x.fonte === prov.fonte);
    const oks = rs.filter((x) => x.ok);
    resumo[prov.fonte] = {
      ok: oks.length,
      total: rs.length,
      latMediaMs: rs.length ? Math.round(rs.reduce((a, b) => a + b.latenciaMs, 0) / rs.length) : 0,
      camposMedio: oks.length ? +(oks.reduce((a, b) => a + b.camposObtidos, 0) / oks.length).toFixed(1) : 0,
      bloqueios429: rs.filter((x) => x.errorType === "RATE_LIMITED").length,
    };
  }

  const saida = { geradoEm: inicio, nota: "Comparativo v0.10.0 (P2) — experimento de cobertura; OpenCaramelo NÃO está na cadeia padrão; sem IA; consultas públicas.", resumo, resultados };
  mkdirSync("qa", { recursive: true });
  writeFileSync("qa/comparativo-provedores-v0.10.0.json", JSON.stringify(saida, null, 2));

  // markdown
  const md: string[] = [
    `# Comparativo de provedores de cadastro — v0.10.0 (P2)`,
    ``,
    `Gerado em ${inicio}. Consultas REAIS às fontes públicas, sem IA. OpenCaramelo é experimento de cobertura — NÃO está na cadeia padrão.`,
    ``,
    `## Resumo por provedor`,
    ``,
    `| Provedor | OK | Latência média | Campos obtidos (média das respostas OK) | 429 |`,
    `| --- | --- | --- | --- | --- |`,
    ...Object.entries(resumo).map(([f, r]) => `| ${f} | ${r.ok}/${r.total} | ${r.latMediaMs} ms | ${r.camposMedio}/${CAMPOS.length} | ${r.bloqueios429} |`),
    ``,
    `## Detalhe por alvo × provedor`,
    ``,
  ];
  for (const alvo of ALVOS) {
    md.push(`### ${alvo.rotulo} — \`${alvo.cnpj}\``, ``, `Expectativa: ${alvo.expectativa}`, ``, `| Provedor | Resultado | Latência | Campos | Observação |`, `| --- | --- | --- | --- | --- |`);
    for (const x of resultados.filter((r) => r.alvo === alvo.rotulo)) {
      const obs = x.ok
        ? Object.entries(x.detalhes).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(" · ")
        : `${x.errorType}${x.pulada ? " (pulada por backoff)" : ""}`;
      md.push(`| ${x.fonte} | ${x.ok ? "OK" : "falha"} | ${x.latenciaMs} ms | ${x.ok ? `${x.camposObtidos}/${x.camposTotal}` : "—"} | ${obs.replace(/\|/g, "/")} |`);
    }
    md.push(``);
  }
  writeFileSync("qa/comparativo-provedores-v0.10.0.md", md.join("\n"));
  console.log(`\nSaída: qa/comparativo-provedores-v0.10.0.json + .md`);
}

void main();
