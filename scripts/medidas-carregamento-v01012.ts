/**
 * MEDIDAS DE CARREGAMENTO — v0.10.12 (contrato "refinar a experiência de carregamento").
 *
 * Estrutural (antes × depois, via git): contagem de entradas animadas que ATRASAVAM a
 * leitura no primeiro paint — hero em cascata (Stagger com opacity 0 + blur), header
 * com entrada de cima (y:-26), títulos de seção com whileInView, timeline do dossiê
 * com BlurFade, CSS de animações mortas.
 *
 * Runtime (depois): abertura fria da home (TTFB/render p50 de N corridas), latência da
 * API da tabela (atualização da prévia) e latência de comandos (stats/telemetria).
 * Uso: bun scripts/medidas-carregamento-v01012.ts
 */
import { execSync } from "child_process";

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  PASS ${nome}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; falhas.push(nome); console.log(`  FAIL ${nome}${extra ? ` — ${extra}` : ""}`); }
}
const gitCount = (ref: string, file: string, re: string): number => {
  try {
    const content = ref === "WORKING"
      ? execSync(`cat ${file}`, { encoding: "utf8" })
      : execSync(`git show ${ref}:${file}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    return (content.match(new RegExp(re, "g")) ?? []).length;
  } catch { return -1; }
};
const p50 = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

console.log("[1] estrutural — entradas animadas ANTES (HEAD) × DEPOIS (árvore)");
const antesHero = gitCount("HEAD", "src/app/page.tsx", "<Stagger>|<StaggerItem>");
const depoisHero = gitCount("WORKING", "src/app/page.tsx", "<Stagger>|<StaggerItem>");
const antesHeader = gitCount("HEAD", "src/components/cnpj/app-header.tsx", "initial=\\{\\{ y: -26");
const depoisHeader = gitCount("WORKING", "src/components/cnpj/app-header.tsx", "initial=\\{\\{ y: -26");
const antesReveal = gitCount("HEAD", "src/components/motion/primitives.tsx", "whileInView");
const depoisReveal = gitCount("WORKING", "src/components/motion/primitives.tsx", "whileInView");
const antesBlur = gitCount("HEAD", "src/components/motion/sv-primitives.tsx", "whileInView");
const depoisBlur = gitCount("WORKING", "src/components/motion/sv-primitives.tsx", "whileInView");
let cssAntesBytes = 0;
try {
  cssAntesBytes = execSync("git show HEAD:src/app/globals.css", { encoding: "utf8" }).length;
} catch { /* */ }
const cssDepoisBytes = execSync("wc -c < src/app/globals.css", { encoding: "utf8" }).trim();

console.log(`    hero em cascata:      antes=${antesHero} → depois=${depoisHero}`);
console.log(`    header com entrada:   antes=${antesHeader} → depois=${depoisHeader}`);
console.log(`    whileInView (seções): antes=${antesReveal} → depois=${depoisReveal}`);
console.log(`    whileInView (dossiê): antes=${antesBlur} → depois=${depoisBlur}`);
console.log(`    globals.css bytes:    antes=${cssAntesBytes} → depois=${cssDepoisBytes}`);
check("hero sem entrada em cascata (título e entrada no primeiro paint)", antesHero > 0 && depoisHero === 0);
check("header sem animação de entrada", antesHeader > 0 && depoisHeader === 0);
check("títulos de seção sem whileInView (leitura imediata)", antesReveal > 0 && depoisReveal === 0);
check("timeline do dossiê sem whileInView", antesBlur > 0 && depoisBlur === 0);
check("CSS morto removido (beam/shiny/pulse/luz)", cssDepoisBytes < cssAntesBytes, `${cssAntesBytes} → ${cssDepoisBytes} bytes`);

console.log("\n[2] runtime — abertura fria e atualização da tabela (p50 de 5 corridas)");
const ttfbs: number[] = [];
const total: number[] = [];
for (let i = 0; i < 5; i++) {
  const r = execSync(`curl -s -o /dev/null -w "%{time_starttransfer} %{time_total}" http://127.0.0.1:3000/`, { encoding: "utf8" });
  const [t1, t2] = r.trim().split(" ").map(Number);
  ttfbs.push(t1 * 1000);
  total.push(t2 * 1000);
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`    GET / — TTFB p50=${p50(ttfbs).toFixed(0)}ms · total p50=${p50(total).toFixed(0)}ms`);
check("abertura fria da home abaixo de 800ms (p50 do TTFB)", p50(ttfbs) < 800, `p50=${p50(ttfbs).toFixed(0)}ms`);

const apiTimes: number[] = [];
for (let i = 0; i < 5; i++) {
  const r = execSync(`curl -s -o /dev/null -w "%{time_total}" "http://127.0.0.1:3000/api/stats"`, { encoding: "utf8" });
  apiTimes.push(Number(r.trim()) * 1000);
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`    GET /api/stats (estado inicial da tela) — p50=${p50(apiTimes).toFixed(0)}ms`);
check("resposta do estado inicial abaixo de 150ms (p50)", p50(apiTimes) < 150, `p50=${p50(apiTimes).toFixed(0)}ms`);

console.log(`\n=== MEDIDAS: ${pass} PASS · ${fail} FAIL ===`);
if (falhas.length > 0) for (const f of falhas) console.log("  -", f);
if (fail > 0) process.exit(1);
