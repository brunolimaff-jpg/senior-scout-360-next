/**
 * Probe do experimento PESQUISA ADAPTATIVA (v0.9.0) — mesmo alvo nos dois modos.
 * Mede: buscas iniciadas, aproveitáveis, páginas lidas, dedupes, recusas de cota e tempo.
 * Sem IA (só coleta) — custo = buscas web + leituras do modo testado.
 *
 * Uso: bun scripts/probe-adaptativa.ts "NOME DA EMPRESA" [CNPJ] [cidade] [UF]
 */
import { buildResearchPacket } from "../src/lib/enrich/research";

function resumo(tag: string, p: Awaited<ReturnType<typeof buildResearchPacket>>) {
  console.log(`\n===== ${tag} — modo ${p.modoPesquisa} =====`);
  console.log(`domínio: ${p.siteOficial.dominio ?? "—"} | páginas OK: ${p.paginasOk}/${p.paginasTentadas} | estratégia: ${p.estrategia}`);
  console.log(`buscas: ${p.metricas.buscasIniciadas} iniciadas · ${p.metricas.buscasAproveitaveis} aproveitáveis · ${p.metricas.consultasDedup} deduplicadas · ${p.metricas.buscasRecusadasCota} recusadas por cota`);
  console.log(`páginas lidas: ${p.metricas.paginasLidas} · usadas no pacote: ${p.metricas.paginasUsadas} · tempo: ${(p.metricas.tempoMs / 1000).toFixed(1)}s`);
  console.log(`sinais — identidade: ${p.sinaisIdentidade.length} · tecnologia: ${p.sinaisTecnologia.length} · porte: ${p.sinaisPorte.length} · comercial: ${p.sinaisComerciais.length} · notícias: ${p.noticias.length}`);
  console.log("consultasLog:");
  for (const c of p.consultasLog) {
    console.log(`  [N${c.nivel}] ${c.descarte ? "(dedupe) " : ""}${c.query.slice(0, 90)} → ${c.resultados} resultado(s) · motivo: ${c.motivo.slice(0, 80)}`);
  }
}

async function main() {
  const name = process.argv[2] ?? "Lar Cooperativa Agroindustrial";
  const cnpj = process.argv[3] ?? "";
  const cidade = process.argv[4] ?? "Medianeira";
  const uf = process.argv[5] ?? "PR";
  const modo = process.argv[6] === "COMPLETO" ? "COMPLETO" : "ADAPTATIVO";
  console.log(`alvo: ${name} ${cnpj ? `(${cnpj})` : ""} — ${cidade}/${uf} · modo ${modo}`);

  const tA = Date.now();
  const p = await buildResearchPacket(
    {
      normalizedCnpj: cnpj,
      legalName: name,
      tradeName: null,
      municipality: cidade,
      uf,
      email: null,
      referenceValue: null,
      cnaeDescription: null,
      socios: [],
    },
    modo
  );
  resumo(modo, p);
  console.log(`tempo total: ${((Date.now() - tA) / 1000).toFixed(1)}s`);
  // guarda o pacote para a comparação controlada (evidências do experimento)
  const { mkdirSync, writeFileSync } = await import("fs");
  mkdirSync("evidencias/adaptativa", { recursive: true });
  const file = `evidencias/adaptativa/${modo.toLowerCase()}-${cnpj || name.replace(/\W+/g, "-").toLowerCase()}.json`;
  writeFileSync(file, JSON.stringify(p, null, 2));
  console.log(`pacote salvo: ${file}`);
  console.log("PROBE_ADAPTATIVA_OK");
}

main().catch((e) => {
  console.error("PROBE_FALHOU:", e);
  process.exit(1);
});
