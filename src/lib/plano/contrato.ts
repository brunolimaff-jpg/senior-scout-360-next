/**
 * contrato.ts — PLANO_CONSULTAS_V1: artefato versionado do planejador de consultas (P4).
 *
 * Princípios do despacho (PROPOSTA-P4, v0.10.9):
 *  - O planejador PROPUÕE um plano; NADA executa sem comando explícito do operador.
 *  - Zero IA: a seleção é determinística — só lacunas COMPLEMENTAR_API da triagem
 *    (fonte estruturada aplicável ainda não esgotada) viram item de consulta.
 *  - A unidade é a LACUNA, não a empresa: um item = UMA pergunta de UMA entidade.
 *  - Mesmo espírito do TRIAGEM_V1: neutro, versionado, validado por esquema (zod),
 *    sem SDK/endpoint/token de consumidor externo. Exportação só por ação explícita.
 *  - Proveniência preservada no artefato (fonte_tecnica) e linguagem comercial na
 *    superfície (fonte_candidata = categoria da camada de apresentação, v0.10.8).
 *  - Nada aqui dispara chamada: este arquivo só DESCREVE e VALIDA o plano.
 */
import { z } from "zod";
import { sanitizarEntrada } from "@/lib/triage/contrato";

export const PLANO_CONSULTAS_VERSAO = "PLANO_CONSULTAS_V1";

/** Comandos do EXECUTOR EXISTENTE — nenhum executor novo (despacho §4):
 *  investigar_relacoes_societarias → POST /api/imports/:id/rows/:n/relacoes-societarias
 *  investigar_estabelecimentos_raiz → POST /api/imports/:id/rows/:n/matriz-filiais
 *  revalidar_ficha → POST /api/imports/:id/rows/:n/revalidate */
export const COMANDOS_EXECUTOR = ["investigar_relacoes_societarias", "investigar_estabelecimentos_raiz", "revalidar_ficha"] as const;
export type ComandoExecutor = (typeof COMANDOS_EXECUTOR)[number];

export const PLANO_ITEM = z.object({
  cnpj_completo: z.string().min(1),
  cnpj_raiz: z.string().min(1),
  linha: z.number().int().min(1),
  pergunta_id: z.string().min(1),
  pergunta: z.string().min(1),
  estado_triagem_origem: z.literal("COMPLEMENTAR_API"),
  /** categoria da camada de apresentação (língua comercial, v0.10.8) */
  fonte_candidata: z.string().min(1),
  /** proveniência técnica do artefato (mesmo regime do TRIAGEM_V1) */
  fonte_tecnica: z.string().min(1),
  /** contadas, nunca estimadas a dedo (despacho §3): descoberta=1; confirmações =
   *  pendências contadas do cache; revalidação = até 4 (nota) */
  chamadas_estimadas: z.number().int().min(0),
  chamadas_nota: z.string().nullable(),
  cache_reutilizavel: z.boolean(),
  bloqueios_ativos: z.array(
    z.object({
      fonte: z.string(),
      tipo: z.string(),
      data: z.string().nullable(),
    })
  ),
  comando_executor: z.enum(COMANDOS_EXECUTOR),
  o_que_resolve: z.string().min(1),
  o_que_nao_resolve: z.string().min(1),
});

export const PLANO_FORA_ESCOPE = z.object({
  cnpj_completo: z.string().nullable(),
  cnpj_raiz: z.string().nullable(),
  linha: z.number().int().min(1),
  pergunta_id: z.string().min(1),
  estado_triagem: z.enum(["RESOLVIDO", "COMPLEMENTAR_API", "PESQUISA_DOCUMENTAL", "VALIDACAO_HUMANA", "INDISPONIVEL", "NAO_APLICAVEL"]),
  motivo: z.string().min(1),
});

export const PLANO_CONSULTAS = z.object({
  versao_contrato: z.literal("PLANO_CONSULTAS_V1"),
  geradoEm: z.string().min(1),
  lote: z.object({
    id: z.string(),
    arquivo: z.string().nullable(),
  }),
  resumo: z.object({
    itens: z.number().int().min(0),
    chamadas_totais: z.number().int().min(0),
    por_fonte: z.array(
      z.object({
        fonte: z.string(),
        itens: z.number().int().min(0),
        chamadas: z.number().int().min(0),
      })
    ),
    fora_do_escopo: z.number().int().min(0),
    bloqueados: z.number().int().min(0),
  }),
  itens: z.array(PLANO_ITEM),
  /** VALIDACAO_HUMANA / PESQUISA_DOCUMENTAL / INDISPONIVEL e COMPLEMENTAR_API sem
   *  comando único — listados por TRANSPARÊNCIA; NUNCA viram item de consulta. */
  fora_do_escopo_api: z.array(PLANO_FORA_ESCOPE),
  gate: z.object({
    ia: z.literal(0),
    busca_web: z.literal(0),
    execucao_automatica: z.literal(false),
  }),
});

export type PlanoItem = z.infer<typeof PLANO_ITEM>;
export type PlanoForaEscopo = z.infer<typeof PLANO_FORA_ESCOPE>;
export type PlanoConsultasV1 = z.infer<typeof PLANO_CONSULTAS>;

export type ValidacaoPlano =
  | { ok: true; plano: PlanoConsultasV1 }
  | { ok: false; erros: string[] };

/** Valida o plano contra o schema — nada é publicado/exportado sem passar aqui. */
export function validarPlano(entrada: unknown): ValidacaoPlano {
  const r = PLANO_CONSULTAS.safeParse(entrada);
  if (r.success) return { ok: true, plano: r.data };
  const erros = r.error.issues.map((iss) => `${iss.path.join(".") || "(raiz)"}: ${iss.message}`);
  return { ok: false, erros };
}

/** Sanitiza TODAS as strings do plano (defesa em profundidade — mesma da triagem). */
export function sanitizarPlano<T>(plano: T): T {
  return sanitizarEntrada(plano);
}

/** Serialização JSONL — um item por linha (mesmo formato neutro do TRIAGEM_V1). */
export function planoParaJsonl(plano: PlanoConsultasV1): string {
  const linhas = [
    JSON.stringify({ versao_contrato: plano.versao_contrato, geradoEm: plano.geradoEm, lote: plano.lote, resumo: plano.resumo, gate: plano.gate }),
    ...plano.itens.map((i) => JSON.stringify({ tipo: "item", ...i })),
    ...plano.fora_do_escopo_api.map((f) => JSON.stringify({ tipo: "fora_do_escopo_api", ...f })),
  ];
  return linhas.join("\n") + "\n";
}
