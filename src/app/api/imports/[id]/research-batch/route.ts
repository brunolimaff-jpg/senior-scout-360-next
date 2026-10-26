/**
 * /api/imports/:id/research-batch — Mesa de Contas (v0.9.0):
 * fila de pesquisa profunda para as contas EXPLICITAMENTE selecionadas.
 *
 * POST {acao:"iniciar",  rowNumbers:[...]} — enfileira (máx. 500; só contas ENRIQUECIDO)
 * POST {acao:"parar"}                    — interrompe sem perder o concluído
 * POST {acao:"retomar"}                  — retoma pendências sem repetir chamadas
 *
 * Durável em ImportBatch.researchQueueJson; executor em memória; 429/cota pausam
 * com motivo honesto e retomada manual. Sem Redis, sem cron, sem fila externa.
 */
import { NextRequest } from "next/server";
import { errRes, fail500, okRes } from "@/lib/api";
import { assertMutationAllowed } from "@/lib/export-guard";
import { assertAccess } from "@/lib/auth"; // v0.10.8: leitura da fila também protegida
import type { ModoPesquisa } from "@/lib/enrich/research";
import {
  getResearchQueue,
  resumeResearchQueue,
  startResearchQueue,
  stopResearchQueue,
} from "@/lib/enrich/engine";
import { plural } from "@/lib/linguagem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await assertMutationAllowed(req);
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { acao?: unknown; rowNumbers?: unknown; modo?: unknown } | null;
    const acao = body?.acao;
    const modo: ModoPesquisa = body?.modo === "ADAPTATIVO" ? "ADAPTATIVO" : "COMPLETO";

    if (acao === "iniciar") {
      const rowNumbers = Array.isArray(body?.rowNumbers)
        ? body!.rowNumbers.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        : [];
      const r = await startResearchQueue(id, rowNumbers, modo);
      if (!r.ok) return errRes("FILA_INVALIDA", r.error ?? "Não foi possível iniciar a fila.", 422);
      return okRes({
        estado: r.estado,
        enfileiradas: r.enfileiradas,
        naoElegiveis: r.naoElegiveis ?? 0,
        mensagem:
          r.naoElegiveis && r.naoElegiveis > 0
            ? `${plural(r.enfileiradas ?? 0, "conta", "contas")} na fila · ${r.naoElegiveis} sem dados públicos prontos ${r.naoElegiveis === 1 ? "ficou de fora" : "ficaram de fora"}.`
            : `${plural(r.enfileiradas ?? 0, "conta", "contas")} na fila de pesquisa.`,
      });
    }
    if (acao === "parar") {
      const r = await stopResearchQueue(id);
      if (!r.ok) return errRes("FILA_INEXISTENTE", r.error ?? "Nenhuma fila ativa.", 422);
      return okRes({ estado: r.estado, mensagem: "Fila interrompida — o trabalho concluído foi preservado." });
    }
    if (acao === "retomar") {
      const r = await resumeResearchQueue(id);
      if (!r.ok) return errRes("FILA_INEXISTENTE", r.error ?? "Nenhuma fila para retomar.", 422);
      return okRes({ estado: r.estado, mensagem: "Fila retomada — contas com dossiê fresco são puladas sem repetir chamadas." });
    }
    return errRes("ACAO_INVALIDA", 'Informe acao: "iniciar" (com rowNumbers), "parar" ou "retomar".', 400);
  } catch (e) {
    return fail500(e);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // v0.10.8 (auditoria): o estado da fila de pesquisa é DADO do lote — no modo
    // TOKEN não pode ser lido apenas conhecendo o id. Mesma fronteira das rotas principais.
    const denied = await assertAccess(req);
    if (denied) return denied;
    const { id } = await ctx.params;
    return okRes({ estado: await getResearchQueue(id) });
  } catch (e) {
    return fail500(e);
  }
}
