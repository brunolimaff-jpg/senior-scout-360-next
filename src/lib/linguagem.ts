/**
 * linguagem.ts — CONTRATO DE LINGUAGEM COMERCIAL (v0.10.17).
 *
 * Regras aplicadas em toda a experiência comercial (interface, avisos, erros,
 * botões, dossiês, leituras de IA e PDFs):
 * 1. Português brasileiro natural, profissional e direto.
 * 2. Frases curtas, uma ideia por frase, voz ativa.
 * 3. Resultado primeiro, depois o motivo e a próxima ação.
 * 4. Sem travessão separando pensamentos (frases independentes).
 * 5. Botões com verbos concretos.
 * 6. Sem códigos, provedores, estados internos ou siglas na superfície comercial.
 * 7. Fato cadastral, informação observada, hipótese e não-verificado ficam separados.
 * 8. Mensagem de erro explica o que aconteceu e o próximo passo.
 * 9. Sem ressalva defensiva repetida: a ressalva fica perto do dado só quando
 *    muda a interpretação comercial.
 *
 * Este módulo é FONTE ÚNICA das frases derivadas que mais de uma superfície
 * consome (interface, PDF, exportações) — a mesma regra não pode ser copiada.
 */

/**
 * Regime tributário do cadastro em linguagem comercial. O ANO fica ao lado do
 * dado ("Lucro Real · exercício 2024"), sem parágrafo defensivo: o registro
 * fiscal não afirma a operação vigente, e a frase não precisa repetir isso.
 *
 * v0.11.1 (Gate 2/3): devolve também o ANO separado e uma nota visível que
 * distingue o regime HISTÓRICO do regime ATUAL não confirmado — o mesmo
 * contrato vale para a ficha, o dossiê copiável e o PDF.
 */
export function regimeTributarioLegivel(texto: string | null | undefined): { valor: string; nota: string; ano: string | null } | null {
  const bruto = (texto ?? "").trim();
  if (!bruto) return null;
  const m = /^([^()]+?)(?:\s*\((?:exerc[ií]cio\s+([^,)]+))?[^)]*\))?$/.exec(bruto);
  const forma = (m?.[1] ?? bruto).replace(/\s+/g, " ").trim();
  const exercicio = (m?.[2] ?? "").trim();
  const valor = exercicio ? `${forma} · exercício ${exercicio}` : forma;
  const nota = exercicio
    ? `O registro encontrado se refere ao exercício ${exercicio}. Ainda precisamos confirmar a situação atual.`
    : "O registro não informa o exercício. Ainda precisamos confirmar o regime atual.";
  return { valor, nota, ano: exercicio || null };
}

/**
 * Frases comerciais dos estados de lacuna (triagem). Cada frase diz o PRÓXIMO
 * PASSO em vez de descrever o estado interno ("ainda não foi feita" saiu do
 * vocabulário do produto — o que existe é o que fazer a seguir).
 */
export const ESTADO_LACUNA_COMERCIAL: Record<string, string> = {
  RESOLVIDO: "Já respondida pelos dados coletados.",
  COMPLEMENTAR_API: "Peça a consulta complementar na ficha desta empresa.",
  PESQUISA_DOCUMENTAL: "Pesquise em sites e publicações do setor.",
  VALIDACAO_HUMANA: "Confirme essa informação com a empresa.",
  INDISPONIVEL: "A fonte estava indisponível na coleta. Tente novamente na ficha.",
  NAO_APLICAVEL: "Não se aplica a esta empresa.",
};

/** Participante de quadro societário em palavras (interface e PDF usam a MESMA leitura). */
export function tipoParticipanteLegivel(tipo: string): string {
  if (tipo === "PF") return "pessoa física";
  if (tipo === "PJ") return "pessoa jurídica";
  return "tipo não confirmado pela fonte";
}

/** Contagem em português natural: "1 empresa" / "3 empresas". Nunca "empresa(s)". */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : pluralForm ?? `${singular}s`}`;
}
