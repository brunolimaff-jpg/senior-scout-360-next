/**
 * Teste do golden case "sementes carolina" — executa o resolver REAL de ponta a ponta.
 * Critérios do delta ENTITY_BINDING:
 *   - MERCADO LIVRE BRASIL, CÂMARA DOS DEPUTADOS, M.F. RURAL não podem virar candidatos
 *     se a única relação for serem donos/publicadores da página onde os termos aparecem.
 *   - Melhor UNRESOLVED do que candidatos contaminados.
 */
import { resolveIdentity } from "../src/lib/resolve";

async function main() {
  const clues = {
    cnpj: null,
    emails: [],
    domains: [],
    disposableEmail: false,
    phones: [],
    names: ["sementes carolina"],
    uf: null,
    rawLine: "sementes carolina",
  };
  const t0 = Date.now();
  const res = await resolveIdentity({ clues, label: "sementes carolina" });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("=== RESULTADO ===");
  console.log("estado:", res.estado, "| confiança:", res.confianca, "| transitorio:", res.transitorio, `(${dt}s)`);
  console.log("\n--- candidatos:", res.candidatos.length);
  for (const c of res.candidatos) {
    console.log(`  ${c.cnpj} [${c.strength}] bindings=${c.bindings.map((b) => `${b.bindingType}/${b.strength}`).join(",") || "nenhum"}`);
    console.log(`    confirmado: ${c.confirmado?.razaoSocial ?? "—"}`);
    console.log(`    sinais: ${c.sinais.slice(0, 3).join(" | ") || "—"}`);
  }
  console.log("\n--- descartados:", res.descartados.length);
  for (const d of res.descartados) {
    console.log(`  [${d.bindingType}] ${d.cnpj ?? "(sem cnpj)"} via ${d.host ?? "?"} — ${d.motivo.slice(0, 130)}`);
  }
  console.log("\n--- notas:");
  for (const n of res.notas) console.log("  •", n);
  console.log("\n--- método (últimos 10):");
  for (const m of res.metodo.slice(-10)) console.log("  →", m);

  // Critérios de reprovação
  const proibidos = ["MERCADO LIVRE", "CAMARA DOS DEPUTADOS", "CÂMARA DOS DEPUTADOS", "M.F. RURAL", "MF RURAL"];
  const contaminados = res.candidatos.filter((c) => {
    const nome = (c.confirmado?.razaoSocial ?? "").toUpperCase();
    return proibidos.some((p) => nome.includes(p));
  });
  console.log("\n=== VEREDITO ===");
  if (contaminados.length === 0) {
    console.log("PASS: nenhum publisher contaminou a lista de candidatos.");
    if (res.estado === "UNRESOLVED" || res.estado === "REVIEW") console.log(`Estado honesto: ${res.estado} — melhor não resolver do que resolver errado.`);
  } else {
    console.log("FAIL: candidatos contaminados:", contaminados.map((c) => c.confirmado?.razaoSocial).join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
