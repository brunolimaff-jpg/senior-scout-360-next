/**
 * inteligencia.ts — LEITURAS COMERCIAIS DETERMINÍSTICAS (v0.10.23 — Entrega 5).
 *
 * Camada PURA entre os fatos já coletados (cadastro, relações de grafo, triagem)
 * e a leitura que o vendedor vê. Regras do contrato do operador:
 *  - Zero rede, zero IA, zero consulta: TUDO aqui lê estado que já existe.
 *  - Distingue RELAÇÃO por TIPO — nunca amontoa tudo como "conexões":
 *      · SOCIO_PESSOA_FISICA              — sócio pessoa física (quadro público);
 *      · SOCIO_PESSOA_JURIDICA            — participação societária direta de PJ;
 *      · ADMINISTRADOR                    — papel de administração registrado;
 *      · ESTABELECIMENTO_MESMA_PJ         — outro estabelecimento da MESMA
 *                                           pessoa jurídica (não é empresa distinta);
 *      · EMPRESA_COM_PARTICIPANTE_COMPARTILHADO — outra empresa investigada no
 *                                           lote com o mesmo participante;
 *      · RELACAO_NAO_CONFIRMADA           — vínculo registrado cujo tipo a fonte
 *                                           não permitiu confirmar.
 *  - NUNCA rotula sobreposição de quadro como "grupo econômico" (a única vez que
 *    o termo aparece é para NEGAR a conclusão).
 *  - NUNCA infere quem decide ("decisor", "controlador", "quem manda" ficam fora
 *    do vocabulário das leituras — administração registrada é um fato, não poder).
 *  - Só usa links JÁ PERSISTIDOS: o grafo (construirGrafoRelacoes) consome as
 *    relações consultadas e os quadros expandidos por comando (cache local).
 */

import { ESTADO_LACUNA_COMERCIAL, plural, regimeTributarioLegivel, tipoParticipanteLegivel } from "@/lib/linguagem";
import { formatCnpj } from "@/lib/cnpj";
import type { ParticipanteView, RelacoesView, QuadroView, RowDetail, TriagemLinhaView } from "@/lib/types";
import { raizDe } from "@/lib/relations/grafo";

/* ============================== LEITURA DE RELAÇÕES ============================== */

export type TipoRelacao =
  | "SOCIO_PESSOA_FISICA"
  | "SOCIO_PESSOA_JURIDICA"
  | "ADMINISTRADOR"
  | "ESTABELECIMENTO_MESMA_PJ"
  | "EMPRESA_COM_PARTICIPANTE_COMPARTILHADO"
  | "RELACAO_NAO_CONFIRMADA";

export interface LeituraRelacaoGrupo {
  tipo: TipoRelacao;
  rotulo: string;
  /** explicação honesta do que o grupo significa (e do que NÃO significa) */
  descricao: string;
  /** nomes públicos dos participantes (ou razões sociais) do grupo */
  nomes: string[];
}

export interface LeituraRelacoes {
  grupos: LeituraRelacaoGrupo[];
  /** frase-resumo em português natural (usada na ficha e no PDF futuro) */
  resumo: string;
  totalParticipantes: number;
}

/** O termo "grupo econômico" só existe no produto para NEGAR a conclusão. */
export const AVISO_GRUPO_ECONOMICO =
  "Participante comum ou sobreposição de quadro NÃO caracteriza grupo econômico.";

/** Administração registrada é um fato do cadastro; nunca é leitura de poder. */
export const AVISO_ADMINISTRACAO =
  "O papel de administração é um registro do quadro público. Ele não indica, por si só, quem decide pela empresa.";

/** limite de nomes listados por grupo (o total real segue na contagem) */
const TETO_NOMES_GRUPO = 6;

const ROTULO_RELACAO: Record<TipoRelacao, string> = {
  SOCIO_PESSOA_FISICA: "Sócios pessoas físicas",
  SOCIO_PESSOA_JURIDICA: "Sócios pessoas jurídicas",
  ADMINISTRADOR: "Papel de administração registrado",
  ESTABELECIMENTO_MESMA_PJ: "Estabelecimentos da mesma empresa",
  EMPRESA_COM_PARTICIPANTE_COMPARTILHADO: "Empresas com participante compartilhado",
  RELACAO_NAO_CONFIRMADA: "Relações não confirmadas",
};

const DESCRICAO_RELACAO: Record<TipoRelacao, string> = {
  SOCIO_PESSOA_FISICA:
    "Pessoas físicas registradas no quadro societário público desta empresa. Nenhum CPF é armazenado ou exibido.",
  SOCIO_PESSOA_JURIDICA:
    "Pessoas jurídicas com participação societária direta registrada no quadro público desta empresa.",
  ADMINISTRADOR:
    "Participantes cujo registro público traz papel de administração (sócio-administrador ou administrador).",
  ESTABELECIMENTO_MESMA_PJ:
    "O participante também figura no quadro de outro estabelecimento da MESMA raiz de CNPJ. É a mesma pessoa jurídica, não uma empresa distinta.",
  EMPRESA_COM_PARTICIPANTE_COMPARTILHADO:
    "Empresas já investigadas neste lote que têm o mesmo participante nos quadros públicos.",
  RELACAO_NAO_CONFIRMADA:
    "A fonte registrou o vínculo sem entregar identificador que confirme o tipo do participante. O vínculo vale; o tipo fica em aberto.",
};

/** qualificação indica papel de administração? ("Sócio-Administrador", "Administrador", "Diretor") */
export function qualificaAdministracao(qual: string | null | undefined): boolean {
  if (!qual) return false;
  return /administrador|diretor|presidente|conselho/i.test(qual);
}

/** Lê as relações consultadas e separa por tipo. Determinístico; aceita view ausente. */
export function lerRelacoes(view: RelacoesView | null): LeituraRelacoes {
  if (!view || view.totalParticipantes === 0) {
    return { grupos: [], resumo: "Nenhum participante registrado no quadro público consultado.", totalParticipantes: 0 };
  }

  const sociosPf: string[] = [];
  const sociosPj: string[] = [];
  const administradores: string[] = [];
  const naoConfirmados: string[] = [];
  const mesmaPjCnpjs = new Map<string, string>();
  const compartilhadasCnpjs = new Map<string, string>();

  for (const p of view.participantes) {
    if (p.tipo === "PF") {
      sociosPf.push(p.nomePublico);
      if (qualificaAdministracao(p.qualificacao?.qual)) administradores.push(p.nomePublico);
    } else if (p.tipo === "PJ") {
      sociosPj.push(p.razaoSocialPj ?? p.nomePublico);
    } else {
      naoConfirmados.push(p.nomePublico);
    }
    for (const c of p.comumMesmaPj) if (!mesmaPjCnpjs.has(c.cnpj)) mesmaPjCnpjs.set(c.cnpj, formatCnpj(c.cnpj));
    for (const c of p.comumCom) if (!compartilhadasCnpjs.has(c.cnpj)) compartilhadasCnpjs.set(c.cnpj, c.razaoSocial ?? formatCnpj(c.cnpj));
  }

  const grupos: LeituraRelacaoGrupo[] = [];
  const push = (tipo: TipoRelacao, nomes: string[]) => {
    if (nomes.length === 0) return;
    grupos.push({ tipo, rotulo: ROTULO_RELACAO[tipo], descricao: DESCRICAO_RELACAO[tipo], nomes: nomes.slice(0, TETO_NOMES_GRUPO) });
  };
  push("SOCIO_PESSOA_FISICA", sociosPf);
  push("SOCIO_PESSOA_JURIDICA", sociosPj);
  push("ADMINISTRADOR", administradores);
  push("ESTABELECIMENTO_MESMA_PJ", [...mesmaPjCnpjs.values()]);
  push("EMPRESA_COM_PARTICIPANTE_COMPARTILHADO", [...compartilhadasCnpjs.values()]);
  push("RELACAO_NAO_CONFIRMADA", naoConfirmados);

  // frase-resumo: só os tipos centrais com contagem natural (o detalhe fica nos grupos)
  const partes: string[] = [];
  if (sociosPf.length) partes.push(plural(sociosPf.length, "sócio pessoa física", "sócios pessoas físicas"));
  if (sociosPj.length) partes.push(plural(sociosPj.length, "participação de pessoa jurídica", "participações de pessoas jurídicas"));
  if (naoConfirmados.length) partes.push(plural(naoConfirmados.length, "relação não confirmada", "relações não confirmadas"));
  const resumo =
    partes.length > 0
      ? `O quadro público consultado registra ${partes.join(", ").replace(/, ([^,]*)$/, " e $1")}.`
      : `O quadro público consultado registra ${plural(view.totalParticipantes, "participante", "participantes")}.`;

  return { grupos, resumo, totalParticipantes: view.totalParticipantes };
}

/* ============================== GRAFO LEVE (SVG) ============================== */

export type NoGrafoTipo =
  | "empresa"
  | "participante-pf"
  | "participante-pj"
  | "participante-indeterminado"
  | "empresa-quadro"
  | "empresa-compartilhada"
  | "agregado";

export interface NoGrafo {
  id: string;
  tipo: NoGrafoTipo;
  /** rótulo curto para o desenho (a interface trunca de forma determinística) */
  rotulo: string;
  /** nome completo para leitor de tela e tooltip */
  nomeCompleto: string;
  subtitulo?: string;
  nivel: 0 | 1 | 2;
}

export type ArestaGrafoTipo = "participacao" | "quadro" | "mesma-empresa" | "compartilhado";

export interface ArestaGrafo {
  de: string;
  para: string;
  tipo: ArestaGrafoTipo;
  /** frase honesta da ligação (tooltip e leitor de tela) */
  rotulo: string;
}

export interface GrafoRelacoes {
  raiz: NoGrafo;
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  resumo: string;
  /** proveniência mínima: de onde veio cada ligação de nível 2 (quadro em cache) */
  quadrosUsados: { participante: string; empresas: number; coletadoEm: string }[];
}

/** tetos de desenho — o total real segue na leitura e nos avisos */
export const GRAFO_TETO_PARTICIPANTES = 8;
export const GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE = 2;

/** Cria um nó de empresa com rótulo curto determinístico (sem medir texto). */
function noEmpresa(
  id: string,
  nome: string | null,
  cnpj: string,
  tipo: NoGrafoTipo,
  nivel: 2,
  subtitulo?: string
): NoGrafo {
  const nomeCompleto = nome ?? `CNPJ ${formatCnpj(cnpj)}`;
  return {
    id,
    tipo,
    rotulo: truncar(nomeCompleto, 26),
    nomeCompleto,
    subtitulo: subtitulo ?? formatCnpj(cnpj),
    nivel,
  };
}

/** Trunca de forma determinística com reticência (mesmo resultado no servidor e no cliente). */
export function truncar(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Constrói a estrutura do mapa de relações a partir de links JÁ PERSISTIDOS:
 *  - relações diretas (relacaoSocietariaCache — via RelacoesView);
 *  - quadros expandidos por comando (quadroParticipanteCache — via quadros).
 * Estabelecimentos da MESMA raiz da empresa consultada viram aresta
 * "mesma-empresa" para a raiz (nunca um nó duplicado da própria empresa).
 * Entradas do quadro cujo CNPJ é o próprio participante PJ são ignoradas
 * (auto-referência do registro, não é ligação nova).
 */
export function construirGrafoRelacoes(
  view: RelacoesView,
  quadros: Record<string, QuadroView>
): GrafoRelacoes {
  const raizConsultada = raizDe(view.cnpj);
  const raiz: NoGrafo = {
    id: "raiz",
    tipo: "empresa",
    rotulo: truncar(view.razaoSocialConsultada ?? formatCnpj(view.cnpj), 30),
    nomeCompleto: view.razaoSocialConsultada ?? `CNPJ ${formatCnpj(view.cnpj)}`,
    subtitulo: formatCnpj(view.cnpj),
    nivel: 0,
  };

  const nos: NoGrafo[] = [];
  const arestas: ArestaGrafo[] = [];
  const quadrosUsados: GrafoRelacoes["quadrosUsados"] = [];
  const criados = new Set<string>();

  const participantesOrdenados = [...view.participantes].sort(
    (a, b) => b.comumCom.length + b.comumMesmaPj.length - (a.comumCom.length + a.comumMesmaPj.length)
  );

  let cortadosParticipantes = 0;
  participantesOrdenados.forEach((p, indice) => {
    if (indice >= GRAFO_TETO_PARTICIPANTES) {
      cortadosParticipantes += 1;
      return;
    }
    const tipoNo: NoGrafoTipo = p.tipo === "PF" ? "participante-pf" : p.tipo === "PJ" ? "participante-pj" : "participante-indeterminado";
    const idNo = `p:${p.participanteId}`;
    if (!criados.has(idNo)) {
      criados.add(idNo);
      nos.push({
        id: idNo,
        tipo: tipoNo,
        rotulo: truncar(p.nomePublico, 26),
        nomeCompleto: `${p.nomePublico} (${tipoParticipanteLegivel(p.tipo)})`,
        subtitulo: p.cnpjParticipante ? formatCnpj(p.cnpjParticipante) : undefined,
        nivel: 1,
      });
    }
    arestas.push({
      de: "raiz",
      para: idNo,
      tipo: "participacao",
      rotulo:
        p.tipo === "PJ"
          ? "Participação societária direta registrada no quadro público."
          : p.tipo === "PF"
            ? "Sócio registrado no quadro público."
            : "Relação registrada no quadro público, tipo não confirmado pela fonte.",
    });

    // nível 2 — quadro já expandido (link persistido) OU sobreposições já calculadas
    const quadro = quadros[p.participanteId];
    const candidatas: { no: NoGrafo; aresta: ArestaGrafo }[] = [];
    let ocultasQuadro = 0;

    if (quadro && quadro.empresas.length > 0) {
      const porRaiz = new Map<string, { cnpjs: string[]; nome: string | null }>();
      for (const e of quadro.empresas) {
        if (p.tipo === "PJ" && e.cnpj.toUpperCase() === p.participanteId.toUpperCase()) continue; // auto-referência
        const r = raizDe(e.cnpj);
        const g = porRaiz.get(r) ?? { cnpjs: [], nome: e.razaoSocial };
        if (!g.nome && e.razaoSocial) g.nome = e.razaoSocial;
        g.cnpjs.push(e.cnpj);
        porRaiz.set(r, g);
      }
      const raizes = [...porRaiz.entries()];
      const visiveis = raizes.slice(0, GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE);
      ocultasQuadro = Math.max(0, raizes.length - visiveis.length);
      for (const [r, g] of visiveis) {
        if (r === raizConsultada) {
          // mesma pessoa jurídica: aresta para a raiz, sem nó duplicado
          candidatas.push({
            no: raiz,
            aresta: {
              de: idNo,
              para: "raiz",
              tipo: "mesma-empresa",
              rotulo: "O participante também figura no quadro de outro estabelecimento da MESMA pessoa jurídica.",
            },
          });
        } else {
          const id = `q:${p.participanteId}:${r}`;
          if (criados.has(id)) continue;
          candidatas.push({
            no: noEmpresa(id, g.nome, g.cnpjs[0], "empresa-quadro", 2, g.cnpjs.length > 1 ? `${plural(g.cnpjs.length, "estabelecimento", "estabelecimentos")} desta empresa` : formatCnpj(g.cnpjs[0])),
            aresta: {
              de: idNo,
              para: id,
              tipo: "quadro",
              rotulo:
                p.tipo === "PF"
                  ? "Empresa em que o participante figura no quadro societário público (consulta já feita)."
                  : "Empresa registrada no quadro público do participante (consulta já feita).",
            },
          });
        }
      }
      if (ocultasQuadro > 0) {
        const id = `agg:${p.participanteId}`;
        candidatas.push({
          no: {
            id,
            tipo: "agregado",
            rotulo: `+${ocultasQuadro} outras`,
            nomeCompleto: `Mais ${plural(ocultasQuadro, "empresa distinta", "empresas distintas")} no quadro deste participante (exibição limitada).`,
            nivel: 2,
          },
          aresta: {
            de: idNo,
            para: id,
            tipo: "quadro",
            rotulo: `A consulta deste quadro registrou mais ${plural(ocultasQuadro, "empresa distinta", "empresas distintas")}.`,
          },
        });
      }
      quadrosUsados.push({ participante: p.nomePublico, empresas: quadro.totalEmpresas, coletadoEm: quadro.coletadoEm });
    }

    // empresas compartilhadas (participante comum com outra raiz do lote) — sem quadro, já é link calculado
    for (const c of p.comumCom.slice(0, Math.max(0, GRAFO_TETO_EMPRESAS_POR_PARTICIPANTE - candidatas.filter((c2) => c2.aresta.tipo === "quadro").length))) {
      const r = raizDe(c.cnpj);
      const id = `c:${r}`;
      if (criados.has(id)) continue;
      candidatas.push({
        no: noEmpresa(id, c.razaoSocial, c.cnpj, "empresa-compartilhada", 2, formatCnpj(c.cnpj)),
        aresta: {
          de: idNo,
          para: id,
          tipo: "compartilhado",
          rotulo: "Mesmo participante nos quadros públicos das duas empresas. NÃO caracteriza grupo econômico.",
        },
      });
    }
    for (const c of p.comumMesmaPj) {
      candidatas.push({
        no: raiz,
        aresta: {
          de: idNo,
          para: "raiz",
          tipo: "mesma-empresa",
          rotulo: "O participante também figura no quadro de outro estabelecimento da MESMA pessoa jurídica.",
        },
      });
    }

    for (const c of candidatas) {
      if (c.no !== raiz && !criados.has(c.no.id)) {
        criados.add(c.no.id);
        nos.push(c.no);
      }
      // evita aresta duplicada exatamente igual (mesma origem/destino/tipo)
      if (!arestas.some((a) => a.de === c.aresta.de && a.para === c.aresta.para && a.tipo === c.aresta.tipo)) {
        arestas.push(c.aresta);
      }
    }
  });

  const resumo = `O mapa usa só ligações já persistidas: ${plural(view.totalParticipantes, "participante", "participantes")} do quadro consultado${
    quadrosUsados.length > 0 ? ` e ${plural(quadrosUsados.length, "quadro expandido", "quadros expandidos")} por comando` : ""
  }.`;

  return { raiz, nos, arestas, resumo, quadrosUsados };
}

/**
 * Portão do experimento controlado: o mapa só existe quando diz algo ALÉM da
 * lista — ligação de nível 2 (quadro expandido), sobreposição com outra raiz ou
 * com a mesma raiz. Uma estrela raiz→participantes é decoração (a lista já diz
 * isso) e o mapa NÃO aparece.
 */
export function grafoTemValor(g: GrafoRelacoes): boolean {
  return g.arestas.some((a) => a.tipo !== "participacao");
}

/* ============================== PRÓXIMO MOVIMENTO ============================== */

export type SecaoMovimentoId = "sabemos" | "validar" | "naoEncontramos" | "investigar";

export interface SecaoMovimento {
  id: SecaoMovimentoId;
  titulo: string;
  descricao: string;
  itens: string[];
}

export interface ProximoMovimento {
  secoes: SecaoMovimento[];
  /** nota de rodapé: a leitura é determinística e não consulta nada */
  nota: string;
}

const TETOS: Record<SecaoMovimentoId, number> = { sabemos: 4, validar: 4, naoEncontramos: 3, investigar: 4 };

const DESCRICAO_SECAO: Record<SecaoMovimentoId, string> = {
  sabemos: "Fatos já confirmados por fonte apropriada, com data da coleta.",
  validar: "Pontos que merecem conferência antes de usar em conversa ou proposta.",
  naoEncontramos: "Perguntas que o registro público consultado ainda não respondeu.",
  investigar: "Consultas disponíveis nesta ficha, sempre sob o seu comando.",
};

/**
 * Monta a leitura "Próximo movimento" a partir dos fatos da linha e da triagem
 * (opcional — quando ainda não foi calculada, as seções ficam só com o cadastro).
 * Determinístico, zero rede, zero IA.
 */
export function montarProximoMovimento(r: RowDetail, triagem: TriagemLinhaView | null): ProximoMovimento {
  const sabemos: string[] = [];
  const validar: string[] = [];
  const naoEncontramos: string[] = [];
  const investigar: string[] = [];

  const enriquecido = r.lookupStatus === "ENRIQUECIDO" && !!r.legalName;

  if (enriquecido) {
    sabemos.push(`Registro localizado na fonte oficial: ${r.legalName}${r.normalizedCnpj ? ` (CNPJ ${formatCnpj(r.normalizedCnpj)})` : ""}.`);
    if (r.registrationStatus === "ATIVA") sabemos.push("Situação cadastral ATIVA no registro público.");
    if (r.municipality && r.uf) sabemos.push(`Endereço registrado em ${r.municipality} - ${r.uf}.`);
    if (r.cnaeDescription) sabemos.push(`Atividade principal registrada: ${truncar(r.cnaeDescription, 90)}.`);
    if (r.branchType === "MATRIZ") sabemos.push("O CNPJ consultado é a matriz da empresa.");
    else if (r.branchType === "FILIAL" && r.headquartersCnpj) sabemos.push(`O CNPJ consultado é uma filial da mesma empresa (matriz ${formatCnpj(r.headquartersCnpj)}).`);
    if (r.socios.length > 0) sabemos.push(`${plural(r.socios.length, "representante registrado", "representantes registrados")} no quadro societário público (QSA).`);
  }

  // identidade — o estágio e as divergências já calculados pelo motor de resolução
  if (r.identityStage === "VALIDADO") {
    sabemos.push("Você validou a identidade desta empresa na revisão.");
  } else if (r.identityStage === "LOCALIZADO") {
    const divs = (r.identityDivergencias ?? []).filter((d) => d.severidade === "ALTA").slice(0, 2);
    if (divs.length > 0) for (const d of divs) validar.push(d.descricao);
    else validar.push("O registro foi localizado, mas nada nesta linha prova que é a empresa pretendida. Confirme a identidade antes de usar.");
  }
  for (const d of (r.identityDivergencias ?? []).filter((d) => d.severidade === "BAIXA").slice(0, 1)) {
    validar.push(d.descricao);
  }

  if (enriquecido && r.registrationStatus && r.registrationStatus !== "ATIVA") {
    validar.push(`Situação cadastral "${r.registrationStatus}" registrada na fonte. Confirme com a empresa antes de avançar.`);
  }

  const regime = regimeTributarioLegivel(r.extra?.regimeTributario);
  if (regime) validar.push(`Regime tributário registrado (${regime.valor}). ${regime.nota}`);

  // triagem — lacunas classificadas sobre os fatos já coletados
  if (triagem) {
    const porEstado = (estado: string) => triagem.lacunas.filter((l) => l.estado === estado);
    for (const l of porEstado("VALIDACAO_HUMANA").slice(0, 2)) {
      validar.push(`${l.pergunta}: ${l.proximaVerificacao ?? ESTADO_LACUNA_COMERCIAL.VALIDACAO_HUMANA}`);
    }
    for (const l of porEstado("PESQUISA_DOCUMENTAL").slice(0, 2)) {
      naoEncontramos.push(`${l.pergunta} — não consta no registro consultado.`);
    }
    for (const l of porEstado("INDISPONIVEL").slice(0, 1)) {
      naoEncontramos.push(`${l.pergunta} — a consulta não concluiu; pode ser tentada de novo na ficha.`);
    }
    for (const l of porEstado("COMPLEMENTAR_API").slice(0, 3)) {
      investigar.push(`${l.pergunta}: ${ESTADO_LACUNA_COMERCIAL.COMPLEMENTAR_API}`);
    }
  }

  // contatos ausentes (fato da coleta, não ausência de consulta)
  const temEmail = !!r.extra?.email;
  const temTelefone = !!r.extra?.telefone || !!r.extra?.telefone2;
  if (enriquecido && !temEmail && !temTelefone) {
    naoEncontramos.push("Nenhum contato público (e-mail, telefone) consta no registro coletado.");
  }

  const cortar = (arr: string[], teto: number) => arr.slice(0, teto);
  const secoesBase: SecaoMovimento[] = [
    { id: "sabemos", titulo: "O que sabemos", descricao: DESCRICAO_SECAO.sabemos, itens: cortar(sabemos, TETOS.sabemos) },
    { id: "validar", titulo: "O que merece validação", descricao: DESCRICAO_SECAO.validar, itens: cortar(validar, TETOS.validar) },
    { id: "naoEncontramos", titulo: "O que ainda não encontramos", descricao: DESCRICAO_SECAO.naoEncontramos, itens: cortar(naoEncontramos, TETOS.naoEncontramos) },
    { id: "investigar", titulo: "O que vale investigar agora", descricao: DESCRICAO_SECAO.investigar, itens: cortar(investigar, TETOS.investigar) },
  ];
  const secoes = secoesBase.filter((s) => s.itens.length > 0);

  return {
    secoes,
    nota: "Leitura feita sobre os dados já coletados. Nenhuma consulta nova acontece aqui.",
  };
}
