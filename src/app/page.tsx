'use client';

/**
 * SCOUT 360 — Enriquecimento de contas.
 * Shell do produto: header com logo oficial, hero com uma única proposta de valor,
 * entrada de dados como primeira tarefa dominante, resultado operacional no centro,
 * histórico compacto e rodapé fixo. Linguagem do LDR — sem jargão de implementação.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { UploadCard } from "@/components/cnpj/upload-card";
import { PreviewCard } from "@/components/cnpj/preview-card";
import { BatchDetailCard } from "@/components/cnpj/batch-detail-card";
import { HistoryCard } from "@/components/cnpj/history-card";
import { BatchStateBadge } from "@/components/cnpj/senior";
import type { ApiError, AuditEventView, BatchDetail, BatchPreview, DecideRequest, HistoryItem, Pagination, RowDetail } from "@/lib/types";
import { ChevronDown, History, ListChecks, Plus, X } from "lucide-react";
import { AuroraBackground, MotionRoot } from "@/components/motion/primitives";
import { AppHeader } from "@/components/cnpj/app-header";
import { AuthGate } from "@/components/cnpj/auth-gate";
import { apiFetch } from "@/lib/client-api";
import { plural } from "@/lib/linguagem";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/* ---------- helpers de contrato: nunca leia .id sem validar ---------- */

async function parseApi<T>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: `Resposta inválida do servidor (HTTP ${res.status}, corpo não-JSON).` };
  }
  const obj = json as Record<string, unknown>;
  if (!res.ok || obj.ok !== true) {
    const err = obj.error as ApiError | undefined;
    return { ok: false, error: err?.message ?? `Falha na requisição (HTTP ${res.status}).` };
  }
  return { ok: true, data: obj as T };
}

export interface RowQuery {
  page: number;
  pageSize: number;
  cnpj: string; // ALL | VALIDA | INVALIDA | DUPLICADA | SEM_CNPJ | REFERENCIA (rótulos humanos na UI)
  lookup: string; // ALL | ENRIQUECIDO | FILA | FALHAS
  resolucao: string; // ALL | CONFIRMED | REVIEW | UNRESOLVED
  pesquisa: string; // ALL | dossie_pronto | com_dossie | gerando | falhou | sem_pesquisa — v0.11.3: dossie_pronto é a população canônica da Mesa (pesquisa+síntese+cadastro+identidade sem bloqueio)
  q: string;
}

const DEFAULT_QUERY: RowQuery = { page: 1, pageSize: 50, cnpj: "ALL", lookup: "ALL", resolucao: "ALL", pesquisa: "ALL", q: "" };

function queryToSearch(q: RowQuery): string {
  const p = new URLSearchParams({
    page: String(q.page),
    pageSize: String(q.pageSize),
    cnpj: q.cnpj,
    lookup: q.lookup,
    resolucao: q.resolucao,
    pesquisa: q.pesquisa,
  });
  if (q.q.trim()) p.set("q", q.q.trim());
  return p.toString();
}

export default function Home() {
  const { toast } = useToast();

  // estados de UI: arquivo selecionado / upload em curso / prévia atual / erro de entrada / lote em tela / histórico
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cnpjColumn, setCnpjColumn] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [rows, setRows] = useState<RowDetail[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [rowQuery, setRowQuery] = useState<RowQuery>(DEFAULT_QUERY);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busyAction, setBusyAction] = useState(false);
  const [retryingRow, setRetryingRow] = useState<number | null>(null);
  const [revalidatingRow, setRevalidatingRow] = useState<number | null>(null);
  const [retryingAiRow, setRetryingAiRow] = useState<number | null>(null);
  const [retryAllBusy, setRetryAllBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // decisão humana de identidade (revisão)
  const [decidingRow, setDecidingRow] = useState<number | null>(null);
  // pesquisa profunda (nível 2) — POST em andamento por linha
  const [deepResearchRow, setDeepResearchRow] = useState<number | null>(null);
  // v0.10.12: a leitura inteligente (IA) SAIU do formulário — permanece desligada por padrão
  // e é acionada explicitamente na ficha da conta (ação contextual). Confirmar/importar
  // NUNCA consome cota de modelo sozinho.
  // pistas coladas
  const [pastedText, setPastedText] = useState("");
  const [analyzingText, setAnalyzingText] = useState(false);
  // v0.11.0 (contrato MESA): em modo estação a entrada de dados fica RECOLHIDA —
  // o formulário só domina a página enquanto não existe lote aberto (Estado 1).
  const [entradaAberta, setEntradaAberta] = useState(false);
  const mesaAtiva = !!detail || entradaAberta;

  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadTokenRef = useRef(0);
  const prevStatusRef = useRef<string | null>(null);

  // deep link compartilhável do dossiê: /?lote=<id>&empresa=<linha>
  const [deepDossierRow] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = Number(new URLSearchParams(window.location.search).get("empresa"));
    return Number.isInteger(v) && v > 0 ? v : null;
  });

  /* ---------- fetch de detalhe com query ---------- */

  const fetchDetail = useCallback(async (id: string, q: RowQuery, silent: boolean): Promise<BatchDetail | null> => {
    try {
      const res = await apiFetch(`/api/imports/${id}?${queryToSearch(q)}`, { cache: "no-store" });
      const parsed = await parseApi<{ batch: BatchDetail; rows: RowDetail[]; pagination: Pagination; events: AuditEventView[] }>(res);
      if (!parsed.ok) {
        if (!silent) toast({ title: "Não foi possível abrir o lote", description: parsed.error, variant: "destructive" });
        return null;
      }
      setDetail(parsed.data.batch);
      setRows(parsed.data.rows ?? []);
      setPagination(parsed.data.pagination ?? null);
      setEvents(parsed.data.events ?? []);
      return parsed.data.batch;
    } catch {
      if (!silent) toast({ title: "Falha de rede ao abrir o lote", variant: "destructive" });
      return null;
    }
  }, [toast]);

  const openBatch = useCallback(async (id: string) => {
    const q = DEFAULT_QUERY;
    setRowQuery(q);
    const b = await fetchDetail(id, q, false);
    if (!b) return;
    prevStatusRef.current = null; // força aviso de transição quando terminar
    // v0.10.17: ao abrir um lote, o resultado entra em cena ABAIXO do cabeçalho fixo —
    // o título "Resultado deste lote" nunca nasce escondido (scroll-mt-24 no alvo).
    window.setTimeout(() => {
      document.querySelector('[data-testid="batch-section"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    // v0.9.1 — prévia recuperável: um lote PREVIEW não tem linhas no banco; abrir o
    // detalhe mostraria uma tela vazia. Reabrimos a PRÉVIA (reconstruída do arquivo
    // salvo pelo backend) exatamente como ela era no momento do upload.
    if (b.status === "PREVIEW" && b.previewRecoveravel) {
      const pr = b.previewRecoveravel;
      setPreview({
        id: b.id,
        fileName: b.fileName,
        fileSize: b.fileSize ?? 0,
        delimiter: b.delimiter,
        encoding: b.encoding,
        hasHeader: b.hasHeader,
        header: pr.header,
        cnpjColumnIndex: pr.cnpjColumnIndex ?? 0,
        cnpjColumnDetectedBy: "prévia recuperada",
        rowCount: pr.rowCount,
        sampleRows: pr.sampleRows,
        status: "PREVIEW",
      });
      setDetail(null);
      setRows([]);
      setPagination(null);
      return;
    }
    if (b.status === "PREVIEW") {
      // arquivo irrecuperável: estado honesto em vez de tela vazia
      toast({
        title: "Prévia não recuperável",
        description: "O arquivo deste lote não está mais disponível. Você pode arquivá-lo nos lotes anteriores e reenviar a planilha.",
        variant: "destructive",
      });
    }
  }, [fetchDetail, toast]);

  const applyQuery = useCallback(async (patch: Partial<RowQuery>) => {
    if (!detail) return;
    const filterChanged =
      ("cnpj" in patch && patch.cnpj !== rowQuery.cnpj) ||
      ("lookup" in patch && patch.lookup !== rowQuery.lookup) ||
      ("resolucao" in patch && patch.resolucao !== rowQuery.resolucao) ||
      ("pesquisa" in patch && patch.pesquisa !== rowQuery.pesquisa) ||
      ("pageSize" in patch && patch.pageSize !== rowQuery.pageSize) ||
      ("q" in patch && patch.q !== rowQuery.q);
    const q = { ...rowQuery, ...patch, page: patch.page ?? (filterChanged ? 1 : rowQuery.page) };
    setRowQuery(q);
    await fetchDetail(detail.id, q, true);
  }, [detail, rowQuery, fetchDetail]);

  // busca com pequena espera: o texto atualiza na hora, a consulta acontece depois
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = useCallback(
    (value: string) => {
      if (!detail) return;
      const q = { ...rowQuery, q: value, page: 1 };
      setRowQuery(q);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        void fetchDetail(detail.id, q, true);
      }, 400);
    },
    [detail, rowQuery, fetchDetail]
  );

  /* ---------- histórico ---------- */

  const refreshHistory = useCallback(async () => {
    try {
      const res = await apiFetch("/api/imports", { cache: "no-store" });
      const parsed = await parseApi<{ batches: HistoryItem[] }>(res);
      if (parsed.ok) setHistory(parsed.data.batches ?? []);
    } catch {
      // silencioso: histórico é acessório; erros de rede aparecem nas ações principais
    }
  }, []);

  /* ---------- boot: recuperação + histórico + reabrir lote em andamento ---------- */

  useEffect(() => {
    void (async () => {
      try {
        await apiFetch("/api/worker/tick", { method: "POST" });
      } catch {
        /* recuperação é melhor-esforço */
      }
      await refreshHistory();
      try {
        const loteParam = new URLSearchParams(window.location.search).get("lote");
        if (loteParam) {
          // link de compartilhamento: abre o lote citado (o dossiê abre sozinho via empresa=N)
          void openBatch(loteParam);
          return;
        }
        const res = await apiFetch("/api/imports", { cache: "no-store" });
        const parsed = await parseApi<{ batches: HistoryItem[] }>(res);
        if (parsed.ok) {
          const all = parsed.data.batches ?? [];
          // v0.9.1: PRÉVIA não confirmada é a ação pendente mais recente do operador —
          // reabre como prévia em vez de sumir (o upload nunca mais "desaparece").
          const emAndamento = all.find((b) => b.status === "PROCESSING") ?? all.find((b) => b.status === "PREVIEW") ?? all.find((b) => b.status === "CONFIRMED");
          if (emAndamento) void openBatch(emAndamento.id);
        }
      } catch {
        /* idem */
      }
    })();
  }, [refreshHistory, openBatch]);

  /* ---------- progresso ---------- */

  useEffect(() => {
    if (!detail) return;
    // P0-01: lote CONFIRMED não avança sozinho — só pesquisa em curso justifica polling.
    // Sem isso, um lote confirmado-but-não-iniciado ficaria consultando para sempre.
    // Mesa de Contas (v0.9.0): fila de pesquisa RODANDO também mantém a tela viva.
    const filaRodando = detail.filaPesquisa?.estado === "RODANDO";
    const researchRunning = rows.some((r) => r.aiStatus === "GERANDO" || r.aiStatus === "EM_FILA" || r.researchStatus === "GERANDO");
    const active = detail.status === "PROCESSING" || detail.processingNow || researchRunning || filaRodando;
    if (!active) {
      prevStatusRef.current = detail.status;
      return;
    }
    const id = detail.id;
    const q = rowQuery;
    // P1-05: intervalo adaptativo — listas curtas respondem rápido; lotes grandes poupam as fontes.
    const pollMs = rows.length <= 12 ? 1500 : 3000;
    const timer = setInterval(async () => {
      // efeitos (aviso/atualização) ficam FORA de qualquer updater de estado
      const b = await fetchDetail(id, q, true);
      if (!b) return;
      const st = b.status;
      const stillResearching = rows.some((r) => r.aiStatus === "GERANDO" || r.aiStatus === "EM_FILA" || r.researchStatus === "GERANDO");
      const stillQueue = b.filaPesquisa?.estado === "RODANDO";
      if (st !== prevStatusRef.current && (st === "DONE" || st === "PARTIAL")) {
        // REGRA DA JORNADA: ao concluir, o filtro NUNCA herda um estado vazio —
        // a prévia abre em "Todas as contas" para o LDR revisar antes de exportar.
        setRowQuery(DEFAULT_QUERY);
        await fetchDetail(id, DEFAULT_QUERY, true);
        toast({
          title: st === "DONE" ? "Processamento concluído: revise antes de exportar" : "Processo concluído com pendências",
          description:
            st === "DONE"
              ? `${plural(b.totalEnriched, "conta pronta", "contas prontas")} para revisão${b.aiEnabled && b.aiDone > 0 ? ` · ${plural(b.aiDone, "leitura Scout pronta", "leituras Scout prontas")}` : ""}. Confira as empresas antes de exportar.`
              : `${plural(b.totalPending, "entrada", "entradas")} ${b.totalPending === 1 ? "ficou pendente" : "ficaram pendentes"} — veja no arquivo de pendências.`,
          variant: st === "DONE" ? "default" : "destructive",
        });
        void refreshHistory();
      }
      prevStatusRef.current = st;
      if ((st === "DONE" || st === "PARTIAL") && !stillResearching && !stillQueue) clearInterval(timer);
    }, pollMs);
    return () => clearInterval(timer);
  }, [detail, rows, rowQuery, fetchDetail, toast, refreshHistory]);

  /* ---------- envio (CSV) ---------- */

  const handleUpload = useCallback(async () => {
    if (!selectedFile || uploading) return;
    setUploadError(null);
    setUploadProgress(8);
    setUploading(true);
    const token = ++uploadTokenRef.current;
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    try {
      const fd = new FormData();
      fd.append("file", selectedFile, selectedFile.name);
      const res = await apiFetch("/api/imports", { method: "POST", body: fd, signal: ac.signal });
      setUploadProgress(70);
      const parsed = await parseApi<{ batch: BatchPreview }>(res);
      if (token !== uploadTokenRef.current) return; // resposta tardia: descarta
      if (!parsed.ok) {
        setUploadError(parsed.error);
        return;
      }
      const b = parsed.data.batch;
      if (!b || typeof b.id !== "string" || b.id.length === 0) {
        setUploadError("Algo deu errado ao ler o arquivo. Verifique se é um CSV válido e tente novamente.");
        return;
      }
      setUploadProgress(100);
      setPreview(b);
      setCnpjColumn(b.cnpjColumnIndex);
      setHasHeader(b.hasHeader);
      setDetail(null);
      setRows([]);
      setPagination(null);
      await refreshHistory();
      toast({ title: "Arquivo analisado", description: `${b.fileName}: ${plural(b.rowCount, "linha pronta", "linhas prontas")} para conferir.` });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // usuário trocou de arquivo
      setUploadError("Não conseguimos ler o arquivo agora. Verifique a conexão e tente novamente.");
    } finally {
      if (token === uploadTokenRef.current) {
        setUploading(false);
        setUploadProgress(0);
      }
    }
  }, [selectedFile, uploading, refreshHistory, toast]);

  /* ---------- pistas coladas ---------- */

  const handleAnalyzeText = useCallback(async () => {
    if (analyzingText || uploading) return;
    if (pastedText.trim().length === 0) {
      setUploadError("Nada foi colado. Cole CNPJs, domínios, sites, e-mails ou nomes de empresa (um por linha).");
      return;
    }
    setUploadError(null);
    setAnalyzingText(true);
    const token = ++uploadTokenRef.current;
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    try {
      const res = await apiFetch("/api/imports/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pastedText }),
        signal: ac.signal,
      });
      const parsed = await parseApi<{ batch: BatchPreview }>(res);
      if (token !== uploadTokenRef.current) return; // resposta tardia: descarta
      if (!parsed.ok) {
        setUploadError(parsed.error);
        return;
      }
      const b = parsed.data.batch;
      if (!b || typeof b.id !== "string" || b.id.length === 0) {
        setUploadError("Algo deu errado ao analisar o texto. Tente novamente.");
        return;
      }
      setPreview(b);
      setDetail(null);
      setRows([]);
      setPagination(null);
      await refreshHistory();
      toast({ title: "Pistas analisadas", description: `${plural(b.rowCount, "entrada pronta", "entradas prontas")} para conferir.` });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setUploadError("Não conseguimos analisar a colagem agora. Tente novamente.");
    } finally {
      if (token === uploadTokenRef.current) {
        setAnalyzingText(false);
      }
    }
  }, [pastedText, analyzingText, uploading, refreshHistory, toast]);

  /* ---------- confirmar ---------- */

  const handleConfirm = useCallback(async () => {
    if (!preview || confirming) return;
    setConfirming(true);
    try {
      const isText = preview.sourceType === "TEXT";
      const res = await apiFetch(`/api/imports/${preview.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isText ? {} : { cnpjColumnIndex: cnpjColumn, hasHeader }),
      });
      const parsed = await parseApi<{ batchId: string }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos iniciar", description: parsed.error, variant: "destructive" });
        return;
      }
      if (typeof parsed.data.batchId !== "string") {
        toast({ title: "Não conseguimos iniciar", description: "Tente novamente em instantes.", variant: "destructive" });
        return;
      }
      setPreview(null);
      setSelectedFile(null);
      setPastedText("");
      setEntradaAberta(false); // confirmação conclui a entrada — a estação segue com o novo lote
      await openBatch(parsed.data.batchId);
      await refreshHistory();
      // P0-01: confirmar NÃO inicia o processamento — o LDR revisa o resumo e clica
      // em "Iniciar agora" (botão do card para status CONFIRMED) quando quiser.
      toast({
        title: "Lote confirmado, pronto para iniciar",
        description: "Revise o resumo e clique em Iniciar agora quando quiser começar a identificação.",
      });
    } catch {
      toast({ title: "Falha de rede ao iniciar", variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }, [preview, confirming, cnpjColumn, hasHeader, openBatch, refreshHistory, toast]);

  /* ---------- processar / concluir pendências ---------- */

  const handleProcess = useCallback(async () => {
    if (!detail || busyAction) return;
    setBusyAction(true);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/process`, { method: "POST" });
      const parsed = await parseApi<{ started: boolean }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos iniciar agora", description: parsed.error, variant: "destructive" });
        return;
      }
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao iniciar", variant: "destructive" });
    } finally {
      setBusyAction(false);
    }
  }, [detail, busyAction, fetchDetail, rowQuery, toast]);

  /* ---------- tentar uma entrada de novo ---------- */

  const handleRetryRow = useCallback(async (rowNumber: number) => {
    if (!detail || retryingRow !== null) return;
    setRetryingRow(rowNumber);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/rows/${rowNumber}/retry`, { method: "POST" });
      const parsed = await parseApi<{ queued: boolean }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos refazer esta consulta", description: parsed.error, variant: "destructive" });
        return;
      }
      toast({ title: "Consulta refeita na fila", description: "Vamos tentar novamente em instantes. A tela atualiza sozinha." });
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao tentar de novo", variant: "destructive" });
    } finally {
      setRetryingRow(null);
    }
  }, [detail, retryingRow, fetchDetail, rowQuery, toast]);

  /* ---------- revalidação manual da ficha cadastral (v0.10.0) ---------- */

  const handleRevalidateRow = useCallback(async (rowNumber: number) => {
    if (!detail || revalidatingRow !== null) return;
    setRevalidatingRow(rowNumber);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/rows/${rowNumber}/revalidate`, { method: "POST" });
      const parsed = await parseApi<{ revalidado: boolean }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos revalidar esta ficha", description: parsed.error, variant: "destructive" });
        return;
      }
      toast({ title: "Ficha revalidada", description: "Nova consulta às fontes públicas concluída. A ficha cadastral foi substituída." });
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao revalidar", variant: "destructive" });
    } finally {
      setRevalidatingRow(null);
    }
  }, [detail, revalidatingRow, fetchDetail, rowQuery, toast]);

  /* ---------- decisão humana: confirmar a empresa certa / nova pista / não identificada ---------- */

  const handleDecideRow = useCallback(async (rowNumber: number, body: DecideRequest) => {
    if (!detail || decidingRow !== null) return;
    setDecidingRow(rowNumber);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/rows/${rowNumber}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await parseApi<{ decided: string; queued?: boolean; reaberto?: boolean }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos registrar a decisão", description: parsed.error, variant: "destructive" });
        return;
      }
      const decided = parsed.data.decided;
      if (decided === "none") {
        toast({ title: "Revisão registrada", description: "Esta pista ficou como não identificada. Nada foi forçado." });
      } else if (decided === "NOT_FOUND") {
        toast({
          title: "Pista encerrada como não identificada",
          description: "Motivo registrado: “Pistas insuficientes, revisão manual”. Os candidatos ficam arquivados e podem ser reabertos.",
        });
      } else if (decided === "CLUE_QUEUED") {
        toast({ title: "Nova pista na fila", description: "Vamos investigar de novo esta mesma linha com o que você informou. A tela atualiza sozinha." });
      } else if (decided === "BACK") {
        if (parsed.data.reaberto) {
          toast({ title: "Candidatos reabertos", description: "A revisão desta identidade voltou para a decisão." });
        }
      } else {
        toast({
          title: "Empresa identificada, falta pouco",
          description: "Estamos completando os dados desta conta agora. A tela atualiza sozinha.",
        });
      }
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao registrar a decisão", variant: "destructive" });
    } finally {
      setDecidingRow(null);
    }
  }, [detail, decidingRow, fetchDetail, rowQuery, toast]);

  /* ---------- leitura inteligente de uma linha ---------- */

  const handleRetryAiRow = useCallback(async (rowNumber: number) => {
    if (!detail || retryingAiRow !== null) return;
    setRetryingAiRow(rowNumber);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/rows/${rowNumber}/retry-ai`, { method: "POST" });
      const parsed = await parseApi<{ queued: boolean }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos enfileirar a leitura", description: parsed.error, variant: "destructive" });
        return;
      }
      toast({ title: "Leitura na fila", description: "A leitura desta conta fica pronta em instantes. A tela atualiza sozinha." });
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao pedir a leitura", variant: "destructive" });
    } finally {
      setRetryingAiRow(null);
    }
  }, [detail, retryingAiRow, fetchDetail, rowQuery, toast]);

  /* ---------- pesquisa profunda da conta (nível 2) ---------- */

  const handleDeepResearch = useCallback(async (rowNumber: number, modo: "COMPLETO" | "ADAPTATIVO" = "COMPLETO") => {
    if (!detail || deepResearchRow !== null) return;
    setDeepResearchRow(rowNumber);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/rows/${rowNumber}/deep-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo }),
      });
      const parsed = await parseApi<{ started: boolean }>(res);
      if (!parsed.ok) {
        toast({ title: "Não conseguimos iniciar a pesquisa profunda", description: parsed.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Pesquisa profunda iniciada",
        description: "Vamos rastrear o site oficial e cruzar buscas públicas. O dossiê profundo fica pronto em instantes.",
      });
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao iniciar a pesquisa profunda", variant: "destructive" });
    } finally {
      setDeepResearchRow(null);
    }
  }, [detail, deepResearchRow, fetchDetail, rowQuery, toast]);

  /* ---------- Mesa de Contas: fila de pesquisa por seleção ---------- */

  const handleFilaPesquisa = useCallback(
    async (acao: "iniciar" | "parar" | "retomar", rowNumbers: number[], modo: "COMPLETO" | "ADAPTATIVO" = "COMPLETO") => {
      if (!detail) return;
      try {
        const res = await apiFetch(`/api/imports/${detail.id}/research-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao, rowNumbers, modo }),
        });
        const parsed = await parseApi<{ mensagem?: string; enfileiradas?: number }>(res);
        if (!parsed.ok) {
          toast({ title: "A fila não foi iniciada", description: parsed.error, variant: "destructive" });
          return;
        }
        const titulos: Record<typeof acao, string> = {
          iniciar: `Fila de pesquisa iniciada${parsed.data.enfileiradas ? ` · ${plural(parsed.data.enfileiradas, "conta", "contas")}` : ""}`,
          parar: "Fila interrompida",
          retomar: "Fila retomada",
        };
        toast({ title: titulos[acao], description: parsed.data.mensagem ?? "O progresso aparece acima da tabela." });
        await fetchDetail(detail.id, rowQuery, true);
      } catch {
        toast({ title: "Falha de rede na fila de pesquisa", variant: "destructive" });
      }
    },
    [detail, fetchDetail, rowQuery, toast]
  );

  /* ---------- leituras que faltam ---------- */

  const handleRetryAiAll = useCallback(async () => {
    if (!detail || retryAllBusy) return;
    setRetryAllBusy(true);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/retry-ai-all`, { method: "POST" });
      const parsed = await parseApi<{ queued: number }>(res);
      if (!parsed.ok) {
        toast({ title: "Nenhuma leitura reenfileirada", description: parsed.error, variant: "destructive" });
        return;
      }
      toast({ title: `${plural(parsed.data.queued, "leitura", "leituras")} na fila`, description: "As leituras ficam prontas em instantes. A tela atualiza sozinha." });
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      toast({ title: "Falha de rede ao enfileirar as leituras", variant: "destructive" });
    } finally {
      setRetryAllBusy(false);
    }
  }, [detail, retryAllBusy, fetchDetail, rowQuery, toast]);

  /* ---------- leitura do conjunto ---------- */

  const handleBatchSummary = useCallback(async () => {
    if (!detail || summaryBusy) return;
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/ai-summary`, { method: "POST" });
      const parsed = await parseApi<{ summary: unknown }>(res);
      if (!parsed.ok) {
        setSummaryError(parsed.error);
        return;
      }
      toast({ title: "Leitura do conjunto pronta", description: "Veja em \"Leitura do conjunto\", acima da tabela." });
      await fetchDetail(detail.id, rowQuery, true);
    } catch {
      setSummaryError("Não conseguimos preparar a leitura do conjunto agora. Tente novamente.");
    } finally {
      setSummaryBusy(false);
    }
  }, [detail, summaryBusy, fetchDetail, rowQuery, toast]);

  /* ---------- arquivar ---------- */

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await apiFetch(`/api/imports/${id}`, { method: "DELETE" });
        const parsed = await parseApi<{ deleted: string }>(res);
        if (!parsed.ok) {
          toast({ title: "Não conseguimos arquivar", description: parsed.error, variant: "destructive" });
          return;
        }
        if (detail?.id === id) {
          setDetail(null);
          setRows([]);
          setPagination(null);
        }
        await refreshHistory();
        toast({ title: "Lote arquivado" });
      } catch {
        toast({ title: "Falha de rede ao arquivar", variant: "destructive" });
      }
    },
    [detail, refreshHistory, toast]
  );

  /* ---------- render ---------- */

  return (
    <MotionRoot>
    <div className="flex min-h-screen flex-col bg-transparent">
      {/* fundo vivo: aurora esmeralda — o vidro precisa de luz atrás dele */}
      <AuroraBackground />

      {/* assinatura visual: degradê verde oficial com brilho que percorre */}
      <div className="senior-cover-strip" aria-hidden="true" />

      {/* header compacto e reativo: colapsa com o scroll, barra de leitura, varredura de luz */}
      <AppHeader />

      {/* G9: sessão do servidor — desbloqueio por token quando o ambiente é TOKEN; invisível em OPEN */}
      <AuthGate />

      {/* v0.11.0 (Entrega B): com lote aberto a página passa a ser ESTAÇÃO — o contêiner
          ganha a largura disponível (24–32px de margem) e o hero de entrada some. */}
      <main
        className={`mx-auto w-full flex-1 px-4 pb-[50px] sm:px-6 ${mesaAtiva ? "max-w-[1720px] lg:px-8" : "max-w-[1140px]"}`}
        data-testid="main"
      >
        {!mesaAtiva && (
        <>
        {/* v0.10.12: hero SEM animação de entrada — título e entrada visíveis no primeiro paint
            (contrato: priorizar título, entrada e resultado imediatos; sem atraso de leitura) */}
        <div className="pb-12 pt-10 sm:pb-14 sm:pt-16">
          <div>
            <span className="glass-chip mb-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold tracking-[0.08em] text-[#086B6B]">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00968C]" />
              </span>
              ENRIQUECIMENTO DE CONTAS
            </span>
            <h1 className="ds-display text-4xl leading-tight sm:text-[44px] sm:leading-[1.1]">
              <span className="text-degrade-esmeralda">Scout 360</span>
            </h1>
            <p className="ds-lead mt-4 max-w-2xl text-senior-cinza-600">
              Comece com o CNPJ, site ou nome da empresa. O Scout reúne informações de fontes públicas,
              mostra o que já está confirmado e aponta o que ainda precisa ser validado.
            </p>
          </div>
        </div>

        <div className="space-y-[50px]">
          <UploadCard
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            uploading={uploading}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
            onDismissError={() => setUploadError(null)}
            onUpload={handleUpload}
            preview={preview}
            onDiscardPreview={() => {
              setPreview(null);
              setSelectedFile(null);
            }}
            pastedText={pastedText}
            onPastedTextChange={setPastedText}
            onAnalyzeText={handleAnalyzeText}
            analyzingText={analyzingText}
          />

          {preview && (
            <PreviewCard
              preview={preview}
              confirming={confirming}
              cnpjColumn={cnpjColumn}
              hasHeader={hasHeader}
              onCnpjColumnChange={setCnpjColumn}
              onHasHeaderChange={setHasHeader}
              onConfirm={handleConfirm}
            />
          )}

          {/* v0.10.11: laboratório experimental FORA da jornada comercial —
              capacidade preservada em src/components/cnpj/lab-panel.tsx, acessível
              apenas com SCOUT_LAB_ENABLED=1 (área técnica protegida no servidor). */}

          <HistoryCard history={history} activeId={preview?.id ?? null} onOpen={openBatch} onDelete={handleDelete} />
        </div>
        </>
        )}

        {mesaAtiva && (
          <>
          {/* CABEÇALHO OPERACIONAL COMPACTO — o lote aberto governa a página; entrada de
              dados e histórico ficam a um comando, sem dominar a jornada (contrato 3). */}
          <div className="pt-5 sm:pt-6" data-testid="mesa-topbar">
            <div className="sn-surface glass-reflex flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="ds-body flex min-w-0 flex-wrap items-center gap-2 font-semibold text-senior-azul">
                  <span className="truncate" data-testid="mesa-lote-nome" title={detail?.fileName ?? "Nova entrada"}>
                    {detail?.fileName ?? "Nova entrada"}
                  </span>
                  {detail && <BatchStateBadge status={detail.status} />}
                </p>
                <p className="ds-caption mt-0.5 text-senior-cinza-600">
                  Mesa de investigação — lista, ficha e consultas numa única jornada.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-[8px] border-senior-cinza-300 text-[#086B6B] hover:bg-[#00968C14]"
                  onClick={() => setEntradaAberta((v) => !v)}
                  aria-expanded={entradaAberta}
                  data-testid="btn-nova-entrada"
                >
                  {entradaAberta ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {entradaAberta ? "Fechar entrada" : "Nova entrada"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-[8px] border-senior-cinza-300 text-senior-azul"
                      data-testid="btn-lotes"
                    >
                      <History className="h-4 w-4" /> Lotes <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto sn-scroll" data-testid="menu-lotes">
                    <DropdownMenuLabel>Lotes anteriores</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {history.length === 0 && (
                      <p className="ds-caption px-2 py-3 text-senior-cinza-600">Nenhum lote no histórico.</p>
                    )}
                    {history.map((b) => (
                      <DropdownMenuItem
                        key={b.id}
                        onClick={() => void openBatch(b.id)}
                        className="gap-2"
                        data-testid={`menu-lote-${b.id}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-senior-azul">{b.fileName}</span>
                          <span className="ds-caption block truncate text-senior-cinza-600">
                            {b.status === "DONE" ? "Concluído" : b.status === "PARTIAL" ? "Concluído com pendências" : b.status === "CONFIRMED" ? "Aguardando início" : b.status === "PROCESSING" ? "Em execução" : b.status === "PREVIEW" ? "Prévia não confirmada" : b.status}
                            {" · "}{plural(b.rowCount, "linha", "linhas")}
                          </span>
                        </span>
                        {detail?.id === b.id && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00968C]" aria-label="aberto agora" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {/* entrada por comando: só ocupa a página enquanto o operador pediu */}
            {entradaAberta && (
              <div className="mt-4 space-y-[25px]" data-testid="entrada-painel">
                <UploadCard
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                  uploading={uploading}
                  uploadProgress={uploadProgress}
                  uploadError={uploadError}
                  onDismissError={() => setUploadError(null)}
                  onUpload={handleUpload}
                  preview={preview}
                  onDiscardPreview={() => {
                    setPreview(null);
                    setSelectedFile(null);
                  }}
                  pastedText={pastedText}
                  onPastedTextChange={setPastedText}
                  onAnalyzeText={handleAnalyzeText}
                  analyzingText={analyzingText}
                />
                {preview && (
                  <PreviewCard
                    preview={preview}
                    confirming={confirming}
                    cnpjColumn={cnpjColumn}
                    hasHeader={hasHeader}
                    onCnpjColumnChange={setCnpjColumn}
                    onHasHeaderChange={setHasHeader}
                    onConfirm={handleConfirm}
                  />
                )}
              </div>
            )}
          </div>
          {detail && (
            <div data-testid="batch-section" className="mt-5 scroll-mt-24">
              <BatchDetailCard
                detail={detail}
                rows={rows}
                pagination={pagination}
                events={events}
                busy={busyAction}
                retryingRow={retryingRow}
                retryingAiRow={retryingAiRow}
                retryAllBusy={retryAllBusy}
                summaryBusy={summaryBusy}
                summaryError={summaryError}
                decidingRow={decidingRow}
                kindFilter={rowQuery.cnpj}
                outcomeFilter={rowQuery.lookup}
                situationFilter={rowQuery.resolucao}
                search={rowQuery.q}
                onSearchChange={handleSearch}
                onProcess={handleProcess}
                onRetryRow={handleRetryRow}
                onRetryAiRow={handleRetryAiRow}
                onRetryAiAll={handleRetryAiAll}
                onBatchSummary={handleBatchSummary}
                onDecideRow={handleDecideRow}
                onDeepResearch={handleDeepResearch}
                deepResearchingRow={deepResearchRow}
                onFilaPesquisa={handleFilaPesquisa}
                pesquisaFilter={rowQuery.pesquisa}
                canExport={detail.status === "DONE" || detail.status === "PARTIAL"}
                onPageChange={(p) => void applyQuery({ page: p })}
                onFilterChange={(patch) => void applyQuery(patch)}
                initialDossierRow={deepDossierRow}
                revalidatingRow={revalidatingRow}
                onRevalidateRow={handleRevalidateRow}
              />
            </div>
          )}
          </>
        )}
      </main>

      <footer className="glass-strong mt-auto border-x-0 border-b-0" data-testid="footer">
        <div className="mx-auto flex max-w-[1140px] flex-col items-center justify-between gap-3 px-4 py-4 pb-[max(16px,env(safe-area-inset-bottom))] text-center sm:flex-row sm:px-6 sm:text-left">
          <p className="ds-caption flex items-center gap-1.5 text-senior-cinza-600">
            <ListChecks className="h-3.5 w-3.5 text-[#00968C]" aria-hidden="true" />
            <span><b className="font-semibold text-senior-azul">Scout 360</b> · Enriquecimento de contas</span>
          </p>
          <p className="ds-caption max-w-md text-senior-cinza-600">
            Informações reunidas de fontes públicas. Confirme os dados com a empresa antes das decisões.
          </p>

        </div>
      </footer>
    </div>
    </MotionRoot>
  );
}
