/**
 * Encontra linhas Petrobras existentes no banco (para reaproveitar ou criar lote novo).
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const rows = await db.importRow.findMany({
    where: {
      OR: [
        { normalizedCnpj: { contains: "33000167" } },
        { referenceValue: { contains: "petrobras" } },
        { legalName: { contains: "PETROBRAS" } },
      ],
    },
    select: {
      batchId: true,
      rowNumber: true,
      normalizedCnpj: true,
      legalName: true,
      lookupStatus: true,
      aiStatus: true,
      researchStatus: true,
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  console.log(JSON.stringify(rows, null, 2));
  const batches = await db.importBatch.findMany({ select: { id: true, fileName: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 });
  console.log("--- últimos lotes:");
  console.log(JSON.stringify(batches, null, 2));
}
main().finally(() => db.$disconnect());
