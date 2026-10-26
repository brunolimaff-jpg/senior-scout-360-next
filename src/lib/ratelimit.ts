/**
 * Rate limiter genérico por serviço (janela deslizante de 60s + semáforo de concorrência).
 * Mesma semântica do limiter de IA: espera honesta, sem janela máxima.
 * Sobrevive a HMR via globalThis. Todos os serviços externos não-CNPJ passam por aqui.
 *
 * v0.10.9 (estresse/despacho): correção da falha de CONCORRÊNCIA check-then-act —
 * a versão anterior verificava `running < concurrency` ANTES de esperar e só
 * reservava a vaga (running++) DEPOIS do await do teto de RPM. Quem estava
 * estacionado no wait de RPM era invisível ao gate de concorrência e, na virada
 * da janela, um bloco inteiro entrava junto (provado em qa/limitador-antes.json:
 * 3 chamadas simultâneas com concurrency=2).
 *
 * Desenho corrigido — a RESERVA É ATÔMICA COM A DECISÃO:
 *  - todo chamador entra numa FILA FIFO no mesmo tick em que chega (nunca espera
 *    "solto" fora do controle);
 *  - um único pump() SÍNCRONO (zero await entre a checagem e a reserva) admite o
 *    cabeçalho da fila somente quando CABEM as duas condições ao mesmo tempo:
 *    running < concurrency  E  chamadas na janela < rpm;
 *  - admitir = reservar (starts.push + running++) no mesmo passo síncrono;
 *  - quem não cabe PERMANECE na fila — a vaga NÃO é reservada;
 *  - UM timer por balde re-executa o mesmo pump síncrono na próxima abertura de
 *    janela — sem polling, sem rajada.
 * Contrato externo preservado: acquireServiceSlot(serviço) → release();
 * release idempotente; zero mudança nos chamadores (WEB_SEARCH/PAGE_READER).
 * opts.windowMs existe SÓ para testes determinísticos (default 60s — produção
 * idêntica ao contrato anterior).
 */

interface Waiter {
  resolve: (release: () => void) => void;
}

interface Bucket {
  /** serviço dono do balde — a spec (rpm/concurrency) é resolvida POR SERVIÇO */
  service: string;
  /** timestamps (ms) dos inícios de chamada dentro da janela vigente */
  starts: number[];
  running: number;
  /** fila FIFO de espera — ninguém espera fora dela (correção v0.10.9) */
  waiters: Waiter[];
  /** timer único de reabertura de janela (null quando nada agendado) */
  timer: ReturnType<typeof setTimeout> | null;
  /** instantâneo agendado do timer (evita remarcar para mais tarde) */
  timerAt: number | null;
  /** janela vigente do balde (60s em produção; testes podem encurtar) */
  windowMs: number;
}

interface LimitSpec {
  rpm: number;
  concurrency: number;
}

const g = globalThis as unknown as { __svcLimiters?: Map<string, Bucket> };
g.__svcLimiters ??= new Map<string, Bucket>();
const buckets = g.__svcLimiters;

function specFor(service: string): LimitSpec {
  switch (service) {
    case "WEB_SEARCH":
      return { rpm: Math.max(1, Number(process.env.SEARCH_RPM) || 10), concurrency: 2 };
    case "PAGE_READER":
      return { rpm: Math.max(1, Number(process.env.PAGE_READER_RPM) || 10), concurrency: 2 };
    default:
      return { rpm: Math.max(1, Number(process.env.SVC_RPM) || 10), concurrency: 2 };
  }
}

function bucket(service: string, windowMs: number): Bucket {
  let b = buckets.get(service);
  if (!b) {
    b = { service, starts: [], running: 0, waiters: [], timer: null, timerAt: null, windowMs };
    buckets.set(service, b);
  }
  return b;
}

/** Remove timestamps fora da janela vigente. */
function podarJanela(b: Bucket): void {
  const agora = Date.now();
  b.starts = b.starts.filter((t) => agora - t < b.windowMs);
}

/**
 * Admite cabeças da fila ENQUANTO couber — SÍNCRONO, sem um único await.
 * A reserva (starts.push + running++) acontece NO MESMO passo da checagem:
 * não existe intervalo de observação entre "verificar limite" e "ocupar vaga".
 */
function pump(b: Bucket): void {
  const { rpm, concurrency } = specFor(b.service);
  for (;;) {
    podarJanela(b);
    if (b.waiters.length === 0) {
      if (b.timer) {
        clearTimeout(b.timer);
        b.timer = null;
        b.timerAt = null;
      }
      return;
    }
    if (b.running >= concurrency) return; // gate 1 — nada entra além do semáforo
    if (b.starts.length >= rpm) {
      agendarReabertura(b); // gate 2 — vaga NÃO reservada; chamador permanece na fila
      return;
    }
    const w = b.waiters.shift();
    if (!w) return;
    b.starts.push(Date.now()); // RESERVA ATÔMICA — mesma tarefa síncrona da checagem acima
    b.running++;
    w.resolve(criarRelease(b));
  }
}

/** Um único timer por balde, para o instante em que a PRÓXIMA vaga de RPM abre. */
function agendarReabertura(b: Bucket): void {
  podarJanela(b);
  if (b.starts.length === 0) {
    pump(b); // janela vazia e ainda há espera — inconsistência de relógio; re-tenta já
    return;
  }
  const abrirEm = Date.now() + (b.windowMs - (Date.now() - b.starts[0]) + 50);
  if (b.timer && b.timerAt !== null && b.timerAt <= abrirEm) return; // já agendado igual ou mais cedo
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    b.timer = null;
    b.timerAt = null;
    pump(b);
  }, Math.max(0, abrirEm - Date.now()));
  b.timerAt = abrirEm;
  b.timer.unref?.(); // o timer não pode segurar o processo sozinho
}

function criarRelease(b: Bucket): () => void {
  let released = false;
  return () => {
    if (released) return; // idempotente
    released = true;
    b.running--;
    pump(b); // liberação admite o próximo DENTRO das regras — nunca fura fila nem teto
  };
}

/**
 * Adquire slot para o serviço (RPM + concorrência). Retorna release().
 * Honestidade > conveniência: lote grande só anda devagar, nunca estoura a fonte.
 * A vaga é reservada ATOMICAMENTE na admissão — requisições concorrentes nunca
 * compartilham a mesma vaga nem entram em bloco na virada da janela (v0.10.9).
 */
export async function acquireServiceSlot(
  service: string,
  opts?: { windowMs?: number }
): Promise<() => void> {
  const windowMs = Math.max(50, opts?.windowMs ?? 60_000);
  const b = bucket(service, windowMs);
  b.windowMs = windowMs; // última janela pedida governa o balde (uso real: sempre 60s)
  return new Promise<() => void>((resolve) => {
    b.waiters.push({ resolve }); // entrada na fila no MESMO tick da chegada
    pump(b); // admissão imediata quando cabe — ainda síncrono neste tick
  });
}

/** Quantidade de chamadas no último minuto (para auditoria/diagnóstico). */
export function serviceUsageLastMinute(service: string): number {
  const b = buckets.get(service);
  if (!b) return 0;
  const now = Date.now();
  b.starts = b.starts.filter((t) => now - t < 60_000);
  return b.starts.length;
}
