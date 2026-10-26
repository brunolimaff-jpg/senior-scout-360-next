/** Invalida o cache do research packet de uma linha (força regeneração honesta com o código novo). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const [batchId, row] = [process.argv[2], Number(process.argv[3] ?? 1)];
  const r = await db.importRow.updateMany({
    where: { batchId, rowNumber: row },
    data: { researchJson: null, researchStatus: null, researchAt: null, researchError: null },
  });
  console.log("cache de pesquisa invalidado:", r.count, "linha(s)");
}
main().finally(() => db.$disconnect());
