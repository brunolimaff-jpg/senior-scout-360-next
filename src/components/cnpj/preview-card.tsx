'use client';

/**
 * CONFERIR ANTES DE PROCESSAR — decisão humana simples:
 * "é isso mesmo que entrou?" → confirmar e iniciar.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AtSign, Globe, Hash, Link2, Building2, CircleAlert, ClipboardList, CheckCircle2 } from "lucide-react";
import type { BatchPreview } from "@/lib/types";
import { formatCnpj } from "@/lib/cnpj";

interface TextSampleRow {
  rowNumber: number;
  entrada: string;
  kind: string;
  cnpj: string | null;
  referencia: string | null;
  valido: boolean;
  motivo: string | null;
}

function isTextSample(row: object): row is TextSampleRow {
  return "entrada" in row;
}

export function PreviewCard({
  preview,
  confirming,
  cnpjColumn,
  hasHeader,
  onCnpjColumnChange,
  onHasHeaderChange,
  onConfirm,
}: {
  preview: BatchPreview;
  confirming: boolean;
  cnpjColumn: number;
  hasHeader: boolean;
  onCnpjColumnChange: (idx: number) => void;
  onHasHeaderChange: (v: boolean) => void;
  onConfirm: () => void;
}) {
  const isText = preview.sourceType === "TEXT";

  const header = hasHeader
    ? preview.header
    : ((preview.sampleRows[0] as string[] | undefined) ?? preview.header).map((_, i) => `coluna_${i + 1}`);

  const sample = preview.sampleRows.slice(0, 5);
  const stats = preview.textStats;

  return (
    <section className="sn-surface glass-reflex relative p-6 sm:p-8" data-testid="card-preview" aria-labelledby="confirmar-title">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 id="confirmar-title" className="ds-title text-senior-azul">Confira o que vamos processar</h2>
          <p className="ds-body mt-1 text-senior-cinza-600">
            {isText
              ? "Reconhecemos as pistas coladas. Ao confirmar, identificamos cada empresa e localizamos o CNPJ da matriz."
              : "Escolha qual coluna contém o CNPJ. As outras colunas da sua planilha são mantidas no resultado final."}
          </p>
        </div>
        <Button className="sn-cta shrink-0" onClick={onConfirm} disabled={confirming} data-testid="btn-confirm">
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Confirmar e identificar contas
        </Button>
      </div>

      {isText && stats && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5" data-testid="preview-text-stats">
          <Badge variant="outline" className="gap-1 border-transparent bg-[#00968C1A] text-[13px] text-[#086B6B]">
            <Hash className="h-3 w-3" /> <b className="tabular-nums">{stats.cnpjValido}</b> com CNPJ válido
          </Badge>
          {stats.cnpjInvalido > 0 && (
            <Badge variant="outline" className="gap-1 border-transparent bg-[#FDECEC] text-[13px] text-[#8C2F39]">
              <CircleAlert className="h-3 w-3" /> <b className="tabular-nums">{stats.cnpjInvalido}</b> com CNPJ inválido
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 border-transparent bg-[#33466C0D] text-[13px] text-[#33466C]">
            <Globe className="h-3 w-3" /> <b className="tabular-nums">{stats.dominio}</b> por domínio
          </Badge>
          <Badge variant="outline" className="gap-1 border-transparent bg-[#33466C0D] text-[13px] text-[#33466C]">
            <AtSign className="h-3 w-3" /> <b className="tabular-nums">{stats.email}</b> por e-mail
          </Badge>
          <Badge variant="outline" className="gap-1 border-transparent bg-[#33466C0D] text-[13px] text-[#33466C]">
            <Link2 className="h-3 w-3" /> <b className="tabular-nums">{stats.url}</b> por site
          </Badge>
          {stats.nome > 0 && (
            <Badge variant="outline" className="gap-1 border-transparent bg-[#086B6B14] text-[13px] text-[#086B6B]">
              <Building2 className="h-3 w-3" /> <b className="tabular-nums">{stats.nome}</b> por nome
            </Badge>
          )}
          {stats.invalido > 0 && (
            <Badge variant="outline" className="gap-1 border-transparent bg-[#FFC51133] text-[13px] text-[#33466C]">
              <CircleAlert className="h-3 w-3" /> <b className="tabular-nums">{stats.invalido}</b> não reconhecidas
            </Badge>
          )}
        </div>
      )}

      {!isText && (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cnpj-col" className="ds-caption text-senior-cinza-600">COLUNA DO CNPJ</Label>
            <Select value={String(cnpjColumn)} onValueChange={(v) => onCnpjColumnChange(Number(v))}>
              <SelectTrigger id="cnpj-col" className="w-64 rounded-[8px] border-senior-cinza-300 bg-white" data-testid="select-cnpj-col">
                <SelectValue placeholder="Selecionar coluna" />
              </SelectTrigger>
              <SelectContent>
                {header.map((h, i) => (
                  <SelectItem key={`${h}-${i}`} value={String(i)}>
                    {h.trim() ? h : `coluna_${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Switch id="has-header" checked={hasHeader} onCheckedChange={onHasHeaderChange} data-testid="switch-header" />
            <Label htmlFor="has-header" className="ds-body text-senior-azul">A primeira linha é o cabeçalho</Label>
          </div>
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-[10px] border border-senior-cinza-300">
        <div className="cnpj-scroll max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F6F9FE] hover:bg-[#F6F9FE]">
                {isText ? (
                  <>
                    <TableHead className="w-14 ds-caption text-senior-cinza-600">Linha</TableHead>
                    <TableHead className="ds-caption text-senior-cinza-600">Pista</TableHead>
                    <TableHead className="ds-caption text-senior-cinza-600">O que vamos fazer</TableHead>
                    <TableHead className="ds-caption text-senior-cinza-600">Observação</TableHead>
                  </>
                ) : (
                  header.map((h, i) => (
                    <TableHead key={`${h}-${i}`} className={i === cnpjColumn ? "bg-[#00968C1A] text-[#086B6B]" : "text-senior-cinza-600"}>
                      <div className="flex items-center gap-1.5">
                        {i === cnpjColumn && <Badge className="border-transparent bg-[#00968C] px-1.5 py-0 text-[13px] text-white">CNPJ</Badge>}
                        <span className="truncate ds-caption">{h.trim() ? h : `coluna_${i + 1}`}</span>
                      </div>
                    </TableHead>
                  ))
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isText
                ? (sample as unknown as TextSampleRow[]).map((row) => (
                    <TableRow key={row.rowNumber} data-testid={`preview-row-${row.rowNumber}`}>
                      <TableCell className="ds-caption tabular-nums text-senior-cinza-500">{row.rowNumber}</TableCell>
                      <TableCell className="max-w-56 truncate ds-body text-senior-azul" title={row.entrada}>{row.entrada}</TableCell>
                      <TableCell><TextKindBadge kind={row.kind} valido={row.valido} /></TableCell>
                      <TableCell className="max-w-52 truncate ds-caption text-senior-cinza-600" title={row.motivo ?? ""}>
                        {row.kind === "CNPJ" && row.cnpj ? formatCnpj(row.cnpj) : row.motivo ?? (row.referencia ? `→ ${row.referencia}` : "")}
                      </TableCell>
                    </TableRow>
                  ))
                : sample.map((row, ri) => {
                    const cells = Array.isArray(row) ? row : [];
                    return (
                      <TableRow key={ri} data-testid={`preview-row-${ri}`}>
                        {header.map((_, ci) => (
                          <TableCell key={ci} className={`max-w-40 truncate ds-body ${ci === cnpjColumn ? "bg-[#00968C08] font-medium text-senior-azul" : "text-senior-azul"}`}>
                            {cells[ci] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </div>
        {preview.rowCount > sample.length && (
          <p className="ds-caption border-t border-senior-cinza-300 bg-[#F6F9FE] px-3 py-2 text-senior-cinza-600">
            Mostrando as primeiras {sample.length} de {preview.rowCount} entradas.
          </p>
        )}
      </div>

      <p className="ds-caption mt-3 flex items-center gap-1.5 text-senior-cinza-600">
        <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
        Suas colunas originais são preservadas no arquivo final. Nada é alterado na sua planilha.
      </p>
    </section>
  );
}

function TextKindBadge({ kind, valido }: { kind: string; valido: boolean }) {
  if (kind === "CNPJ") {
    return (
      <Badge variant="outline" className={`gap-1 whitespace-nowrap border-transparent text-[13px] ${valido ? "bg-[#00968C1A] text-[#086B6B]" : "bg-[#FDECEC] text-[#8C2F39]"}`}>
        {valido ? "Consulta direta pelo CNPJ" : "CNPJ inválido"}
      </Badge>
    );
  }
  if (kind === "EMAIL") {
    return <Badge variant="outline" className="whitespace-nowrap border-transparent bg-[#33466C0D] text-[13px] text-[#33466C]">Identificar pelo e-mail</Badge>;
  }
  if (kind === "URL") {
    return <Badge variant="outline" className="whitespace-nowrap border-transparent bg-[#33466C0D] text-[13px] text-[#33466C]">Identificar pelo site</Badge>;
  }
  if (kind === "DOMAIN") {
    return <Badge variant="outline" className="whitespace-nowrap border-transparent bg-[#33466C0D] text-[13px] text-[#33466C]">Identificar pelo domínio</Badge>;
  }
  if (kind === "NAME") {
    return <Badge variant="outline" className="whitespace-nowrap border-transparent bg-[#086B6B14] text-[13px] text-[#086B6B]">Identificar pelo nome</Badge>;
  }
  return <Badge variant="outline" className="border-transparent bg-[#FFC51133] text-[13px] text-[#33466C]">Pista não reconhecida</Badge>;
}
