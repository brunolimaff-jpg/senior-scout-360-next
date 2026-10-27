'use client';

/**
 * ENTRADA DE DADOS — a primeira tarefa dominante do produto.
 * Mensagem principal: "Não precisa ter CNPJ. Envie as pistas disponíveis."
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  UploadCloud, FileSpreadsheet, Loader2, AlertTriangle, X, ClipboardPaste, AtSign, Globe, Hash,
  Link2, Building2, CircleAlert, FileUp,
} from "lucide-react";
import type { BatchPreview } from "@/lib/types";
import { parseTextLines } from "@/lib/extract";
import { formatCnpj } from "@/lib/cnpj";
import { plural } from "@/lib/linguagem";

const EXAMPLE = `CNPJ\tDomínio
00.000.000/0001-91\tbb.com.br
contato@brasildigital.net.br
https://petrobras.com.br/institucional
scheffer.agr.br
Agropecuária São Lucas`;

/** Pistas aceitas — comunicadas de forma visual e discreta. */
const PISTAS = [
  { icon: Hash, label: "CNPJ" },
  { icon: Globe, label: "Domínio" },
  { icon: Link2, label: "Site" },
  { icon: AtSign, label: "E-mail corporativo" },
  { icon: Building2, label: "Nome da empresa" },
];

export function UploadCard({
  selectedFile,
  onSelectFile,
  uploading,
  uploadProgress,
  uploadError,
  onDismissError,
  onUpload,
  preview,
  onDiscardPreview,
  pastedText,
  onPastedTextChange,
  onAnalyzeText,
  analyzingText,
}: {
  selectedFile: File | null;
  onSelectFile: (f: File | null) => void;
  uploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  onDismissError: () => void;
  onUpload: () => void;
  preview: BatchPreview | null;
  onDiscardPreview: () => void;
  pastedText: string;
  onPastedTextChange: (t: string) => void;
  onAnalyzeText: () => void;
  analyzingText: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState<"csv" | "paste">("csv");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSelect = useCallback(
    (f: File | null) => {
      if (uploading && abortRef.current) {
        abortRef.current.abort(); // troca rápida de arquivo nunca deixa resposta antiga sobrescrever
      }
      onSelectFile(f);
    },
    [uploading, onSelectFile]
  );

  // detecção ao vivo (mesmas regras determinísticas do servidor — sem IA)
  const live = useMemo(() => {
    if (tab !== "paste" || pastedText.trim().length === 0) return null;
    try {
      return parseTextLines(pastedText);
    } catch {
      return null;
    }
  }, [tab, pastedText]);

  const busy = uploading || analyzingText;

  return (
    <section className="sn-surface glass-reflex relative overflow-hidden" data-testid="card-upload" aria-labelledby="entrada-title">
      <div className="p-6 sm:p-8">
        {/* Mensagem principal do produto */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <h2 id="entrada-title" className="ds-headline text-senior-azul">
              Comece pelas pistas que você tem
            </h2>
            <p className="ds-lead mt-2 text-senior-azul">
              <strong className="font-bold text-[#086B6B]">Não precisa ter CNPJ.</strong> Envie as pistas disponíveis.
              Identificamos a empresa, localizamos a matriz e preparamos os dados para uso comercial.
            </p>
            <ul className="mt-4 flex flex-wrap items-center gap-2" aria-label="Pistas aceitas">
              {PISTAS.map((p) => (
                <li
                  key={p.label}
                  className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium text-[#086B6B] transition-transform duration-300 hover:-translate-y-0.5"
                >
                  <p.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {p.label}
                </li>
              ))}
            </ul>
            <p className="ds-caption mt-2 text-senior-cinza-600">
              Aceita também combinações de pistas em uma mesma linha (ex.: CNPJ + domínio) e planilhas com várias colunas.
            </p>
          </div>
        </div>

        {/* erro de entrada — explica e orienta, sem código */}
        {uploadError && (
          <Alert variant="destructive" className="mt-5 border-[#F1BDBD] bg-[#FDF1F1] text-[#8C2F39]">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-start justify-between gap-2">
              <span>{uploadError}</span>
              <button onClick={onDismissError} className="rounded p-0.5 hover:bg-[#F5DEDE]" aria-label="Fechar aviso">
                <X className="h-3.5 w-3.5" />
              </button>
            </AlertDescription>
          </Alert>
        )}

        {!preview && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "csv" | "paste")} className="mt-6">
            <TabsList className="h-10 rounded-[10px] bg-[#F2F2F2] p-1" aria-label="Como enviar as pistas">
              <TabsTrigger
                value="csv"
                className="gap-1.5 rounded-[8px] px-4 text-sm data-[state=active]:bg-white data-[state=active]:text-[#086B6B]"
                data-testid="tab-csv"
              >
                <FileSpreadsheet className="h-4 w-4" /> Enviar planilha
              </TabsTrigger>
              <TabsTrigger
                value="paste"
                className="gap-1.5 rounded-[8px] px-4 text-sm data-[state=active]:bg-white data-[state=active]:text-[#086B6B]"
                data-testid="tab-paste"
              >
                <ClipboardPaste className="h-4 w-4" /> Colar pistas
              </TabsTrigger>
            </TabsList>

            {/* ---------------- planilha ---------------- */}
            <TabsContent value="csv" className="mt-4">
              <div
                role="button"
                tabIndex={0}
                aria-label="Selecionar arquivo CSV"
                data-testid="dropzone"
                onClick={() => !busy && inputRef.current?.click()}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !busy) inputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleSelect(f);
                }}
                className={`relative flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed p-8 text-center transition-all duration-300 ${
                  dragOver
                    ? "border-girando border-transparent bg-[#00968C0D] shadow-[0_0_40px_rgba(18,247,209,0.25)]"
                    : "border-[#B8CFCB] bg-white/40 hover:border-[#00968C] hover:bg-[#00968C08] hover:shadow-[0_0_30px_rgba(0,150,140,0.12)]"
                } ${uploading ? "pointer-events-none opacity-70" : ""}`}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-[#00968C]" />
                    <p className="ds-body font-medium text-senior-azul">Lendo seu arquivo…</p>
                    <Progress value={uploadProgress} className="h-1.5 w-48" />
                  </>
                ) : (
                  <>
                    <span className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#00AF9B26] to-[#12F7D126] shadow-[0_0_24px_rgba(0,150,140,0.18)] ${uploading ? "" : "animate-[float_3.4s_ease-in-out_infinite]"}`}>
                      <FileUp className="h-6 w-6 text-[#086B6B]" aria-hidden="true" />
                    </span>
                    <p className="ds-body font-medium text-senior-azul">
                      Arraste a planilha aqui ou <span className="text-[#086B6B] underline underline-offset-2">clique para escolher</span>
                    </p>
                    <p className="ds-caption text-senior-cinza-600">
                      Arquivos .csv ou .txt de até 8 MB · a coluna do CNPJ é reconhecida sozinha, se existir
                    </p>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="sr-only"
                  data-testid="file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    handleSelect(f);
                    e.target.value = "";
                  }}
                />
              </div>

              {selectedFile && (
                <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-senior-cinza-300 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#00968C1A]">
                      <FileSpreadsheet className="h-5 w-5 text-[#086B6B]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="ds-title-md truncate text-senior-azul" data-testid="selected-file-name">{selectedFile.name}</p>
                      <p className="ds-caption text-senior-cinza-600">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-9 rounded-[8px] border-senior-cinza-300 text-senior-azul hover:bg-[#F2F2F2]" onClick={() => handleSelect(null)} disabled={uploading}>
                      Trocar arquivo
                    </Button>
                    <Button size="sm" className="sn-cta h-9" onClick={onUpload} disabled={uploading} data-testid="btn-upload">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                      Analisar arquivo
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ---------------- colar pistas ---------------- */}
            <TabsContent value="paste" className="mt-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="ds-body text-senior-cinza-600">
                    Uma pista por linha, ou várias juntas (ex.: <span className="font-medium text-senior-azul">CNPJ&nbsp;+&nbsp;domínio</span>).
                  </p>
                  <Button variant="ghost" size="sm" className="h-8 text-[13px] text-[#086B6B] hover:bg-[#00968C14]" onClick={() => onPastedTextChange(EXAMPLE)} data-testid="btn-example">
                    Usar um exemplo
                  </Button>
                </div>
                <Textarea
                  value={pastedText}
                  onChange={(e) => onPastedTextChange(e.target.value)}
                  placeholder={EXAMPLE}
                  rows={7}
                  className="min-h-40 resize-y rounded-[10px] border-senior-cinza-300 bg-white text-sm leading-relaxed focus-visible:ring-[#00968C]"
                  aria-label="Cole aqui CNPJs, domínios, sites, e-mails ou nomes de empresas"
                  data-testid="paste-textarea"
                  spellCheck={false}
                />

                {live && (
                  <div className="rounded-[10px] border border-[#00968C40] bg-[#00968C08] p-3" data-testid="live-detection">
                    <div className="flex flex-wrap items-center gap-1.5" role="status" aria-live="polite">
                      <span className="ds-caption mr-1 text-senior-azul">Reconhecemos nesta colagem:</span>
                      <LiveChip icon={<Hash className="h-3 w-3" />} label="CNPJs válidos" value={live.stats.cnpjValido} tone="verde" />
                      <LiveChip icon={<AlertTriangle className="h-3 w-3" />} label="CNPJs inválidos" value={live.stats.cnpjInvalido} tone="rose" hideZero />
                      <LiveChip icon={<Globe className="h-3 w-3" />} label="domínios" value={live.stats.dominio} tone="azul" />
                      <LiveChip icon={<AtSign className="h-3 w-3" />} label="e-mails" value={live.stats.email} tone="azul" />
                      <LiveChip icon={<Link2 className="h-3 w-3" />} label="sites" value={live.stats.url} tone="azul" />
                      <LiveChip icon={<Building2 className="h-3 w-3" />} label="nomes de empresa" value={live.stats.nome} tone="teal" />
                      <LiveChip icon={<CircleAlert className="h-3 w-3" />} label="não reconhecidos" value={live.stats.invalido} tone="amber" hideZero />
                    </div>
                    {live.lines.length > 0 && (
                      <div className="cnpj-scroll mt-2 max-h-24 overflow-y-auto rounded-[8px] border border-senior-cinza-300 bg-white p-2 text-[13px] leading-relaxed" aria-hidden="true">
                        {live.lines.slice(0, 12).map((l) => (
                          <div key={l.rowNumber} className="flex items-center gap-2 truncate">
                            <span className="w-6 shrink-0 text-right tabular-nums text-senior-cinza-500">{l.rowNumber}</span>
                            <span className="min-w-0 flex-1 truncate text-senior-azul">{l.rawLine}</span>
                            <span className={`shrink-0 font-medium ${
                              l.kind === "CNPJ" ? (l.cnpjValid ? "text-[#086B6B]" : "text-[#8C2F39]") :
                              l.kind === "INVALID" ? "text-[#8C2F39]" :
                              "text-[#086B6B]"
                            }`}>
                              {l.kind === "INVALID" ? "não reconhecido" : l.kind === "CNPJ" ? (l.cnpjValid ? `CNPJ ${formatCnpj(l.normalizedCnpj)}` : "CNPJ inválido") : l.kind === "EMAIL" ? "e-mail corporativo" : l.kind === "URL" ? "site" : l.kind === "NAME" ? "nome de empresa" : "domínio"}
                            </span>
                          </div>
                        ))}
                        {live.lines.length > 12 && <p className="ds-caption mt-1 text-senior-cinza-500">+ {plural(live.lines.length - 12, "linha", "linhas")}…</p>}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button className="sn-cta" onClick={onAnalyzeText} disabled={busy || pastedText.trim().length === 0} data-testid="btn-analyze-text">
                    {analyzingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />}
                    Analisar pistas
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* prévia pronta — confirme na sequência */}
        {preview && (
          <div className="mt-6 flex flex-col gap-3 rounded-[10px] border border-[#00968C40] bg-[#00968C08] p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="preview-info">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#00968C1A]">
                {preview.sourceType === "TEXT" ? <ClipboardPaste className="h-5 w-5 text-[#086B6B]" /> : <FileSpreadsheet className="h-5 w-5 text-[#086B6B]" />}
              </span>
              <div className="min-w-0">
                <p className="ds-title-md truncate text-senior-azul" data-testid="preview-file-name">{preview.fileName}</p>
                <p className="ds-caption text-senior-cinza-600" data-testid="preview-meta">
                  {plural(preview.rowCount, "pista pronta", "pistas prontas")} para identificação
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="whitespace-nowrap border-transparent bg-[#00968C] text-[13px] text-white">Pronto para conferir</Badge>
              <Button variant="ghost" size="sm" className="h-8 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" onClick={onDiscardPreview}>
                Descartar
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LiveChip({ icon, label, value, tone, hideZero }: { icon: React.ReactNode; label: string; value: number; tone: "verde" | "rose" | "azul" | "amber" | "teal"; hideZero?: boolean }) {
  if (hideZero && value === 0) return null;
  const cls =
    tone === "verde" ? "bg-[#00968C1A] text-[#086B6B]"
    : tone === "rose" ? "bg-[#FDECEC] text-[#8C2F39]"
    : tone === "amber" ? "bg-[#FFC51133] text-[#33466C]"
    : tone === "teal" ? "bg-[#086B6B14] text-[#086B6B]"
    : "bg-[#33466C0D] text-[#33466C]";
  return (
    <Badge variant="outline" className={`gap-1 border-transparent text-[13px] ${cls}`}>
      {icon} <b className="tabular-nums">{value}</b> {label}
    </Badge>
  );
}
