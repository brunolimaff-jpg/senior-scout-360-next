/** Avalia o dossiê Petrobras contra os critérios obrigatórios da auditoria adversarial. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

interface Ev { claim?: string; afirmacao?: string; entidade?: string; source?: string; fonte?: string; url?: string; periodo?: string; status?: string }

async function main() {
  const row = await db.importRow.findFirst({
    where: { batchId: "imp_mvgt60cs_uymob4", rowNumber: 1 },
    select: { aiDossierJson: true, researchJson: true, aiModel: true, aiModelRequested: true, aiProcessedAt: true, researchAt: true, legalName: true, openingDate: true },
  });
  if (!row) return console.log("linha não encontrada");
  const d = JSON.parse(row.aiDossierJson ?? "{}");
  const r = JSON.parse(row.researchJson ?? "{}");
  const texto = JSON.stringify(d).toLowerCase();

  const chk = (nome: string, ...termos: string[]) => {
    const hit = termos.some((t) => texto.includes(t.toLowerCase()));
    console.log(`${hit ? "✅" : "❌"} ${nome}${hit ? "" : ` — termos: ${termos.join(" / ")}`}`);
  };

  console.log("== CRITÉRIOS OBRIGATÓRIOS (Petrobras) ==");
  chk("1. Fundação 1953 (≠ abertura cadastral)", "1953");
  chk("2. Receita R$ 497,5 bilhões (2025)", "497.5", "497,5", "497549", "497.549");
  chk("3. 50.687 empregados próprios", "50.687", "50687", "50 687");
  chk("4. 129.961 terceiros", "129.961", "129961", "129 961");
  chk("5. US$ 109 bi plano 2026–2030", "109", "us$ 109", "109 bilhões");
  chk("6. Produção 2,7M bbl/d (2T26)", "2,7", "2.7", "barris");
  chk("7. SAP S/4HANA desde 2022", "s/4hana", "s4hana");
  chk("8. SAP Ariba documentada", "ariba");
  chk("9. Petrobras vs Vibra (postos)", "vibra", "br distribuidora", "postos");
  console.log("");
  console.log("== CRITÉRIOS DE REPROVAÇÃO ==");
  const descoCount = (texto.match(/desconhecid/g) ?? []).length;
  console.log(`${descoCount <= 2 ? "✅" : "❌"} 'desconhecido' aparece ${descoCount}× (ok se baixo)`);
  chk("sem atribuição de terceiros à Petrobras (procurar 'vibra' com escopo)", "vibra");
  const trunc = (s: unknown) => typeof s === "string" && /\b[a-zà-ú]{1,3}$/i.test(s.trim()) && s.trim().length > 40;
  const frases = [d.sintese_executiva ?? d.sintese, ...(d.como_opera ?? []), ...(d.tecnologia_observada ?? [])].filter(Boolean) as string[];
  const truncados = frases.filter(trunc).length;
  console.log(`${truncados === 0 ? "✅" : "❌"} frases truncadas: ${truncados}/${frases.length}`);

  console.log("");
  console.log("== ESTRUTURA ==");
  console.log("entidadeEscopo:", JSON.stringify(d.entidadeEscopo ?? d.profunda?.entidadeEscopo ?? null)?.slice(0, 200));
  console.log("quemE:", String(d.quemE ?? "").slice(0, 300));
  console.log("naoSabemos:", JSON.stringify(d.naoSabemos ?? null)?.slice(0, 300));
  const evid: Ev[] = d.evidencias ?? d.profunda?.evidencias ?? [];
  console.log("evidências:", evid.length, "| com status:", evid.filter((e) => e.status).length, "| com fonte:", evid.filter((e) => e.source || e.fonte || e.url).length);
  for (const e of evid.slice(0, 12)) {
    console.log(`  [${e.status ?? "?"}] ${((e as Ev).claim ?? e.afirmacao ?? "").slice(0, 110)} — ${e.source ?? e.fonte ?? e.url ?? "?"} ${e.periodo ? `(${e.periodo})` : ""}`);
  }
  console.log("");
  console.log("== INSTRUMENTAÇÃO (real) ==");
  console.log("modelo solicitado:", row.aiModelRequested, "| efetivo:", row.aiModel);
  console.log("tokens:", JSON.stringify(d.tokens ?? null));
  console.log("etapasMs:", JSON.stringify(r.instrumentacao?.etapasMs ?? r.etapasMs ?? null));
  console.log("buscas:", (r.buscas ?? []).length, "| páginas lidas:", (r.paginas ?? []).length, "| notícias:", (r.noticias ?? []).length, "| sinais porte:", (r.sinaisPorte ?? []).length);
  console.log("estratégia:", r.estrategia, "| domínio:", r.siteOficial?.dominio ?? null, "| usouCache:", r.usouCache ?? false);
  for (const b of (r.buscas ?? []).slice(0, 10)) console.log(`  busca: ${b.query} — ${b.resultados?.length ?? 0} resultados`);
  for (const p of (r.paginas ?? []).slice(0, 6)) console.log(`  página: ${p.url} (${p.tipo})`);
}
main().finally(() => db.$disconnect());
