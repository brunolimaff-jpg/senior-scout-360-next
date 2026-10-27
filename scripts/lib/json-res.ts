/** Helper compartilhado: resposta JSON para simuladores de fonte (testes). */
export function jsonRes(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}
