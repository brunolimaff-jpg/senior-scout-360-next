/**
 * /api/lab/mock/v1 — PROVEDOR MOCK compatível com OpenAI (APENAS validação sintética).
 *
 * Para que serve: validar o laboratório do Lote B de ponta a ponta SEM consumir
 * API paga e SEM rede externa — o operador aponta a Base URL do laboratório para
 * http://127.0.0.1:3000/api/lab/mock/v1 (localhost http é aceito pelo vault só
 * para este fim). Devolve um dossiê sintético claramente rotulado como MOCK.
 *
 * O que NÃO é: um provedor real, um proxy, ou parte dos fluxos oficiais do Scout.
 * Os resultados gerados por ele caem em LabComparison (experimentais) — nunca nos
 * campos oficiais — e a telemetria marca a fonte como 127.0.0.1 (mock local).
 */

import { NextRequest, NextResponse } from "next/server";
import { labDisabledRes, labEnabled } from "@/lib/lab/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = ["mock-scout-mini", "mock-scout-deep"];

/** Autenticação sintética: aceita só chaves "sk-mock..." — prova o caminho 401 do conector. */
function chaveValida(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer sk-mock");
}

export async function GET(req: NextRequest, _ctx: { params: Promise<{ path?: string[] }> }) {
  // v0.10.11 (piloto): fixture do laboratório segue o MESMO gate server-side.
  if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
  if (!chaveValida(req)) {
    return NextResponse.json({ error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 });
  }
  return NextResponse.json({
    object: "list",
    data: MODELS.map((id) => ({ id, object: "model", owned_by: "scout-mock" })),
  });
}

interface MockChatBody {
  messages?: { role: string; content: string }[];
  model?: string;
}

export async function POST(req: NextRequest, _ctx: { params: Promise<{ path?: string[] }> }) {
  // v0.10.11 (piloto): fixture do laboratório segue o MESMO gate server-side.
  if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
  if (!chaveValida(req)) {
    return NextResponse.json({ error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 });
  }
  let body: MockChatBody | null = null;
  try {
    body = (await req.json()) as MockChatBody;
  } catch {
    return NextResponse.json({ error: { message: "JSON inválido" } }, { status: 400 });
  }
  const user = body?.messages?.find((m) => m.role === "user")?.content ?? "";
  const promptTokens = Math.max(1, Math.round((user.length ?? 0) / 4));

  // atraso pequeno para a medição de latência ser realista (não é rede externa)
  await new Promise((r) => setTimeout(r, 350));

  const conteudo = {
    sintese: "DOSSIÊ MOCK (validação sintética do laboratório — não use como dado real). Conta lida a partir do pacote reutilizado.",
    perfil: "Perfil sintético gerado pelo provedor mock do Lote B.",
    teia: ["Estrutura sintética — mock não faz pesquisa externa"],
    operacao: ["Operação sintética — mock não consulta fontes"],
    tecnologia: ["Lacuna honesta: o provedor mock não pesquisa tecnologia"],
    aderencia: [],
    tese: "Este texto existe para provar o circuito: mesmo pacote, mesmo prompt, provedor diferente, resultado experimental separado.",
    profunda: true,
    entidadeEscopo: "Pessoa jurídica do CNPJ informado no pacote (escopo mock).",
    quem_e: "Conta sintética para validação do laboratório (mock local).",
    oQueFaz: ["Simula a leitura de um provedor externo compatível com OpenAI"],
    escalaEstrutura: ["Sem dados reais — mock"],
    pessoas: [],
    mudancasSinais: ["Nenhum sinal — mock"],
    naoSabemos: ["Tudo o que exigir pesquisa externa — o mock não pesquisa"],
    hipotesesDetalhadas: [],
    evidencias: [
      {
        claim: "O pacote de evidências foi reutilizado da pesquisa salva (0 buscas novas).",
        status: "CONFIRMADO",
        source: "laboratório lote B",
        url: null,
        relevancia: "alta",
        periodo: null,
      },
    ],
  };

  return NextResponse.json({
    id: `chatcmpl-mock-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body?.model ?? MODELS[0],
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "```json\n" + JSON.stringify(conteudo, null, 2) + "\n```" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: 180,
      total_tokens: promptTokens + 180,
    },
  });
}
