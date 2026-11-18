/**
 * Populações de linhas do lote — predicados canônicos partilhados entre a rota do
 * lote, os filtros rápidos da UI e os contadores batch-wide.
 *
 * v0.11.4 (fix/rota-lote-populacoes): extraído de src/app/api/imports/[id]/route.ts.
 * Módulo SEM imports — apenas objetos/funções puras, verificável sem banco
 * (populacoes.test.ts).
 *
 * Regra que vale para TODOS os predicados abaixo: o `not` do Prisma NÃO casa com
 * NULL. Toda condição "diferente de X" precisa da guarda explícita
 * `OR: [{ campo: null }, { campo: { not: "X" } }]` — sem ela as linhas de CNPJ
 * direto (campos NULL) desaparecem do conjunto.
 */

/** v0.11.3 (missão Lotes+Mesa): MESMA definição canônica de “sem bloqueio de
 * identidade” usada pelo contador totalReview (engine.recomputeCounters) e pelo
 * conjunto “Identificadas” da tabela — decisão humana pendente (REVIEW) ou registro
 * localizado divergente (LOCALIZADO com ficha coletada) BLOQUEIAM o dossiê na Mesa.
 * A conta continua visível em Lotes (pendente de revisão) — nunca desaparece. */
export const SEM_BLOQUEIO_IDENTIDADE = [
  { OR: [{ resolutionState: null }, { resolutionState: { not: "REVIEW" } }] },
  { OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }] },
];

/** v0.11.3: filtro canônico do filtro rápido “Dossiês” da Mesa — pesquisa solicitada
 * e CONCLUÍDA (researchStatus OK), síntese concluída (aiStatus OK), cadastro coletado
 * e identidade sem bloqueio. É a MESMA população do contador pesquisaProfunda.dossiesProntos:
 * o número do botão e a tabela filtrada contam exatamente o mesmo conjunto. */
export const DOSSIE_PRONTO_WHERE = {
  researchStatus: "OK",
  aiStatus: "OK",
  lookupStatus: "ENRIQUECIDO",
  AND: SEM_BLOQUEIO_IDENTIDADE,
};

/** v0.11.4: população “prontas sem revisão” — espelho SQL do predicado isConfirmed
 * da exportação (export/route.ts L201-207), que roda em JS e por isso não sofre da
 * armadilha do NULL. NULL participa explicitamente nas duas guardas: o `not` do
 * Prisma EXCLUI nulos, e as linhas de CNPJ direto (identityStage/resolutionState
 * NULL) são justamente as que devem entrar.
 *
 * Limite conhecido (registrado, NÃO resolvido aqui): a exportação conta as duplicatas
 * herdadas via eff() (a linha duplicada herda os fatos do original); o contador SQL
 * conta a linha como está gravada. Divergência pequena e conhecida — o número do
 * diálogo é o do SQL; a lista exportada pode ser levemente maior. */
export const CONFIRMADA_WHERE = {
  lookupStatus: "ENRIQUECIDO",
  AND: [
    { OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }] },
    { OR: [{ resolutionState: null }, { resolutionState: "CONFIRMED" }] },
  ],
};

/**
 * v0.11.4: mescla predicados SEM perder condições. `Object.assign` sobrescrevia
 * chaves inteiras — a busca em texto (q) pisava o OR do filtro de resolução e a
 * tabela mostrava linhas fora do filtro aplicado.
 *
 * - `AND` do extra é CONCATENADO ao AND existente;
 * - `OR` do extra vira mais um item do AND (nunca substitui o OR de outro filtro);
 * - demais chaves são aplicadas diretamente (uma por campo, sem colisão).
 */
export function mergeWhere(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  for (const [chave, valor] of Object.entries(extra)) {
    if (chave === "AND") {
      const atuais = (base.AND as unknown[] | undefined) ?? [];
      base.AND = [...atuais, ...((valor as unknown[]) ?? [])];
    } else if (chave === "OR") {
      const atuais = (base.AND as unknown[] | undefined) ?? [];
      const orAtual = base.OR as Record<string, unknown>[] | undefined;
      // OR pré-existente também é preservado (dobrado no AND) antes de entrar o novo.
      base.AND = orAtual ? [...atuais, { OR: orAtual }, { OR: valor }] : [...atuais, { OR: valor }];
      delete base.OR;
    } else {
      base[chave] = valor;
    }
  }
  return base;
}

// v0.10.12: "Revisar" inclui registro LOCALIZADO (divergência de identidade);
// "Identificadas" exclui divergentes (não são identificadas até revisar/validar) e
// INCLUDE linhas de CNPJ direto enriquecidas (resolutionState null — o rótulo novo
// do filtro é "Identificadas", não mais "resolução CONFIRMED").
export function whereResolucao(filtro: string): Record<string, unknown> | null {
  // v0.11.2 (UX): "Revisar" alinhado ao contador do engine (totalReview, engine.ts):
  // REVIEW OU LOCALIZADO COM ficha coletada. Antes o filtro incluía LOCALIZADO sem
  // coleta (em processamento) — clicar em "Revisar agora" mostrava mais linhas do
  // que a contagem do chip, e a mensagem parecia contradizer os filtros rápidos.
  if (filtro === "REVIEW") return { OR: [{ resolutionState: "REVIEW" }, { identityStage: "LOCALIZADO", lookupStatus: "ENRIQUECIDO" }] };
  if (filtro === "CONFIRMED") {
    // v0.11.4: "Identificadas" INCLUI linhas de CNPJ direto (identityStage/resolutionState
    // NULL) — o `not` do Prisma exclui nulos e o filtro antigo as escondia. Guarda explícita.
    return {
      AND: [
        { OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }] },
        { OR: [{ resolutionState: "CONFIRMED" }, { resolutionState: null, lookupStatus: "ENRIQUECIDO" }] },
      ],
    };
  }
  if (filtro === "UNRESOLVED") {
    // v0.11.0 (homologação Gate 2): o `not` do Prisma EXCLUI nulos — toda linha
    // UNRESOLVED de pipeline tem identityStage NULL e o filtro devolvia 0 mesmo com
    // linhas "Não encontrada" no lote (contadores e filtro divergiam). NULL participa.
    return {
      resolutionState: "UNRESOLVED",
      OR: [{ identityStage: null }, { identityStage: { not: "LOCALIZADO" } }],
    };
  }
  return null;
}
