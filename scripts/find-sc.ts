import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const rows = await db.importRow.findMany({
    where: { referenceValue: { contains: "sementes" } },
    select: { batchId: true, rowNumber: true, referenceValue: true, resolutionState: true, lookupStatus: true },
    orderBy: { createdAt: "desc" }, take: 5,
  });
  console.log(JSON.stringify(rows));
}
main().finally(() => db.$disconnect());
