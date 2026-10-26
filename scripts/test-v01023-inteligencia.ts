/**
 * test-v01023-inteligencia.ts — GATE DA ENTREGA 5 (contrato do Planejador, despacho 22/10 ~00:00).
 *
 * Oito casos adversariais de identidade + auditoria do normalizador de quadro.
 * Valores esperados INDEPENDENTES das funções testadas (fixtures escritos à mão,
 * literais no teste — nunca derivados da função sob prova).
 *
 *   C1  Homônimo em município distinto   → divergência ALTA vai para "validar", nunca para "sabemos"
 *   C2  Página de terceiro (dono/CNPJ alheio) → grafo não inventa nó; só ligação persistida vira nó
 *   C3  Mesma PJ, estabelecimentos distintos  → aresta "mesma-empresa", nunca empresa distinta
 *   C4  Participante compartilhado entre linhas do lote → grupo + aviso literal de NÃO-grupo
 *   C5  Tipo de participante não confirmado → só em RELACAO_NAO_CONFIRMADA (nunca PF/PJ por eliminação)
 *   C6  Cache expirado → quadrosEmCacheDaLinha NÃO devolve o quadro vencido (leitura pura)
 *   C7  Tetos do grafo (8 participantes × 2 empresas por participante) → corte honesto + agregado
 *   C8  Export = UI intocado → arquivos de exportação sem referência às leituras novas
 *
 *   N1–N4 Auditoria do normalizador (normalizarQuadroParticipante): unificação de
 *   linhas repetidas fica VISÍVEL (aviso), primeira razão mantida, nenhum campo de
 *   sócio (cpf/nome) vaza para o quadro de empresas.
 *
 * Sem rede, sem IA. Único toque no banco: lotes/caches SINTÉTICOS criados e
 * APAGADOS no finally (nenhum dado do operador é lido ou modificado).
 *
 * Rodar: bun scripts/test-v01023-inteligencia.ts
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import ExcelJS from "exceljs";
import { construirDatasetExportacao } from "../src/lib/export/dataset";
import { gerarExcelLote } from "../src/lib/export/excel";
import { lacunaParaTriagemV1, paraJsonl, validarPacoteTriagemV1 } from "../src/lib/triage/contrato";
import { db } from "../src/lib/db";
import {
  lerRelacoes,
  montarProximoMovimento,
  construirGrafoRelacoes,
  grafoTemValor,
  AVISO_GRUPO_ECONOMICO,
  AVISO_ADMINISTRACAO,
  GRAFO_TETO_PARTICIPANTES,
  GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE,
  type LeituraRelacoes,
} from "../src/lib/inteligencia";
import { normalizarQuadroParticipante } from "../src/lib/relations/grafo";
import { quadrosEmCacheDaLinha } from "../src/lib/relations/service";
import { formatCnpj } from "../src/lib/cnpj";
import type { RelacoesView, QuadroView, ParticipanteView, RowDetail, TriagemLinhaView } from "../src/lib/types";

/** forma mínima do dataset REABERTO do disco (tipagem local do teste — não importada do produto) */
interface DatasetExportLike {
  linhas: {
    cnpjNormalizado: string;
    cnpjFormatado: string;
    razaoSocial: string;
    matrizFilial: string;
    relacoesConsultadas: {
      coletadoEm: string;
      participantes: { participanteId: string; quadro: { empresas: { cnpjFormatado: string }[] } | null }[];
    } | null;
  }[];
}

let pass = 0;
let fail = 0;
const falhas: string[] = [];
function check(nome: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${nome}`);
  } else {
    fail++;
    falhas.push(nome + (extra ? ` — ${extra}` : ""));
    console.log(`  FAIL  ${nome}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ----------------------------- fixtures (à mão) ----------------------------- */

const CNPJ_CONSULTADA = "11222333000181"; // estabelecimento consultado (raiz 11222333)
const RAIZ_CONSULTADA = "11222333";
const PF_HASH_1 = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const PF_HASH_2 = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1";
const PF_HASH_ADMIN = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2";
const PF_HASH_COMUM = "d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3";
const CNPJ_FILIAL_MESMA_RAIZ = "11222333000270"; // outro estabelecimento da MESMA raiz
const CNPJ_OUTRA_EMPRESA_1 = "33344455000100";
const CNPJ_OUTRA_EMPRESA_2 = "44455566000110";
const CNPJ_OUTRA_EMPRESA_3 = "55566677000120";

function participante(overrides: Partial<ParticipanteView>): ParticipanteView {
  return {
    participanteId: PF_HASH_1,
    tipo: "PF",
    nomePublico: "PARTICIPANTE NEUTRO",
    cnpjParticipante: null,
    qualificacao: null,
    comumMesmaPj: [],
    comumCom: [],
    ...overrides,
  } as ParticipanteView;
}

function view(overrides: Partial<RelacoesView> = {}): RelacoesView {
  return {
    ok: true,
    cnpj: CNPJ_CONSULTADA,
    razaoSocialConsultada: "EMPRESA CONSULTADA EXEMPLO LTDA",
    fonte: "MinhaReceita Grafo",
    baseDados: null,
    coletadoEm: "2026-10-22T10:00:00.000Z",
    validoAte: "2026-10-29T10:00:00.000Z",
    via: "consulta",
    participantes: [],
    totalParticipantes: 0,
    existeParticipanteComum: false,
    avisos: [],
    ...overrides,
  };
}

function quadro(participanteId: string, empresas: { cnpj: string; razaoSocial: string | null }[], overrides: Partial<QuadroView> = {}): [string, QuadroView] {
  return [
    participanteId,
    {
      ok: true,
      participanteId,
      tipoParticipante: "PF",
      rotulo: null,
      leitura: "Encontramos as empresas em que este participante aparece no quadro societário público.",
      totalEmpresas: empresas.length,
      totalPessoasJuridicas: empresas.length,
      truncado: false,
      empresas,
      empresasOcultas: 0,
      fonte: "MinhaReceita Grafo",
      coletadoEm: "2026-10-22T10:00:00.000Z",
      validoAte: "2026-10-29T10:00:00.000Z",
      via: "cache",
      avisos: [],
      ...overrides,
    } as QuadroView,
  ];
}

function rowDetail(overrides: Record<string, unknown> = {}): RowDetail {
  return {
    rowNumber: 1,
    lookupStatus: "ENRIQUECIDO",
    legalName: "EMPRESA CONSULTADA EXEMPLO LTDA",
    normalizedCnpj: CNPJ_CONSULTADA,
    registrationStatus: "ATIVA",
    municipality: "CUIABÁ",
    uf: "MT",
    cnaeDescription: null,
    branchType: "MATRIZ",
    headquartersCnpj: null,
    socios: [],
    identityStage: null,
    identityDivergencias: [],
    extra: {},
    ...overrides,
  } as unknown as RowDetail;
}

const TRIAGEM_VAZIA = null as unknown as TriagemLinhaView;

/* ==================== C1 — homônimo em município distinto ==================== */
console.log("\nC1. HOMÔNIMO — divergência ALTA vira validação, nunca fato sabido");
{
  const DESC = "Registro homônimo localizado em município distinto do esperado pela pista.";
  const r = rowDetail({
    legalName: "METALURGIA SÃO JORGE LTDA",
    identityStage: "LOCALIZADO",
    identityDivergencias: [{ tipo: "MUNICIPIO", severidade: "ALTA", descricao: DESC }],
  });
  const m = montarProximoMovimento(r, TRIAGEM_VAZIA);
  const validar = m.secoes.find((s) => s.id === "validar");
  const sabemos = m.secoes.find((s) => s.id === "sabemos");
  check("divergência de identidade aparece na seção de validação", !!validar && validar.itens.includes(DESC));
  check("divergência de identidade NUNCA aparece como fato sabido", !!sabemos && !sabemos.itens.includes(DESC));
  check("fato sabido continua sendo só o registro localizado", !!sabemos && sabemos.itens.some((i) => i.includes("Registro localizado na fonte oficial")));
}

/* ============ C2 — página de terceiro: o grafo não inventa nó ============ */
console.log("\nC2. TERCEIROS — nó só nasce de ligação persistida (participante ou quadro)");
{
  const v = view({
    participantes: [
      participante({ participanteId: PF_HASH_1, nomePublico: "SOCIO UM" }),
      participante({ participanteId: PF_HASH_2, nomePublico: "SOCIO DOIS" }),
    ],
    totalParticipantes: 2,
  });
  const g = construirGrafoRelacoes(v, {});
  // a raiz é nó dedicado fora do array (g.raiz); nos = só os participantes e o nível 2
  check("raiz dedicada existe e nós = participantes persistidos (nada além)", g.nos.length === 2 && g.raiz.tipo === "empresa");
  check("CNPJ de página alheia NUNCA vira nó", !g.nos.some((n) => (n.subtitulo ?? "").includes(formatCnpj(CNPJ_OUTRA_EMPRESA_1))));
  check("só arestas de participação (nenhuma ligação de nível 2)", g.arestas.every((a) => a.tipo === "participacao"));
  check("sem ligações além da lista, o mapa NÃO existe (experimento controlado)", grafoTemValor(g) === false);
}

/* ========= C3 — mesma PJ, estabelecimentos distintos: nunca "empresa" ========= */
console.log("\nC3. MESMA PJ — estabelecimento da mesma raiz é a MESMA pessoa jurídica");
{
  const p = participante({
    participanteId: PF_HASH_1,
    nomePublico: "SOCIO PRESENTE NAS DUAS",
    comumMesmaPj: [{ cnpj: CNPJ_FILIAL_MESMA_RAIZ, nota: "estabelecimento da mesma raiz" }],
  });
  const v = view({ participantes: [p], totalParticipantes: 1 });
  const leitura = lerRelacoes(v);
  const grupoMesmaPj = leitura.grupos.find((gr) => gr.tipo === "ESTABELECIMENTO_MESMA_PJ");
  const grupoComum = leitura.grupos.find((gr) => gr.tipo === "EMPRESA_COM_PARTICIPANTE_COMPARTILHADO");
  check("leitura aponta o estabelecimento da MESMA PJ (CNPJ literal)", !!grupoMesmaPj && grupoMesmaPj.nomes.includes("11.222.333/0002-70"));
  check("leitura NÃO cria grupo de empresa distinta", !grupoComum || !grupoComum.nomes.includes("SOCIO PRESENTE NAS DUAS"));

  // quadro do participante listando matriz + filial da MESMA raiz consultada
  const g = construirGrafoRelacoes(v, {
    [PF_HASH_1]: quadro(PF_HASH_1, [
      { cnpj: CNPJ_CONSULTADA, razaoSocial: "EMPRESA CONSULTADA EXEMPLO LTDA" },
      { cnpj: CNPJ_FILIAL_MESMA_RAIZ, razaoSocial: "EMPRESA CONSULTADA EXEMPLO LTDA" },
    ])[1],
  });
  const mesmaEmpresa = g.arestas.filter((a) => a.tipo === "mesma-empresa");
  check("vínculo vira aresta 'mesma-empresa' para a raiz", mesmaEmpresa.length === 1);
  check("nenhuma empresa-quadro nova nasce para a mesma raiz", !g.nos.some((n) => n.tipo === "empresa-quadro" && (n.subtitulo ?? "").includes(RAIZ_CONSULTADA.slice(0, 2)) && n.id.startsWith("q:")));
  check("o mapa existe (há ligação além da estrela)", grafoTemValor(g) === true);
}

/* ============ C4 — participante compartilhado: nunca grupo econômico ============ */
console.log("\nC4. COMPARTILHADO — participante comum não vira grupo econômico");
{
  const p = participante({
    participanteId: PF_HASH_COMUM,
    nomePublico: "SOCIO COMUM AO LOTE",
    comumCom: [
      { cnpj: CNPJ_OUTRA_EMPRESA_1, razaoSocial: "AGRO PARANAENSE LTDA", nota: "mesmo participante no quadro público (fixture)" },
      { cnpj: CNPJ_OUTRA_EMPRESA_2, razaoSocial: "COMERCIO VALE VERDE LTDA", nota: "mesmo participante no quadro público (fixture)" },
    ],
  });
  const v = view({ participantes: [p], totalParticipantes: 1, existeParticipanteComum: true });
  const leitura: LeituraRelacoes = lerRelacoes(v);
  const grupo = leitura.grupos.find((gr) => gr.tipo === "EMPRESA_COM_PARTICIPANTE_COMPARTILHADO");
  check("grupo de compartilhados lista as empresas distintas do lote", !!grupo && grupo.nomes.length === 2 && grupo.nomes.includes("AGRO PARANAENSE LTDA") && grupo.nomes.includes("COMERCIO VALE VERDE LTDA"));
  check("aviso dedicado nega grupo econômico (texto literal do contrato)", AVISO_GRUPO_ECONOMICO === "Participante comum ou sobreposição de quadro NÃO caracteriza grupo econômico.");
  check("a leitura nunca afirma grupo — palavra 'grupo' só aparece na negação dedicada", leitura.resumo.includes("grupo") === false);
  const g = construirGrafoRelacoes(v, {});
  const comp = g.arestas.filter((a) => a.tipo === "compartilhado");
  check("arestas de compartilhamento carregam a negação no rótulo", comp.length === 2 && comp.every((a) => a.rotulo.includes("NÃO caracteriza grupo econômico")));
}

/* ============= C5 — tipo não confirmado: nunca PF/PJ por eliminação ============= */
console.log("\nC5. INDETERMINADO — vínculo vale, tipo fica em aberto");
{
  const v = view({
    participantes: [
      participante({ participanteId: "id-sem-tipo-0001", tipo: "INDETERMINADO", nomePublico: "FUNDACAO EXEMPLO" }),
      participante({ participanteId: PF_HASH_1, nomePublico: "SOCIO UM" }),
    ],
    totalParticipantes: 2,
  });
  const leitura = lerRelacoes(v);
  const naoConfirmado = leitura.grupos.find((gr) => gr.tipo === "RELACAO_NAO_CONFIRMADA");
  const pf = leitura.grupos.find((gr) => gr.tipo === "SOCIO_PESSOA_FISICA");
  const pj = leitura.grupos.find((gr) => gr.tipo === "SOCIO_PESSOA_JURIDICA");
  check("vínculo não confirmado fica no grupo dedicado", !!naoConfirmado && naoConfirmado.nomes.includes("FUNDACAO EXEMPLO"));
  check("NUNCA entra como sócio pessoa física", !pf || !pf.nomes.includes("FUNDACAO EXEMPLO"));
  check("NUNCA entra como sócio pessoa jurídica", !pj || !pj.nomes.includes("FUNDACAO EXEMPLO"));
  const g = construirGrafoRelacoes(v, {});
  const no = g.nos.find((n) => n.id === "p:id-sem-tipo-0001");
  check("nó do grafo preserva o estado indeterminado", !!no && no.tipo === "participante-indeterminado");
}

/* ==================== C6 — cache expirado: leitura pura ==================== */
console.log("\nC6. CACHE EXPIRADO — quadro vencido não volta como ligação");
{
  const batch = await db.importBatch.create({
    data: { fileName: "TESTE-v01023-adversarial.csv", storedPath: "", fileSize: 0, status: "DONE" },
  });
  await db.importRow.create({
    data: {
      batchId: batch.id,
      rowNumber: 1,
      rawCnpj: CNPJ_CONSULTADA,
      normalizedCnpj: CNPJ_CONSULTADA,
      cnpjStatus: "VALIDA",
      lookupStatus: "ENRIQUECIDO",
      legalName: "EMPRESA CONSULTADA EXEMPLO LTDA",
      branchType: "MATRIZ",
      branchIdentifier: 1,
      cnpjRoot: RAIZ_CONSULTADA,
    },
  });
  const PARTICIPANTE_EXPIRADO = "expirado0001expirado0001expirado01";
  try {
    await db.relacaoSocietariaCache.create({
      data: {
        cnpj: CNPJ_CONSULTADA,
        fonte: "MinhaReceita Grafo",
        coletadoEm: new Date("2026-10-01T10:00:00Z"),
        atualizadoEm: new Date("2026-10-01T10:00:00Z"),
        validoAte: new Date("2026-10-08T10:00:00Z"), // vencido
        relacoesJson: JSON.stringify([participante({ participanteId: PARTICIPANTE_EXPIRADO, nomePublico: "SOCIO COM QUADRO VENCIDO" })]),
        totalParticipantes: 1,
      },
    });
    await db.quadroParticipanteCache.create({
      data: {
        participanteId: PARTICIPANTE_EXPIRADO,
        tipoParticipante: "PF",
        rotulo: "SOCIO COM QUADRO VENCIDO",
        fonte: "MinhaReceita Grafo",
        coletadoEm: new Date("2026-10-01T10:00:00Z"),
        validoAte: new Date("2026-10-08T10:00:00Z"), // vencido
        empresasJson: JSON.stringify([{ cnpj: CNPJ_OUTRA_EMPRESA_1, razaoSocial: "AGRO PARANAENSE LTDA" }]),
        totalEmpresas: 1,
        truncado: false,
      },
    });
    const res = await quadrosEmCacheDaLinha(batch.id, 1);
    check("leitura pura devolve ok mesmo com cache vencido", res.ok === true);
    if (res.ok) {
      check("quadro expirado NÃO volta na resposta", Object.keys(res.quadros).length === 0);
      check("aviso aponta o comando para recriar a ligação", res.avisos.some((a) => a.includes("Investigar conexão")));
    }
  } finally {
    await db.quadroParticipanteCache.deleteMany({ where: { participanteId: PARTICIPANTE_EXPIRADO } }).catch(() => undefined);
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: CNPJ_CONSULTADA } }).catch(() => undefined);
    await db.importRow.deleteMany({ where: { batchId: batch.id } }).catch(() => undefined);
    await db.importBatch.delete({ where: { id: batch.id } }).catch(() => undefined);
  }
}

/* ==================== C7 — tetos do grafo com corte honesto ==================== */
console.log("\nC7. TETOS — corte declarado, contagem real na lista, nada inventado");
{
  const participantes: ParticipanteView[] = [];
  for (let i = 0; i < 10; i++) {
    participantes.push(
      participante({
        participanteId: `hash-lote-${String(i).padStart(4, "0")}`,
        nomePublico: `SOCIO NUMERO ${i + 1}`,
      })
    );
  }
  // o primeiro participante tem quadro com 3 empresas distintas (3 raízes)
  participantes[0] = participante({
    participanteId: "hash-lote-0000",
    nomePublico: "SOCIO NUMERO 1",
    comumCom: [],
  });
  const v = view({ participantes, totalParticipantes: 10 });
  const g = construirGrafoRelacoes(v, {
    "hash-lote-0000": quadro("hash-lote-0000", [
      { cnpj: CNPJ_OUTRA_EMPRESA_1, razaoSocial: "AGRO PARANAENSE LTDA" },
      { cnpj: CNPJ_OUTRA_EMPRESA_2, razaoSocial: "COMERCIO VALE VERDE LTDA" },
      { cnpj: CNPJ_OUTRA_EMPRESA_3, razaoSocial: "TRANSPORTE ROTA SUL LTDA" },
    ])[1],
  });
  const nivel1 = g.nos.filter((n) => n.nivel === 1);
  const quadroArestas = g.arestas.filter((a) => a.tipo === "quadro");
  const agregado = g.nos.find((n) => n.tipo === "agregado");
  check(`nível 1 respeita o teto declarado (${GRAFO_TETO_PARTICIPANTES})`, nivel1.length === GRAFO_TETO_PARTICIPANTES);
  check(`empresas por participante respeitam o teto declarado (${GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE})`, quadroArestas.filter((a) => a.de === "p:hash-lote-0000" && a.para.startsWith("q:")).length === GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE);
  check("empresas cortadas viram nó agregado declarado", !!agregado && agregado.rotulo === "+1 outras");
  check("contagem REAL segue visível no resumo (10 participantes)", g.resumo.includes("10 participantes"));
  check("nenhum nó inventado além dos tetos", g.nos.filter((n) => n.nivel === 2 && n.tipo !== "agregado").length === GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE);
}

/* ============ C8 — export = UI: arquivos de exportação intocados ============ */
console.log("\nC8. EXPORT = UI — exportações não conhecem as leituras novas");
{
  const arquivos = [
    "src/app/api/imports/[id]/export/route.ts",
    "src/lib/export/excel.ts",
    "src/lib/export/pdf.ts",
    "src/lib/export/dataset.ts",
  ];
  const proibidos = ["@/lib/inteligencia", "grafo-relacoes", "lerRelacoes", "montarProximoMovimento", "GrafoRelacoesCard"];
  for (const arq of arquivos) {
    const conteudo = readFileSync(`${process.cwd()}/${arq}`, "utf8");
    const achado = proibidos.find((p) => conteudo.includes(p));
    check(`${arq} sem referência às leituras novas`, !achado, achado ? `contém "${achado}"` : "");
  }
  // contrato de resposta do export segue de pé (fatos dos arquivos, não da memória)
  const rota = readFileSync(`${process.cwd()}/src/app/api/imports/[id]/export/route.ts`, "utf8");
  check("rota preserva o contrato pdf_empresa nos dois níveis", rota.includes("pdf_empresa") && rota.includes("executivo") && rota.includes("completo"));
  check("leitura de relações é apresentação — aviso de administração é fato, não poder", AVISO_ADMINISTRACAO.includes("não indica, por si só, quem decide"));
}

/* ========== N1–N4 — auditoria do normalizador (item 3 do despacho) ========== */
console.log("\nN. NORMALIZADOR DO QUADRO — unificação visível, sem vazamento de sócio");
{
  const LINHAS_SAME_CNPJ = [
    { cnpj: CNPJ_OUTRA_EMPRESA_1, razao_social: "AGRO PARANAENSE LTDA", id: "socio-a", nome: "SOCIO A", cpf: "**111111**" },
    { cnpj: CNPJ_OUTRA_EMPRESA_1, razao_social: "AGRO PARANAENSE LTDA", id: "socio-b", nome: "SOCIO B", cpf: "**222222**" },
    { cnpj: CNPJ_OUTRA_EMPRESA_1, razao_social: "AGRO PARANAENSE LTDA", id: "socio-c", nome: "SOCIO C", cpf: "**333333**" },
  ];
  const norm = normalizarQuadroParticipante(LINHAS_SAME_CNPJ, { participanteId: PF_HASH_1, tipoParticipante: "PF" });
  if ("ok" in norm && norm.ok) {
    check("3 linhas do mesmo CNPJ → 1 estabelecimento", norm.totalEmpresas === 1 && norm.empresas.length === 1);
    check("unificação fica VISÍVEL em aviso honesto", norm.avisos.some((a) => a.includes("2") && a.includes("unificado") && a.includes("estabelecimento")), JSON.stringify(norm.avisos));
    const bruto = JSON.stringify(norm.empresas);
    check("nenhum campo de sócio (cpf/nome/id) vaza no quadro", !bruto.includes("cpf") && !bruto.includes('"nome"') && !bruto.includes("socio-"));
  } else {
    check("normalizador devolve sucesso para linhas válidas", false);
  }

  const DUAS_DISTINTAS = [
    { cnpj: CNPJ_OUTRA_EMPRESA_1, razao_social: "AGRO PARANAENSE LTDA" },
    { cnpj: CNPJ_OUTRA_EMPRESA_2, razao_social: "COMERCIO VALE VERDE LTDA" },
  ];
  const norm2 = normalizarQuadroParticipante(DUAS_DISTINTAS, { participanteId: PF_HASH_1, tipoParticipante: "PF" });
  if ("ok" in norm2 && norm2.ok) {
    check("CNPJs distintos → 2 estabelecimentos, sem aviso de unificação", norm2.totalEmpresas === 2 && norm2.avisos.length === 0);
  } else {
    check("normalizador devolve sucesso para CNPJs distintos", false);
  }

  const VARIANTES_RAZAO = [
    { cnpj: CNPJ_OUTRA_EMPRESA_1, razao_social: "AGRO PARANAENSE LTDA" },
    { cnpj: CNPJ_OUTRA_EMPRESA_1, razao_social: "AGRO PARANAENSE LTDA - FILIAL" },
  ];
  const norm3 = normalizarQuadroParticipante(VARIANTES_RAZAO, { participanteId: PF_HASH_1, tipoParticipante: "PF" });
  if ("ok" in norm3 && norm3.ok) {
    check("mesmo CNPJ com razões diferentes → primeira razão mantida (determinístico)", norm3.empresas[0]?.razaoSocial === "AGRO PARANAENSE LTDA");
  } else {
    check("normalizador devolve sucesso para variantes de razão", false);
  }
}

/* ========== C8-B — exportação COMPORTAMENTAL (parecer do checkpoint v0.10.23) ========== */
console.log("\nC8-B. EXPORTAÇÃO COMPORTAMENTAL — gera, GRAVA, REABRE e compara (antes/depois)");
{
  // expectativas LITERais independentes (nada derivado das funções sob prova)
  const CNPJ_FMT_CONSULTADA = "11.222.333/0001-81";
  const CNPJ_FMT_OUTRA_1 = "33.344.455/0001-00";
  const COLETA_ISO = "2026-10-20T12:00:00.000Z";
  const batch = await db.importBatch.create({
    data: { fileName: "TESTE-v01023-export.csv", storedPath: "", fileSize: 0, status: "DONE", sourceType: "CSV" },
  });
  await db.importRow.create({
    data: {
      batchId: batch.id, rowNumber: 1, rawCnpj: CNPJ_CONSULTADA, normalizedCnpj: CNPJ_CONSULTADA,
      cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", legalName: "EXPORT ALVO EXEMPLO LTDA",
      branchType: "MATRIZ", branchIdentifier: 1, cnpjRoot: RAIZ_CONSULTADA,
    },
  });
  await db.importRow.create({
    data: {
      batchId: batch.id, rowNumber: 2, rawCnpj: CNPJ_OUTRA_EMPRESA_2, normalizedCnpj: CNPJ_OUTRA_EMPRESA_2,
      cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", legalName: "COMERCIO VALE VERDE LTDA",
      branchType: "MATRIZ", branchIdentifier: 1, cnpjRoot: "44455566",
    },
  });
  await db.importRow.create({
    data: {
      batchId: batch.id, rowNumber: 3, rawCnpj: CNPJ_OUTRA_EMPRESA_3, normalizedCnpj: CNPJ_OUTRA_EMPRESA_3,
      cnpjStatus: "VALIDA", lookupStatus: "ENRIQUECIDO", legalName: "DISTRIBUIDORA RIO CLARO LTDA",
      branchType: "FILIAL", branchIdentifier: 2, cnpjRoot: "55566677",
    },
  });
  // vínculos sintéticos em cache: relação direta + quadro expandido COM avisosJson
  // (prova a coluna nova de ponta a ponta até o arquivo exportado)
  await db.relacaoSocietariaCache.create({
    data: {
      cnpj: CNPJ_CONSULTADA, fonte: "MinhaReceita Grafo",
      coletadoEm: new Date(COLETA_ISO), atualizadoEm: new Date(COLETA_ISO), validoAte: new Date("2026-11-19T12:00:00Z"),
      relacoesJson: JSON.stringify([{ participanteId: PF_HASH_1, tipo: "PF", nomePublico: "SOCIO EXPORT ALVO", cnpjParticipante: null }]),
      totalParticipantes: 1,
    },
  });
  await db.quadroParticipanteCache.create({
    data: {
      participanteId: PF_HASH_1, tipoParticipante: "PF", rotulo: "SOCIO EXPORT ALVO", fonte: "MinhaReceita Grafo",
      coletadoEm: new Date(COLETA_ISO), validoAte: new Date("2026-11-19T12:00:00Z"),
      empresasJson: JSON.stringify([
        { cnpj: CNPJ_OUTRA_EMPRESA_1, razaoSocial: "AGRO PARANAENSE LTDA" },
        { cnpj: CNPJ_FILIAL_MESMA_RAIZ, razaoSocial: "EXPORT ALVO EXEMPLO LTDA" },
      ]),
      totalEmpresas: 2, truncado: false,
      avisosJson: JSON.stringify(["1 registro repetido na fonte foi unificado por estabelecimento (CNPJ igual) — o quadro lista estabelecimentos distintos, não linhas da fonte."]),
    },
  });

  const arquivosTmp = [
    "/tmp/c8b-dataset-1.json", "/tmp/c8b-dataset-2.json",
    "/tmp/c8b-lote-1.xlsx", "/tmp/c8b-lote-2.xlsx",
    "/tmp/c8b-triagem-1.jsonl", "/tmp/c8b-triagem-2.jsonl",
  ];
  try {
    // trap de rede: QUALQUER fetch durante a exportação = prova de consulta externa = falha
    let chamadasRede = 0;
    const fetchReal = globalThis.fetch;
    globalThis.fetch = (async () => {
      chamadasRede++;
      throw new Error("REDE_PROIBIDA_NA_EXPORTACAO");
    }) as typeof fetch;
    let json1 = "";
    let json2 = "";
    let xlsx1: Buffer | undefined;
    let xlsx2: Buffer | undefined;
    let jsonl1 = "";
    let jsonl2 = "";
    try {
      const e1 = await construirDatasetExportacao(batch.id, "TODAS");
      const e2 = await construirDatasetExportacao(batch.id, "TODAS");
      if (e1.ok && e2.ok) {
        json1 = JSON.stringify(e1.dataset);
        json2 = JSON.stringify(e2.dataset);
        xlsx1 = await gerarExcelLote(e1.dataset, batch.id);
        xlsx2 = await gerarExcelLote(e2.dataset, batch.id);
      }
      const ctx = {
        cnpjCompleto: CNPJ_FMT_CONSULTADA,
        cnpjRaiz: RAIZ_CONSULTADA,
        dataReferencia: "2026-10-20",
        fontesConsultadas: ["Cadastro Receita Federal"],
        evidencias: [] as { tipo: string; referencia: string; data: string | null }[],
        bloqueios: [] as { fonte: string; tipo: string; data: string | null }[],
      };
      const lacunaFixa: TriagemLinhaView["lacunas"][number] = {
        perguntaId: "identidade.situacao",
        pergunta: "A situação cadastral está ativa?",
        estado: "VALIDACAO_HUMANA",
        motivo: "Fato registrado pela fonte; confirmação humana pendente.",
        entidade: "PESSOA_JURIDICA",
        fatos: [{ fato: "Situação cadastral ATIVA registrada pela Receita Federal.", fonte: "Cadastro Receita Federal", data: COLETA_ISO, origem: "estrutura" }],
        falta: "Confirmação humana antes do uso comercial.",
        proximaVerificacao: "Confirmar com a empresa antes de proposta.",
        utilidade: "Evita propostas para empresas irregulares.",
      };
      jsonl1 = paraJsonl([lacunaParaTriagemV1(lacunaFixa, ctx)]);
      jsonl2 = paraJsonl([lacunaParaTriagemV1(lacunaFixa, ctx)]);
    } finally {
      globalThis.fetch = fetchReal;
    }
    check("C8-B.1 zero consulta externa durante TODA a exportação (trap de fetch)", chamadasRede === 0, `chamadas=${chamadasRede}`);
    check("C8-B.2 dataset e xlsx gerados nas duas execuções", !!json1 && !!json2 && !!xlsx1 && !!xlsx2);
    if (!json1 || !json2 || !xlsx1 || !xlsx2) throw new Error("C8-B: geração de dataset/xlsx falhou — a reabertura não tem o que comparar");

    // GRAVA em disco e REABRE — o teste compara o que está NO ARQUIVO, não a memória
    writeFileSync("/tmp/c8b-dataset-1.json", json1);
    writeFileSync("/tmp/c8b-dataset-2.json", json2);
    if (xlsx1) writeFileSync("/tmp/c8b-lote-1.xlsx", xlsx1);
    if (xlsx2) writeFileSync("/tmp/c8b-lote-2.xlsx", xlsx2);
    writeFileSync("/tmp/c8b-triagem-1.jsonl", jsonl1);
    writeFileSync("/tmp/c8b-triagem-2.jsonl", jsonl2);

    const ds1r = JSON.parse(readFileSync("/tmp/c8b-dataset-1.json", "utf8")) as DatasetExportLike;
    const ds2r = JSON.parse(readFileSync("/tmp/c8b-dataset-2.json", "utf8")) as DatasetExportLike;
    check("C8-B.3 dataset antes/depois: FATOS idênticos (JSON determinístico)", JSON.stringify(ds1r) === JSON.stringify(ds2r));
    const l1 = ds1r.linhas.find((l) => l.cnpjNormalizado === CNPJ_CONSULTADA);
    check("C8-B.4 fato: razão social da linha alvo (literal)", l1?.razaoSocial === "EXPORT ALVO EXEMPLO LTDA");
    check("C8-B.5 fato: CNPJ formatado (literal independente)", l1?.cnpjFormatado === CNPJ_FMT_CONSULTADA);
    check("C8-B.6 estado: matriz/filial + 3 linhas no escopo TODAS", l1?.matrizFilial === "MATRIZ" && ds1r.linhas.length === 3);
    check(
      "C8-B.7 vínculo: participante da relação em cache presente com quadro expandido",
      l1?.relacoesConsultadas?.participantes?.[0]?.participanteId === PF_HASH_1 &&
        l1?.relacoesConsultadas?.participantes?.[0]?.quadro?.empresas?.some((e) => e.cnpjFormatado === CNPJ_FMT_OUTRA_1) === true,
      JSON.stringify(l1?.relacoesConsultadas).slice(0, 200)
    );
    check("C8-B.8 data: coletadoEm da coleta sintética preservado (ISO literal)", l1?.relacoesConsultadas?.coletadoEm === COLETA_ISO);
    check("C8-B.9 vínculo: nenhuma expansão inventada nas linhas sem cache", ds1r.linhas.filter((l) => l.cnpjNormalizado !== CNPJ_CONSULTADA).every((l) => !l.relacoesConsultadas));

    // xlsx REABERTO com exceljs — compara a GRADE DE FATOS entre execuções
    // (bytes NÃO são comparados: metadados de workbook variam — diferença legítima)
    const wb1 = new ExcelJS.Workbook();
    const wb2 = new ExcelJS.Workbook();
    await Promise.all([wb1.xlsx.load(readFileSync("/tmp/c8b-lote-1.xlsx") as unknown as ExcelJS.Buffer), wb2.xlsx.load(readFileSync("/tmp/c8b-lote-2.xlsx") as unknown as ExcelJS.Buffer)]);
    const emp1 = wb1.getWorksheet("Empresas");
    const emp2 = wb2.getWorksheet("Empresas");
    const cel = (ws: ExcelJS.Worksheet | undefined, r: number, c: number) => {
      const v = ws?.getRow(r)?.getCell(c)?.value;
      return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    };
    let gradeIgual = !!emp1 && !!emp2;
    if (emp1 && emp2) {
      for (let r = 1; r <= 4 && gradeIgual; r++) {
        for (let c = 1; c <= 20; c++) {
          if (cel(emp1, r, c) !== cel(emp2, r, c)) {
            gradeIgual = false;
            console.log(`        divergência em r${r}c${c}: ${cel(emp1, r, c)} ≠ ${cel(emp2, r, c)}`);
          }
        }
      }
    }
    check("C8-B.10 xlsx antes/depois: grade de fatos idêntica (metadados de workbook ignorados)", gradeIgual);
    check("C8-B.11 xlsx reaberto: CNPJ preservado como TEXTO com máscara (literal)", cel(emp1, 2, 3) === CNPJ_FMT_CONSULTADA, cel(emp1, 2, 3));
    check("C8-B.12 xlsx reaberto: razão social da linha alvo (literal)", cel(emp1, 2, 4).includes("EXPORT ALVO EXEMPLO LTDA"), cel(emp1, 2, 4));

    // TRIAGEM_V1: reabrir do disco, validar no schema zod e comparar com literais
    const linhasArquivo1 = readFileSync("/tmp/c8b-triagem-1.jsonl", "utf8").trim().split("\n");
    const linhasArquivo2 = readFileSync("/tmp/c8b-triagem-2.jsonl", "utf8").trim().split("\n");
    const pacote = validarPacoteTriagemV1(linhasArquivo1.map((l) => JSON.parse(l)));
    check("C8-B.13 TRIAGEM_V1 reaberta do disco valida no schema do contrato", pacote.ok === true, pacote.ok ? "" : JSON.stringify(pacote.erros).slice(0, 200));
    check("C8-B.14 TRIAGEM_V1 antes/depois idêntica (JSONL determinístico)", linhasArquivo1.join("\n") === linhasArquivo2.join("\n"));
    if (pacote.ok) {
      const e0 = pacote.entradas[0];
      check(
        "C8-B.15 TRIAGEM_V1: fato/estado/data com literais independentes",
        e0?.estado_triagem === "VALIDACAO_HUMANA" &&
          e0?.data_referencia === "2026-10-20" &&
          e0?.fatos_existentes?.[0]?.fato === "Situação cadastral ATIVA registrada pela Receita Federal." &&
          e0?.fatos_existentes?.[0]?.data === COLETA_ISO &&
          e0?.cnpj_raiz === RAIZ_CONSULTADA,
        JSON.stringify(e0).slice(0, 240)
      );
    } else {
      check("C8-B.15 TRIAGEM_V1: fato/estado/data com literais independentes", false);
    }
  } finally {
    await db.quadroParticipanteCache.deleteMany({ where: { participanteId: PF_HASH_1 } }).catch(() => undefined);
    await db.relacaoSocietariaCache.deleteMany({ where: { cnpj: CNPJ_CONSULTADA } }).catch(() => undefined);
    await db.importRow.deleteMany({ where: { batchId: batch.id } }).catch(() => undefined);
    await db.importBatch.delete({ where: { id: batch.id } }).catch(() => undefined);
    for (const f of arquivosTmp) {
      try {
        unlinkSync(f);
      } catch {
        /* arquivo pode não existir — nada a fazer */
      }
    }
  }
}

/* ================================ resultado ================================ */
console.log(`\n============================================`);
console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.log("FALHAS:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
