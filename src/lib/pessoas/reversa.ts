/**
 * pessoas/reversa.ts — INVESTIGAÇÃO REVERSA DE PESSOAS (v0.11.1, Gate 4).
 *
 * Leitura PURA dos caches já persistidos (RelacaoSocietariaCache por CNPJ +
 * QuadroParticipanteCache por participanteId): ZERO consulta externa, ZERO IA.
 * A agregação não cria entidades novas — organiza o que já foi coletado sob
 * comando do operador.
 *
 * Regras do contrato (inalteráveis):
 * - Identidade da pessoa = participanteId da fonte (hash opaco de PF, CNPJ de
 *   PJ). Nomes iguais NUNCA são unidos: homônimos ficam separados e contados.
 * - Raiz de CNPJ distinta = PESSOAS JURÍDICAS distintas; CNPJ completo =
 *   estabelecimento. Os dois números nunca se somam nem se confundem.
 * - Papel registrado por IDENTIFICADOR (aparece na relação daquele CNPJ) é
 *   distinto de papel ASSOCIADO POR NOME no cadastro (qualificação casada
 *   nominalmente — nunca confirmado por identificador).
 * - Quadro não ampliado é cobertura honesta: conta como não ampliado, nunca
 *   como "sem vínculos".
 * - Nenhum CPF é lido, armazenado ou exportado aqui.
 */
import { db } from "@/lib/db";
import { formatCnpj } from "@/lib/cnpj";
import { plural } from "@/lib/linguagem";
import { contarPessoasJuridicas, QUADRO_TETO_EXIBICAO, type EmpresaQuadro } from "@/lib/relations/grafo";
import type { QuadroView } from "@/lib/types";

export interface PapelReversaView {
  /** empresa do lote onde o papel está registrado */
  rowNumber: number;
  cnpjFormatado: string;
  razaoSocial: string | null;
  /** papel conforme o quadro público */
  papel: string;
  /** papel associado POR NOME no cadastro — não confirmado por identificador */
  papelPorNome: boolean;
  desde: string | null;
}

export interface PessoaReversaView {
  participanteId: string;
  tipo: "PF" | "PJ" | "INDETERMINADO";
  nomePublico: string;
  cnpjParticipanteFormatado: string | null;
  /** empresas DO LOTE cuja relação consultada contém esta pessoa (por identificador) */
  empresasNoLote: { rowNumber: number; cnpjFormatado: string; razaoSocial: string | null }[];
  /** papéis registrados, com a origem honesta (identificador × nome) */
  papeis: PapelReversaView[];
  /** quadro ampliado em cache — null = ainda não foi ampliado (cobertura honesta) */
  quadro: QuadroView | null;
  /** raízes de CNPJ distintas conectadas a esta pessoa (quadro + lote) */
  raizesDistintas: number;
  /** estabelecimentos (CNPJs completos) distintos citados nos quadros */
  estabelecimentosCitados: number;
  /** outros participantes DO MESMO LOTE com nome público igual — nunca unidos */
  homonimosNoLote: number;
  identidadeIncerta: boolean;
}

export interface ResumoReversaView {
  /** empresas do lote com relações já coletadas */
  linhasComRelacoes: number;
  /** pessoas efetivamente identificadas (hash próprio da fonte) */
  pfIdentificadas: number;
  /** participantes com identidade incerta (a fonte não prova PF nem PJ) */
  participantesIncertos: number;
  /** participações de pessoa jurídica (CNPJ com DV válido) */
  pjParticipacoes: number;
  /** papéis registrados (aparecem na relação daquele CNPJ) */
  papeisRegistrados: number;
  /** papéis cuja qualificação só existe por correspondência nominal — não confirmados */
  papeisPorNomeNaoConfirmados: number;
  /** cobertura da investigação: quadros ampliados × participantes */
  cobertura: { participantesTotal: number; quadrosAmpliados: number };
  nota: string;
}

/** Avisos de quadro rederiváveis — MESMA regra do service de relações. */
function avisosDeCache(truncado: boolean, totalEmpresas: number, avisosJson: string | null): string[] {
  if (avisosJson) {
    try {
      const parsed = JSON.parse(avisosJson) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((a): a is string => typeof a === "string");
    } catch {
      /* fallback determinístico abaixo — nada inventado */
    }
  }
  return truncado ? [`Quadro com ${totalEmpresas} empresas — armazenamento limitado (total real preservado).`] : [];
}

function quadroDeCache(
  c: {
    participanteId: string;
    tipoParticipante: string;
    rotulo: string | null;
    empresasJson: string;
    totalEmpresas: number;
    truncado: boolean;
    fonte: string;
    coletadoEm: Date;
    validoAte: Date;
    avisosJson: string | null;
  },
  /** PF/INDETERMINADO: o quadro é "onde a pessoa aparece" e entra na cobertura;
   *  PJ: o quadro é o quadro de SÓCIOS do participante — não vira "empresas dele". */
  contaParaCobertura: boolean,
): { quadro: QuadroView; raizesDoQuadro: Set<string>; estabelecimentosDoQuadro: Set<string>; armazenamentoTruncado: boolean } | null {
  let empresas: EmpresaQuadro[] = [];
  try {
    empresas = JSON.parse(c.empresasJson) as EmpresaQuadro[];
  } catch {
    return null; // cache ilegível não vira erro — leitura pura
  }
  const visiveis = empresas.slice(0, QUADRO_TETO_EXIBICAO);
  // v0.11.2 (UX): cobertura computada do QUADRO COMPLETO (o cache guarda todas as
  // empresas quando o armazenamento não truncou) — antes as contagens do topo do
  // dossiê usavam só o recorte de EXIBIÇÃO (teto 50): 255 citados na fonte
  // apareciam como "51 estabelecimentos citados". Quando o armazenamento truncou,
  // os sets são parciais — e o UI declara o teto (nunca apresenta como total).
  const raizesDoQuadro = new Set<string>();
  const estabelecimentosDoQuadro = new Set<string>();
  if (contaParaCobertura) {
    for (const e of empresas) {
      const dig = (e.cnpj || "").replace(/\D/g, "");
      if (dig) {
        raizesDoQuadro.add(dig.slice(0, 8));
        estabelecimentosDoQuadro.add(dig);
      }
    }
  }
  return {
    quadro: {
      ok: true,
      participanteId: c.participanteId,
      tipoParticipante: c.tipoParticipante as QuadroView["tipoParticipante"],
      rotulo: c.rotulo,
      leitura:
        c.tipoParticipante === "PF"
          ? "Encontramos as empresas em que este participante aparece no quadro societário público. A fonte pública cobre parte dos vínculos."
          : "Encontramos o quadro de sócios público deste participante (participação de pessoa jurídica).",
      totalEmpresas: c.totalEmpresas,
      totalPessoasJuridicas: contarPessoasJuridicas(empresas),
      truncado: c.truncado,
      empresas: visiveis,
      empresasOcultas: Math.max(0, c.totalEmpresas - visiveis.length),
      fonte: c.fonte,
      coletadoEm: c.coletadoEm.toISOString(),
      validoAte: c.validoAte.toISOString(),
      via: "cache",
      avisos: avisosDeCache(c.truncado, c.totalEmpresas, c.avisosJson),
    },
    raizesDoQuadro,
    estabelecimentosDoQuadro,
    armazenamentoTruncado: c.truncado,
  };
}

export interface PessoasReversas {
  resumo: ResumoReversaView;
  pessoas: PessoaReversaView[];
}

/**
 * Agregação reversa do LOTE: cada pessoa (por participanteId) com suas
 * empresas no lote, papéis, quadro ampliado e contagens honestas.
 * Leitura pura: nenhum fetch, nenhuma consulta externa, nenhuma mutação.
 */
export async function lerPessoasReversas(batchId: string): Promise<PessoasReversas | null> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { id: true } });
  if (!batch) return null;

  const rows = await db.importRow.findMany({
    where: { batchId, normalizedCnpj: { not: "" } },
    select: { rowNumber: true, normalizedCnpj: true, legalName: true, resolvedCnpj: true },
    orderBy: { rowNumber: "asc" },
  });
  if (rows.length === 0) {
    return {
      resumo: {
        linhasComRelacoes: 0, pfIdentificadas: 0, participantesIncertos: 0, pjParticipacoes: 0,
        papeisRegistrados: 0, papeisPorNomeNaoConfirmados: 0,
        cobertura: { participantesTotal: 0, quadrosAmpliados: 0 },
        nota: "Nenhuma empresa deste lote tem relações coletadas ainda.",
      },
      pessoas: [],
    };
  }

  const rels = await db.relacaoSocietariaCache.findMany({
    where: { cnpj: { in: rows.map((r) => r.normalizedCnpj) } },
    select: { cnpj: true, relacoesJson: true, totalParticipantes: true, coletadoEm: true },
  });

  // por participante: onde aparece no lote + papéis (com origem honesta)
  interface Acumulo {
    tipo: "PF" | "PJ" | "INDETERMINADO";
    nomePublico: string;
    cnpjParticipante: string | null;
    empresasNoLote: PessoaReversaView["empresasNoLote"];
    papeis: PapelReversaView[];
  }
  const pessoas = new Map<string, Acumulo>();
  const nomePorId = new Map<string, string>();
  let linhasComRelacoes = 0;

  for (const rel of rels) {
    let lista: { participanteId?: unknown; tipo?: unknown; nomePublico?: unknown; cnpjParticipante?: unknown; qualificacao?: { qual?: unknown; entrada?: unknown } | null }[] = [];
    try {
      const parsed = JSON.parse(rel.relacoesJson) as unknown;
      if (Array.isArray(parsed)) lista = parsed as typeof lista;
    } catch {
      continue; // cache ilegível: pula esta linha (leitura pura)
    }
    if (lista.length > 0) linhasComRelacoes += 1;
    const linha = rows.find((r) => r.normalizedCnpj === rel.cnpj);
    if (!linha) continue;
    for (const p of lista) {
      const id = typeof p.participanteId === "string" ? p.participanteId : "";
      if (!id) continue;
      const tipo = p.tipo === "PF" || p.tipo === "PJ" ? p.tipo : "INDETERMINADO";
      const nome = typeof p.nomePublico === "string" ? p.nomePublico : "(sem nome público)";
      const cnpjP = typeof p.cnpjParticipante === "string" && p.cnpjParticipante ? p.cnpjParticipante : null;
      const qual = p.qualificacao && typeof p.qualificacao === "object" ? p.qualificacao : null;
      const papel = qual && typeof qual.qual === "string" ? qual.qual : "";
      const desde = qual && typeof qual.entrada === "string" ? qual.entrada : "";
      const acc = pessoas.get(id) ?? { tipo, nomePublico: nome, cnpjParticipante: cnpjP, empresasNoLote: [], papeis: [] };
      if (!acc.empresasNoLote.some((e) => e.rowNumber === linha.rowNumber)) {
        acc.empresasNoLote.push({
          rowNumber: linha.rowNumber,
          cnpjFormatado: formatCnpj(linha.resolvedCnpj || linha.normalizedCnpj),
          razaoSocial: linha.legalName || null,
        });
      }
      if (papel) {
        // ORIGEM HONESTA: a qualificação da FRENTE A vem do cadastro casado por
        // nome (qualificacaoDoCadastro) — a PRESENÇA na relação é por identificador
        // (hash/CNPJ), mas a QUALIFICAÇÃO casada nominalmente não é confirmação
        // do papel pelo identificador. Fica marcada como papelPorNome.
        acc.papeis.push({
          rowNumber: linha.rowNumber,
          cnpjFormatado: formatCnpj(linha.resolvedCnpj || linha.normalizedCnpj),
          razaoSocial: linha.legalName || null,
          papel,
          papelPorNome: true,
          desde: desde || null,
        });
      }
      pessoas.set(id, acc);
      nomePorId.set(id, nome.trim().toUpperCase());
    }
  }

  // homônimos no lote (mesmo nome público, identidade diferente) — contados, nunca unidos
  const contagemNomes = new Map<string, number>();
  for (const nome of nomePorId.values()) contagemNomes.set(nome, (contagemNomes.get(nome) ?? 0) + 1);

  // quadros ampliados (cache válido) para os participantes deste lote
  const ids = [...pessoas.keys()];
  const caches = ids.length > 0
    ? await db.quadroParticipanteCache.findMany({ where: { participanteId: { in: ids }, validoAte: { gt: new Date() } } })
    : [];
  const cachePorId = new Map(caches.map((c) => [c.participanteId, c]));

  const pessoasView: PessoaReversaView[] = [];
  let papeisRegistrados = 0;
  let papeisPorNomeNaoConfirmados = 0;
  let quadrosAmpliados = 0;
  for (const [id, acc] of pessoas) {
    const cache = cachePorId.get(id);
    const quadroInfo = cache ? quadroDeCache(cache, acc.tipo !== "PJ") : null;
    const quadro = quadroInfo?.quadro ?? null;
    if (quadro) quadrosAmpliados += 1;
    // v0.11.2: raízes/estabelecimentos do QUADRO COMPLETO (cache não truncado) ∪
    // empresas do lote ∪ (PJ: o próprio CNPJ). Com armazenamento truncado, os
    // sets cobrem os dados disponíveis e o UI declara o teto — nada inventado.
    const raizes = new Set<string>(quadroInfo?.raizesDoQuadro ?? []);
    const estabelecimentos = new Set<string>(quadroInfo?.estabelecimentosDoQuadro ?? []);
    for (const e of acc.empresasNoLote) {
      const cnpjDig = e.cnpjFormatado.replace(/\D/g, "");
      if (cnpjDig) {
        raizes.add(cnpjDig.slice(0, 8));
        estabelecimentos.add(cnpjDig);
      }
    }
    // PJ participante: o próprio CNPJ é a empresa que ela É (o quadro dela lista
    // os SÓCIOS dela — nunca empresas em que participa)
    if (acc.tipo === "PJ" && acc.cnpjParticipante) {
      const dig = acc.cnpjParticipante.replace(/\D/g, "");
      if (dig) {
        raizes.add(dig.slice(0, 8));
        estabelecimentos.add(dig);
      }
    }
    for (const p of acc.papeis) {
      papeisRegistrados += 1;
      if (p.papelPorNome) papeisPorNomeNaoConfirmados += 1;
    }
    pessoasView.push({
      participanteId: id,
      tipo: acc.tipo,
      nomePublico: acc.nomePublico,
      cnpjParticipanteFormatado: acc.cnpjParticipante ? formatCnpj(acc.cnpjParticipante) : null,
      empresasNoLote: acc.empresasNoLote.sort((a, b) => a.rowNumber - b.rowNumber),
      papeis: acc.papeis.sort((a, b) => a.rowNumber - b.rowNumber),
      quadro,
      raizesDistintas: raizes.size,
      estabelecimentosCitados: estabelecimentos.size,
      homonimosNoLote: Math.max(0, (contagemNomes.get(nomePorId.get(id) ?? "") ?? 1) - 1),
      identidadeIncerta: acc.tipo === "INDETERMINADO",
    });
  }
  pessoasView.sort((a, b) => b.empresasNoLote.length - a.empresasNoLote.length || a.nomePublico.localeCompare(b.nomePublico));

  const pf = pessoasView.filter((p) => p.tipo === "PF").length;
  const incertos = pessoasView.filter((p) => p.tipo === "INDETERMINADO").length;
  const resumo: ResumoReversaView = {
    linhasComRelacoes,
    pfIdentificadas: pf,
    participantesIncertos: incertos,
    pjParticipacoes: pessoasView.filter((p) => p.tipo === "PJ").length,
    papeisRegistrados,
    papeisPorNomeNaoConfirmados,
    cobertura: { participantesTotal: pessoasView.length, quadrosAmpliados },
    nota:
      pessoasView.length === 0
        ? "Nenhuma pessoa registrada nas relações coletadas deste lote."
        : `${plural(pf, "pessoa identificada", "pessoas identificadas")}, ${plural(incertos, "participante", "participantes")} com identidade incerta, ${plural(quadrosAmpliados, "quadro ampliado", "quadros ampliados")} de ${plural(pessoasView.length, "participante", "participantes")}.`,
  };
  return { resumo, pessoas: pessoasView };
}

/** UMA pessoa (por participanteId) com o mesmo contrato da agregação do lote. */
export async function lerPessoaReversa(batchId: string, participanteId: string): Promise<PessoaReversaView | null> {
  const tudo = await lerPessoasReversas(batchId);
  if (!tudo) return null;
  return tudo.pessoas.find((p) => p.participanteId === participanteId) ?? null;
}
