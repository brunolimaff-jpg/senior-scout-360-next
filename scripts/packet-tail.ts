/** Último DEEP_RESEARCH_PACKET de um lote — ground truth da coleta. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const batchId = process.argv[2] ?? "imp_mvgt60cs_uymob4";
  const ev = await db.auditEvent.findFirst({
    where: { batchId, event: "DEEP_RESEARCH_PACKET" },
    orderBy: { createdAt: "desc" },
  });
  if (!ev) return console.log("nenhum packet");
  const d = JSON.parse(ev.detail ?? "{}");
  for (const k of ["estrategia", "dominio", "paginas_lidas", "paginas_tentadas", "buscas_com_resultado", "noticias", "sinais_porte", "sinais_identidade", "sinais_tecnologia", "sinais_comerciais", "fontes_rejeitadas"]) {
    console.log(`${k}: ${d[k]}`);
  }
  const notas: string[] = d.notas ?? [];
  for (const n of notas.slice(0, 16)) console.log(" ·", n);
}
main().finally(() => db.$disconnect());
