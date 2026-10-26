import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const r = await db.importRow.findFirst({
    where: { batchId: "imp_mvfy4d1n_ntiznx" },
    select: { resolutionJson: true, resolutionState: true, resolutionConfidence: true, legalName: true, aiStatus: true, researchStatus: true },
  });
  const j = r?.resolutionJson ? JSON.parse(r.resolutionJson) : null;
  console.log("estado:", r?.resolutionState, "| confiança:", r?.resolutionConfidence, "| legal:", r?.legalName);
  console.log("candidatos:", (j?.candidatos ?? []).length, "| descartados:", (j?.descartados ?? []).length);
  for (const c of (j?.candidatos ?? []).slice(0, 3)) {
    console.log(" -", c.razaoSocial ?? c.nome, "| bindings:", JSON.stringify((c.bindings ?? []).map((b: { bindingType: string; strength: string }) => `${b.bindingType}:${b.strength}`)));
  }
  for (const d of (j?.descartados ?? []).slice(0, 6)) {
    console.log(" ✗", d.cnpj, d.motivo?.slice(0, 90));
  }
}
main().finally(() => db.$disconnect());
