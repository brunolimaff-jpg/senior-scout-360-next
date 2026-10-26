/**
 * single-flight.ts — VOOR ÚNICO POR CHAVE (v0.10.10, estresse da v0.10.9).
 *
 * Falha provada pela auditoria da v0.10.9: dois comandos de aprovação para o
 * MESMO alvo (mesma sessão repetida ou duas sessões independentes) liam a cache
 * em miss, e CADA UM disparava a própria chamada externa — a persistência da
 * cache só acontecia DEPOIS da resposta (check-then-act no nível da fonte,
 * mesma classe da falha de concorrência corrigida no limitador em v0.10.9).
 *
 * Desenho — a RESERVA DA CONSULTA É ATÔMICA COM A DECISÃO DE CONSULTAR:
 *  - `emVooUnico(chave, tarefa)`: se já existe promessa em curso para a chave,
 *    o chamador SEGUINDO-a (seguidor) e recebe o MESMO resultado — nenhuma
 *    chamada externa nova acontece para requisições concorrentes do mesmo alvo;
 *  - o registro entra no mapa SÍNCRONAMENTE no mesmo tick da decisão (zero
 *    await entre o get e o set — impossível intercalar em JS single-thread);
 *  - a chave sai do mapa ao FINAL da tarefa (sucesso OU falha — sem cache
 *    negativa): o próximo comando após uma falha faz uma consulta nova, honesta;
 *  - `lider` distingue quem executou a tarefa de quem compartilhou o resultado,
 *    para telemetria honesta (via "coalescido" no seguidor — não infla a
 *    contagem de consultas externas).
 *
 * Sobrevive a HMR via globalThis (mesmo padrão do limitador). Zero dependência
 * externa; não faz HTTP; não conhece banco — só coordena promessas.
 */

const g = globalThis as unknown as { __voosEmCurso?: Map<string, Promise<unknown>> };
g.__voosEmCurso ??= new Map<string, Promise<unknown>>();
const voos = g.__voosEmCurso;

export interface ResultadoVoo<T> {
  valor: T;
  /** true quando ESTE chamador executou a tarefa; false quando compartilhou o voo em curso. */
  lider: boolean;
}

/**
 * Executa `tarefa` sob voo único para `chave`. Chamadores concorrentes com a
 * mesma chave compartilham UMA execução — a reserva é atômica com a decisão.
 * A promessa sai do mapa ao terminar (sucesso ou falha), SEM cache negativa.
 */
export async function emVooUnico<T>(chave: string, tarefa: () => Promise<T>): Promise<ResultadoVoo<T>> {
  const emCurso = voos.get(chave);
  if (emCurso) {
    // seguidor: compartilha o resultado do voo em curso — nenhuma tarefa nova
    const valor = (await emCurso) as T;
    return { valor, lider: false };
  }
  const promessa: Promise<T> = tarefa().finally(() => {
    // remove SOMENTE se ainda é o voo desta promessa (nunca apaga voo mais novo)
    if (voos.get(chave) === promessa) voos.delete(chave);
  });
  voos.set(chave, promessa); // mesmo tick da decisão — sem janela de corrida
  const valor = await promessa;
  return { valor, lider: true };
}

/** Estado atual (para testes/diagnóstico): chaves com voo em curso. */
export function voosEmCurso(): string[] {
  return [...voos.keys()];
}
