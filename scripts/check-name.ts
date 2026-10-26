import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const r = await db.importRow.findFirst({ where: { batchId: "imp_mvgt60cs_uymob4", rowNumber: 1 }, select: { legalName: true, tradeName: true, cnaeDescription: true, branchType: true } });
  console.log(JSON.stringify(r));
}
main().finally(() => db.$disconnect());
