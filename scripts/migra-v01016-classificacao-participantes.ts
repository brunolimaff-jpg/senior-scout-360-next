/**
 * migra-v01016-classificacao-participantes.ts — MIGRAÇÃO ONE-OFF (v0.10.16).
 *
 * Caches de relações gravados antes da regra honesta de classificação rotularam
 * como PF todo participante sem CNPJ reconhecível — inclusive pessoas JURÍDICAS
 * com identificador inválido (caso real: "BRD DIGITAL PARTICIPACOES LTDA", id
 * "35444812"). Esta migração:
 *  - reclassifica cada participante pela semântica da fonte (hash = PF; CNPJ com
 *    DV = PJ; qualquer outra coisa = INDETERMINADO);
 *  - preserva o vínculo, a fonte, coletadoEm e atualizadoEm (NADA é reconsultado);
 *  - ajusta razaoSocialPj (nome público da PJ) só quando o tipo vira PJ;
 *  - registra o antes/depois de cada linha alterada.
 *
 * Rodar: bun scripts/migra-v01016-classificacao-participantes.ts
 */
import { db } from "../src/lib/db";
import { validateCnpj } from "../src/lib/cnpj";
import { classificarParticipantePorId } from "../src/lib/relations/grafo";

let verificadas = 0;
let corrigidas = 0;

const caches = await db.relacaoSocietariaCache.findMany();
for (const c of caches) {
  verificadas++;
  let rels: { participanteId: string; tipo: string; nomePublico: string; cnpjParticipante: string | null; razaoSocialPj: string | null }[] = [];
  try {
    rels = JSON.parse(c.relacoesJson);
  } catch {
    console.log(`SKIP (ilegível) ${c.cnpj}`);
    continue;
  }
  let mudou = false;
  const corrigidasJson = rels.map((p) => {
    const tipoNovo = classificarParticipantePorId(String(p.participanteId ?? ""), validateCnpj);
    if (tipoNovo !== p.tipo) {
      mudou = true;
      console.log(`  ${c.cnpj}: "${p.nomePublico}" (id ${p.participanteId}) ${p.tipo} → ${tipoNovo}`);
    }
    return { ...p, tipo: tipoNovo, razaoSocialPj: tipoNovo === "PJ" ? p.razaoSocialPj ?? p.nomePublico : null };
  });
  if (mudou) {
    await db.relacaoSocietariaCache.update({ where: { cnpj: c.cnpj }, data: { relacoesJson: JSON.stringify(corrigidasJson) } });
    corrigidas++;
  }
}

console.log(`\nMigração concluída: ${verificadas} cache(s) verificado(s), ${corrigidas} corrigido(s). Nenhuma consulta externa feita.`);
