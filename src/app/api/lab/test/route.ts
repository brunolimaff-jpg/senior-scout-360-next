/**
 * /api/lab/test — TESTE DE CONEXÃO SEM INFERÊNCIA (reconciliado na v0.10.8).
 *
 * A UI (lab-panel.tsx) sempre chamou POST /api/lab/test — a rota existiu na
 * v0.9.0 (CHANGELOG) e faltava no código entregue (regressão de empacotamento
 * detectada na auditoria da v0.10.7). Esta rota restaura o contrato:
 *
 *  · GET {base}/models com a API key da sessão do laboratório (cookie httpOnly).
 *  · ZERO inferência, ZERO tokens: nenhum chat/completion é chamado aqui.
 *  · Timeout curto (8s) e SEM retry — falha é estado visível, não exceção.
 *  · Erro do provedor é redigido (a chave nunca volta em mensagem/log).
 *  · Acesso: mesma fronteira do modo TOKEN das rotas principais.
 *  · Rastro: evento de telemetria "ETAPA/LAB_PROBE_EXTERNO" (fora do resumo do
 *    lote — teste de laboratório não é etapa da jornada comercial).
 *
 * Resposta (contrato consumido pelo ProbeRes da UI):
 *   ok: true  → probe: { modeloSolicitado, modelos[], modeloPresente, duracaoMs, httpStatus }
 *   ok: false → code, message?, probe: { modeloSolicitado, modelos: [], modeloPresente: null, duracaoMs, httpStatus }
 */
import { NextRequest, NextResponse } from "next/server";
import { fail500 } from "@/lib/api";
import { assertAccess } from "@/lib/auth"; // v0.10.8: mesma fronteira das rotas principais
import { LAB_COOKIE, getLabConfig, labDisabledRes, labEnabled, redactKey } from "@/lib/lab/vault";
import { recordTelemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8_000;

interface ModelosResposta {
  data?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    // v0.10.11 (piloto): gate server-side do laboratório.
    if (!labEnabled()) return labDisabledRes() as unknown as NextResponse;
    const denied = await assertAccess(req);
    if (denied) return denied;

    const cfg = getLabConfig(req.cookies.get(LAB_COOKIE)?.value);
    if (!cfg) {
      return NextResponse.json(
        {
          ok: false,
          code: "LAB_NAO_CONFIGURADO",
          message: "Configure o provedor externo no laboratório antes de testar a conexão.",
          probe: { modeloSolicitado: "", modelos: [], modeloPresente: null, duracaoMs: 0, httpStatus: null },
        },
        { status: 400 }
      );
    }

    let host = "provedor-externo";
    try {
      host = new URL(cfg.baseUrl).host;
    } catch {
      /* validação do vault garante URL válida — defesa em profundidade */
    }

    const t0 = Date.now();
    let httpStatus: number | null = null;
    let modelos: string[] = [];
    let erro: string | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(`${cfg.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      httpStatus = res.status;

      if (res.ok) {
        const j = (await res.json().catch(() => null)) as ModelosResposta | null;
        if (j && Array.isArray(j.data)) {
          modelos = j.data
            .map((m) => (m && typeof m === "object" && "id" in m ? String((m as { id: unknown }).id) : ""))
            .filter((id) => id.length > 0)
            .slice(0, 200);
        } else {
          // 2xx sem lista utilizável — conexão OK, verificação de Model ID indecisa
          modelos = [];
        }
      } else if (res.status === 401 || res.status === 403) {
        erro = "O provedor recusou a credencial (chave sem permissão ou inválida para esta Base URL).";
      } else if (res.status === 429) {
        erro = "O provedor sinalizou limite de requisições agora — tente novamente mais tarde.";
      } else {
        erro = `O provedor respondeu com recusa (código ${res.status}) — confira a Base URL.`;
      }
    } catch (e) {
      const causa = e instanceof Error ? (e.name === "AbortError" ? "tempo esgotado" : e.message) : String(e);
      erro = causa === "tempo esgotado"
        ? `A conexão não respondeu em ${TIMEOUT_MS / 1000}s — provedor inalcançável ou Base URL incorreta.`
        : `Não foi possível conectar: ${causa}.`;
    }
    const duracaoMs = Date.now() - t0;

    // Rastro honesto do teste (fora do resumo do lote — é laboratório, não jornada)
    recordTelemetry({
      tipo: "ETAPA",
      etapa: "LAB_PROBE_EXTERNO",
      fonte: `${host} (laboratório — teste de conexão)`,
      operacao: "probe_models_sem_inferencia",
      alvo: cfg.modelId,
      httpStatus,
      erro: erro ? redactKey(erro.slice(0, 300), cfg.apiKey) : null,
      tentativas: 1,
      duracaoMs,
      estadoFinal: erro === null ? "sucesso" : "falha",
      payload: { host, inferencia: false, tokens: 0 },
    });

    const modeloPresente: boolean | null =
      httpStatus !== null && httpStatus < 400 ? (modelos.length > 0 ? modelos.includes(cfg.modelId) : null) : null;

    if (erro) {
      return NextResponse.json(
        {
          ok: false,
          code: "CONEXAO_FALHOU",
          message: erro,
          probe: { modeloSolicitado: cfg.modelId, modelos: [], modeloPresente: null, duracaoMs, httpStatus },
        },
        { status: 200 } // o teste concluiu — a falha é RESULTADO visível na UI, não erro de rota
      );
    }

    return NextResponse.json({
      ok: true,
      code: "OK",
      probe: { modeloSolicitado: cfg.modelId, modelos, modeloPresente, duracaoMs, httpStatus },
    });
  } catch (e) {
    return fail500(e);
  }
}
