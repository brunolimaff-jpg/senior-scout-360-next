import { buildResearchPacket } from "../src/lib/enrich/research";
// sondagem: como as queries saem? interceptamos via webSearch indireto — em vez disso,
// testamos a lógica de nome replicando usableFantasia/searchNameFor
function cleanName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/\s+(ltda|limitada|s\/a|sociedade an[oô]nima|eireli|me|mei|epp|\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}).*$/i, "")
    .replace(/[^\p{L}\p{N}\s&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
const tn = "PETROBRAS - EDISE", ln = "PETROLEO BRASILEIRO S A PETROBRAS";
const t = cleanName(tn);
console.log("cleanName(fantasia):", JSON.stringify(t));
console.log("tem '-'?", /[-–—]/.test(t));
