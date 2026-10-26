/** Últimos eventos de auditoria de um lote (para diagnosticar retry-ai/deep-research). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const batchId = process.argv[2] ?? "imp_mvgt60cs_uymob4";
  const events = await db.auditEvent.findMany({
    where: { batchId },
    orderBy: { createdAt: "desc" },
    take: 18,
    select: { createdAt: true, event: true, detail: true, rowNumber: true },
  });
  for (const e of events.reverse()) {
    const d = (e.detail ?? "").toString().slice(0, 260);
    console.log(`${e.createdAt.toISOString()} [linha ${e.rowNumber ?? "-"}] ${e.event}: ${d}`);
  }
}
main().finally(() => db.$disconnect());
