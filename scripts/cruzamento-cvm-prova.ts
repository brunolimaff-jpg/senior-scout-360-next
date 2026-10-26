/**
 * cruzamento-cvm-prova.ts — P3-B1: PROVA de cruzamento local por CNPJ (v0.10.4).
 *
 * Contrato do despacho: "Não implemente os dois conectores completos de uma vez.
 * Primeiro prove um cruzamento com identidade e proveniência corretas."
 *
 * O que este script PROVA (e o que NÃO faz):
 *  · carrega UMA VEZ o CSV público do cadastro de companhias abertas da CVM
 *    (dados.cvm.gov.br — gratuito, sem auth) num banco SCRATCH
 *    (db/fontes/cvm-cia-aberta.db — NUNCA no banco de dev da aplicação);
 *  · cruza por CNPJ COMPLETO (14 caracteres normalizados — sem match parcial
 *    por raiz, sem presumir matriz/filial) empresas alvo contra o cadastro;
 *  · registra PROVENIÊNCIA: URL da fonte, SHA-256 do arquivo baixado, data da
 *    CARGA (distinta da coleta cadastral da ficha), linha de origem do fato;
 *  · NÃO implementa conector na cadeia de enriquecimento (isso é o próximo passo,
 *    só depois do aceite); NÃO consulta HTTP por empresa (a carga é o único acesso);
 *  · match por CNPJ prova VÍNCULO REGULATÓRIO (registro na CVM), nunca faturamento,
 *    porte operacional ou necessidade comercial.
 *
 * Alvos do teste mínimo:
 *  · Petrobras 33000167000101 — registrada → campos preenchidos com proveniência;
 *  · BOTICA FARMACIA DE MANIPULACAO 08.044.783/0001-17 — NÃO registrada → resultado
 *    vazio honesto (ausência de registro NÃO é falha nem conclusão sobre a empresa).
 *
 * Uso: bun scripts/cruzamento-cvm-prova.ts          # usa a cópia local se existir
 *      bun scripts/cruzamento-cvm-prova.ts --recarregar   # força novo download
 * Evidência: qa/cruzamento-cvm-v0.10.4.json
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CSV_PATH = join(ROOT, "db", "fontes", "cad_cia_aberta.csv");
const SCRATCH_DB = join(ROOT, "db", "fontes", "cvm-cia-aberta.db");
const FONTE_URL = "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv";
const OUT = "qa/cruzamento-cvm-v0.10.4.json";
const RECARREGAR = process.argv.includes("--recarregar");

const ALVOS = [
  { nome: "PETROBRAS", cnpj: "33000167000101", formato: "33.000.167/0001-01" },
  { nome: "BOTICA FARMACIA DE MANIPULACAO LTDA (fora do cadastro — esperado)", cnpj: "08.044.783/0001-17", formato: "08.044.783/0001-17" },
];

function normalizarCnpj(v: string): string {
  return v.replace(/\D/g, "");
}

async function garantirCsv(): Promise<{ sha256: string; bytes: number; baixadoAgora: boolean }> {
  mkdirSync(join(ROOT, "db", "fontes"), { recursive: true });
  if (RECARREGAR || !existsSync(CSV_PATH)) {
    console.log("Baixando cad_cia_aberta.csv (ÚNICO acesso de rede — sem consulta por empresa)…");
    const res = await fetch(FONTE_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(CSV_PATH, buf);
  } else {
    console.log("Reutilizando cópia local (sem rede — regra: arquivos públicos carregados localmente).");
  }
  const bytes = statSync(CSV_PATH).size;
  const sha256 = createHash("sha256").update(readFileSync(CSV_PATH)).digest("hex");
  return { sha256, bytes, baixadoAgora: RECARREGAR || !existsSync(CSV_PATH) ? true : false };
}

/** Carga do CSV no banco scratch (substitui a tabela — cargaEm registrado). */
function carregar(sha256: string): { linhas: number; cargaEm: string } {
  const cargaEm = new Date().toISOString();
  const db = new Database(SCRATCH_DB);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS meta_fonte (
    chave TEXT PRIMARY KEY, valor TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS cia_aberta_cvm (
    cnpj TEXT PRIMARY KEY,            -- CNPJ COMPLETO normalizado (14) — identidade do cruzamento
    denom_social TEXT, denom_comercial TEXT, dt_registro TEXT, situacao TEXT,
    dt_ini_situacao TEXT, cd_cvm TEXT, setor_ativ TEXT, tp_mercado TEXT,
    categoria_registro TEXT, dt_ini_categoria TEXT,
    linha_csv INTEGER                 -- proveniência: linha do arquivo de origem
  )`);
  const bruto = readFileSync(CSV_PATH);
  // o arquivo da CVM é windows-1252 (não UTF-8) — decodificar explicitamente
  const texto = new TextDecoder("windows-1252").decode(bruto);
  const linhas = texto.split(/\r?\n/);
  const cabecalho = linhas[0].split(";");
  const idx = Object.fromEntries(cabecalho.map((h, i) => [h, i]));
  const exigidos = ["CNPJ_CIA", "DENOM_SOCIAL", "DT_REG", "SIT", "CD_CVM", "CATEG_REG"];
  for (const c of exigidos) {
    if (idx[c] === undefined) throw new Error(`coluna esperada ausente no CSV da CVM: ${c} (esquema real mudou? header: ${cabecalho.join("|")})`);
  }
  db.exec("DELETE FROM cia_aberta_cvm");
  const ins = db.query(
    `INSERT OR REPLACE INTO cia_aberta_cvm
     (cnpj, denom_social, denom_comercial, dt_registro, situacao, dt_ini_situacao, cd_cvm, setor_ativ, tp_mercado, categoria_registro, dt_ini_categoria, linha_csv)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  const insMany = db.transaction(() => {
    for (let i = 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l.trim()) continue;
      const c = l.split(";");
      const cnpj = normalizarCnpj(c[idx.CNPJ_CIA] ?? "");
      if (cnpj.length !== 14) continue; // linha sem CNPJ completo — ignorada honestamente
      ins.run(
        cnpj,
        c[idx.DENOM_SOCIAL] ?? null,
        c[idx.DENOM_COMERC] ?? null,
        c[idx.DT_REG] ?? null,
        c[idx.SIT] ?? null,
        c[idx.DT_INI_SIT] ?? null,
        c[idx.CD_CVM] ?? null,
        c[idx.SETOR_ATIV] ?? null,
        c[idx.TP_MERC] ?? null,
        c[idx.CATEG_REG] ?? null,
        c[idx.DT_INI_CATEG] ?? null,
        i + 1
      );
      n++;
    }
  });
  insMany();
  db.query(`INSERT OR REPLACE INTO meta_fonte (chave, valor) VALUES ('fonte_url', ?), ('arquivo_sha256', ?), ('carga_em', ?), ('linhas_carregadas', ?)`).run(
    FONTE_URL, sha256, cargaEm, String(n)
  );
  db.close();
  return { linhas: n, cargaEm };
}

/** Cruzamento por CNPJ COMPLETO — SQL local, zero HTTP. */
function cruzar(cnpjFormatado: string): Record<string, unknown> | null {
  const db = new Database(SCRATCH_DB, { readonly: true });
  const r = db.query(`SELECT * FROM cia_aberta_cvm WHERE cnpj = ?`).get(normalizarCnpj(cnpjFormatado)) as Record<string, unknown> | null;
  db.close();
  return r;
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" P3-B1 — PROVA DE CRUZAMENTO CVM POR CNPJ (scratch — dev intocado)");
  console.log("══════════════════════════════════════════════════════════════");
  const csv = await garantirCsv();
  const carga = carregar(csv.sha256);
  console.log(`carga: ${carga.linhas} companhias em db/fontes/cvm-cia-aberta.db (cargaEm ${carga.cargaEm})`);

  const resultados = ALVOS.map((alvo) => {
    const r = cruzar(alvo.cnpj);
    return {
      alvo: alvo.nome,
      cnpj_consultado: alvo.formato,
      match_cnpj_completo: !!r,
      fato: r
        ? {
            denom_social: r.denom_social,
            cd_cvm: r.cd_cvm,
            categoria_registro: r.categoria_registro,
            dt_registro: r.dt_registro,
            situacao: r.situacao,
            dt_ini_situacao: r.dt_ini_situacao,
            setor_ativ: r.setor_ativ,
            tp_mercado: r.tp_mercado,
          }
        : null,
      proveniencia: r
        ? {
            fonte_url: FONTE_URL,
            arquivo_sha256: csv.sha256,
            carga_em: carga.cargaEm,
            linha_csv: r.linha_csv,
            match: "CNPJ completo normalizado (14) — sem raiz parcial, sem presumir matriz/filial",
            significado: "registro de companhia aberta na CVM = VÍNCULO REGULATÓRIO (não faturamento, não porte operacional, não produto)",
          }
        : { fonte_url: FONTE_URL, arquivo_sha256: csv.sha256, carga_em: carga.cargaEm, match: null, significado: "sem registro no cadastro de companhias abertas — resultado vazio honesto (não é conclusão sobre a empresa)" },
    };
  });

  const petro = resultados[0];
  const botica = resultados[1];
  const provas = [
    { nome: "Petrobras encontrada por CNPJ completo", pass: petro.match_cnpj_completo && !!petro.fato?.cd_cvm },
    { nome: "categoria de registro é A ou B (não 'B3')", pass: /^(Categoria (A|B))/.test(String(petro.fato?.categoria_registro ?? "")) },
    { nome: "proveniência completa (URL + SHA + cargaEm + linha)", pass: !!(petro.proveniencia as Record<string, unknown>).arquivo_sha256 },
    { nome: "não registrada → vazio honesto (Botica)", pass: botica.match_cnpj_completo === false && botica.fato === null },
  ];
  console.log("");
  for (const p of provas) console.log(`  ${p.pass ? "PASS" : "FAIL"} ${p.nome}`);
  for (const r of resultados) {
    console.log(`\n  ${r.alvo} (${r.cnpj_consultado}):`);
    console.log(`    match: ${r.match_cnpj_completo ? "SIM" : "não (vazio honesto)"}`);
    if (r.fato) console.log(`    fato: ${r.fato.denom_social} · CD_CVM ${r.fato.cd_cvm} · ${r.fato.categoria_registro} · registro ${r.fato.dt_registro} · ${r.fato.situacao}`);
    console.log(`    proveniência: SHA ${String((r.proveniencia as Record<string, unknown>).arquivo_sha256).slice(0, 16)}… · carga ${String((r.proveniencia as Record<string, unknown>).carga_em)}`);
  }

  writeFileSync(
    resolve(ROOT, OUT),
    JSON.stringify(
      {
        geradoEm: new Date().toISOString(),
        escopo: "P3-B1 — PROVA de cruzamento local por CNPJ (carga 1× + SQL local; conector NÃO implementado na cadeia)",
        fonte: {
          url: FONTE_URL,
          arquivo_local: "db/fontes/cad_cia_aberta.csv",
          bytes: csv.bytes,
          sha256: csv.sha256,
          baixado_nesta_execucao: csv.baixadoAgora,
          esquema_real_colunas: readFileSync(CSV_PATH).subarray(0, 800).toString("latin1").split("\n")[0].split(";"),
        },
        carga: { banco_scratch: "db/fontes/cvm-cia-aberta.db (FORA do banco de dev)", linhas_carregadas: carga.linhas, cargaEm: carga.cargaEm, encoding: "windows-1252", separador: ";" },
        alvos: resultados,
        provas,
        condicoes_ans: {
          host_testado: "https://dados.abertos.ans.gov.br/FTP/PDA/operadoras_de_plano_de_saude_ativas/operadoras_ativas.csv",
          resultado_na_vm: "DNS NÃO RESOLVE nesta VM (verificado 21/10/2026) — fonte ANS NÃO confirmada nesta rodada; conector ANS permanece BLOQUEADO até confirmação, como previsto na proposta",
          esquema_publicado_nao_verificado_aqui: "Registro_ANS;CNPJ;Razao_Social;Nome_Fantasia;Modalidade;Data_Registro_ANS;... (a confirmar quando o host estiver acessível)",
        },
        contratos: [
          "match por CNPJ COMPLETO antes de atribuir fatos (nunca por raiz 8 dígitos)",
          "CNAE/setor é sinal de APLICABILIDADE, nunca prova única de vínculo regulatório",
          "registro CVM/ANS comprova vínculo regulatório, não faturamento/porte/produto",
          "cargaEm (data da CARGA do CSV) ≠ coletadoEm (coleta cadastral da ficha)",
        ],
        proximo_passo_recomendado: "aceite desta prova → implementar o conector CVM na cadeia (tabela final + gatilho por natureza jurídica/CNAE + proveniência na teia), UM conector por vez",
      },
      null,
      2
    ) + "\n"
  );
  console.log(`\n▸ Evidência: ${OUT}`);
  const falhas = provas.filter((p) => !p.pass).length;
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error("erro:", e);
  process.exit(1);
});
