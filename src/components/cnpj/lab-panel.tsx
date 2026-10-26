"use client";

/**
 * LabPanel — Lote B: laboratório de modelos externos (EXPERIMENTAL).
 *
 * Fluxo desenhado pelo contrato:
 *  1. Operador informa Base URL + API key descartável + Model ID (APIs compatíveis
 *     com OpenAI). A chave fica SÓ no servidor (memória, sessão, TTL, descarte).
 *  2. "Testar conexão" faz GET /models — NÃO dispara inferência (custo zero).
 *  3. Operador escolhe uma conta COM pesquisa salva e clica "Comparar" — esse
 *     clique é a autorização expressa de envio do pacote ao provedor externo.
 *     O resultado é EXPERIMENTAL (nunca substitui o dossiê oficial).
 *  4. Comparação lado a lado: mesmo pacote (hash), mesmo prompt (versão), provedores
 *     diferentes. Latência, tokens REPORTADOS (ou "não informado"), erro e buscas
 *     reutilizadas ficam visíveis. Custos não reportados pela API não são inventados.
 *
 * Provedor padrão: Z.ai nativo e gratuito — este painel NUNCA o substitui nem
 * faz fallback automático.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FlaskConical, KeyRound, Link2, RefreshCw, ShieldAlert, Trash2, Unplug, Loader2, ChevronDown } from "lucide-react";
import { plural } from "@/lib/linguagem";

interface LabStatus {
  configurado: boolean;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  modelId: string | null;
  expiraEm: string | null;
  ttlRestanteS: number | null;
  chavePresente: boolean;
  chaveTamanho: number | null;
}

interface LabStatusRes {
  ok: boolean;
  status: LabStatus;
  ttlMinutos: number;
}

interface ProbeRes {
  ok: boolean;
  code: string;
  message?: string;
  probe: {
    modeloSolicitado: string;
    modelos: string[];
    modeloPresente: boolean | null;
    duracaoMs: number;
    httpStatus: number | null;
  };
}

export interface EquivalenciaVerdict {
  estado: "EQUIVALENTE" | "NAO_EQUIVALENTE" | "HISTORICA";
  motivo: string;
}

interface ComparacaoMeta {
  id: string;
  provider: string;
  modelRequested: string;
  modelEffective: string | null;
  promptVersion: string;
  evidenceChars: number;
  evidenceHash: string;
  packetReuse: boolean;
  parsedOk: boolean;
  equivalencia?: EquivalenciaVerdict | null;
  tokens: { prompt: number | null; completion: number | null; total: number | null; informed: boolean } | null;
  durationMs: number;
  httpStatus: number | null;
  estadoFinal: string;
  content: string | null;
  error: string | null;
  createdAt: string;
}

interface ContaOpcao {
  batchId: string;
  batchArquivo: string;
  rowId: string;
  rowNumber: number;
  empresa: string;
  cnpj: string | null;
  temPesquisa: boolean;
  temDossie: boolean;
  dossieSintese: string | null;
  dossieModelo: string | null;
  dossieTokens: { prompt: number | null; completion: number | null; total: number | null } | null;
}

interface BatchItem {
  id: string;
  fileName: string;
}

function fmtDur(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
function fmtTok(v: number | null): string {
  return typeof v === "number" ? v.toLocaleString("pt-BR") : "—";
}
function fmtHash(h: string | null | undefined): string {
  return h ? `${h.slice(0, 12)}…` : "—";
}

/** Campos esperados no dossiê experimental (mesma estrutura do oficial profundo). */
const CAMPOS_DOSSIE = ["sintese_executiva", "quem_e", "o_que_faz", "escala_estrutura", "tecnologia_observada", "evidencias", "nao_sabemos", "hipoteses"] as const;

/** Leitura estrutural do JSON experimental: campos presentes/ausentes + contagem de evidências por status. */
function resumoEstrutura(exp: Record<string, unknown> | null): { presentes: string[]; ausentes: string[]; evidPorStatus: Record<string, number> } | null {
  if (!exp) return null;
  const presentes: string[] = [];
  const ausentes: string[] = [];
  for (const k of CAMPOS_DOSSIE) {
    const v = exp[k];
    const tem = Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v != null;
    (tem ? presentes : ausentes).push(k);
  }
  const evidPorStatus: Record<string, number> = {};
  const evid = exp.evidencias;
  if (Array.isArray(evid)) {
    for (const e of evid) {
      const st = e && typeof e === "object" && "status" in e ? String((e as { status: unknown }).status) : "sem_status";
      evidPorStatus[st] = (evidPorStatus[st] ?? 0) + 1;
    }
  }
  return { presentes, ausentes, evidPorStatus };
}

/** Extrai o JSON do conteúdo do modelo (tolera cercas de código). */
function tryParseDossier(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try {
    const obj = JSON.parse(text) as unknown;
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function parseLab<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const json = (await res.json()) as { ok?: boolean; error?: { message?: string }; message?: string } & Record<string, unknown>;
    if (res.ok && json.ok) return { ok: true, data: json as unknown as T };
    return { ok: false, error: json.error?.message ?? json.message ?? `Falha (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: `Falha de rede (HTTP ${res.status}).` };
  }
}

export function LabPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LabStatusRes | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "discard" | "compare" | "contas">("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro" | "info"; texto: string } | null>(null);
  const [probe, setProbe] = useState<ProbeRes | null>(null);

  const [contas, setContas] = useState<ContaOpcao[]>([]);
  const [contaSel, setContaSel] = useState<string>("");
  const [comparacao, setComparacao] = useState<ComparacaoMeta | null>(null);
  // v0.9.0 (E5): histórico legível da conta selecionada — modelo, data, estado, equivalência
  const [historico, setHistorico] = useState<ComparacaoMeta[]>([]);

  const carregarStatus = useCallback(async () => {
    const r = await parseLab<LabStatusRes>(await fetch("/api/lab/config", { cache: "no-store" }));
    if (r.ok && r.data) {
      setStatus(r.data);
      if (r.data.status.configurado) setModelId(r.data.status.modelId ?? "");
    }
  }, []);

  useEffect(() => {
    void carregarStatus();
  }, [carregarStatus]);

  const carregarContas = useCallback(async () => {
    setBusy("contas");
    try {
      const lotesRes = await fetch("/api/imports", { cache: "no-store" });
      const lotesJson = (await lotesRes.json()) as { ok?: boolean; batches?: BatchItem[] };
      const lotes = (lotesJson.batches ?? []).slice(0, 12);
      const achadas: ContaOpcao[] = [];
      for (const lote of lotes) {
        const detRes = await fetch(`/api/imports/${lote.id}`, { cache: "no-store" });
        if (!detRes.ok) continue;
        const det = (await detRes.json()) as {
          rows?: {
            id?: string;
            rowNumber: number;
            legalName: string | null;
            tradeName: string | null;
            normalizedCnpj: string | null;
            researchStatus: string | null;
            aiDossier?: { sintese?: string; modeloAuditoria?: { efetivo?: string }; tokens?: { prompt?: number | null; completion?: number | null; total?: number | null } } | null;
            aiModel?: string | null;
          }[];
        };
        for (const row of det.rows ?? []) {
          if (!row.id) continue;
          const temPesquisa = row.researchStatus === "OK";
          if (!temPesquisa) continue;
          const dossie = row.aiDossier ?? null;
          achadas.push({
            batchId: lote.id,
            batchArquivo: lote.fileName,
            rowId: row.id,
            rowNumber: row.rowNumber,
            empresa: row.legalName || row.tradeName || `linha ${row.rowNumber}`,
            cnpj: row.normalizedCnpj,
            temPesquisa,
            temDossie: !!dossie,
            dossieSintese: dossie?.sintese ?? null,
            dossieModelo: dossie?.modeloAuditoria?.efetivo ?? row.aiModel ?? null,
            dossieTokens: dossie?.tokens
              ? { prompt: dossie.tokens.prompt ?? null, completion: dossie.tokens.completion ?? null, total: dossie.tokens.total ?? null }
              : null,
          });
        }
        if (achadas.length >= 30) break;
      }
      setContas(achadas);
      if (achadas.length === 0) setMsg({ tipo: "info", texto: "Nenhuma conta com pesquisa salva nos lotes recentes. Rode a pesquisa profunda de uma conta primeiro." });
    } finally {
      setBusy("");
    }
  }, []);

  const salvar = async () => {
    setBusy("save");
    setMsg(null);
    setProbe(null);
    try {
      const r = await parseLab<LabStatusRes & { aviso?: string }>(
        await fetch("/api/lab/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl, apiKey, modelId }),
        })
      );
      if (r.ok && r.data) {
        setStatus(r.data);
        setApiKey(""); // a chave nunca vive no cliente depois de salvar
        setMsg({ tipo: "ok", texto: r.data.aviso ?? "Credencial guardada na memória do servidor (vínculo com esta sessão)." });
      } else {
        setMsg({ tipo: "erro", texto: r.error ?? "Não foi possível salvar." });
      }
    } finally {
      setBusy("");
    }
  };

  const testar = async () => {
    setBusy("test");
    setMsg(null);
    try {
      const r = await parseLab<ProbeRes>(await fetch("/api/lab/test", { method: "POST" }));
      if (r.data) setProbe(r.data);
      if (!r.ok && r.error) setMsg({ tipo: "erro", texto: r.error });
    } finally {
      setBusy("");
    }
  };

  const descartar = async () => {
    setBusy("discard");
    try {
      await fetch("/api/lab/config", { method: "DELETE" });
      setStatus({ ok: true, status: { configurado: false, baseUrlHost: null, baseUrlPath: null, modelId: null, expiraEm: null, ttlRestanteS: null, chavePresente: false, chaveTamanho: null }, ttlMinutos: status?.ttlMinutos ?? 60 });
      setProbe(null);
      setComparacao(null);
      setMsg({ tipo: "info", texto: "Credencial descartada da memória do servidor." });
    } finally {
      setBusy("");
    }
  };

  const comparar = async () => {
    if (!contaSel) return;
    setBusy("compare");
    setMsg(null);
    setComparacao(null);
    try {
      const r = await parseLab<{ comparacao: ComparacaoMeta; equivalencia?: EquivalenciaVerdict }>(
        await fetch("/api/lab/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: contaSel }),
        })
      );
      if (r.data?.comparacao) setComparacao({ ...r.data.comparacao, equivalencia: r.data.equivalencia ?? r.data.comparacao.equivalencia ?? null });
      if (!r.ok) setMsg({ tipo: "erro", texto: r.error ?? "A comparação falhou." });
      else if (r.data?.comparacao?.estadoFinal === "OK") setMsg({ tipo: "ok", texto: "Comparação concluída — resultado experimental salvo à parte do dossiê oficial." });
      await carregarHistorico(contaSel); // histórico atualiza inclusive em falha (estado ERRO é histórico honesto)
    } finally {
      setBusy("");
    }
  };

  const carregarHistorico = useCallback(async (rowId: string) => {
    try {
      const r = await parseLab<{ comparacoes: ComparacaoMeta[] }>(await fetch(`/api/lab/compare?rowId=${encodeURIComponent(rowId)}`, { cache: "no-store" }));
      setHistorico(r.ok && r.data?.comparacoes ? r.data.comparacoes : []);
    } catch {
      setHistorico([]);
    }
  }, []);

  useEffect(() => {
    if (!contaSel) {
      setHistorico([]);
      return;
    }
    void carregarHistorico(contaSel);
  }, [contaSel, carregarHistorico]);

  const conta = useMemo(() => contas.find((c) => c.rowId === contaSel) ?? null, [contas, contaSel]);
  const exp = comparacao ? tryParseDossier(comparacao.content) : null;
  const estruturaExp = useMemo(() => resumoEstrutura(exp), [exp]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="lab-panel">
      <div className="overflow-hidden rounded-2xl border border-[#DCE9E6] bg-white/70 shadow-[0_1px_2px_rgba(31,42,46,0.04)] backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#F3FAF8]"
            data-testid="lab-toggle"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#E8F6F2]">
              <FlaskConical className="size-4.5 text-[#086B6B]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[15px] font-semibold text-[#1F2A2E]">Laboratório de modelos externos</span>
                <Badge variant="outline" className="border-[#BFE3DB] bg-[#F3FAF8] text-[10px] font-bold uppercase tracking-wider text-[#086B6B]">
                  Lote B · experimental
                </Badge>
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-[#5C6B70]">
                Compare um modelo externo (API compatível com OpenAI) com o GLM nativo usando as mesmas evidências e o mesmo prompt.
              </span>
            </span>
            <ChevronDown className={`size-4 shrink-0 text-[#5C6B70] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-[#EAF2F0] px-5 py-5">
            {/* aviso de privacidade e de escopo — honesto e curto */}
            <div className="mb-5 flex gap-2.5 rounded-xl border border-[#F3E3C2] bg-[#FDF8EE] px-3.5 py-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#9A6B15]" aria-hidden />
              <p className="text-[12.5px] leading-relaxed text-[#6B5426]">
                <strong>Experimental.</strong> A API key fica somente na memória do servidor, vinculada a esta sessão, com expiração
                automática ({status?.ttlMinutos ?? 60} min) e descarte — nunca no banco, em ZIP ou em log. O provedor padrão continua
                sendo o <strong>Z.ai nativo e gratuito</strong>; não existe fallback automático. Ao executar uma comparação, o pacote de
                evidências da conta é enviado ao provedor externo — envie dados que você tem autorização de compartilhar. Em ambiente
                público de Preview, prefira validar com o provedor mock local antes de usar sua chave real.
              </p>
            </div>

            {/* 1. credencial */}
            <section aria-label="Credencial do provedor externo" className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#1F2A2E]">1 · Credencial do provedor</h3>
                {status?.status.configurado ? (
                  <Badge data-testid="lab-status-configurado" className="border-transparent bg-[#E8F6F2] text-[#086B6B]">
                    <Link2 className="mr-1 size-3" aria-hidden />
                    {status.status.baseUrlHost}
                    {status.status.baseUrlPath ?? ""}
                    {" · "}
                    {status.status.modelId}
                    {status.status.ttlRestanteS != null ? ` · expira em ${Math.ceil(status.status.ttlRestanteS / 60)} min` : ""}
                  </Badge>
                ) : (
                  <Badge data-testid="lab-status-vazio" variant="outline" className="border-[#DCE9E6] text-[#5C6B70]">
                    não configurado
                  </Badge>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="lab-baseurl">Base URL (compatível com OpenAI)</Label>
                  <Input
                    id="lab-baseurl"
                    data-testid="lab-baseurl"
                    placeholder="https://api.fornecedor.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="lab-modelid">Model ID</Label>
                  <Input
                    id="lab-modelid"
                    data-testid="lab-modelid"
                    placeholder="ex.: gpt-4o-mini, deepseek-chat"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="lab-apikey" className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5 text-[#5C6B70]" aria-hidden />
                    API key descartável
                  </Label>
                  <Input
                    id="lab-apikey"
                    data-testid="lab-apikey"
                    type="password"
                    placeholder={status?.status.chavePresente ? "•••••••• (guardada no servidor — deixe vazio para manter)" : "cole a chave; ela não volta para o navegador"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="min-h-9" onClick={salvar} disabled={busy !== "" || !baseUrl.trim() || !modelId.trim() || (!apiKey.trim() && !status?.status.configurado)} data-testid="lab-salvar">
                  {busy === "save" ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : null}
                  Salvar credencial
                </Button>
                <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={testar} disabled={busy !== "" || !status?.status.configurado} data-testid="lab-testar">
                  {busy === "test" ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Unplug className="mr-1.5 size-4" aria-hidden />}
                  Testar conexão (sem inferência)
                </Button>
                <Button type="button" size="sm" variant="ghost" className="min-h-9 text-[#8C2F39] hover:bg-[#8C2F3910] hover:text-[#8C2F39]" onClick={descartar} disabled={busy !== "" || !status?.status.configurado} data-testid="lab-descartar">
                  {busy === "discard" ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Trash2 className="mr-1.5 size-4" aria-hidden />}
                  Descartar agora
                </Button>
              </div>

              {msg && (
                <p role={msg.tipo === "erro" ? "alert" : undefined} data-testid="lab-msg" className={`text-[13px] leading-relaxed ${msg.tipo === "erro" ? "text-[#8C2F39]" : msg.tipo === "ok" ? "text-[#0A7A5C]" : "text-[#5C6B70]"}`}>
                  {msg.texto}
                </p>
              )}

              {probe && (
                <div data-testid="lab-probe" className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${probe.ok ? "border-[#BFE3DB] bg-[#F3FAF8]" : "border-[#F0D5D2] bg-[#FBF1F0]"}`}>
                  {probe.ok ? (
                    <>
                      <strong>Conexão OK</strong> — HTTP {probe.probe.httpStatus} em {fmtDur(probe.probe.duracaoMs)}, {plural(probe.probe.modelos.length, "modelo listado", "modelos listados")}.
                      {probe.probe.modeloPresente === true && <> O Model ID <strong>{probe.probe.modeloSolicitado}</strong> está na lista.</>}
                      {probe.probe.modeloPresente === false && (
                        <> <span className="text-[#9A6B15]">Atenção:</span> o Model ID <strong>{probe.probe.modeloSolicitado}</strong> NÃO aparece na lista — a chamada pode falhar por nome errado.</>
                      )}
                      {probe.probe.modeloPresente === null && <> A lista de modelos não pôde ser usada para verificar o Model ID.</>}
                      <span className="mt-1 block text-[12px] text-[#5C6B70]">Nenhuma inferência foi disparada — este teste não consome tokens.</span>
                    </>
                  ) : (
                    <>
                      <strong>Conexão falhou</strong>
                      {probe.probe.httpStatus ? ` — HTTP ${probe.probe.httpStatus}` : ""} em {fmtDur(probe.probe.duracaoMs)}. {probe.message ?? "Sem detalhes do provedor."}
                    </>
                  )}
                </div>
              )}
            </section>

            {/* 2. comparação */}
            <section aria-label="Comparação de modelos" className="mt-6 grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#1F2A2E]">2 · Comparar com o GLM nativo</h3>
                <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={carregarContas} disabled={busy !== ""} data-testid="lab-carregar-contas">
                  {busy === "contas" ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1.5 size-4" aria-hidden />}
                  Listar contas com pesquisa salva
                </Button>
              </div>

              {contas.length > 0 && (
                <div className="grid gap-1.5">
                  <Label htmlFor="lab-conta">Conta (pesquisa já salva — o pacote é reutilizado, 0 buscas novas)</Label>
                  <select
                    id="lab-conta"
                    data-testid="lab-conta"
                    value={contaSel}
                    onChange={(e) => setContaSel(e.target.value)}
                    className="h-10 rounded-lg border border-[#DCE9E6] bg-white px-3 text-[14px] text-[#1F2A2E] focus:outline-none focus:ring-2 focus:ring-[#00968C]"
                  >
                    <option value="">Selecione…</option>
                    {contas.map((c) => (
                      <option key={c.rowId} value={c.rowId}>
                        {c.empresa}
                        {c.cnpj ? ` · ${c.cnpj}` : ""} · lote {c.batchArquivo}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="min-h-9 max-w-full whitespace-normal sm:whitespace-nowrap" onClick={comparar} disabled={busy !== "" || !status?.status.configurado || !contaSel} data-testid="lab-comparar">
                  {busy === "compare" ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <FlaskConical className="mr-1.5 size-4" aria-hidden />}
                  Executar comparação (envia o pacote ao provedor externo)
                </Button>
                {busy === "compare" && <span className="text-[12.5px] text-[#5C6B70]">Consultando o provedor externo… sem retry automático.</span>}
              </div>

              {conta && (
                <div className="rounded-xl border border-[#EAF2F0] bg-[#FBFDFC] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#5C6B70]">
                  <strong className="text-[#1F2A2E]">{conta.empresa}</strong>
                  {conta.cnpj ? ` · CNPJ ${conta.cnpj}` : ""} — dossiê oficial gerado por {conta.dossieModelo ?? "GLM nativo"}. O resultado experimental vai para a tabela
                  separada <code className="rounded bg-[#F0F6F4] px-1">LabComparison</code> e NUNCA substitui o dossiê oficial desta conta.
                </div>
              )}

              {comparacao && (
                <div data-testid="lab-resultado" className="mt-2 grid gap-3">
                  {/* VEREDITO DE EQUIVALÊNCIA — reconciliado com os hashes do dossiê oficial.
                      Só "A/B equivalente" quando evidência + prompt + temperatura conferem AGORA. */}
                  {comparacao.equivalencia && (
                    <div
                      data-testid={`lab-equivalencia-${comparacao.equivalencia.estado.toLowerCase()}`}
                      role="status"
                      className={`rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed ${
                        comparacao.equivalencia.estado === "EQUIVALENTE"
                          ? "border-[#BFE3DB] bg-[#F3FAF8] text-[#086B6B]"
                          : "border-[#F3E3C2] bg-[#FDF8EE] text-[#6B5426]"
                      }`}
                    >
                      <strong className="font-semibold">
                        {comparacao.equivalencia.estado === "EQUIVALENTE"
                          ? "A/B equivalente (hashes reconciliados)."
                          : comparacao.equivalencia.estado === "HISTORICA"
                            ? "Comparação histórica — entradas não comprovadamente equivalentes."
                            : "Entradas não equivalentes."}
                      </strong>{" "}
                      {comparacao.equivalencia.motivo}
                    </div>
                  )}
                  {/* métricas da execução experimental */}
                  <div className="overflow-hidden rounded-xl border border-[#DCE9E6]">
                    <table className="w-full text-[13px]">
                      <tbody className="divide-y divide-[#EAF2F0]">
                        <tr className="bg-[#FBFDFC]">
                          <th scope="row" className="px-3.5 py-2 text-left font-semibold text-[#1F2A2E]">Provedor (fonte)</th>
                          <td className="px-3.5 py-2 text-[#5C6B70]" data-testid="lab-metrica-provedor">{comparacao.provider} (laboratório)</td>
                        </tr>
                        <tr>
                          <th scope="row" className="px-3.5 py-2 text-left font-semibold text-[#1F2A2E]">Modelo solicitado → efetivo</th>
                          <td className="px-3.5 py-2 text-[#5C6B70]" data-testid="lab-metrica-modelo">
                            {comparacao.modelRequested} → {comparacao.modelEffective ?? "não informado"}
                          </td>
                        </tr>
                        <tr className="bg-[#FBFDFC]">
                          <th scope="row" className="px-3.5 py-2 text-left font-semibold text-[#1F2A2E]">Latência</th>
                          <td className="px-3.5 py-2 text-[#5C6B70]" data-testid="lab-metrica-latencia">{fmtDur(comparacao.durationMs)}</td>
                        </tr>
                        <tr>
                          <th scope="row" className="px-3.5 py-2 text-left font-semibold text-[#1F2A2E]">Tokens (reportados)</th>
                          <td className="px-3.5 py-2 text-[#5C6B70]" data-testid="lab-metrica-tokens">
                            {comparacao.tokens?.informed
                              ? `prompt ${fmtTok(comparacao.tokens.prompt)} · completion ${fmtTok(comparacao.tokens.completion)} · total ${fmtTok(comparacao.tokens.total)}`
                              : "não informado pela API (nunca inventamos custo)"}
                          </td>
                        </tr>
                        <tr className="bg-[#FBFDFC]">
                          <th scope="row" className="px-3.5 py-2 text-left font-semibold text-[#1F2A2E]">Evidências / prompt</th>
                          <td className="px-3.5 py-2 text-[#5C6B70]">
                            pacote reutilizado ({comparacao.evidenceChars.toLocaleString("pt-BR")} chars · sha {fmtHash(comparacao.evidenceHash)}) · prompt v{comparacao.promptVersion} · 0 buscas novas
                          </td>
                        </tr>
                        <tr>
                          <th scope="row" className="px-3.5 py-2 text-left font-semibold text-[#1F2A2E]">Estado</th>
                          <td className="px-3.5 py-2 text-[#5C6B70]" data-testid="lab-metrica-estado">
                            {comparacao.estadoFinal}
                            {comparacao.httpStatus ? ` · HTTP ${comparacao.httpStatus}` : ""}
                            {comparacao.error ? ` — ${comparacao.error}` : ""}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* lado a lado */}
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-[#DCE9E6] bg-white/80 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Badge className="border-transparent bg-[#E8F6F2] text-[#086B6B]">Oficial · Z.ai nativo (GLM)</Badge>
                        <span className="text-[11.5px] text-[#5C6B70]">{conta?.dossieModelo ?? "—"}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#1F2A2E]" data-testid="lab-dossie-nativo">
                        {conta?.dossieSintese ?? "Sem dossiê oficial salvo para esta conta."}
                      </p>
                      {conta?.dossieTokens && (
                        <p className="mt-2 text-[11.5px] text-[#5C6B70]">
                          tokens reportados: {comparacao ? fmtTok(conta.dossieTokens.prompt) : "—"} / {fmtTok(conta.dossieTokens.completion)} / {fmtTok(conta.dossieTokens.total)}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-[#DCE9E6] bg-white/80 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Badge variant="outline" className="border-[#F3E3C2] bg-[#FDF8EE] text-[10px] font-bold uppercase tracking-wider text-[#9A6B15]">
                          Experimental · {comparacao.provider}
                        </Badge>
                        <span className="text-[11.5px] text-[#5C6B70]">{comparacao.modelEffective ?? comparacao.modelRequested}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#1F2A2E]" data-testid="lab-dossie-experimental">
                        {comparacao.estadoFinal !== "OK"
                          ? `A comparação falhou: ${comparacao.error ?? "erro desconhecido"} — nada foi salvo como resultado e o dossiê oficial permanece intocado.`
                          : (typeof exp?.sintese === "string" ? exp.sintese : comparacao.content?.slice(0, 1200) ?? "(sem conteúdo)")}
                      </p>
                      {comparacao.estadoFinal === "OK" && comparacao.parsedOk === false && (
                        <p className="mt-2 text-[11.5px] text-[#9A6B15]">A resposta não veio em JSON de dossiê — o texto bruto foi preservado na telemetria/export.</p>
                      )}
                    </div>
                  </div>
                  {estruturaExp && comparacao.estadoFinal === "OK" && (
                    <div className="rounded-xl border border-[#EAF2F0] bg-[#FBFDFC] px-3.5 py-3" data-testid="lab-estrutura">
                      <p className="text-[12.5px] font-semibold text-[#1F2A2E]">Leitura estrutural do dossiê experimental</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-[#5C6B70]">
                        campos presentes: {estruturaExp.presentes.length > 0 ? estruturaExp.presentes.join(", ") : "nenhum"}
                        {estruturaExp.ausentes.length > 0 && <> · ausentes/vazios: <span className="text-[#9A6B15]">{estruturaExp.ausentes.join(", ")}</span></>}
                        {Object.keys(estruturaExp.evidPorStatus).length > 0 && (
                          <> · evidências: {Object.entries(estruturaExp.evidPorStatus).map(([k, v]) => `${v} ${k}`).join(", ")}</>
                        )}
                      </p>
                    </div>
                  )}
                  {historico.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-[#DCE9E6]" data-testid="lab-historico">
                      <p className="border-b border-[#EAF2F0] bg-[#FBFDFC] px-3.5 py-2 text-[12.5px] font-semibold text-[#1F2A2E]">
                        Histórico desta conta ({historico.length}) — modelo, data, estado e equivalência
                      </p>
                      <ul className="divide-y divide-[#EAF2F0]">
                        {historico.map((h) => (
                          <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-[12.5px] text-[#5C6B70]">
                            <span className="tabular-nums">{new Date(h.createdAt).toLocaleString("pt-BR")}</span>
                            <span className="font-medium text-[#1F2A2E]">{h.provider}</span>
                            <span>{h.modelRequested}{h.modelEffective && h.modelEffective !== h.modelRequested ? ` → ${h.modelEffective}` : ""}</span>
                            <span>{h.estadoFinal}{h.httpStatus ? ` · HTTP ${h.httpStatus}` : ""}</span>
                            <span>{h.tokens?.informed ? `${fmtTok(h.tokens.total)} tokens` : "tokens não informados"}</span>
                            {h.equivalencia && (
                              <Badge variant="outline" className={`text-[10px] font-bold uppercase ${h.equivalencia.estado === "EQUIVALENTE" ? "border-[#BFE3DB] bg-[#F3FAF8] text-[#086B6B]" : "border-[#F3E3C2] bg-[#FDF8EE] text-[#9A6B15]"}`}>
                                {h.equivalencia.estado === "EQUIVALENTE" ? "A/B equivalente" : "histórica"}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[11.5px] leading-relaxed text-[#5C6B70]">
                    Comparabilidade: o veredito acima reconcilia hash das evidências (sha {fmtHash(comparacao.evidenceHash)}), hash do prompt, versão (v{comparacao.promptVersion})
                    e temperature com a síntese oficial — sem esses hashes conferindo, o resultado é exibido como comparação histórica. Custo financeiro não é exibido quando a
                    API não o reporta (tokens reportados ≠ custo em dinheiro). Este dossiê experimental é rastreado em telemetria com fonte própria e não substitui o original.
                  </p>
                </div>
              )}
            </section>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
