'use client';

/**
 * HISTÓRICO COMPACTO — o lote atual manda; anteriores ficam discretos.
 * Nome · data · quantidade · resultado · estado. Detalhes só quando pedido.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, Download, History, Trash2, ClipboardPaste, FileSpreadsheet, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { HistoryItem } from "@/lib/types";
import { plural } from "@/lib/linguagem";
import { BATCH_STATE } from "./senior";

const STATE_TONE: Record<string, string> = {
  DONE: "bg-[#00968C1A] text-[#086B6B]",
  PARTIAL: "bg-[#FFC51133] text-[#33466C]",
  FAILED: "bg-[#FDECEC] text-[#8C2F39]",
  PROCESSING: "bg-[#00968C1A] text-[#086B6B]",
  CONFIRMED: "bg-[#F2F2F2] text-[#33466C]",
  PREVIEW: "bg-[#F2F2F2] text-[#77736E]",
};

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "";
  }
}

export function HistoryCard({
  history,
  activeId,
  onOpen,
  onDelete,
}: {
  history: HistoryItem[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const past = history.filter((h) => h.id !== activeId);
  const previasPendentes = past.filter((h) => h.status === "PREVIEW").length;
  const hasExportable = past.some((h) => h.status !== "PREVIEW");

  return (
    <section className="sn-surface glass-reflex relative overflow-hidden" data-testid="card-history" aria-labelledby="historico-title">
      <button
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="history-toggle"
      >
        <span className="flex items-center gap-3">
          <span className="glass-chip flex h-9 w-9 items-center justify-center rounded-full">
            <History className="h-4 w-4 text-senior-cinza-600" aria-hidden="true" />
          </span>
          <span>
            <span id="historico-title" className="ds-title-md block text-senior-azul">Lotes anteriores</span>
            <span className="ds-caption block text-senior-cinza-600">
              {past.length === 0 ? "Nenhum lote anterior." : `${plural(past.length, "lote já processado", "lotes já processados")}${previasPendentes > 0 ? ` · ${plural(previasPendentes, "prévia", "prévias")} aguardando confirmação` : ""}.`}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          {hasExportable && (
            <span
              className="hidden items-center gap-1.5 rounded-[8px] border border-senior-cinza-300 bg-white px-3 py-1.5 text-[13px] font-medium text-[#086B6B] transition-colors hover:bg-[#00968C0D] sm:inline-flex"
              onClick={(e) => e.stopPropagation()}
              data-testid="export-all"
            >
              <Download className="h-3.5 w-3.5" />
              <a href="/api/imports/export-all?type=result" download data-testid="export-all-result">resultado-consolidado.csv</a>
            </span>
          )}
          {open ? <ChevronDown className="h-4 w-4 text-senior-cinza-600" /> : <ChevronRight className="h-4 w-4 text-senior-cinza-600" />}
        </span>
      </button>

      {open && (
        <ul className="border-t border-senior-cinza-300" data-testid="history-list">
          {past.map((h) => (
            <li key={h.id} className="flex flex-col gap-2 border-b border-white/50 px-6 py-3 transition-colors duration-200 last:border-b-0 hover:bg-white/50 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={() => onOpen(h.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid={`history-item-${h.id}`}>
                <span className="glass-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]">
                  {h.sourceType === "TEXT" ? <ClipboardPaste className="h-4 w-4 text-senior-cinza-600" /> : <FileSpreadsheet className="h-4 w-4 text-senior-cinza-600" />}
                </span>
                <span className="min-w-0">
                  <span className="ds-body block truncate font-medium text-senior-azul">{h.fileName}</span>
                  <span className="ds-caption block text-senior-cinza-600">
                    {relativeTime(h.createdAt)} · {plural(h.rowCount, "entrada", "entradas")}
                    {h.totalConfirmed > 0 ? ` · ${plural(h.totalConfirmed, "identificada", "identificadas")}` : ""}
                    {h.totalReview > 0 ? ` · ${h.totalReview} p/ revisão` : ""}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={`whitespace-nowrap border-transparent text-[13px] font-medium ${STATE_TONE[h.status] ?? "bg-[#F2F2F2] text-[#77736E]"}`}>
                  {BATCH_STATE[h.status] ?? h.status}
                </Badge>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-senior-cinza-400 hover:bg-[#FDECEC] hover:text-[#8C2F39]" aria-label={`Arquivar ${h.fileName}`} data-testid={`history-delete-${h.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="glass-strong rounded-[16px] border-transparent">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="ds-title-md text-senior-azul">Arquivar este lote?</AlertDialogTitle>
                      <AlertDialogDescription className="ds-body text-senior-cinza-600">
                        "{h.fileName}" sai da lista de lotes anteriores. Os arquivos já baixados continuam válidos.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-[8px]">Manter</AlertDialogCancel>
                      <AlertDialogAction
                        className="rounded-[8px] bg-[#8C2F39] text-white hover:bg-[#6E242D]"
                        onClick={() => onDelete(h.id)}
                        data-testid="confirm-delete"
                      >
                        Arquivar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
