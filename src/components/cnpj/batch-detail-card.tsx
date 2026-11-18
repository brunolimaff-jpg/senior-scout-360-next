'use client';

/**
 * RESULTADO DESTE LOTE — o centro do produto.
 * Para cada entrada: ENTRADA → EMPRESA IDENTIFICADA → CNPJ ENCONTRADO → MATRIZ → CONFIANÇA → SITUAÇÃO.
 * Informação técnica (fontes, chamadas, auditoria) vive em camada secundária.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ArrowRight, AtSign, Briefcase, Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck,
  CircleDashed, CircleHelp, Clock, Coins, Columns2, Copy, Download, Eye, FileJson, FileSpreadsheet, FileText, Gauge, Globe, Hash, Inbox, Link2, List as ListIcon, ListChecks, Loader2, Mail,
  ArrowDownAZ, ArrowUpDown, MapPin, Maximize2, Minimize2, Network, Newspaper, Phone, Play, RotateCcw, ScrollText, Search, SearchX, Send, SlidersHorizontal, Sparkles, Square, UserCog, Users, X,
  Layers,
} from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CHAVE_PAINEL_MESA, useLarguraConteiner, useLarguraMinima, useScoutUi, type ModoVisual, type OrdenacaoTabela } from "@/hooks/use-scout-ui";
import {
  AI_STATE, BatchStateBadge, eventLabel, formatBRL, formatBR,
  FoundTypeChip, IDENTITY_STAGE, IdentityStageChip, KIND, LOOKUP_STATE, OpMetric, registrationLabel,
  rowSituation, SectionTitle, SituationBadge, sourceDetail, sourceLabel, TechDisclosure, TONE_ICON, TrustChip, DefRow, RowAction,
} from "./senior";
import type {
  AccountDossierView, AuditEventView, BatchDetail, BatchSummaryView, BindingView, DecideRequest, DetailedHypothesisView, DiscardedCandidateView, DistItem, EmpresaQuadro, EvidenceItemView, MatrizFiliaisView, NewsItemView, Pagination, PortfolioFitView, RelacoesView, ResolutionCandidateView, ResearchQueueView, RowDetail, EstabelecimentoView, QuadroView, TriagemLinhaView,
} from "@/lib/types";
import { ESTADO_TRIAGEM_LABEL } from "@/lib/types";
import { formatCnpj, validateCnpj } from "@/lib/cnpj";
import { DECISOR_QUAL_RE, telefoneUtil } from "@/lib/contato";
import { plural, regimeTributarioLegivel } from "@/lib/linguagem";
import { apiFetch } from "@/lib/client-api";
import { copyText } from "@/lib/clipboard";
import { GrafoRelacoesCard } from "./grafo-relacoes";
import { PessoaDossieSheet } from "./pessoa-dossie-sheet";
import { AcompanhamentoStrip, MesaEmptyState, MesaIntro } from "./acompanhamento-painel";
import { AVISO_ADMINISTRACAO, lerRelacoes, montarProximoMovimento, type SecaoMovimentoId } from "@/lib/inteligencia";
import { useToast } from "@/hooks/use-toast";
import { SpotlightCard, Ticker } from "@/components/motion/sv-primitives";
import { TECH_STATES, TECH_STATE_HINT, type TechState } from "@/lib/enrich/tech-states";
import { TelemetryPanel } from "./telemetry-panel";
import type { PlanoConsultasV1 } from "@/lib/plano/contrato";

const RETRYABLE = new Set(["RATE_LIMITED", "TIMEOUT", "ERRO_REDE", "ERRO_SERVIDOR", "NAO_ENCONTRADO"]);

/** v0.11.3 (missão Lotes+Mesa): MESMA regra canônica do filtro server-side
 * `dossie_pronto` (rota GET /api/imports/[id]) — pesquisa solicitada e concluída
 * (researchStatus OK), síntese pronta (aiStatus OK), cadastro coletado e identidade
 * SEM bloqueio (não REVIEW, não LOCALIZADO divergente). A UI usa esta regra apenas
 * para rótulos/ação por linha; a POPULAÇÃO e o contador vêm sempre do servidor
 * (pesquisaProfunda.dossiesProntos) — UI nunca decide sozinha quem é dossiê pronto. */
export function isDossiePronto(r: RowDetail): boolean {
  return (
    r.lookupStatus === "ENRIQUECIDO" &&
    r.researchStatus === "OK" &&
    r.aiStatus === "OK" &&
    r.resolutionState !== "REVIEW" &&
    r.identityStage !== "LOCALIZADO"
  );
}

/** Logos do portfólio Senior (Design System anexado) — ícone sempre acompanhado do nome. */
const PORTFOLIO_LOGOS: Record<string, { src: string; label: string }> = {
  ERP: { src: "/logos/erp.png", label: "ERP" },
  HCM: { src: "/logos/hcm.png", label: "HCM" },
  WMS: { src: "/logos/wms.png", label: "WMS" },
  TMS: { src: "/logos/tms.png", label: "TMS" },
  ACESSO_SEGURANCA: { src: "/logos/acesso-seguranca.png", label: "Acesso e Segurança" },
  AGRONEGOCIO: { src: "/logos/agronegocio.png", label: "Agronegócio" },
  CONSTRUCAO: { src: "/logos/construcao.png", label: "Construção" },
  INDUSTRIA: { src: "/logos/industria.png", label: "Indústria" },
  LOGISTICA: { src: "/logos/logistica.png", label: "Logística" },
};

function PortfolioLogo({ produto, className = "h-5 w-auto" }: { produto: string; className?: string }) {
  const l = PORTFOLIO_LOGOS[produto];
  if (!l) return null;
  // w-auto é OBRIGATÓRIO: os PNGs são quadrados (186×186); com width fixo o logo
  // fica achatado/cortado dentro do chip (bug "logo cortada").
  return <img src={l.src} alt={l.label} title={l.label} className={className} loading="lazy" />;
}

function KindIcon({ kind, className = "h-4 w-4" }: { kind: string; className?: string }) {
  const cls = `shrink-0 text-[#086B6B] ${className}`;
  if (kind === "CNPJ") return <Hash className={cls} aria-hidden="true" />;
  if (kind === "EMAIL") return <AtSign className={cls} aria-hidden="true" />;
  if (kind === "URL") return <Link2 className={cls} aria-hidden="true" />;
  if (kind === "NAME") return <Building2 className={cls} aria-hidden="true" />;
  return <Globe className={cls} aria-hidden="true" />;
}

/* ==================================================================== */
/* Alertas materiais — devem saltar na tela antes de qualquer exportação */
/* ==================================================================== */

const REGISTRATION_ALERT: Record<string, string> = {
  BAIXADA: "Situação cadastral: baixada. Confira se esta é a empresa operacional que você quer",
  SUSPENSA: "Situação cadastral: suspensa. A empresa pode não estar operando normalmente",
  INAPTA: "Situação cadastral: inapta, irregularidade no registro público do CNPJ",
  NULA: "Situação cadastral: nula, registro anulado no cadastro público do CNPJ",
};

function materialAlerts(r: RowDetail): { tone: "alerta" | "info"; text: string }[] {
  const out: { tone: "alerta" | "info"; text: string }[] = [];
  const regKey = r.registrationStatus?.toUpperCase() ?? "";
  if (REGISTRATION_ALERT[regKey]) out.push({ tone: "alerta", text: REGISTRATION_ALERT[regKey] });
  if (r.matrizStatus === "NAO_LOCALIZADA") out.push({ tone: "alerta", text: "Matriz não confirmada nas fontes públicas" });
  if (r.resolutionConfidence === "HUMANA") out.push({ tone: "info", text: "Identidade confirmada manualmente por você" });
  return out;
}

/** Badge curto de situação cadastral na prévia — só aparece quando é alerta material. */
function RegistrationAlertBadge({ r }: { r: RowDetail }) {
  const regKey = r.registrationStatus?.toUpperCase() ?? "";
  if (!REGISTRATION_ALERT[regKey]) return null;
  return (
    <Badge
      variant="outline"
      className="mt-1 gap-1 whitespace-nowrap border-transparent bg-[#FDECEC] px-1.5 py-0 text-[13px] font-medium text-[#8C2F39]"
      title={REGISTRATION_ALERT[regKey]}
    >
      <CircleAlert className="h-3 w-3" aria-hidden="true" />
      {registrationLabel(r.registrationStatus)}
    </Badge>
  );
}

/**
 * Confiança da identidade na linha: quando a pista foi o próprio CNPJ e a fonte
 * oficial confirmou, dizemos isso em vez de mostrar um traço vazio.
 * v0.10.8: o selo NÃO promete "cadastro oficial direto" — os dados vêm de
 * espelhos públicos do registro; o texto diz o que é e a Evidências dá a origem.
 */
function RowTrustChip({ r }: { r: RowDetail }) {
  if (r.resolutionConfidence) return <TrustChip confidence={r.resolutionConfidence} />;
  const directHit = r.lookupKind === "CNPJ" && !!(r.resolvedCnpj || r.headquartersCnpj);
  if (directHit) {
    // Confirmação do REGISTRO em espelho público — sem prometer consulta direta.
    const detalhe = sourceDetail(r.source);
    return (
      <span
        className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-[#00968C1A] px-2 py-0.5 text-[13px] font-medium text-[#086B6B]"
        title={`Registro confirmado em base pública do cadastro empresarial${detalhe ? ` (origem técnica: ${detalhe})` : ""} — confirme o registro antes de decisões críticas.`}
        data-testid={`trust-direct-${r.rowNumber}`}
      >
        <CircleCheck className="h-3 w-3" aria-hidden="true" /> Registro confirmado
      </span>
    );
  }
  return <span className="ds-body text-senior-cinza-400">—</span>;
}

/* ==================================================================== */
/* Avatar de iniciais — âncora visual da empresa na prévia               */
/* ==================================================================== */

const AVATAR_TONES = [
  "bg-[#00968C1A] text-[#086B6B]",
  "bg-[#086B6B14] text-[#086B6B]",
  "bg-[#FFC51133] text-[#6b5600]",
  "bg-[#FDECEC] text-[#8C2F39]",
];

function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function companyInitials(name: string | null | undefined): string {
  if (!name) return "—";
  const words = name
    .replace(/[.,/()\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(LTDA|LTDAA?|S\/A|SA|ME|EPP|EIRELI|MEI|COM|IMP|EXP|DA|DO|DE|DAS|DOS|E)$/i.test(w));
  const a = words[0]?.[0] ?? "";
  const b = words[1]?.[0] ?? words[0]?.[1] ?? "";
  const pick = (a + b).toUpperCase();
  return pick || "—";
}

function CompanyAvatar({ name, size = "h-9 w-9 text-[13px]" }: { name: string | null; size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-bold tracking-wide ${size} ${name ? avatarTone(name) : "bg-[#F2F2F2] text-senior-cinza-400"}`}
    >
      {companyInitials(name)}
    </span>
  );
}

/* ==================================================================== */
/* Bloco: fluxo de identificação (ENTRADA → EMPRESA → CNPJ → MATRIZ)    */
/* ==================================================================== */

function IdentityFlow({ r }: { r: RowDetail }) {
  const entrada = r.entrada ?? r.referenceValue ?? (r.rawCnpj ? formatCnpj(r.rawCnpj) : "—");
  return (
    <div className="rounded-[10px] border border-senior-cinza-300 bg-[#F6F9FE] p-4" data-testid={`identity-flow-${r.rowNumber}`}>
      <ol className="space-y-3">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white border border-senior-cinza-300">
            <KindIcon kind={r.lookupKind} />
          </span>
          <div className="min-w-0">
            <p className="ds-caption text-senior-cinza-600">O QUE VOCÊ ENVIOU ({KIND[r.lookupKind] ?? r.lookupKind})</p>
            <p className="ds-body truncate font-medium text-senior-azul" title={entrada}>{entrada}</p>
          </div>
        </li>
        {r.legalName && (
          <li className="flex items-start gap-3">
            <ArrowRight className="mt-3 h-4 w-4 shrink-0 text-senior-cinza-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="ds-caption text-senior-cinza-600">EMPRESA IDENTIFICADA</p>
              <p className="ds-title-md text-senior-azul">{r.legalName}</p>
              {/* v0.11.1 (Gate 2): a denominação secundária vive no cabeçalho — aqui não repete. */}
            </div>
          </li>
        )}
        {r.resolvedCnpj && (
          <li className="flex items-start gap-3">
            <ArrowRight className="mt-3 h-4 w-4 shrink-0 text-senior-cinza-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="ds-caption text-senior-cinza-600">CNPJ ENCONTRADO</p>
              <p className="ds-title-md tabular-nums text-senior-azul">{formatCnpj(r.resolvedCnpj)}</p>
              {(r.municipality || r.uf) && (
                <span className="mt-1 inline-flex items-center gap-1 ds-caption text-senior-cinza-600">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  {r.municipality ? `${r.municipality}/${r.uf ?? ""}` : r.uf}
                </span>
              )}
            </div>
          </li>
        )}
        {r.headquartersCnpj && !r.foundIsHeadquarters && (
          <li className="flex items-start gap-3">
            <ArrowRight className="mt-3 h-4 w-4 shrink-0 text-senior-cinza-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="ds-caption text-senior-cinza-600">MATRIZ DA EMPRESA</p>
              <p className="ds-title-md tabular-nums text-senior-azul">{formatCnpj(r.headquartersCnpj)}</p>
              <p className="ds-caption text-senior-cinza-600">Localizada pelo registro oficial — a matriz é o CNPJ certo para usar.</p>
            </div>
          </li>
        )}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-senior-cinza-300 pt-3 ds-caption text-senior-cinza-600">
        <span>Fonte consultada: <b className="font-medium text-senior-azul">{sourceLabel(r.source)}</b></span>
        {r.queriedAt && <span>Consulta em {formatBR(r.queriedAt)}</span>}
        {/* v0.11.1 (Gate 2): "Situação" saiu deste rodapé — o cabeçalho a mostra com cor de significado. */}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* ENTITY_BINDING — chips de vínculo + lista de descartes                 */
/* ==================================================================== */

const BINDING_META: Record<string, { label: string; cls: string; dot: string }> = {
  OFFICIAL_SITE: { label: "Site oficial", cls: "bg-[#00968C14] text-[#086B6B]", dot: "#00968C" },
  LEGAL_DISCLOSURE: { label: "Divulgação legal", cls: "bg-[#00968C14] text-[#086B6B]", dot: "#00968C" },
  DOMAIN_REGISTRANT: { label: "Registro do domínio", cls: "bg-[#00968C14] text-[#086B6B]", dot: "#00968C" },
  GOVERNMENT_RECORD: { label: "Registro governamental", cls: "bg-[#00968C14] text-[#086B6B]", dot: "#00968C" },
  SAME_PHONE: { label: "Mesmo telefone", cls: "bg-[#FFC51126] text-[#8a6d00]", dot: "#E3A008" },
  SAME_EMAIL_DOMAIN: { label: "Mesmo domínio de e-mail", cls: "bg-[#FFC51126] text-[#8a6d00]", dot: "#E3A008" },
  SAME_ADDRESS: { label: "Mesmo endereço", cls: "bg-[#FFC51126] text-[#8a6d00]", dot: "#E3A008" },
  BUSINESS_DIRECTORY: { label: "Diretório empresarial", cls: "bg-[#FFC51126] text-[#8a6d00]", dot: "#E3A008" },
  THIRD_PARTY_MENTION: { label: "Menção de terceiros", cls: "bg-[#F2F2F2] text-senior-cinza-600", dot: "#9aa0a6" },
  PAGE_OWNER_ONLY: { label: "Só o dono da página", cls: "bg-[#FDECEC] text-[#8C2F39]", dot: "#8C2F39" },
  UNRELATED: { label: "Sem relação com a pista", cls: "bg-[#FDECEC] text-[#8C2F39]", dot: "#8C2F39" },
};

/**
 * "Situação cadastral confirmada" valida o REGISTRO, nunca o vínculo com a pista —
 * nunca aparece como sinal de identidade (linhas antigas em cache podem ainda ter o texto).
 */
function identitySinais(sinais: string[] | undefined): string[] {
  return (sinais ?? []).filter((s) => !/^situação cadastral confirmada/i.test(s));
}

function BindingChip({ b }: { b: BindingView }) {
  const meta = BINDING_META[b.bindingType] ?? { label: b.bindingType, cls: "bg-[#F2F2F2] text-senior-cinza-600", dot: "#9aa0a6" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-medium ${meta.cls}`}
      title={`Evidência ${b.strength.toLowerCase()} — ${b.bindingEvidence}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} aria-hidden="true" />
      {meta.label}
      <span className="sr-only"> — evidência {b.strength.toLowerCase()}</span>
    </span>
  );
}

/**
 * CNPJs/fontes rejeitados pelo gate de vínculo — transparência do que NÃO virou
 * candidato (ex.: CNPJ do Mercado Livre por causa de "sementes carolina cross").
 */
function DiscardedList({ descartados, testId }: { descartados: DiscardedCandidateView[]; testId: string }) {
  if (!descartados || descartados.length === 0) return null;
  return (
    <div className="mt-3 rounded-[8px] border border-senior-cinza-300 bg-white p-3" data-testid={testId}>
      <p className="ds-caption flex items-center gap-1.5 font-medium text-senior-cinza-600">
        <SearchX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {plural(descartados.length, "CNPJ/fonte descartado", "CNPJ/fontes descartados")} por falta de vínculo com a pista
      </p>
      <ul className="mt-1.5 space-y-1">
        {descartados.slice(0, 4).map((d, i) => (
          <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600">
            <X className="mt-0.5 h-3 w-3 shrink-0 text-[#8C2F39]" aria-hidden="true" />
            <span className="min-w-0">{d.cnpj ? `${formatCnpj(d.cnpj)} — ` : ""}{d.motivo}</span>
          </li>
        ))}
      </ul>
      {descartados.length > 4 && (
        <p className="ds-caption mt-1 text-senior-cinza-400">+{descartados.length - 4} outros descartes no rastro técnico.</p>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Bloco: revisão humana (candidatos + por quê + decisão — SEM beco)     */
/* ==================================================================== */

/** Situação cadastral registrada nos dados jurídicos do candidato (validam o REGISTRO). */
const CADASTRAL_RE = /Situação cadastral:\s*(.+)$/i;
const CADASTRAL_ALERTA = new Set(["BAIXADA", "SUSPENSA", "INAPTA", "NULA"]);

function situacaoCadastralDe(c: ResolutionCandidateView): string | null {
  for (const dJulgamento of c.dadosJuridicos ?? []) {
    const m = dJulgamento.match(CADASTRAL_RE);
    if (m) return m[1].trim().toUpperCase();
  }
  return null;
}

/**
 * v0.10.12: painel de DIVERGÊNCIA DE IDENTIDADE (registro LOCALIZADO).
 * O cadastro existe na fonte oficial, mas diverge das pistas. Nada é descartado:
 * o operador valida ("É esta empresa"), corrige o CNPJ ou informa outra pista.
 */
function IdentidadeDivergentePanel({
  r, busy, deciding, onDecide,
}: { r: RowDetail; busy: boolean; deciding: boolean; onDecide: (body: DecideRequest) => void }) {
  const [novoCnpj, setNovoCnpj] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const locked = busy || deciding;
  const divergencias = r.identityDivergencias ?? [];

  const corrigir = () => {
    const v = novoCnpj.trim();
    if (!v) return;
    const digits = validateCnpj(v);
    if (digits.valid) {
      if (digits.normalized === r.normalizedCnpj) {
        setErro("Este é o mesmo CNPJ já registrado na linha.");
        return;
      }
      setErro(null);
      onDecide({ cnpj: digits.normalized });
      setNovoCnpj("");
      return;
    }
    // qualquer outra pista (site, domínio, e-mail, nome) segue pelo caminho de nova pista
    if (v.length > 200) {
      setErro("Pista longa demais. Envie site, domínio, CNPJ, telefone ou nome.");
      return;
    }
    setErro(null);
    onDecide({ action: "CLUE", value: v });
    setNovoCnpj("");
  };

  return (
    <div className="rounded-[10px] border border-[#FFC51166] bg-[#FFC51114] p-4" data-testid={`identidade-divergente-${r.rowNumber}`}>
      <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
        <CircleAlert className="h-4 w-4 text-[#8a6d00]" aria-hidden="true" />
        Registro localizado, mas com divergências
      </h4>
      <p className="ds-body mt-1.5 text-senior-cinza-600">
        Encontramos o cadastro oficial abaixo, mas ele não bate com as pistas que você enviou. Antes de usar estes dados, confirme se é a empresa certa.
      </p>
      {divergencias.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {divergencias.map((d, i) => (
            <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600" data-testid={`divergencia-${i}`}>
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-[#8a6d00]" aria-hidden="true" />
              {d.descricao}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#FFC51166] pt-3">
        <Button
          size="sm"
          className="sn-btn-verde h-8"
          disabled={locked}
          onClick={() => onDecide({ action: "VALIDAR_REGISTRO" })}
          data-testid={`btn-validar-registro-${r.rowNumber}`}
          title="Confirma que este registro é a empresa certa, mesmo com a divergência"
        >
          <Check className="h-3.5 w-3.5" /> É esta empresa
        </Button>
      </div>
      <div className="mt-2.5">
        <p className="ds-caption text-senior-cinza-600">Não é esta? Informe o CNPJ correto ou cole outra pista (site, domínio ou nome):</p>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <Input
            value={novoCnpj}
            onChange={(e) => { setNovoCnpj(e.target.value); setErro(null); }}
            placeholder="CNPJ, site, domínio ou nome"
            className="h-9 flex-1 rounded-[8px] border-senior-cinza-300 bg-white text-sm"
            disabled={locked}
            data-testid={`input-corrigir-identidade-${r.rowNumber}`}
            aria-label="CNPJ correto ou nova pista"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0 rounded-[8px] border-senior-cinza-300 bg-white text-senior-azul hover:bg-[#F2F2F2]"
            disabled={locked || novoCnpj.trim().length === 0}
            onClick={corrigir}
            data-testid={`btn-corrigir-identidade-${r.rowNumber}`}
          >
            <Send className="h-3.5 w-3.5" /> Enviar pista
          </Button>
        </div>
        {erro && (
          <p className="ds-caption mt-1.5 flex items-center gap-1 text-[#8C2F39]" role="alert">
            <CircleAlert className="h-3 w-3" aria-hidden="true" /> {erro}
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewPanel({
  r, busy, deciding, onDecide,
}: { r: RowDetail; busy: boolean; deciding: boolean; onDecide: (body: DecideRequest) => void }) {
  const res = r.resolution;
  const [noneOpen, setNoneOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [clue, setClue] = useState("");
  const [confirmNF, setConfirmNF] = useState(false);
  if (!res) return null;
  const candidates = res.candidatos ?? [];
  const locked = busy || deciding;
  const pista = r.entrada ?? r.referenceValue ?? (r.rawCnpj ? formatCnpj(r.rawCnpj) : "—");
  // Alerta de situação cadastral ANTES da decisão — candidato BAIXADO/SUSPENSO/INAPTO não passa batido
  const cadAlerts = candidates
    .map((c) => situacaoCadastralDe(c))
    .filter((s): s is string => !!s && CADASTRAL_ALERTA.has(s));

  const confirmManual = () => {
    const v = validateCnpj(manual);
    if (!v.valid) {
      setManualErr("Este CNPJ não é válido. Confira os 14 dígitos.");
      return;
    }
    setManualErr(null);
    onDecide({ cnpj: v.normalized });
  };

  const sendClue = () => {
    const v = clue.trim();
    if (!v) return;
    onDecide({ action: "CLUE", value: v });
    setClue("");
  };

  return (
    <div className="rounded-[10px] border border-[#FFC51166] bg-[#FFC51114] p-4" data-testid={`review-details-${r.rowNumber}`}>
      <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
        <CircleAlert className="h-4 w-4 text-[#8a6d00]" aria-hidden="true" />
        Precisamos confirmar esta empresa
      </h4>

      {/* Pista recebida — o ponto de partida da investigação */}
      <div className="mt-2.5 rounded-[8px] border border-senior-cinza-300 bg-white px-3 py-2" data-testid={`review-pista-${r.rowNumber}`}>
        <p className="ds-caption text-senior-cinza-600">PISTA RECEBIDA ({KIND[r.lookupKind] ?? r.lookupKind})</p>
        <p className="ds-body break-all font-medium text-senior-azul">{pista}</p>
      </div>

      {/* O que conseguimos comprovar — método real; nome semelhante NÃO comprova vínculo */}
      {res.metodo.length > 0 && (
        <div className="mt-2.5" data-testid={`review-comprova-${r.rowNumber}`}>
          <p className="ds-caption text-senior-cinza-600">O QUE CONSEGUIMOS COMPROVAR</p>
          <ul className="mt-1 space-y-0.5">
            {res.metodo.slice(0, 4).map((m, i) => (
              <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600">
                <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-[#00968C]" aria-hidden="true" />
                {m}
              </li>
            ))}
          </ul>
          <p className="ds-caption mt-1 text-senior-cinza-400">
            Nome semelhante não comprova vínculo — cada candidato abaixo mostra a evidência que o trouxe.
          </p>
        </div>
      )}

      <p className="ds-body mt-3 text-senior-cinza-600">
        {candidates.length > 1
          ? `Encontramos ${candidates.length} empresas possíveis para esta pista. Compare o porquê de cada uma e diga qual é a certa.`
          : "Encontramos uma empresa possível, mas a evidência ainda é fraca para confirmar sozinha."}
      </p>

      {/* alerta material ANTES dos botões de decisão */}
      {cadAlerts.length > 0 && (
        <div className="mt-2.5 rounded-[8px] border border-[#F1BDBD] bg-[#FDF1F1] p-2.5" data-testid={`review-cadastral-alert-${r.rowNumber}`}>
          <p className="ds-caption flex items-start gap-1.5 font-medium text-[#8C2F39]">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {cadAlerts.length === 1
              ? `Atenção: um dos candidatos está com situação cadastral ${registrationLabel(cadAlerts[0]).toLowerCase()} — confirme se é a empresa operacional que você quer.`
              : `Atenção: ${cadAlerts.length} candidatos estão com situação cadastral irregular (${cadAlerts.map((s) => registrationLabel(s)).join(", ")}) — confirme antes de decidir.`}
          </p>
        </div>
      )}

      <ol className="mt-3 space-y-2.5">
        {candidates.map((c, i) => (
          <CandidateRow
            key={c.cnpj}
            c={c}
            index={i + 1}
            chosen={r.resolvedCnpj === c.cnpj}
            locked={locked}
            onChoose={() => onDecide({ cnpj: c.cnpj })}
          />
        ))}
      </ol>

      <DiscardedList descartados={res.descartados ?? []} testId={`review-discarded-${r.rowNumber}`} />

      {/* decisão — nenhum caminho é irreversível: "Nenhuma destas" abre as 4 saídas */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#FFC51166] pt-3">
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-[8px] border-senior-cinza-300 bg-white text-senior-cinza-600 hover:bg-[#F2F2F2]"
          onClick={() => setNoneOpen((v) => !v)}
          disabled={locked}
          aria-expanded={noneOpen}
          data-testid={`review-none-${r.rowNumber}`}
        >
          <X className="h-3.5 w-3.5" /> {noneOpen ? "Fechar opções" : "Nenhuma destas é a empresa"}
        </Button>
        {deciding && (
          <span className="inline-flex items-center gap-1.5 ds-caption text-[#086B6B]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Registrando sua decisão…
          </span>
        )}
      </div>

      {noneOpen && (
        <div className="mt-2.5 space-y-3 rounded-[8px] border border-senior-cinza-300 bg-white p-3" data-testid={`review-none-panel-${r.rowNumber}`}>
          <p className="ds-caption font-semibold text-senior-azul">Sem beco sem saída. Escolha o próximo passo:</p>

          {/* 1. nova pista na MESMA linha — reprocessa preservando a auditoria */}
          <div>
            <label className="ds-caption block text-senior-cinza-600" htmlFor={`clue-input-${r.rowNumber}`}>
              Adicionar outra pista para esta mesma linha — site, domínio, CNPJ, telefone ou cidade
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <Input
                id={`clue-input-${r.rowNumber}`}
                value={clue}
                onChange={(e) => setClue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !locked && clue.trim()) sendClue();
                }}
                placeholder="ex.: madeireirasaojose.com.br"
                className="h-11 flex-1 rounded-[8px] border-senior-cinza-300 sm:h-9"
                aria-label="Nova pista para investigar esta linha"
                data-testid={`review-clue-input-${r.rowNumber}`}
              />
              <Button
                className="sn-btn-verde h-11 shrink-0 sm:h-9"
                onClick={sendClue}
                disabled={locked || !clue.trim()}
                data-testid={`review-clue-send-${r.rowNumber}`}
              >
                {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Investigar com esta pista
              </Button>
            </div>
            <p className="ds-caption mt-1 text-senior-cinza-400">Reprocessa a busca nesta mesma linha — o histórico de auditoria é preservado.</p>
          </div>

          {/* 2. CNPJ correto — a consulta oficial confirma */}
          <div>
            <label className="ds-caption block text-senior-cinza-600" htmlFor={`manual-cnpj-${r.rowNumber}`}>
              Sei o CNPJ correto (só aceitamos números válidos — a consulta oficial confirma)
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <Input
                id={`manual-cnpj-${r.rowNumber}`}
                value={manual}
                onChange={(e) => {
                  setManual(e.target.value);
                  setManualErr(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !locked) confirmManual();
                }}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                className="h-11 flex-1 rounded-[8px] border-senior-cinza-300 tabular-nums sm:h-9"
                aria-label="CNPJ correto desta empresa"
                aria-invalid={manualErr ? true : undefined}
                data-testid={`review-manual-input-${r.rowNumber}`}
              />
              <Button className="sn-btn-verde h-11 shrink-0 sm:h-9" onClick={confirmManual} disabled={locked} data-testid={`review-manual-confirm-${r.rowNumber}`}>
                {deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmar CNPJ
              </Button>
            </div>
            {manualErr && <p className="ds-caption mt-1.5 text-[#8C2F39]" role="alert">{manualErr}</p>}
          </div>

          {/* 3. manter como não identificada — decisão resolvida, com confirmação explícita */}
          <div className="border-t border-[#F2F2F2] pt-2.5">
            {!confirmNF ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-[8px] border-senior-cinza-300 bg-white text-senior-cinza-600 hover:bg-[#F2F2F2]"
                onClick={() => setConfirmNF(true)}
                disabled={locked}
                data-testid={`review-notfound-arm-${r.rowNumber}`}
              >
                <SearchX className="h-3.5 w-3.5" /> Manter como não identificada
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="ds-caption text-[#8C2F39]">
                  Encerra esta pista como “Pistas insuficientes — revisão manual” (os candidatos ficam arquivados e a revisão pode ser reaberta).
                </span>
                <Button
                  size="sm"
                  className="h-8 rounded-[8px] bg-[#8C2F39] text-white hover:bg-[#732631]"
                  onClick={() => onDecide({ action: "NOT_FOUND" })}
                  disabled={locked}
                  data-testid={`review-notfound-confirm-${r.rowNumber}`}
                >
                  Confirmar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-[8px] text-senior-cinza-600 hover:bg-[#F2F2F2]"
                  onClick={() => setConfirmNF(false)}
                  disabled={locked}
                  data-testid={`review-notfound-cancel-${r.rowNumber}`}
                >
                  Cancelar
                </Button>
              </div>
            )}
          </div>

          {/* 4. voltar aos candidatos — a revisão continua aberta */}
          <div className="border-t border-[#F2F2F2] pt-2.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-[8px] px-2.5 text-[13px] text-[#086B6B] hover:bg-[#00968C0D] hover:text-[#086B6B]"
              onClick={() => {
                setNoneOpen(false);
                onDecide({ action: "BACK" });
              }}
              disabled={locked}
              data-testid={`review-back-${r.rowNumber}`}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Voltar aos candidatos
            </Button>
          </div>
        </div>
      )}

      {res.notas.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-[#FFC51166] pt-3">
          {res.notas.map((n, i) => (
            <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600">
              <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({
  c, index, chosen, locked, onChoose,
}: { c: ResolutionCandidateView; index: number; chosen: boolean; locked: boolean; onChoose: () => void }) {
  const validBindings = (c.bindings ?? []).filter((b) => b.strength !== "INVALIDA");
  const invalidBindings = (c.bindings ?? []).filter((b) => b.strength === "INVALIDA");
  const sinais = identitySinais(c.sinais);
  // situação cadastral do REGISTRO — alerta material antes do botão de confirmar
  const cad = situacaoCadastralDe(c);
  const cadAlerta = !!cad && CADASTRAL_ALERTA.has(cad);
  return (
    <li className={`rounded-[8px] border bg-white p-3 transition-shadow ${chosen ? "border-[#00968C66] shadow-[0_0_0_1px_#00968C33]" : "border-senior-cinza-300 hover:border-[#00968C40]"}`} data-testid={`candidate-${c.cnpj}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ds-title-md min-w-0 text-senior-azul">
          <span className="mr-1.5 text-senior-cinza-400">{index}.</span>
          {c.confirmado?.razaoSocial ?? formatCnpj(c.cnpj)}
        </p>
        <span className="flex items-center gap-2">
          {chosen && <Badge className="border-transparent bg-[#00968C] text-[13px] text-white"><Check className="mr-0.5 h-3 w-3" aria-hidden="true" />escolhida</Badge>}
          <TrustChip confidence={c.strength} />
        </span>
      </div>
      <p className="ds-caption mt-0.5 text-senior-cinza-600">
        CNPJ {formatCnpj(c.cnpj)}
        {c.confirmado?.municipio || c.confirmado?.uf ? ` · ${[c.confirmado?.municipio, c.confirmado?.uf].filter(Boolean).join("/")}` : ""}
        {cad ? ` · situação: ${registrationLabel(cad)}` : ""}
      </p>
      {cadAlerta && (
        <p className="ds-caption mt-1.5 flex items-center gap-1.5 rounded-[6px] border border-[#F1BDBD] bg-[#FDF1F1] px-2 py-1 text-[#8C2F39]" data-testid={`candidate-cad-alert-${c.cnpj}`}>
          <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          Situação cadastral {registrationLabel(cad).toLowerCase()} — registro irregular; confirme se é a empresa operacional que você quer.
        </p>
      )}

      {validBindings.length > 0 && (
        <div className="mt-2.5">
          <p className="ds-caption font-medium text-senior-azul">Por que este CNPJ corresponde à pista</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {validBindings.map((b, i) => (
              <BindingChip key={i} b={b} />
            ))}
          </div>
          <ul className="mt-1.5 space-y-1">
            {validBindings.map((b, i) => (
              <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600">
                <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-[#086B6B]" aria-hidden="true" />
                <span className="min-w-0">{b.bindingEvidence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sinais.length > 0 && (
        <ul className="mt-2 space-y-1">
          {sinais.map((s, i) => (
            <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
              <Check className="mt-1 h-3 w-3 shrink-0 text-[#00968C]" aria-hidden="true" />
              {s}
            </li>
          ))}
        </ul>
      )}
      {c.contradicoes.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {c.contradicoes.map((s, i) => (
            <li key={i} className="ds-body flex items-start gap-1.5 text-senior-cinza-600">
              <X className="mt-1 h-3 w-3 shrink-0 text-[#8C2F39]" aria-hidden="true" />
              {s}
            </li>
          ))}
        </ul>
      )}

      {(c.dadosJuridicos?.length ?? 0) > 0 && (
        <div className="mt-2.5 rounded-[8px] border border-senior-cinza-200 bg-[#F7F7F7] p-2.5">
          <p className="ds-caption font-medium text-senior-cinza-600">
            Dados jurídicos confirmados
            <span className="font-normal"> — validam o registro, não o vínculo com a pista</span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {c.dadosJuridicos!.filter(Boolean).map((s, i) => (
              <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600">
                <ScrollText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {invalidBindings.length > 0 && (
        <p className="ds-caption mt-2 flex items-start gap-1.5 text-[#8C2F39]">
          <X className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {invalidBindings[0].bindingEvidence}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {c.fontes.length > 0 && (
          <p className="ds-caption min-w-0 text-senior-cinza-600">
            Visto em:{" "}
            {c.fontes.map((f, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer" className="text-[#086B6B] underline underline-offset-2">
                    {sourceLabel(f.fonte)}
                  </a>
                ) : (
                  sourceLabel(f.fonte)
                )}
              </span>
            ))}
          </p>
        )}
        <Button
          size="sm"
          className="sn-btn-verde h-8"
          onClick={onChoose}
          disabled={locked || chosen}
          data-testid={`choose-${c.cnpj}`}
        >
          {chosen ? (
            <>
              <CircleCheck className="h-3.5 w-3.5" /> É esta — confirmada
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" /> É esta empresa
            </>
          )}
        </Button>
      </div>
    </li>
  );
}

/* ==================================================================== */
/* Bloco: por que identificamos (CONFIRMED)                              */
/* ==================================================================== */

function WhyPanel({ r }: { r: RowDetail }) {
  const res = r.resolution;
  if (!res) return null;
  const chosen = (res.candidatos ?? []).find((c) => c.cnpj === r.resolvedCnpj) ?? (res.candidatos ?? [])[0];
  if (!chosen) return null;
  const validBindings = (chosen.bindings ?? []).filter((b) => b.strength !== "INVALIDA");
  const sinais = identitySinais(chosen.sinais);
  if (validBindings.length === 0 && sinais.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-[#00968C40] bg-[#00968C08] p-4" data-testid={`why-${r.rowNumber}`}>
      <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
        <CircleCheck className="h-4 w-4 text-[#00968C]" aria-hidden="true" />
        Por que identificamos esta empresa
      </h4>
      {validBindings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {validBindings.map((b, i) => (
            <BindingChip key={i} b={b} />
          ))}
        </div>
      )}
      <ul className="mt-2 space-y-1.5">
        {validBindings.map((b, i) => (
          <li key={`b${i}`} className="ds-body flex items-start gap-1.5 text-senior-azul">
            <Link2 className="mt-1 h-3.5 w-3.5 shrink-0 text-[#086B6B]" aria-hidden="true" />
            {b.bindingEvidence}
          </li>
        ))}
        {sinais.map((s, i) => (
          <li key={`s${i}`} className="ds-body flex items-start gap-1.5 text-senior-azul">
            <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-[#00968C]" aria-hidden="true" />
            {s}
          </li>
        ))}
      </ul>
      {(chosen.dadosJuridicos?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-[8px] border border-senior-cinza-300 bg-white/70 p-2.5">
          <p className="ds-caption font-medium text-senior-cinza-600">
            Dados jurídicos confirmados
            <span className="font-normal"> — validam o registro, não são prova de vínculo</span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {chosen.dadosJuridicos!.filter(Boolean).map((s, i) => (
              <li key={i} className="ds-caption flex items-start gap-1.5 text-senior-cinza-600">
                <ScrollText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Bloco: não identificada — o que faltou                                */
/* ==================================================================== */

function UnresolvedPanel({
  r, busy, deciding, onDecide,
}: { r: RowDetail; busy?: boolean; deciding?: boolean; onDecide?: (body: DecideRequest) => void }) {
  const res = r.resolution;
  const notas = res?.notas ?? [];
  return (
    <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4" data-testid={`unresolved-${r.rowNumber}`}>
      <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
        <SearchX className="h-4 w-4 text-senior-cinza-600" aria-hidden="true" />
        Não conseguimos identificar esta empresa
      </h4>
      {notas.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {notas.map((n, i) => (
            <li key={i} className="ds-body flex items-start gap-1.5 text-senior-cinza-600">
              <CircleHelp className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {n}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-body mt-2 text-senior-cinza-600">
          As fontes públicas não trouxeram evidência suficiente para esta pista. Tente enviar outra pista para a mesma
          empresa — o site ou o e-mail corporativo ajudam bastante.
        </p>
      )}
      {/* sem beco sem saída: a decisão “não identificada” pode ser reaberta */}
      {onDecide && (
        <RowAction
          onClick={() => onDecide({ action: "BACK" })}
          disabled={busy || deciding}
          title="Traz de volta os candidatos arquivados desta pista"
          testId={`unresolved-reopen-${r.rowNumber}`}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reabrir candidatos
        </RowAction>
      )}
      <DiscardedList descartados={res?.descartados ?? []} testId={`unresolved-discarded-${r.rowNumber}`} />
    </div>
  );
}

/* ==================================================================== */
/* Bloco: dados públicos da empresa                                      */
/* ==================================================================== */

/** Dados públicos COMPLEMENTARES do registro — só o que os cartões do resumo e a
 *  seção de contatos não mostram. v0.10.14 (qualidade do dado): capital social,
 *  porte, Simples, telefone, e-mail e endereço deixaram de repetir aqui; cada
 *  informação aparece UMA vez na ficha. Telefone fictício do cadastro (ex.:
 *  000000000000) não vira contato em lugar nenhum — ver telefoneUtil. */
function PublicDataPanel({ r }: { r: RowDetail }) {
  const e = r.extra;
  const hasData = e && (e.naturezaJuridica || e.mei || e.setorPrimario || (e.cnaesSecundarios && e.cnaesSecundarios.length > 0));
  if (!hasData) return null;
  return (
    <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4">
      <h4 className="ds-title-md text-senior-azul">Registro público</h4>
      <dl className="mt-2 divide-y divide-[#F2F2F2]">
        {e.setorPrimario && (
          <DefRow label="Setor (CNAE)" data-testid="setor-cnae">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="rounded-full bg-[#EAF1F7] px-2 py-0.5 text-[13px] font-medium text-[#33466C]">{e.setorPrimario}</span>
              {e.multissetorial && (
                <span className="rounded-full bg-[#F2F2F2] px-2 py-0.5 text-[13px] text-[#33466C]">multissetorial: também {e.setoresSecundarios?.join(", ")}</span>
              )}
            </span>
            <p className="ds-caption mt-1 text-senior-cinza-600">Setor derivado do CNAE registrado (IBGE).</p>
            {e.avisosSetoriais && e.avisosSetoriais.length > 0 && (
              <p className="ds-caption mt-1 text-[#8A5A00]" data-testid="setor-aviso">{e.avisosSetoriais.join(" · ")}</p>
            )}
          </DefRow>
        )}
        {e.naturezaJuridica && <DefRow label="Natureza">{e.naturezaJuridica}</DefRow>}
        {e.mei && <DefRow label="MEI">{e.mei}</DefRow>}
        {e.cnaesSecundarios && e.cnaesSecundarios.length > 0 && (
          <DefRow label="Outras atividades">
            <span className="flex flex-wrap gap-1">
              {e.cnaesSecundarios.slice(0, 4).map((c, i) => (
                <span key={i} className="rounded-full bg-[#F2F2F2] px-2 py-0.5 text-[13px] text-[#33466C]">{c}</span>
              ))}
              {e.cnaesSecundarios.length > 4 && <span className="text-[13px] text-senior-cinza-600">+{e.cnaesSecundarios.length - 4}</span>}
            </span>
            {e.cnaesTruncados && (
              <p className="ds-caption mt-1 text-[#8A5A00]" data-testid="cnaes-truncados-aviso">
                Lista incompleta: existem mais atividades registradas e a exibição respeita um teto de segurança.
              </p>
            )}
          </DefRow>
        )}
      </dl>
    </div>
  );
}

/* ==================================================================== */
/* Bloco: teia societária                                                */
/* ==================================================================== */

function SociosPanel({ r }: { r: RowDetail }) {
  if (!r.socios || r.socios.length === 0) return null;
  // v0.10.14 (qualidade do dado): quem está na administração aparece UMA vez na
  // seção de representantes (DecisoresSection). Aqui ficam só os OUTROS integrantes
  // do quadro societário; se o quadro inteiro é a administração, nada se repete.
  const temDecisores = decisoresOf(r).length > 0;
  const outros = r.socios.filter((s) => !DECISOR_QUAL_RE.test(s.qual ?? ""));
  if (temDecisores && outros.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4" data-testid={`socios-${r.rowNumber}`}>
      <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
        <Users className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
        {temDecisores ? "Outros sócios no quadro" : "Quem está por trás da empresa"}
      </h4>
      <ul className="mt-2 space-y-1.5">
        {outros.slice(0, 8).map((s, i) => (
          <li key={i} className="ds-body flex flex-wrap items-baseline gap-x-2 text-senior-azul">
            <span className="font-medium">{s.nome}</span>
            {s.qual && <span className="text-senior-cinza-600">· {s.qual}</span>}
            {s.entrada && <span className="text-senior-cinza-400">· desde {s.entrada}</span>}
          </li>
        ))}
      </ul>
      {outros.length > 8 && <p className="ds-caption mt-1.5 text-senior-cinza-600">+ {plural(outros.length - 8, "pessoa", "pessoas")} no quadro.</p>}
      {r.extra?.qsaTruncados && (
        <p className="ds-caption mt-1.5 text-[#8A5A00]" data-testid="qsa-truncado-aviso" role="note">
          Lista incompleta: o quadro de sócios excede o teto de segurança (500) e foi registrado truncado.
        </p>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Bloco: leitura inteligente (IA)                                       */
/* ==================================================================== */

function AiBlock({
  r, busy, onView, onRetry,
}: { r: RowDetail; busy: boolean; onView: () => void; onRetry: () => void }) {
  if (r.aiStatus === "OK" && r.aiReading) {
    return (
      <div className="rounded-[10px] border border-[#00968C38] bg-[#00968C0A] p-4" data-testid={`ai-block-${r.rowNumber}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
            <Sparkles className="h-4 w-4 text-[#00968C]" aria-hidden="true" />
            Leitura inteligente
          </h4>
          <span className="flex flex-wrap items-center gap-1.5">
            {r.aiSector && <Badge variant="outline" className="whitespace-nowrap border-[#00968C33] bg-white px-2.5 py-1 text-[12.5px] font-medium text-[#086B6B]">{r.aiSector}</Badge>}
            {r.aiSize && !/indeterminad/i.test(r.aiSize) && <Badge variant="outline" className="whitespace-nowrap border-[#00968C33] bg-white px-2.5 py-1 text-[12.5px] font-medium text-[#086B6B]">{r.aiSize}</Badge>}
          </span>
        </div>
        <p className="ds-body mt-2 leading-relaxed text-senior-azul">{r.aiReading}</p>
        {r.aiDossier?.aderencia && r.aiDossier.aderencia.length > 0 && (
          <div className="mt-2.5" data-testid={`ai-aderencia-${r.rowNumber}`}>
            <p className="ds-caption text-senior-cinza-600">POSSÍVEL ADERÊNCIA AO PORTFÓLIO SENIOR (HIPÓTESE)</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {r.aiDossier.aderencia.slice(0, 3).map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#00968C2E] bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-[#33466C]"
                  title={f.hipotese}
                >
                  <PortfolioLogo produto={f.produto} className="h-4 w-auto" />
                  {PORTFOLIO_LOGOS[f.produto]?.label ?? f.produto}
                </span>
              ))}
            </div>
          </div>
        )}
        {r.aiHypotheses.length > 0 && (
          <div className="mt-3">
            <p className="ds-caption text-senior-cinza-600">HIPÓTESES A VALIDAR</p>
            <ul className="mt-1 space-y-1">
              {r.aiHypotheses.slice(0, 3).map((h, i) => (
                <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                  <CircleHelp className="mt-1 h-3 w-3 shrink-0 text-[#B08300]" aria-hidden="true" />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#00968C26] pt-2.5">
          <p className="ds-caption text-senior-cinza-600">
            Gerada por IA a partir dos dados públicos consultados{r.aiProcessedAt ? ` · ${formatBR(r.aiProcessedAt)}` : ""} — hipóteses a validar, nunca conclusões.
          </p>
          {r.aiDossier && (
            <RowAction onClick={onView} testId={`ai-view-${r.rowNumber}`}>
              <Eye className="h-3.5 w-3.5" /> Abrir leitura completa
            </RowAction>
          )}
        </div>
      </div>
    );
  }

  if (r.aiStatus === "EM_FILA" || r.aiStatus === "GERANDO") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-[#00968C38] bg-[#00968C0A] px-4 py-3 text-sm text-senior-azul" data-testid={`ai-waiting-${r.rowNumber}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#00968C]" aria-hidden="true" />
        {AI_STATE[r.aiStatus] ?? "Preparando leitura"}. A tela atualiza sozinha.
      </div>
    );
  }

  if (r.aiStatus === "FALHOU") {
    return (
      <div className="rounded-[10px] border border-[#F1BDBD] bg-[#FDF1F1] px-4 py-3" data-testid={`ai-failed-${r.rowNumber}`}>
        <p className="ds-body text-[#8C2F39]">Não conseguimos preparar a leitura desta conta agora.</p>
        <RowAction onClick={onRetry} disabled={busy} testId={`ai-retry-${r.rowNumber}`}>
          <RotateCcw className="h-3.5 w-3.5" /> Tentar de novo
        </RowAction>
      </div>
    );
  }

  return null;
}

/* Fase 6 do plano v0.6: a expansão inline da linha (ficha extensa DENTRO da tabela,
 * com sobreposição/transbordo) foi REMOVIDA — a expansão agora abre o dossiê em Sheet
 * lateral (≥1024px, 560px à direita) ou full-width abaixo disso, com rolagem única. */

/* ==================================================================== */
/* Painel: progresso real — só existe com execução em curso (v0.10.8)     */
/* ==================================================================== */

function ProgressPanel({ detail }: { detail: BatchDetail }) {
  const processable = detail.totalValid + detail.totalReference;
  const done = Math.max(0, processable - detail.totalPending);
  const pct = processable > 0 ? Math.min(100, Math.round((done / processable) * 100)) : 0;
  const aiPct = detail.aiTotal > 0 ? Math.min(100, Math.round((detail.aiDone / detail.aiTotal) * 100)) : 0;
  return (
    <div className="glass-chip rounded-[14px] p-5" data-testid="progress-area">
      <div className="flex items-center justify-between gap-3">
        <p className="ds-title-md flex items-center gap-2 text-senior-azul">
          <Loader2 className="h-4 w-4 animate-spin text-[#00968C]" aria-hidden="true" />
          Consultando dados públicos
        </p>
        <p className="ds-caption tabular-nums text-senior-cinza-600">{done} de {processable || "—"}</p>
      </div>
      <Progress value={pct} className="shimmer mt-2 h-2 bg-[#F2F2F2] [&>div]:bg-gradient-to-r [&>div]:from-[#00AF9B] [&>div]:to-[#12F7D1]" data-testid="progress-bar" />
      {detail.aiEnabled && detail.aiTotal > 0 && (
        <div className="mt-3" data-testid="ai-progress">
          <div className="flex items-center justify-between gap-3">
            <p className="ds-caption flex items-center gap-1.5 text-senior-cinza-600">
              <Sparkles className="h-3 w-3 text-[#00968C]" aria-hidden="true" />
              Preparando as leituras inteligentes
            </p>
            <p className="ds-caption tabular-nums text-senior-cinza-600" data-testid="ai-progress-label">{detail.aiDone} de {detail.aiTotal}</p>
          </div>
          <Progress value={aiPct} className="mt-1 h-1.5 bg-[#F2F2F2] [&>div]:bg-gradient-to-r [&>div]:from-[#00AF9B] [&>div]:to-[#12F7D1]" data-testid="ai-progress-bar" />
        </div>
      )}
      {/* P1-09 + v0.10.17 (contrato de linguagem): frase curta, sem promessa de prazo */}
      <p className="ds-caption mt-3 text-senior-cinza-600">
        O tempo depende do tamanho do lote e da resposta de cada fonte. A tela atualiza sozinha.
      </p>
    </div>
  );
}

/* ==================================================================== */
/* Painel: lote confirmado, NADA iniciado (v0.10.8 — coerência de estados) */
/* Sem spinner, sem barra de progresso, sem promessa de execução.         */
/* ==================================================================== */

function WaitingStartPanel({ detail }: { detail: BatchDetail }) {
  const preparadas = detail.totalValid + detail.totalReference;
  return (
    <div className="rounded-[14px] border border-senior-cinza-300 bg-white p-5" data-testid="waiting-start" role="status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F2F2F2]">
            <CircleDashed className="h-4.5 w-4.5 text-senior-cinza-500" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="ds-title-md text-senior-azul" data-testid="waiting-start-title">Aguardando início</p>
            <p className="ds-body mt-0.5 text-senior-cinza-600" data-testid="waiting-start-message">
              {preparadas} entrada{preparadas === 1 ? "" : "s"} preparada{preparadas === 1 ? "" : "s"}. Nenhuma consulta iniciada. Clique em <b className="font-semibold text-senior-azul">Iniciar agora</b> para consultar as fontes públicas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* Painel: resultado pronto — revisão primeiro, exportação depois        */
/* ==================================================================== */

/* ==================================================================== */
/* Exportação — UMA experiência com duas decisões simples (v0.10.15):      */
/*   1. O que exportar (todas / sem revisão / em revisão / selecionadas)   */
/*   2. Em qual formato (Excel, PDF compacto do lote, CSV)                 */
/* Formatos técnicos e contratos existentes ficam na área recolhida.       */
/* ==================================================================== */

type EscopoExport = "TODAS" | "SEM_REVISAO" | "EM_REVISAO" | "SELECIONADAS";
type FormatoExport = "EXCEL" | "PDF" | "CSV";

/** Limite do PDF compacto — acima disso o formato explica a restrição e indica o Excel. */
const LIMITE_PDF_LOTE_UI = 300;

/** Baixa um arquivo da API com tratamento de erro legível (toasts em vez de falha muda). */
async function baixarArquivo(url: string, body: unknown | null, nomePadrao: string): Promise<{ ok: true; nome: string } | { ok: false; erro: string }> {
  try {
    const res = body ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) : await fetch(url);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, erro: j?.error?.message ?? "A exportação não concluiu. Tente novamente." };
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const nome = /filename="([^"]+)"/.exec(cd)?.[1] ?? nomePadrao;
    const a = document.createElement("a");
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    return { ok: true, nome };
  } catch {
    return { ok: false, erro: "Não conseguimos falar com o servidor. Verifique a conexão e tente de novo." };
  }
}

function ExportMenu({ detail, selected }: { detail: BatchDetail; selected: number[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        className="h-10 gap-1.5 rounded-[8px] border-senior-cinza-300 bg-white text-[13px] font-semibold text-senior-azul hover:bg-[#F2F2F2]"
        onClick={() => setOpen(true)}
        data-testid="export-menu-trigger"
      >
        <Download className="h-4 w-4" /> Exportar
      </Button>
      <ExportDialog detail={detail} selected={selected} open={open} onOpenChange={setOpen} />
    </>
  );
}

function ExportDialog({
  detail, selected, open, onOpenChange,
}: { detail: BatchDetail; selected: number[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [escopo, setEscopo] = useState<EscopoExport>("TODAS");
  const [formato, setFormato] = useState<FormatoExport>("EXCEL");
  const [tecnicas, setTecnicas] = useState(false);
  const [gerando, setGerando] = useState(false);

  // v0.11.4: MESMA população do escopo SEM_REVISAO no servidor (CONFIRMADA_WHERE /
  // isConfirmed do export): enriquecida, sem identidade LOCALIZADO e resolução
  // CONFIRMED/nula. Limite conhecido: a exportação conta duplicatas herdadas via eff();
  // este contador SQL não — divergência pequena, registrada e não reproduzida aqui.
  const semRevisao = detail.prontasSemRevisao;
  const emRevisao = detail.totalReview;
  const selecionadas = selected.length;
  const hasAi = detail.aiEnabled && detail.aiTotal > 0;
  const countEscopo = (e: EscopoExport): number =>
    e === "TODAS" ? detail.rowCount : e === "SEM_REVISAO" ? semRevisao : e === "EM_REVISAO" ? emRevisao : selecionadas;
  const noEscopo = countEscopo(escopo);
  const pdfBloqueado = countEscopo(escopo) > LIMITE_PDF_LOTE_UI;
  const prontoParaExportar = noEscopo > 0 && !(formato === "PDF" && pdfBloqueado);

  const exporta = async () => {
    setGerando(true);
    try {
      const rowsSelecionadas = [...selected].sort((a, b) => a - b);
      let url = `/api/imports/${detail.id}/export?`;
      let body: unknown = null;
      if (formato === "EXCEL" || formato === "PDF") {
        const params = new URLSearchParams({ type: formato === "EXCEL" ? "excel" : "pdf_lote", scope: escopo });
        if (escopo === "SELECIONADAS") params.set("rows", rowsSelecionadas.join(","));
        if (rowsSelecionadas.length > 400 || escopo === "SELECIONADAS") {
          body = { type: formato === "EXCEL" ? "excel" : "pdf_lote", scope: escopo, rows: rowsSelecionadas };
        }
        url += params.toString();
      } else {
        if (escopo === "TODAS") url += "type=result";
        else if (escopo === "SEM_REVISAO") url += "type=result_confirmed";
        else if (escopo === "EM_REVISAO") url += "type=result_review";
        else {
          if (rowsSelecionadas.length > 400) {
            body = { type: "result_selected", rows: rowsSelecionadas };
            url += "type=result_selected";
          } else {
            url += `type=result_selected&rows=${rowsSelecionadas.join(",")}`;
          }
        }
      }
      const resultado = await baixarArquivo(url, body, "exportacao-scout360");
      if (!resultado.ok) {
        toast({ title: "Não conseguimos exportar", description: resultado.erro, variant: "destructive" });
        return;
      }
      onOpenChange(false);
      toast({ title: "Exportação pronta", description: `${resultado.nome} foi baixado para o seu computador.` });
    } finally {
      setGerando(false);
    }
  };

  const escopoItens: { valor: EscopoExport; titulo: string; desc: string; desabilitado: boolean }[] = [
    { valor: "TODAS", titulo: "Todas as empresas", desc: `${plural(detail.rowCount, "entrada", "entradas")} do lote, incluindo as em revisão`, desabilitado: detail.rowCount === 0 },
    { valor: "SEM_REVISAO", titulo: "Somente sem revisão pendente", desc: `Exclui as ${emRevisao} que aguardam a sua conferência`, desabilitado: semRevisao === 0 },
    { valor: "EM_REVISAO", titulo: "Somente as que exigem revisão", desc: `As ${emRevisao} com divergência de identidade em aberto`, desabilitado: emRevisao === 0 },
    { valor: "SELECIONADAS", titulo: "Empresas selecionadas", desc: selecionadas > 0 ? `As ${selecionadas} marcadas na prévia` : "Marque contas na prévia para habilitar", desabilitado: selecionadas === 0 },
  ];
  const formatoItens: { valor: FormatoExport; titulo: string; desc: string; desabilitado: boolean }[] = [
    { valor: "EXCEL", titulo: "Excel (.xlsx)", desc: "Planilha com resumo, empresas, revisões, representantes, evidências e lacunas", desabilitado: false },
    {
      valor: "PDF",
      titulo: "PDF (resumo do lote)",
      desc: pdfBloqueado
        ? `Relatório compacto cobre até ${LIMITE_PDF_LOTE_UI} entradas por escopo; este escopo tem ${noEscopo}. Use o Excel para o volume completo.`
        : "Relatório compacto com resultado geral, empresas, revisões e pendências",
      desabilitado: pdfBloqueado,
    },
    { valor: "CSV", titulo: "CSV (.csv)", desc: "Planilha técnica completa, uma linha por entrada — compatibilidade com o formato atual", desabilitado: false },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 rounded-[14px] border-senior-cinza-300 p-0" data-testid="export-dialog">
        <DialogHeader className="border-b border-senior-cinza-300 px-5 pb-3 pt-4">
          <DialogTitle className="ds-title-md text-senior-azul">Exportar dados do lote</DialogTitle>
          <DialogDescription className="ds-body text-senior-cinza-600">
            Duas decisões: o que vai no arquivo e em qual formato. Nada é reconsultado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-5 py-4">
          <fieldset>
            <legend className="ds-caption mb-2 text-senior-cinza-600">O QUE EXPORTAR</legend>
            <RadioGroup value={escopo} onValueChange={(v) => setEscopo(v as EscopoExport)} className="gap-2" data-testid="export-escopo">
              {escopoItens.map((it) => (
                <Label
                  key={it.valor}
                  htmlFor={`escopo-${it.valor}`}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors ${escopo === it.valor ? "border-[#00968C] bg-[#00968C0D]" : "border-senior-cinza-300 bg-white hover:bg-[#F2F2F2]"} ${it.desabilitado ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <RadioGroupItem value={it.valor} id={`escopo-${it.valor}`} disabled={it.desabilitado} className="mt-0.5" data-testid={`escopo-${it.valor}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-senior-azul">{it.titulo}</span>
                    <span className="block text-[12.5px] text-senior-cinza-600">{it.desc}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <fieldset>
            <legend className="ds-caption mb-2 text-senior-cinza-600">EM QUAL FORMATO</legend>
            <RadioGroup value={formato} onValueChange={(v) => setFormato(v as FormatoExport)} className="gap-2" data-testid="export-formato">
              {formatoItens.map((it) => (
                <Label
                  key={it.valor}
                  htmlFor={`formato-${it.valor}`}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors ${formato === it.valor ? "border-[#00968C] bg-[#00968C0D]" : "border-senior-cinza-300 bg-white hover:bg-[#F2F2F2]"} ${it.desabilitado ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <RadioGroupItem value={it.valor} id={`formato-${it.valor}`} disabled={it.desabilitado} className="mt-0.5" data-testid={`formato-${it.valor}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-senior-azul">{it.titulo}</span>
                    <span className="block text-[12.5px] text-senior-cinza-600">{it.desc}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-1.5 rounded-[8px] border border-senior-cinza-300 bg-[#F7F9FA] p-3" data-testid="export-inclusao">
            <p className="ds-body text-senior-azul">
              {prontoParaExportar
                ? `Este arquivo vai incluir ${plural(noEscopo, "entrada", "entradas")}${escopo === "TODAS" && emRevisao > 0 ? `, incluindo as ${emRevisao} em revisão (marcadas na coluna de identidade)` : ""}.`
                : "Escolha um escopo com contas disponíveis."}
            </p>
            {detail.totalPending > 0 && (
              <p className="ds-caption text-senior-cinza-600">
                {plural(detail.totalPending, "entrada", "entradas")} ainda {detail.totalPending === 1 ? "está na fila" : "estão na fila"} e sa{detail.totalPending === 1 ? "i" : "em"} sem resultado.
              </p>
            )}
            {detail.totalFalhasConsulta > 0 && formato !== "EXCEL" && (
              <p className="ds-caption text-senior-cinza-600">
                {plural(detail.totalFalhasConsulta, "falha de consulta", "falhas de consulta")} aparecem com o motivo, na aba Resumo (Excel) ou na seção de pendências (PDF).
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="items-center gap-3 border-t border-senior-cinza-300 px-5 py-3 sm:justify-between">
          <Collapsible open={tecnicas} onOpenChange={setTecnicas} className="min-w-0">
            <CollapsibleTrigger className="ds-caption flex items-center gap-1.5 text-senior-cinza-600 hover:text-senior-azul" data-testid="export-tecnicas-trigger">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${tecnicas ? "rotate-180" : ""}`} aria-hidden="true" />
              Opções técnicas e outros formatos
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1" data-testid="export-tecnicas">
                <p className="ds-caption pb-1 text-senior-cinza-600">CONTRATOS EXISTENTES E FORMATOS AUDITÁVEIS</p>
                <a href={`/api/imports/${detail.id}/export?type=result`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-azul hover:bg-[#00968C14]" data-testid="export-complete">
                  Planilha completa (.csv) — todas as linhas originais + colunas derivadas
                </a>
                <a href={`/api/imports/${detail.id}/export?type=teia`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-azul hover:bg-[#00968C14]" data-testid="export-teia">
                  Teia societária (.csv) — uma linha por sócio registrado, sem IA
                </a>
                {hasAi && (
                  <a href={`/api/imports/${detail.id}/export?type=ai`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-azul hover:bg-[#00968C14]" data-testid="export-ai">
                    Leituras Scout 360 (.csv) — uma linha por conta com o dossiê de IA
                  </a>
                )}
                {detail.totalPending > 0 && (
                  <a href={`/api/imports/${detail.id}/export?type=pending`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-azul hover:bg-[#00968C14]" data-testid="export-pending">
                    Pendências (.csv) — entradas não concluídas, com o motivo
                  </a>
                )}
                <a href={`/api/imports/${detail.id}/export?type=summary`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" data-testid="export-summary">
                  Resumo técnico (.json) — números e tempos do lote
                </a>
                <a href={`/api/imports/${detail.id}/export?type=audit`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" data-testid="export-audit">
                  Auditoria (.jsonl) — registro completo da execução
                </a>
                <a href={`/api/imports/${detail.id}/triagem?formato=json`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" data-testid="export-triagem-json">
                  O que falta descobrir, TRIAGEM_V1 (.json)
                </a>
                <a href={`/api/imports/${detail.id}/triagem?formato=jsonl`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" data-testid="export-triagem-jsonl">
                  O que falta descobrir, TRIAGEM_V1 (.jsonl)
                </a>
                <a href={`/api/imports/${detail.id}/plano?formato=json`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" data-testid="export-plano-json">
                  Plano de consultas, PLANO_CONSULTAS_V1 (.json)
                </a>
                <a href={`/api/imports/${detail.id}/plano?formato=jsonl`} download className="block rounded-[6px] px-2 py-1.5 text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" data-testid="export-plano-jsonl">
                  Plano de consultas, PLANO_CONSULTAS_V1 (.jsonl)
                </a>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" className="h-9 rounded-[8px] text-[13px] text-senior-cinza-600 hover:bg-[#F2F2F2]" onClick={() => onOpenChange(false)} disabled={gerando}>
              Cancelar
            </Button>
            <Button className="sn-btn-verde h-9 gap-1.5 rounded-[8px]" onClick={exporta} disabled={!prontoParaExportar || gerando} data-testid="export-confirmar">
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {gerando ? "Gerando arquivo" : "Exportar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultsReadyPanel({
  detail, selected, onViewResults, onReview,
}: { detail: BatchDetail; selected: number[]; onViewResults: () => void; onReview?: () => void }) {
  const review = detail.totalReview;
  // v0.11.0 (Gate 6): alertas materiais como CHIPS de uma linha — o texto
  // completo segue no title (hover/leitor de tela). Antes 3 parágrafos
  // empilhados (~130px) empurravam a mesa para fora da primeira dobra.
  const alerts: { resumo: string; texto: string }[] = [];
  if (detail.alertBaixada > 0) {
    alerts.push({
      resumo: `${detail.alertBaixada} ${detail.alertBaixada === 1 ? "empresa" : "empresas"} baixada/suspensa/inapta`,
      texto: `${plural(detail.alertBaixada, "empresa")} com situação cadastral baixada/suspensa/inapta — confira se é a empresa operacional que você quer antes de exportar`,
    });
  }
  if (detail.alertMatriz > 0)
    alerts.push({ resumo: `${detail.alertMatriz} ${detail.alertMatriz === 1 ? "conta" : "contas"} sem matriz confirmada`, texto: `${plural(detail.alertMatriz, "conta")} com matriz não confirmada nas fontes públicas` });
  if (detail.alertHumana > 0)
    alerts.push({ resumo: `${detail.alertHumana} ${detail.alertHumana === 1 ? "identidade" : "identidades"} decidida${detail.alertHumana === 1 ? "" : "s"} manualmente`, texto: `${plural(detail.alertHumana, "identidade")} decidida manualmente por você` });
  // v0.10.14 (reconciliação): "prontas" exclui as que aguardam revisão —
  // antes o título dizia 24 prontas e 6 aguardando ao mesmo tempo
  // v0.11.4: contador canônico do servidor (mesma população do painel de
  // acompanhamento) — nunca a subtração de conjuntos ortogonais.
  const prontas = detail.pesquisaProfunda.identificadasElegiveis;
  // v0.11.0 (Gate 6): painel COMPACTO de uma linha — o resumo do lote não pode
  // comer a primeira dobra da mesa de investigação. O CTA de revisão (antes um
  // banner amarelo separado, ~110px) mora aqui; a explicação longa segue no
  // title do botão (hover/leitor de tela) e no estado das próprias linhas.
  return (
    <div className="glass-verde glass-reflex relative overflow-hidden rounded-[14px] px-5 py-3" data-testid="results-ready">
      {/* halo esmeralda de canto — assinatura do estado DONE */}
      <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-[#12F7D133] blur-3xl" aria-hidden="true" />
      {/* v0.11.0 (Gate 6): TÍTULO + AVISOS + AÇÕES numa única faixa (~64px) —
          o estado do lote não pode roubar a primeira dobra da mesa. */}
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="ds-title-md flex min-w-0 items-center gap-2 text-senior-azul" data-testid="results-ready-title">
          <CircleCheck className="h-5 w-5 shrink-0 text-[#00968C]" aria-hidden="true" />
          <span className="truncate">
            {prontas > 0
              ? `${plural(prontas, "conta")} pronta${prontas === 1 ? "" : "s"} para análise${review > 0 ? ` · ${plural(review, "identidade")} aguardando revisão` : ""}`
              : review > 0
                ? `${plural(review, "identidade")} aguardando revisão de identidade`
                : "Processamento concluído"}
          </span>
        </h3>
        {alerts.length > 0 && (
          <div
            className="flex min-w-0 flex-wrap items-center gap-1.5"
            data-testid="material-alerts"
            aria-label={`Avisos materiais: ${alerts.map((a) => a.texto).join("; ")}`}
          >
            {alerts.map((a, i) => (
              <span
                key={i}
                title={a.texto}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#FFC51166] bg-[#FFC51114] px-2 py-0.5 text-[12.5px] leading-tight text-[#33466C]"
              >
                <CircleAlert className="h-3 w-3 shrink-0 text-[#8a6d00]" aria-hidden="true" />
                <span className="truncate">{a.resumo}</span>
              </span>
            ))}
          </div>
        )}
        <span className="min-w-2 flex-1" aria-hidden="true" />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {review > 0 && onReview && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 rounded-[8px] border-[#8a6d0055] bg-white text-[#8a6d00] hover:bg-[#FFC51133]"
              onClick={onReview}
              title="Encontramos mais de uma possibilidade para estas pistas. Confirme qual é a certa para completar os dados e as leituras inteligentes."
              data-testid="cta-review-now"
            >
              Revisar agora <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <Button className="sn-btn-verde h-8 px-4 text-[13px] font-semibold" onClick={onViewResults} data-testid="cta-view-results">
            <Eye className="h-4 w-4" aria-hidden="true" /> Visualizar resultados
          </Button>
          <ExportMenu detail={detail} selected={selected} />
        </div>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* Painel: panorama do lote — setores, localização e situação            */
/* ==================================================================== */

function DistBar({ items, tone, labelFn, testId }: { items: DistItem[]; tone: string | ((k: string) => string); labelFn?: (k: string) => string; testId?: string }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-2" data-testid={testId}>
      {items.map((it) => {
        const label = labelFn ? labelFn(it.key) : it.key;
        const t = typeof tone === "function" ? tone(it.key) : tone;
        return (
          <li key={it.key} className="flex items-center gap-2">
            <span className="ds-caption w-32 shrink-0 truncate text-senior-cinza-600" title={label}>
              {label}
            </span>
            <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-[#F2F2F2]">
              <span
                className={`block h-full rounded-full transition-all duration-500 ${t}`}
                style={{ width: `${Math.max(8, (it.count / max) * 100)}%` }}
              />
            </span>
            {/* número já computado do lote — Ticker (Fase 4) */}
            <Ticker value={it.count} className="ds-caption w-6 shrink-0 text-right text-senior-azul" />
          </li>
        );
      })}
    </ul>
  );
}

function PanoramaPanel({ detail }: { detail: BatchDetail }) {
  const hasCnae = detail.cnaeDist.length > 0;
  const hasSector = detail.sectorDist.length > 0;
  const hasUf = detail.ufDist.length > 0;
  const hasSituacao = detail.situacaoDist.length > 0;
  if (!hasCnae && !hasSector && !hasUf && !hasSituacao) return null;
  const situTone = (k: string) =>
    k.toUpperCase() === "ATIVA"
      ? "bg-[#00968C]"
      : k.toUpperCase() === "BAIXADA" || k.toUpperCase() === "NULA" || k.toUpperCase() === "INAPTA" || k.toUpperCase() === "SUSPENSA"
        ? "bg-[#D97706]"
        : "bg-senior-cinza-400";
  const totalCols = [hasCnae || hasSector, hasUf, hasSituacao].filter(Boolean).length;
  const gridCols = totalCols >= 3 ? "lg:grid-cols-3" : totalCols === 2 ? "sm:grid-cols-2" : "";
  return (
    <div className="sn-surface sn-shadow-suave p-5" data-testid="panorama">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="ds-title-md text-senior-azul">Panorama do lote</h3>
        <p className="ds-caption text-senior-cinza-600">
          A distribuição das contas localizadas no lote{hasCnae ? " · setor cadastral pelo CNAE registrado" : ""}{hasSector ? " · setor inferido pela leitura de IA (hipótese)" : ""}
        </p>
      </div>
      <div className={`mt-4 grid gap-5 ${gridCols}`}>
        {/* v0.10.8 (coerência): setor CADASTRAL pelo CNAE — determinístico, sem IA,
            usando a classificação oficial já presente na ficha coletada. */}
        {hasCnae && (
          <section>
            <p className="ds-caption mb-2 text-senior-cinza-600">SETOR CADASTRAL (CNAE)</p>
            <DistBar items={detail.cnaeDist} tone="bg-[#00968C]" testId="panorama-cnae" />
          </section>
        )}
        {/* Setor INFERIDO pela IA — informação SEPARADA, nunca misturada ao cadastral.
            CNAE não prova atividade operacional; a leitura de IA é hipótese. */}
        {hasSector && (
          <section>
            <p className="ds-caption mb-2 flex flex-wrap items-center gap-1 text-senior-cinza-600">
              SETOR INFERIDO PELA LEITURA DE IA
              <span className="rounded-full bg-[#FFC51133] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#6B5A00]">hipótese</span>
            </p>
            <DistBar items={detail.sectorDist} tone="bg-[#8a6d00]" testId="panorama-setores" />
          </section>
        )}
        {hasUf && (
          <section>
            <p className="ds-caption mb-2 text-senior-cinza-600">LOCALIZAÇÃO (UF)</p>
            <DistBar items={detail.ufDist} tone="bg-[#00968C]" testId="panorama-ufs" />
          </section>
        )}
        {hasSituacao && (
          <section>
            <p className="ds-caption mb-2 text-senior-cinza-600">SITUAÇÃO CADASTRAL</p>
            <DistBar items={detail.situacaoDist} tone={situTone} labelFn={(k) => registrationLabel(k)} testId="panorama-situacao" />
          </section>
        )}
      </div>
      {hasSector && !hasCnae && (
        <p className="ds-caption mt-3 text-senior-cinza-500">
          O setor cadastral pelo CNAE aparece quando a ficha coletada traz a atividade econômica do registro.
        </p>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Painel: leitura do conjunto (IA)                                      */
/* ==================================================================== */

function SummaryPanel({
  detail, busy, error, onGenerate,
}: { detail: BatchDetail; busy: boolean; error: string | null; onGenerate: () => void }) {
  const s: BatchSummaryView | null = detail.aiSummary;
  return (
    <div className="rounded-[10px] border border-[#00968C38] bg-[#00968C0A] p-5" data-testid="ai-summary-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="ds-title-md flex items-center gap-2 text-senior-azul">
          <Sparkles className="h-4 w-4 text-[#00968C]" aria-hidden="true" />
          Leitura do conjunto
        </h3>
        {detail.totalEnriched > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-[13px] font-medium text-[#086B6B] hover:bg-[#00968C14] hover:text-[#086B6B]"
            onClick={onGenerate}
            disabled={busy}
            data-testid={s ? "btn-summary-regenerate" : "btn-summary-generate"}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {s ? "Gerar de novo" : "Gerar leitura do conjunto"}
          </Button>
        )}
      </div>

      {error && <p className="ds-body mt-3 rounded-[8px] border border-[#F1BDBD] bg-[#FDF1F1] px-3 py-2 text-[#8C2F39]" data-testid="ai-summary-error">{error}</p>}

      {busy && !s && (
        <p className="ds-body mt-3 flex items-center gap-2 text-senior-cinza-600" data-testid="ai-summary-loading">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00968C]" /> Lendo o conjunto de contas…
        </p>
      )}

      {s && (
        <div className="mt-3 space-y-3" data-testid="ai-summary-content">
          <p className="ds-body rounded-[8px] border-l-4 border-[#00968C] bg-white p-3 leading-relaxed text-senior-azul" data-testid="ai-summary-text">
            {s.resumo_executivo}
          </p>
          {s.destaques?.length > 0 && (
            <div>
              <p className="ds-caption text-senior-cinza-600">O QUE CHAMA ATENÇÃO</p>
              <ul className="mt-1 space-y-1">
                {s.destaques.map((d, i) => (
                  <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                    <CircleCheck className="mt-1 h-3 w-3 shrink-0 text-[#00968C]" aria-hidden="true" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.prioridades?.length > 0 && (
            <div>
              <p className="ds-caption text-senior-cinza-600">POR ONDE COMEÇAR</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                {s.prioridades.map((p, i) => (
                  <li key={i} className="ds-body text-senior-azul">{p}</li>
                ))}
              </ol>
            </div>
          )}
          <p className="ds-caption text-senior-cinza-600">
            Gerada por IA a partir dos dados públicos consultados{detail.aiSummaryAt ? ` · ${formatBR(detail.aiSummaryAt)}` : ""} — hipóteses a validar, nunca conclusões.
          </p>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Auditoria da execução (camada técnica secundária)                     */
/* ==================================================================== */

function AuditPanel({ events, detail }: { events: AuditEventView[]; detail: BatchDetail }) {
  return (
    <div className="space-y-4" data-testid="audit-panel">
      <ul className="cnpj-scroll max-h-72 space-y-1 overflow-y-auto rounded-[8px] border border-senior-cinza-300 bg-white p-3">
        {events.length === 0 && <li className="ds-caption text-senior-cinza-600">Sem registros ainda.</li>}
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2 ds-caption text-senior-cinza-600">
            <span className="w-28 shrink-0 tabular-nums">{formatBR(e.ts)}</span>
            <span className="min-w-0 flex-1 text-senior-azul">
              {eventLabel(e.event)}
              {e.rowNumber ? ` — linha ${e.rowNumber}` : ""}
            </span>
            <details className="shrink-0">
              <summary className="cursor-pointer text-[#086B6B] hover:underline">ver registro</summary>
              <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-[#F6F9FE] p-2 text-left text-[13px] leading-relaxed text-senior-cinza-600">
                {typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail, null, 1)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
      <dl className="divide-y divide-[#F2F2F2] rounded-[8px] border border-senior-cinza-300 bg-white px-3">
        <DefRow label="Arquivo">{detail.fileName}</DefRow>
        <DefRow label="Origem">{detail.sourceType === "TEXT" ? "Pistas coladas" : "Planilha enviada"}</DefRow>
        <DefRow label="Recebido em">{formatBR(detail.createdAt)}</DefRow>
        {detail.finishedAt && <DefRow label="Concluído em">{formatBR(detail.finishedAt)}</DefRow>}
        <DefRow label="Identificador do lote"><span className="font-mono text-xs">{detail.id}</span></DefRow>
      </dl>
    </div>
  );
}

/* ==================================================================== */
/* Dossiê da empresa — v0.10.13: FICHA ÚNICA em seções (sem abas)         */
/* ==================================================================== */

/* ------------------------------ Seções da ficha ------------------------------ */

/**
 * v0.10.13 — seção numerada da FICHA ÚNICA da empresa (substitui a navegação
 * Dossiê/Dados/Evidências). recolhida: seções secundárias nascem fechadas.
 */
function FichaSecao({
  n, titulo, descricao, testId, children, acoes, recolhida = false,
}: {
  n: number;
  titulo: string;
  descricao?: string;
  testId?: string;
  children: React.ReactNode;
  acoes?: React.ReactNode;
  recolhida?: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const numero = (
    <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#00968C1A] text-[13px] font-bold text-[#086B6B]" aria-hidden="true">
      {n}
    </span>
  );
  if (recolhida) {
    return (
      <Collapsible open={aberta} onOpenChange={setAberta} className="relative pl-10" data-ficha-secao={n} data-testid={testId}>
        {numero}
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-start gap-3 text-left" aria-expanded={aberta}>
            <span className="min-w-0 flex-1">
              <span className="ds-title-md block text-senior-azul">{titulo}</span>
              {descricao && <span className="ds-caption mt-0.5 block text-senior-cinza-600">{descricao}</span>}
            </span>
            {aberta ? (
              <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-senior-cinza-600" aria-hidden="true" />
            ) : (
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-senior-cinza-600" aria-hidden="true" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-4">{children}</CollapsibleContent>
      </Collapsible>
    );
  }
  return (
    <section className="relative scroll-mt-14 pl-10" data-ficha-secao={n} data-testid={testId}>
      {numero}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="ds-title-md pt-0.5 text-senior-azul">{titulo}</h4>
          {descricao && <p className="ds-caption mt-0.5 text-senior-cinza-600">{descricao}</p>}
        </div>
        {acoes}
      </div>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

/** v0.10.13 — sub-bloco da análise comercial (sem numeração própria: a numeração é da ficha). */
function SubSecaoAnalise({ titulo, testId, children }: { titulo: string; testId?: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId}>
      <h4 className="ds-caption text-senior-cinza-600">{titulo}</h4>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </section>
  );
}

function MiniChip({ tone }: { tone: "fato" | "consequencia" | "validar" | "CONFIRMADO" | "INDICIO" | "HIPOTESE" | "NAO_COMPROVADO" | "NAO_ENCONTRADO" }) {
  const cls =
    tone === "fato" ? "bg-[#00968C1A] text-[#086B6B]"
    : tone === "consequencia" ? "bg-[#FFC51133] text-[#33466C]"
    : tone === "validar" ? "bg-[#33466C0D] text-[#33466C]"
    : tone === "CONFIRMADO" ? "bg-[#00968C1A] text-[#086B6B]"
    : tone === "INDICIO" ? "bg-[#FFC51133] text-[#33466C]"
    : tone === "HIPOTESE" ? "bg-[#33466C14] text-[#33466C]"
    : tone === "NAO_COMPROVADO" ? "bg-[#FF7A591A] text-[#B3532F]"
    : "bg-[#F2F2F2] text-[#77736E]";
  const label = tone === "fato" ? "FATO OBSERVADO" : tone === "consequencia" ? "CONSEQUÊNCIA POSSÍVEL" : tone === "validar" ? "O QUE VALIDAR" : tone === "NAO_COMPROVADO" ? "NÃO COMPROVADO" : tone;
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[13px] font-bold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function HypothesisCard({ h, i }: { h: DetailedHypothesisView; i: number }) {
  return (
    <div className="space-y-1.5 rounded-[8px] border border-senior-cinza-300 bg-white p-3" data-testid={`scout-hipotese-detalhada-${i}`}>
      <p className="ds-body flex items-start gap-2 text-senior-azul">
        <MiniChip tone="fato" /> <span>{h.fato}</span>
      </p>
      <p className="ds-body flex items-start gap-2 text-[#33466C]">
        <MiniChip tone="consequencia" /> <span>{h.consequencia}</span>
      </p>
      <p className="ds-body flex items-start gap-2 text-[#33466C]">
        <MiniChip tone="validar" /> <span>{h.validar}</span>
      </p>
    </div>
  );
}

function EvidenceChipRow({ ev }: { ev: EvidenceItemView }) {
  return (
    <li className="flex items-start gap-2" data-testid={`evidencia-${ev.status.toLowerCase()}`}>
      <MiniChip tone={ev.status} />
      <span className="min-w-0">
        <span className="ds-body block text-senior-azul">{ev.claim}</span>
        <span className="ds-caption text-senior-cinza-600">
          {ev.entidade && ev.entidade !== "—" ? `entidade: ${ev.entidade} · ` : ""}
          {ev.source}
          {ev.periodo ? ` · período: ${ev.periodo}` : ""}
          {ev.url && (
            <>
              {" · "}
              <a href={ev.url} target="_blank" rel="noreferrer" className="text-[#086B6B] underline underline-offset-2 break-all">
                {ev.url.replace(/^https?:\/\//i, "").slice(0, 60)}
              </a>
            </>
          )}
          {ev.relevancia !== "media" ? ` · relevância ${ev.relevancia}` : ""}
        </span>
      </span>
    </li>
  );
}

/* ------------------------------ Cobertura factual (v0.9.0, E4) ------------------------------ */

type EstadoCobertura = "COMPROVADO" | "PARCIAL" | "NAO_ENCONTRADO" | "NAO_PESQUISADO";

const COBERTURA_ESTILO: Record<EstadoCobertura, string> = {
  COMPROVADO: "border-[#BFE3DB] bg-[#F3FAF8] text-[#086B6B]",
  PARCIAL: "border-[#F3E3C2] bg-[#FDF8EE] text-[#9A6B15]",
  NAO_ENCONTRADO: "border-senior-cinza-300 bg-white text-senior-cinza-600",
  NAO_PESQUISADO: "border-dashed border-senior-cinza-300 bg-transparent text-senior-cinza-400",
};

interface DimensaoCobertura {
  dimensao: string;
  estado: EstadoCobertura;
  porque: string;
}

/**
 * Derivada EXCLUSIVAMENTE de dados presentes (dossiê + pacote + cadastro) — sem score
 * comercial. "Não encontrado" só quando HOUVE pesquisa suficiente; cota recusada é
 * pesquisa incompleta (nunca conclusiva). Divergências ficam visíveis, nunca abafadas.
 */
function computeCobertura(r: RowDetail): DimensaoCobertura[] {
  const d = r.aiDossier;
  const pkt = r.research;
  const dim = pkt?.dimensoesPesquisadas;
  const evid = d?.evidencias ?? [];
  const recusadas = pkt?.buscasRecusadasCota ?? 0;
  const comStatus = (re: RegExp) => {
    const conf = evid.find((e) => e.status === "CONFIRMADO" && re.test(`${e.claim} ${e.source}`));
    if (conf) return "COMPROVADO" as EstadoCobertura;
    const ind = evid.find((e) => e.status === "INDICIO" && re.test(`${e.claim} ${e.source}`));
    if (ind) return "PARCIAL" as EstadoCobertura;
    return null;
  };
  const estadoPorBusca = (pesquisada: boolean): { estado: EstadoCobertura; porque: string } => {
    if (!pesquisada) return { estado: "NAO_PESQUISADO", porque: "nenhuma busca dirigida para esta dimensão" };
    if (recusadas > 0) return { estado: "NAO_PESQUISADO", porque: `pesquisa INCOMPLETA — ${plural(recusadas, "busca recusada", "buscas recusadas")} por cota; ausência não é conclusiva` };
    return { estado: "NAO_ENCONTRADO", porque: "pesquisado em fontes públicas sem resultado" };
  };
  const out: DimensaoCobertura[] = [];

  // Identidade — cadastro + resolução humana
  if (r.resolutionState === "CONFIRMED" && (r.legalName || r.normalizedCnpj)) {
    out.push({ dimensao: "Identidade", estado: "COMPROVADO", porque: "identidade confirmada (cadastro oficial + resolução)" });
  } else if (r.resolutionState === "REVIEW") {
    out.push({ dimensao: "Identidade", estado: "PARCIAL", porque: "identidade em revisão humana" });
  } else {
    out.push({ dimensao: "Identidade", estado: "PARCIAL", porque: "identidade não confirmada" });
  }

  // Operação — CNAE declarado (parcial) vs. evidência de operação observada
  const opEvid = comStatus(/atividade|opera|comércio|comercio|coopera|indústria|industria|serviço|servico|atacadista|varejo|telecom|transporte|avicultura|suinocultura|agroindústria|site oficial|providora|provedora/i);
  if (opEvid === "COMPROVADO" && (d?.oQueFaz?.length || pkt?.paginasOk)) {
    out.push({ dimensao: "Operação", estado: "COMPROVADO", porque: "operação descrita em fonte própria/pública com evidência" });
  } else if (opEvid === "PARCIAL" || r.cnaeDescription) {
    out.push({ dimensao: "Operação", estado: "PARCIAL", porque: r.cnaeDescription ? "atividade DECLARADA no cadastro (CNAE), observação parcial" : "indício de operação" });
  } else {
    out.push({ dimensao: "Operação", estado: "NAO_PESQUISADO", porque: "sem busca/leitura de operação" });
  }

  // Escala comprovada — capital social declarado NÃO conta (contrato: período + escopo)
  const escalaRe = /captação|captacao|faturamento|receita|funcionários|funcionarios|colaboradores|empregados|estabelecimentos|unidades|frota|população|populacao|vagas/i;
  const escalaEvid = comStatus(escalaRe);
  if (escalaEvid) {
    out.push({ dimensao: "Escala comprovada", estado: escalaEvid, porque: escalaEvid === "COMPROVADO" ? "número com fonte e período citados" : "indício de escala (validar período/escopo)" });
  } else {
    const e = estadoPorBusca(!!dim?.escala);
    out.push({ dimensao: "Escala comprovada", estado: e.estado, porque: e.porque });
  }

  // Estrutura societária — QSA oficial
  if (r.socios.length > 0) {
    out.push({ dimensao: "Estrutura societária", estado: "COMPROVADO", porque: `QSA da consulta oficial (${plural(r.socios.length, "sócio", "sócios")})` });
  } else {
    const teiaBuscada = !!dim?.teia;
    out.push({ dimensao: "Estrutura societária", estado: teiaBuscada ? "NAO_ENCONTRADO" : "NAO_ENCONTRADO", porque: "QSA ausente na consulta oficial, teia não demonstrável" });
  }

  // Tecnologias — vaga cita ≠ produção (rótulos do tech-states)
  const techRe = /SAP|ERP|Senior|Totvs|Oracle|Dynamics|Salesforce|sistema|tecnolog/i;
  const techEvid = comStatus(techRe);
  if (techEvid) {
    out.push({ dimensao: "Tecnologias", estado: techEvid, porque: techEvid === "COMPROVADO" ? "tecnologia citada com fonte (validar estado da implantação)" : "tecnologia citada como indício (vaga/menção ≠ produção)" });
  } else {
    const e = estadoPorBusca(!!dim?.tecnologia);
    out.push({ dimensao: "Tecnologias", estado: e.estado, porque: e.porque });
  }

  // Mudanças relevantes — notícias/RI com período
  const mudRe = /captação|captacao|investimento|parceria|expansão|expansao|aquisição|aquisicao|inaugura|plano de investimentos|parceria estratégica/i;
  const mudEvid = comStatus(mudRe);
  if (mudEvid) {
    out.push({ dimensao: "Mudanças relevantes", estado: mudEvid, porque: "mudança pública com fonte" });
  } else if ((pkt?.noticias.length ?? 0) > 0) {
    out.push({ dimensao: "Mudanças relevantes", estado: "PARCIAL", porque: "notícias mapeadas por nome; nenhum evento estruturado como mudança confirmada" });
  } else {
    const e = estadoPorBusca(!!dim?.periodo);
    out.push({ dimensao: "Mudanças relevantes", estado: e.estado, porque: e.porque });
  }

  // Fontes e período — rastreabilidade das evidências
  const comPeriodo = evid.filter((e) => e.source && e.periodo);
  if (comPeriodo.length >= 3) {
    out.push({ dimensao: "Fontes e período", estado: "COMPROVADO", porque: `${plural(comPeriodo.length, "evidência", "evidências")} com fonte e período` });
  } else if (comPeriodo.length > 0) {
    out.push({ dimensao: "Fontes e período", estado: "PARCIAL", porque: `${plural(comPeriodo.length, "evidência", "evidências")} com fonte e período — demais sem período citado` });
  } else if (evid.length > 0) {
    out.push({ dimensao: "Fontes e período", estado: "PARCIAL", porque: "evidências sem período citado" });
  } else {
    out.push({ dimensao: "Fontes e período", estado: pkt ? "NAO_ENCONTRADO" : "NAO_PESQUISADO", porque: pkt ? "pesquisa executada sem evidência estruturada" : "sem pacote de pesquisa" });
  }
  return out;
}

/** Grid compacto de cobertura factual + divergências registradas (nunca score comercial). */
function CoberturaFactual({ r }: { r: RowDetail }) {
  const dims = useMemo(() => computeCobertura(r), [r]);
  const divergencias: string[] = [];
  const escolhido = r.resolution?.candidatos?.find((c) => c.cnpj === r.resolvedCnpj || c.cnpj === r.normalizedCnpj);
  if (escolhido?.contradicoes) divergencias.push(...escolhido.contradicoes.slice(0, 4));
  return (
    <div className="rounded-[8px] border border-senior-cinza-300 bg-white/70 p-3" data-testid="cobertura-factual">
      <p className="ds-caption font-semibold uppercase tracking-wide text-senior-cinza-600">
        Cobertura factual <span className="normal-case font-normal">— o que sabemos vs. o que falta (sem score)</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {dims.map((x) => (
          <span
            key={x.dimensao}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${COBERTURA_ESTILO[x.estado]}`}
            title={x.porque}
            data-testid={`cobertura-${x.dimensao.toLowerCase().replace(/[^a-z]/g, "-")}-${x.estado.toLowerCase()}`}
          >
            {x.dimensao}: {x.estado === "NAO_ENCONTRADO" ? "não encontrado" : x.estado === "NAO_PESQUISADO" ? "não pesquisado" : x.estado.toLowerCase()}
          </span>
        ))}
      </div>
      {r.research?.modoPesquisa && (
        <p className="ds-caption mt-2 text-senior-cinza-400">
          coleta: {r.research.modoPesquisa.toLowerCase()} · {plural(r.research.buscasOk, "busca", "buscas")} com resultado
          {r.research.buscasRecusadasCota > 0 ? ` · ${plural(r.research.buscasRecusadasCota, "recusada", "recusadas")} por cota (pesquisa incompleta)` : ""}
        </p>
      )}
      {divergencias.length > 0 && (
        <div className="mt-2 rounded-[6px] border border-[#F3E3C2] bg-[#FDF8EE] px-2.5 py-2" data-testid="cobertura-divergencias">
          <p className="text-[11.5px] font-semibold text-[#9A6B15]">Divergências entre fontes (exibidas, nunca abafadas):</p>
          <ul className="mt-1 space-y-0.5">
            {divergencias.map((c, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed text-[#6B5426]">— {c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Estados da pesquisa profunda + CTA — v0.10.13: a investigação tem UMA ação principal
 * contextual (um comando por estado). O modo ADAPTATIVO permanece disponível internamente
 * (rota/contrato preservados); o botão experimental saiu da experiência comercial. */
function DeepResearchBar({
  r, deepBusy, onDeepResearch, onQuickReading, quickBusy, hasLeitura,
}: {
  r: RowDetail;
  deepBusy: boolean;
  onDeepResearch: (modo: "COMPLETO" | "ADAPTATIVO") => void;
  /** v0.10.13: leitura rápida (síntese sem nova varredura) — comando explícito preservado */
  onQuickReading?: () => void;
  quickBusy?: boolean;
  hasLeitura?: boolean;
}) {
  // REVIEW ainda não tem dados públicos prontos — o servidor recusaria
  if (r.lookupStatus !== "ENRIQUECIDO") {
    if (rowSituation(r).key === "REVIEW") {
      return (
        <div className="rounded-[8px] border border-[#FFC51166] bg-[#FFC51114] p-3">
          <p className="ds-body text-[#33466C]">
            A pesquisa profunda (site oficial + web) fica disponível assim que a identidade desta empresa for confirmada.
          </p>
        </div>
      );
    }
    return null;
  }
  if (r.researchStatus === "GERANDO") {
    return (
      <div className="flex items-start gap-2.5 rounded-[8px] border border-[#00968C40] bg-[#00968C0D] p-3" data-testid="deep-research-running">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#086B6B]" aria-hidden="true" />
        <p className="ds-body text-senior-azul">
          Pesquisando a conta — site oficial, páginas-chave (sobre, produtos, contato) e buscas públicas. A leitura atualiza sozinha quando estiver pronta.
        </p>
      </div>
    );
  }
  if (r.researchStatus === "OK" && r.aiStatus === "GERANDO") {
    return (
      <div className="flex items-start gap-2.5 rounded-[8px] border border-[#00968C38] bg-[#00968C0A] p-3" data-testid="deep-research-synthesizing">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#00968C]" aria-hidden="true" />
        <p className="ds-body text-senior-azul">Pacote de pesquisa pronto — sintetizando o dossiê profundo…</p>
      </div>
    );
  }
  if (r.aiStatus === "EM_FILA" || r.aiStatus === "GERANDO") return null;
  const pesquisaSalva = r.researchStatus === "OK";
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[#00968C40] bg-[#00968C0D] p-3" data-testid="deep-research-cta">
      <p className="ds-caption min-w-0 text-[#33466C]">
        {hasLeitura
          ? "Uma nova pesquisa rastreia o site oficial e as buscas públicas e refaz a leitura por cima do pacote atualizado."
          : pesquisaSalva
            ? "O pacote de pesquisa desta conta já está salvo. A leitura sintetiza o que foi coletado, sem nova varredura no site."
            : "Rastreia o site oficial (sobre, produtos, contato), cruza buscas públicas e só então sintetiza, sem hipótese genérica."}
      </p>
      <span className="flex flex-wrap items-center gap-2">
        {(hasLeitura || !pesquisaSalva) && (
          <Button
            size="sm"
            className="sn-btn-verde h-9"
            onClick={() => onDeepResearch("COMPLETO")}
            disabled={deepBusy}
            title="Pipeline integral de investigação (A→E): mais buscas, cobertura máxima"
            data-testid="btn-deep-research"
          >
            {deepBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {pesquisaSalva ? "Pesquisar de novo" : "Pesquisa profunda"}
          </Button>
        )}
        {!hasLeitura && onQuickReading && (
          pesquisaSalva ? (
            <Button
              size="sm"
              className="sn-btn-verde h-9"
              onClick={onQuickReading}
              disabled={quickBusy}
              data-testid="ai-generate-quick-dialog"
            >
              {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Gerar leitura da pesquisa salva
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-[13px] text-[#086B6B] hover:bg-[#00968C14]"
              onClick={onQuickReading}
              disabled={quickBusy}
              title="Só a leitura, a partir do que já foi coletado — sem varrer o site agora"
              data-testid="ai-generate-quick-dialog"
            >
              {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Gerar leitura rápida
            </Button>
          )
        )}
      </span>
    </div>
  );
}

/* ------------------------------ Ficha visual da empresa ------------------------------ */

/** Tile de fato cadastral — dado primeiro, sem prosa. */
function FichaTile({ icon, label, value, testId, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; testId?: string; hint?: string }) {
  return (
    <div
      className="rounded-[10px] border border-senior-cinza-300 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(0,150,140,0.10)]"
      title={hint}
      data-testid={testId}
    >
      <p className="ds-caption flex items-center gap-1.5 text-senior-cinza-600">
        <span className="text-[#00968C]" aria-hidden="true">{icon}</span>
        {label}
      </p>
      {/* v0.10.14 (leitura comercial): sem corte — o valor inteiro fica visível.
          v0.11.1 (Gate 2): FATOS em negrito — valores e números têm o maior peso
          visual da ficha; rótulos e metadados ficam mais leves. */}
      <p className="ds-body mt-1.5 break-words font-semibold leading-snug text-senior-azul">{value}</p>
    </div>
  );
}

/** Ficha da empresa — fatos públicos como dados visuais (não parágrafos repetidos). */
function CompanyFicha({ r }: { r: RowDetail }) {
  const extra = r.extra;
  const facts: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }[] = [];
  if (r.cnaeDescription) facts.push({ icon: <Briefcase className="h-3.5 w-3.5" />, label: "Atividade (CNAE)", value: r.cnaeDescription });
  if (extra?.porte && !/^demais$/i.test(extra.porte)) facts.push({ icon: <Gauge className="h-3.5 w-3.5" />, label: "Porte declarado", value: extra.porte });
  // Fase 1.1: SEM faturamento inferido — o tile não existe; faturamento só com valor publicado + fonte
  if (extra?.capitalSocial) facts.push({ icon: <Coins className="h-3.5 w-3.5" />, label: "Capital social declarado", value: formatBRL(extra.capitalSocial) });
  if (r.openingDate) facts.push({ icon: <CalendarDays className="h-3.5 w-3.5" />, label: "Abertura", value: formatBR(r.openingDate, false) });
  if (r.municipality || r.uf) facts.push({ icon: <MapPin className="h-3.5 w-3.5" />, label: "Sede", value: r.municipality ? `${r.municipality}${r.uf ? `/${r.uf}` : ""}` : r.uf ?? "—" });
  // CONTEXTO MUNICIPAL IBGE: população e região imediata — geografia comercial oficial
  if (extra?.ibge?.populacao) facts.push({
    icon: <Building2 className="h-3.5 w-3.5" />,
    label: `Município (IBGE${extra.ibge.anoPopulacao ? ` ${extra.ibge.anoPopulacao}` : ""})`,
    value: `Pop. ${extra.ibge.populacao}${extra.ibge.regiaoImediata ? ` · ${extra.ibge.regiaoImediata}` : ""}`,
  });
  // v0.10.14 (qualidade do dado): os tiles de "Sócios no quadro" e "Atividades
  // secundárias" saíram — a seção 3 mostra o quadro societário e o painel do
  // registro público lista as atividades; contagem solta repetia o que já tinha nome.
  if (extra?.simples && extra.simples !== "") facts.push({ icon: <FileText className="h-3.5 w-3.5" />, label: "Simples Nacional", value: extra.simples });
  if (extra?.regimeTributario) {
    // v0.10.16 (contrato de linguagem): registro fiscal ≠ regime vigente — leitura humana
    // v0.11.1 (Gate 2): a nota NÃO é hover-only — o ano do registro fica visível
    // junto do dado, distinguindo o regime histórico do regime atual não confirmado.
    const regime = regimeTributarioLegivel(extra.regimeTributario);
    if (regime) facts.push({ icon: <ScrollText className="h-3.5 w-3.5" />, label: "Regime tributário", value: regime.valor, hint: regime.nota });
  }
  if (facts.length === 0) return null;
  // v0.11.0 (contrato 7): colunas adaptativas pela LARGURA DO PAINEL (container query) —
  // duas colunas só quando há largura de leitura; em painel estreito, uma coluna com respiro.
  const regimeFicha = extra?.regimeTributario ? regimeTributarioLegivel(extra.regimeTributario) : null;
  return (
    <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[560px]:gap-4" data-testid="company-ficha">
      {facts.slice(0, 10).map((f, i) => (
        <FichaTile key={i} icon={f.icon} label={f.label} value={f.value} testId={`ficha-${i}`} />
      ))}
      {regimeFicha && (
        <p className="ds-caption col-span-full text-senior-cinza-600" data-testid="ficha-regime-nota">
          <span className="font-semibold text-senior-cinza-800">Regime tributário:</span> o registro encontrado se refere ao exercício
          {" "}{regimeFicha.ano ?? "informado"}. Ainda precisamos confirmar a situação atual.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ Contato para abordagem ------------------------------ */

// v0.10.15: a regra de telefone utilizável virou FONTE ÚNICA em @/lib/contato —
// a mesma decisão vale para a interface e para TODAS as exportações (Excel/PDF/CSV).
// telefoneUtil foi importada no topo do arquivo.

/** Chip de contato público: link clicável (tel:/mailto:) + cópia dedicada com feedback ✓. */
function ContactRow({
  icon, label, value, href, testId, wide = false,
}: {
  icon: React.ReactNode; label: string; value: string; href?: string; testId?: string; wide?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div
      className={`flex items-center gap-2.5 rounded-[10px] border border-senior-cinza-300 bg-white px-3.5 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(0,150,140,0.10)] ${wide ? "@min-[480px]:col-span-2" : ""}`}
      data-testid={testId}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#00968C14]" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="ds-caption block text-senior-cinza-600">{label}</span>
        {/* v0.10.14: sem corte — endereço e e-mail longos quebram linha e continuam legíveis */}
        {href ? (
          <a href={href} className="ds-body block break-words font-medium text-[#086B6B] hover:underline" title={value}>
            {value}
          </a>
        ) : (
          <span className="ds-body block break-words font-medium text-senior-azul" title={value}>{value}</span>
        )}
      </span>
      <button
        type="button"
        onClick={copy}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-senior-cinza-600 transition-colors hover:bg-[#00968C14] hover:text-[#086B6B]"
        title={`Copiar ${label.toLowerCase()}`}
        aria-label={`Copiar ${label}`}
        data-testid={testId ? `${testId}-copiar` : undefined}
      >
        {copied ? <Check className="h-4 w-4 text-[#00968C]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** FICHA DE CONTATO (CRM) — todos os fatos públicos da conta em texto pronto para colar.
 *  Dado determinístico, sem discurso de venda: a venda é do humano, o mapeamento é do Scout. */
function fichaContatoTexto(r: RowDetail): string {
  const L: string[] = [];
  const nomeEmpresa = r.legalName ?? r.tradeName ?? "—";
  L.push(`Empresa: ${nomeEmpresa}${r.tradeName && r.tradeName !== r.legalName ? ` (${r.tradeName})` : ""}`);
  const cnpj = r.headquartersCnpj ?? r.resolvedCnpj ?? r.normalizedCnpj;
  if (cnpj) L.push(`CNPJ: ${formatCnpj(cnpj)}`);
  const extra = r.extra;
  // v0.10.14: telefone fictício do cadastro não entra na ficha de CRM
  const tel1Crm = telefoneUtil(extra?.telefone);
  const tel2Crm = telefoneUtil(extra?.telefone2);
  if (tel1Crm) L.push(`Telefone 1: ${tel1Crm}`);
  if (tel2Crm) L.push(`Telefone 2: ${tel2Crm}`);
  if (extra?.email) L.push(`E-mail: ${extra.email}`);
  if (extra?.endereco) L.push(`Endereço: ${extra.endereco}`);
  const sede = [r.municipality ? `${r.municipality}/${r.uf ?? ""}` : r.uf].filter(Boolean).join("");
  if (sede) {
    const ibge = extra?.ibge;
    L.push(`Sede: ${sede}${ibge?.regiaoImediata ? ` · região imediata de ${ibge.regiaoImediata}` : ""}${ibge?.populacao ? ` · pop. ${ibge.populacao} (IBGE${ibge.anoPopulacao ? ` ${ibge.anoPopulacao}` : ""})` : ""}`);
  }
  if (extra?.porte && !/^demais$/i.test(extra.porte)) L.push(`Porte: ${extra.porte}`);
  const regimeCrm = regimeTributarioLegivel(extra?.regimeTributario);
  if (regimeCrm) L.push(`Regime tributário: ${regimeCrm.valor} (registro do exercício; regime atual ainda precisa ser confirmado)`);
  if (extra?.capitalSocial) L.push(`Capital social: ${formatBRL(extra.capitalSocial)}`);
  const decisores = decisoresOf(r);
  if (decisores.length) {
    L.push("Administração e representantes registrados (QSA público):");
    decisores.slice(0, 8).forEach((s) => L.push(`  - ${s.nome}${s.qual ? ` (${s.qual})` : ""}`));
  }
  if (r.cnaeDescription) L.push(`Atividade: ${r.cnaeDescription}`);
  return L.join("\n");
}

/**
 * CONTATO PÚBLICO DA CONTA — telefone 1+2, e-mail e endereço públicos do cadastro.
 * Dado determinístico das fontes; o clique copia (e o link dispara o discador/e-mail).
 * Botão "Copiar ficha (CRM)": leva TODO o mapeamento de contato para o CRM de uma vez.
 */
function ContactSection({ r }: { r: RowDetail }) {
  const extra = r.extra;
  const [copiedFicha, setCopiedFicha] = useState(false);
  const { toast } = useToast();
  if (!extra) return null;
  // v0.10.14: telefone fictício (ex.: 000000000000) não vira contato nem link de ligação
  const tel1 = telefoneUtil(extra.telefone);
  const tel2 = telefoneUtil(extra.telefone2);
  const email = extra.email?.trim() ?? "";
  const endereco = extra.endereco?.trim() ?? "";
  if (!tel1 && !tel2 && !email && !endereco) return null;
  const copyFicha = async () => {
    const ok = await copyText(fichaContatoTexto(r));
    if (ok) {
      setCopiedFicha(true);
      toast({ title: "Ficha de contato copiada", description: "Empresa, telefones, e-mail, sede e decisores, prontos para colar no CRM." });
      window.setTimeout(() => setCopiedFicha(false), 2400);
    } else {
      toast({ title: "Não conseguimos copiar", description: "Selecione os dados e copie manualmente.", variant: "destructive" });
    }
  };
  return (
    <div data-testid="scout-contato">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="ds-caption flex items-center gap-1.5 text-senior-cinza-600">
          <Phone className="h-3.5 w-3.5 text-[#00968C]" aria-hidden="true" /> CONTATO PÚBLICO DA CONTA
          <span className="text-[13px] font-normal tracking-normal text-senior-cinza-400">· do cadastro da Receita</span>
        </h4>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C14]"
          onClick={copyFicha}
          data-testid="btn-copiar-ficha-crm"
        >
          {copiedFicha ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copiedFicha ? "Copiado ✓" : "Copiar ficha (CRM)"}
        </Button>
      </div>
      <div className="mt-3 grid gap-3 @min-[480px]:grid-cols-2 @min-[560px]:gap-4">
        {tel1 && (
          <ContactRow
            icon={<Phone className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />}
            label="Telefone 1"
            value={tel1}
            href={`tel:${tel1.replace(/\D/g, "")}`}
            testId="contato-telefone-1"
          />
        )}
        {tel2 && (
          <ContactRow
            icon={<Phone className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />}
            label="Telefone 2"
            value={tel2}
            href={`tel:${tel2.replace(/\D/g, "")}`}
            testId="contato-telefone-2"
          />
        )}
        {email && (
          <ContactRow
            icon={<Mail className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />}
            label="E-mail público"
            value={email}
            href={`mailto:${email}`}
            testId="contato-email"
          />
        )}
        {endereco && (
          <ContactRow
            icon={<MapPin className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />}
            label="Endereço da sede"
            value={endereco}
            testId="contato-endereco"
            wide
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Decisores prováveis ------------------------------ */

/**
 * Qualificações do QSA que indicam quem participa da decisão — regra ÚNICA em
 * @/lib/contato (v0.10.15): interface e exportações classificam IGUAL.
 */
function decisoresOf(r: RowDetail) {
  return r.socios.filter((s) => DECISOR_QUAL_RE.test(s.qual ?? ""));
}

/**
 * ADMINISTRAÇÃO E REPRESENTANTES REGISTRADOS — quadro societário público (QSA).
 * O QSA registra quem está na administração (determinístico, sem IA) — NÃO comprova
 * quem compra tecnologia (Fases 1.5/4 do plano v0.6).
 */
function DecisoresSection({ r }: { r: RowDetail }) {
  const decisores = useMemo(() => decisoresOf(r), [r]);
  const [copied, setCopied] = useState(false);
  if (decisores.length === 0) return null;
  const copyAll = async () => {
    const text = decisores.map((s) => `${s.nome}${s.qual ? ` (${s.qual})` : ""}`).join("\n");
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div data-testid="scout-decisores">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="ds-caption flex items-center gap-1.5 text-senior-cinza-600">
          <UserCog className="h-3.5 w-3.5 text-[#00968C]" aria-hidden="true" /> REPRESENTANTES REGISTRADOS
          <span className="ml-1 rounded-full bg-[#00968C1A] px-1.5 py-0.5 text-[13px] font-bold text-[#086B6B]">{decisores.length}</span>
        </h4>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C14]"
          onClick={copyAll}
          data-testid="btn-copiar-decisores"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copiado ✓" : "Copiar nomes"}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {decisores.slice(0, 6).map((s, i) => (
          <span
            key={i}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#00968C40] bg-[#00968C0D] px-3 py-1.5 text-[12.5px] font-medium text-[#086B6B] transition-colors hover:border-[#00968C80]"
            title={s.entrada ? `${s.nome} — no quadro desde ${s.entrada}` : s.nome}
            data-testid={`decisor-${i}`}
          >
            <UserCog className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{s.nome}</span>
            {s.qual && <span className="shrink-0 text-[13px] font-normal text-senior-cinza-600">{s.qual}</span>}
          </span>
        ))}
        {decisores.length > 6 && (
          <span className="ds-caption self-center text-senior-cinza-600">+{decisores.length - 6} no quadro</span>
        )}
      </div>
      <p className="ds-caption mt-1.5 text-senior-cinza-600">
        Do quadro societário público.
      </p>
    </div>
  );
}

/* ------------------------------ Notícias (Google News) ------------------------------ */

function NewsCard({ n, testId }: { n: NewsItemView; testId?: string }) {
  const data = n.data ? formatBR(n.data, false) : null;
  return (
    <a
      href={n.link}
      target="_blank"
      rel="noreferrer"
      className="group flex items-start gap-3 rounded-[10px] border border-senior-cinza-300 bg-white p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00968C4D] hover:shadow-[0_6px_18px_rgba(0,150,140,0.10)]"
      data-testid={testId}
    >
      <span className="glass-chip mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Newspaper className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="ds-body block font-medium leading-snug text-senior-azul line-clamp-2">{n.titulo}</span>
        <span className="ds-caption mt-0.5 block text-senior-cinza-600">
          {n.fonte || "Imprensa"}{data ? ` · ${data}` : ""}
        </span>
      </span>
    </a>
  );
}

/** Notícias mapeadas POR NOME — a imprensa revela o que o cadastro oficial não tem. */
function NewsSection({ noticias }: { noticias: NewsItemView[] }) {
  if (noticias.length === 0) return null;
  return (
    <div data-testid="scout-noticias">
      <h4 className="ds-caption flex items-center gap-1.5 text-senior-cinza-600">
        <Newspaper className="h-3.5 w-3.5 text-[#00968C]" aria-hidden="true" /> NOTÍCIAS DA EMPRESA
        <span className="ml-1 rounded-full bg-[#00968C1A] px-1.5 py-0.5 text-[13px] font-bold text-[#086B6B]">{noticias.length}</span>
      </h4>
      <div className="mt-3 grid gap-3 @min-[480px]:grid-cols-2 @min-[560px]:gap-4">
        {noticias.slice(0, 4).map((n, i) => (
          <NewsCard key={i} n={n} testId={`noticia-${i}`} />
        ))}
      </div>
      <p className="ds-caption mt-1.5 text-senior-cinza-600">
        Mapeadas pelo nome da empresa no Google News — clique para ler a matéria original.
      </p>
    </div>
  );
}

/* ------------------------------ Teia societária visual ------------------------------ */

/** Sinais determinísticos de porte real — números crus detectados em fontes públicas.
 *  v0.9.1: cada sinal mostra a FONTE quando identificável nos resultados salvos —
 *  a atribuição de entidade (ex.: "Sementes Jotabasso" ≠ PJ analisada) fica visível. */
function PorteSignals({
  sinais,
  fontes,
}: {
  sinais: string[];
  fontes?: ({ fonte: string; url: string | null } | null)[];
}) {
  if (sinais.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="scout-porte-sinais">
      {sinais.slice(0, 4).map((s, i) => {
        const f = fontes?.[i] ?? null;
        return (
          <span
            key={i}
            className="inline-flex max-w-full flex-col gap-0.5 rounded-[8px] bg-[#00968C0D] px-2.5 py-1.5 text-[13px] leading-snug text-[#086B6B]"
          >
            {f && (
              <span className="ds-caption flex items-center gap-1 font-semibold text-[#086B6B]" data-testid="scout-porte-fonte">
                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer noopener" className="underline decoration-[#00968C66] underline-offset-2 hover:decoration-[#00968C]" title={f.fonte}>
                    {f.fonte}
                  </a>
                ) : (
                  <span title={f.fonte}>{f.fonte}</span>
                )}
              </span>
            )}
            <span className="flex items-start gap-1">
              <Gauge className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {s}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ---------------- Estado de adoção de tecnologia (Fase 4/2.3) ---------------- */

/** Extrai o ESTADO DE ADOÇÃO do início do item — rótulos canônicos de tech-states.ts. */
function parseTechItem(t: string): { state: TechState | null; texto: string } {
  const low = t.toLowerCase();
  for (const s of TECH_STATES) {
    if (low.startsWith(s.toLowerCase())) {
      const rest = t.slice(s.length).replace(/^[\s:—–-]+/, "").trim();
      return { state: s, texto: rest || t };
    }
  }
  return { state: null, texto: t };
}

/** Item de tecnologia com o chip do estado canônico — vaga NUNCA vira produção. */
function TechStateRow({ item }: { item: { state: TechState | null; texto: string } }) {
  const tone = (s: TechState) =>
    s === "Em uso confirmado" ? "bg-[#00968C1A] text-[#086B6B]"
    : s === "Implantação anunciada" ? "bg-[#33466C0D] text-[#33466C]"
    : s === "Tecnologia mencionada em vaga" ? "bg-[#FFC51133] text-[#8a6d00]"
    : "bg-[#F2F2F2] text-senior-cinza-600";
  return (
    <li
      className="flex items-start gap-2"
      data-testid={item.state ? `tech-${item.state.replace(/\s+/g, "-").toLowerCase()}` : "tech-sem-estado"}
    >
      {item.state && (
        <span
          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold tracking-wide ${tone(item.state)}`}
          title={TECH_STATE_HINT[item.state]}
        >
          {item.state}
        </span>
      )}
      <span className="ds-body min-w-0 text-senior-azul">{item.texto}</span>
    </li>
  );
}

/* ==================================================================== */
/* v0.10.5 — seções discretas: Matriz e filiais / Relações societárias    */
/* On-demand (comando explícito por CNPJ), sem IA, sem recursão.          */
/* ==================================================================== */

function ErroFonteBox({ erro, tipo }: { erro: string; tipo: string | null }) {
  // v0.10.8: sem códigos HTTP na interface — a situação em palavras, o detalhe
  // técnico (status, provedor) fica em telemetria/exportação técnica.
  // v0.10.16 (contrato de linguagem): resultado primeiro, próxima ação clara,
  // sem travessão separando pensamentos e sem promessa de capacidade inexistente.
  const rotulo = tipo === "RATE_LIMITED"
    ? "Consulta com limite atingido"
    : tipo === "TIMEOUT"
      ? "A consulta não respondeu a tempo"
      : tipo === "FONTE_INDISPONIVEL"
        ? "Consulta temporariamente indisponível"
        : tipo === "SEM_RELACOES_REGISTRADAS"
          ? "Sem registro público"
          : null;
  return (
    <div className="rounded-[8px] border border-[#B3402A33] bg-[#B3402A0D] p-3" data-testid="erro-fonte">
      <p className="ds-body flex items-start gap-1.5 text-[#7A3A1E]">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {rotulo && <span className="font-medium">{rotulo}. </span>}
          {erro} <span className="text-[#7A3A1E99]">As informações anteriores continuam disponíveis.</span>
        </span>
      </p>
    </div>
  );
}

function MatrizFiliaisPanel({ r, batchId }: { r: RowDetail; batchId: string }) {
  const [view, setView] = useState<MatrizFiliaisView | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroTipo, setErroTipo] = useState<string | null>(null);
  // v0.10.24 — identidade governa o estado (sem key de remontagem): reset na fase de
  // render na troca de empresa (sem flash de dados da anterior) + guarda de identidade
  // para respostas atrasadas (a resposta de A nunca muda a ficha de B). A key aqui
  // produzia nó órfão visível com a ficha de A ao navegar (reproduzido no navegador).
  const identidade = `${batchId}:${r.rowNumber}`;
  const [identidadeMontada, setIdentidadeMontada] = useState(identidade);
  if (identidadeMontada !== identidade) {
    setIdentidadeMontada(identidade);
    setView(null);
    setLoading(false);
    setErro(null);
    setErroTipo(null);
  }
  const identidadeRef = useRef(identidade);
  identidadeRef.current = identidade;
  const elegivel = r.lookupStatus === "ENRIQUECIDO" && !!r.normalizedCnpj && validateCnpj(r.normalizedCnpj).valid;
  if (!elegivel) return null;

  async function investigar() {
    const alvo = identidade;
    setLoading(true);
    setErro(null);
    setErroTipo(null);
    try {
      const res = await apiFetch(`/api/imports/${batchId}/rows/${r.rowNumber}/matriz-filiais`, { method: "POST" });
      const data = await res.json();
      if (identidadeRef.current !== alvo) return; // resposta atrasada de outra empresa: descartada
      if (!res.ok || !data.ok) {
        setErro(data?.error?.message ?? "Não foi possível investigar os estabelecimentos da raiz.");
        setErroTipo(data?.error?.fonte?.tipo ?? null);
        return;
      }
      setView(data.matrizFiliais as MatrizFiliaisView);
    } catch {
      if (identidadeRef.current !== alvo) return;
      setErro("Falha de rede ao investigar os estabelecimentos da raiz.");
    } finally {
      if (identidadeRef.current === alvo) setLoading(false);
    }
  }

  const EstabRow = ({ e, badge }: { e: EstabelecimentoView; badge?: "matriz" | "filial" }) => (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {badge && (
        <span className={`rounded-full px-2 py-0.5 text-[13px] font-semibold ${badge === "matriz" ? "bg-[#086B6B] text-white" : "bg-[#EAF1F7] text-[#33466C]"}`}>
          {badge === "matriz" ? "MATRIZ" : "FILIAL"}
        </span>
      )}
      <span className="font-medium text-senior-azul">{formatCnpj(e.cnpj)}</span>
      {e.razaoSocial && <span className="min-w-0 truncate text-[13px] text-senior-cinza-800">{e.razaoSocial}</span>}
      {(e.municipio || e.uf) && (
        <span className="inline-flex items-center gap-1 text-[13px] text-senior-cinza-600">
          <MapPin className="h-3 w-3" aria-hidden="true" />{[e.municipio, e.uf].filter(Boolean).join("/")}
        </span>
      )}
      {e.situacao && <span className="text-[13px] text-senior-cinza-600">situação: {e.situacao}</span>}
      {!e.confirmado && (
        <span className="rounded-full bg-[#FFC51133] px-2 py-0.5 text-[13px] font-medium text-[#6B5A00]">localizado — sem confirmação individual</span>
      )}
      <span className="w-full text-[13px] text-senior-cinza-500">
        origem: {sourceLabel(e.descobertoPor)}
        {e.fonteConfirmacao && <> · confirmação: {sourceLabel(e.fonteConfirmacao)} ({e.confirmadoEm ? formatBR(e.confirmadoEm) : "—"})</>}
      </span>
    </li>
  );

  return (
    <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4" data-testid="matriz-filiais-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
          <Building2 className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
          Matriz e filiais (mesma raiz)
        </h4>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 border-[#00968C66] text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
          onClick={investigar}
          disabled={loading}
          aria-label="Investigar estabelecimentos da mesma raiz (consulta sob comando às fontes públicas)"
          data-testid="btn-matriz-filiais"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
          {loading
            ? "Investigando…"
            : view
              ? view.cobertura.pendentesConfirmacao > 0
                ? `Confirmar mais (${view.cobertura.pendentesConfirmacao} pendentes)`
                : "Atualizar"
              : "Investigar estabelecimentos da raiz"}
        </Button>
      </div>
      {!view && !erro && (
        <p className="ds-caption mt-2 text-senior-cinza-600">
          <span className="font-semibold text-senior-cinza-800">Uma empresa, várias unidades.</span> As filiais não representam empresas independentes.
          A descoberta acontece sob comando, e cada estabelecimento é confirmado pelo campo oficial matriz/filial do registro. Sem IA, sem download de base nacional.
        </p>
      )}
      {erro && <div className="mt-3"><ErroFonteBox erro={erro} tipo={erroTipo} /></div>}
      {view && (
        <div className="mt-3 space-y-3">
          <p className="text-[13px] text-senior-cinza-600">
            Estabelecimento consultado: <span className="font-medium text-senior-azul">{formatCnpj(view.consultado.cnpj)}</span>
            {view.consultado.branchType && <> — {view.consultado.branchType} (campo oficial)</>}
          </p>
          <ul className="space-y-2" data-testid="mf-lista">
            {view.matriz && <EstabRow e={view.matriz} badge="matriz" />}
            {view.filiais.map((f) => <EstabRow key={f.cnpj} e={f} badge="filial" />)}
          </ul>
          {view.localizadosNaoConfirmados.length > 0 && (
            <div>
              <p className="text-[13px] font-medium text-[#6B5A00]">Localizados na fonte, aguardando confirmação individual:</p>
              <ul className="mt-1 max-h-44 space-y-2 overflow-y-auto cnpj-scroll pr-1">
                {view.localizadosNaoConfirmados.map((e) => <EstabRow key={e.cnpj} e={e} />)}
              </ul>
            </div>
          )}
          {view.avisos.length > 0 && (
            <ul className="space-y-1">
              {view.avisos.map((a, i) => (
                <li key={i} className="ds-caption text-[#8A5A00]" data-testid={`mf-aviso-${i}`}>{a}</li>
              ))}
            </ul>
          )}
          <p className="ds-caption text-senior-cinza-600" data-testid="mf-cobertura">
            Fonte <span className="font-semibold">PARCIAL</span>: estabelecimentos localizados na fonte consultada — {view.cobertura.pendentesConfirmacao + view.filiais.length + (view.matriz ? 1 : 0)} no total
            ({view.cobertura.pendentesConfirmacao} pendentes de confirmação) · participantes do quadro consultados: {view.cobertura.participantesConsultados}
            {view.cobertura.totalParticipantesPf > view.cobertura.tetoParticipantes && <> de {view.cobertura.totalParticipantesPf} (teto {view.cobertura.tetoParticipantes}/rodada)</>}
            {view.cobertura.totalParticipantesPf <= view.cobertura.tetoParticipantes && <> (teto {view.cobertura.tetoParticipantes}/rodada)</>}
            {view.raizAlfanumerica && <> · raiz alfanumérica</>}
            . A quantidade TOTAL de estabelecimentos da raiz não é afirmada — cobertura do quadro consultado apenas.
          </p>
          <p className="ds-caption text-senior-cinza-500" data-testid="mf-fonte-data">
            Descoberta: <span title={sourceDetail(view.fonteDescoberta) ?? view.fonteDescoberta}>{sourceLabel(view.fonteDescoberta)}</span> · atualizado em {formatBR(view.atualizadoEm)} · reuso válido até {formatBR(view.validoAte)} ({view.via === "cache" ? "reuso de cache" : "consulta"})
          </p>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* v0.10.6 — TRIAGEM "O que falta descobrir": classificação determinística */
/* das lacunas (perguntas), com fatos já coletados. SEM IA, SEM busca web, */
/* SEM recomendação de acionar IA — e sem score comercial.                */
/* ==================================================================== */

const ESTADO_TRIAGEM_CLASSE: Record<string, string> = {
  RESOLVIDO: "bg-[#00968C1A] text-[#086B6B]",
  COMPLEMENTAR_API: "bg-[#EAF1F7] text-[#33466C]",
  PESQUISA_DOCUMENTAL: "bg-[#FFC51133] text-[#6B5A00]",
  VALIDACAO_HUMANA: "bg-[#B3402A1A] text-[#7A3A1E]",
  INDISPONIVEL: "bg-[#B3402A33] text-[#7A3A1E]",
  NAO_APLICAVEL: "bg-[#F2F2F2] text-senior-cinza-600",
};

/** v0.10.8 — linguagem comercial dos estados (o contrato TRIAGEM_V1 preserva os
 *  códigos internos; a UI fala a língua do vendedor): Já sabemos / Podemos
 *  consultar / Vale investigar / Precisa confirmar / Indisponível. */
const ESTADO_TRIAGEM_UI: Record<string, string> = {
  RESOLVIDO: "Já sabemos",
  COMPLEMENTAR_API: "Podemos consultar dados adicionais",
  PESQUISA_DOCUMENTAL: "Vale investigar em documentos",
  VALIDACAO_HUMANA: "Precisa confirmar com a empresa",
  INDISPONIVEL: "Consulta temporariamente indisponível",
  NAO_APLICAVEL: "Não aplicável",
};

const GRUPOS_TRIAGEM: { estado: keyof typeof ESTADO_TRIAGEM_LABEL; titulo: string; descricao: string; icon: React.ReactNode }[] = [
  {
    estado: "RESOLVIDO",
    titulo: "Já sabemos",
    descricao: "Fatos confirmados por fonte apropriada, com fonte e data da coleta.",
    icon: <CircleCheck className="h-3.5 w-3.5 shrink-0 text-[#086B6B]" aria-hidden="true" />,
  },
  {
    estado: "COMPLEMENTAR_API",
    titulo: "Podemos consultar dados adicionais",
    descricao: "Existe fonte aplicável ainda não esgotada; qualquer consulta fica sob o seu comando explícito.",
    icon: <Search className="h-3.5 w-3.5 shrink-0 text-[#33466C]" aria-hidden="true" />,
  },
  {
    estado: "PESQUISA_DOCUMENTAL",
    titulo: "Vale investigar em documentos",
    descricao: "Não está no cadastro consultado; só com investigação documental, sob demanda.",
    icon: <FileText className="h-3.5 w-3.5 shrink-0 text-[#8A6D00]" aria-hidden="true" />,
  },
  {
    estado: "VALIDACAO_HUMANA",
    titulo: "Precisa confirmar com a empresa",
    descricao: "Ambiguidade, contradição ou informação que depende de declaração da própria empresa.",
    icon: <CircleHelp className="h-3.5 w-3.5 shrink-0 text-[#7A3A1E]" aria-hidden="true" />,
  },
  {
    estado: "INDISPONIVEL",
    titulo: "Consulta temporariamente indisponível",
    descricao: "A consulta não concluiu neste momento. As informações anteriores continuam disponíveis.",
    icon: <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[#B3402A]" aria-hidden="true" />,
  },
];

/* v0.10.23 — "Próximo movimento": leitura comercial determinística (zero rede, zero IA).
   Organiza o que sabemos / o que merece validação / o que não encontramos / o que vale
   investigar — cada seção com teto de itens, sem repetir a triagem inteira. A triagem
   usada vem da MESMA rota do painel de lacunas (cálculo local sobre fatos coletados;
   nenhuma consulta externa acontece aqui). */
function ProximoMovimentoPanel({ r, batchId, blocos }: { r: RowDetail; batchId: string; blocos?: SecaoMovimentoId[] }) {
  const [triagem, setTriagem] = useState<TriagemLinhaView | null>(null);
  // v0.10.24 — identidade governa o estado (sem key de remontagem): reset na fase de
  // render na troca de empresa — B nunca começa com a triagem de A (desvio 2 do parecer;
  // o nó órfão por key foi reproduzido no navegador e eliminado).
  const identidade = `${batchId}:${r.rowNumber}`;
  const [identidadeMontada, setIdentidadeMontada] = useState(identidade);
  if (identidadeMontada !== identidade) {
    setIdentidadeMontada(identidade);
    setTriagem(null);
  }

  useEffect(() => {
    let vivo = true;
    // v0.10.24: a troca de identidade faz o reset na fase de render (acima) — o efeito
    // só busca a triagem da empresa montada; a resposta atrasada de A é descartada.
    apiFetch(`/api/imports/${batchId}/rows/${r.rowNumber}/triagem`)
      .then((res) => res.json())
      .then((data) => {
        if (vivo && data?.ok) setTriagem(data.triagem as TriagemLinhaView);
      })
      .catch(() => {
        // leitura local: sem a triagem, a leitura segue só com o cadastro (a lib aceita null)
      });
    return () => {
      vivo = false;
    };
  }, [batchId, r.rowNumber]);

  const movimento = useMemo(() => {
    const m = montarProximoMovimento(r, triagem);
    // v0.11.1 (Gate 2): blocos opcionais — a ficha usa isto para NÃO repetir as
    // seções 1-4 ("sabemos") nem as consultas da seção 7 ("investigar").
    if (!blocos) return m;
    return { ...m, secoes: m.secoes.filter((s) => blocos.includes(s.id)) };
  }, [r, triagem, blocos]);
  if (movimento.secoes.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-[#F2F2F2] p-4" data-testid="proximo-movimento">
      <h4 className="ds-title-md text-senior-azul">Próximo movimento</h4>
      <div className="mt-2 grid gap-2.5 md:grid-cols-2">
        {movimento.secoes.map((s) => (
          <div key={s.id} className="rounded-[8px] bg-[#F7FAF9] p-3" data-testid={`movimento-${s.id}`}>
            <p className="text-[13px] font-semibold text-[#33466C]">{s.titulo}</p>
            <p className="ds-caption text-senior-cinza-500">{s.descricao}</p>
            <ul className="mt-1.5 space-y-1">
              {s.itens.map((it, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[13px] text-senior-cinza-600">
                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#086B6B]" />
                  <span className="min-w-0">{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="ds-caption mt-2 text-senior-cinza-500">{movimento.nota}</p>
    </div>
  );
}

function TriagemPanel({ r, batchId }: { r: RowDetail; batchId: string }) {
  const [triagem, setTriagem] = useState<TriagemLinhaView | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  // v0.10.24 — identidade governa o estado (sem key de remontagem): reset na fase de
  // render na troca de empresa + guarda da resposta em voo (mesma correção dos
  // painéis de relações — o defeito do nó órfão foi reproduzido no navegador).
  const identidade = `${batchId}:${r.rowNumber}`;
  const [identidadeMontada, setIdentidadeMontada] = useState(identidade);
  if (identidadeMontada !== identidade) {
    setIdentidadeMontada(identidade);
    setTriagem(null);
    setLoading(false);
    setErro(null);
    setAberto(false);
  }
  const identidadeRef = useRef(identidade);
  identidadeRef.current = identidade;

  async function calcular() {
    const alvo = identidade;
    setLoading(true);
    setErro(null);
    try {
      const res = await apiFetch(`/api/imports/${batchId}/rows/${r.rowNumber}/triagem`);
      const data = await res.json();
      if (identidadeRef.current !== alvo) return; // resposta atrasada de outra empresa: descartada
      if (!res.ok || !data.ok) {
        setErro(data?.error?.message ?? "Não foi possível calcular a triagem.");
        return;
      }
      setTriagem(data.triagem as TriagemLinhaView);
    } catch {
      if (identidadeRef.current !== alvo) return;
      setErro("Falha de rede ao calcular a triagem.");
    } finally {
      if (identidadeRef.current === alvo) setLoading(false);
    }
  }

  // recalcula a CADA abertura — o cálculo é local (sem HTTP externo), barato, e
  // reflete investigações feitas desde a última abertura do painel
  useEffect(() => {
    if (aberto) void calcular();
  }, [aberto]);

  const resumoPorEstado = new Map<string, number>();
  if (triagem) {
    for (const l of triagem.lacunas) resumoPorEstado.set(l.estado, (resumoPorEstado.get(l.estado) ?? 0) + 1);
  }

  return (
    <Collapsible
      open={aberto}
      onOpenChange={setAberto}
      className="rounded-[10px] border border-senior-cinza-300 bg-white"
      data-testid="triagem-panel"
    >
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={aberto} data-testid="btn-triagem">
          <span>
            <span className="ds-title-md block text-senior-azul">Triagem dos dados públicos</span>
            <span className="ds-caption mt-0.5 block text-senior-cinza-600">
              O que os dados públicos já respondem e o que ainda falta.
            </span>
          </span>
          {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-senior-cinza-600" /> : <ChevronRight className="h-4 w-4 shrink-0 text-senior-cinza-600" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-senior-cinza-300 px-4 py-3">
        {loading && (
          <p className="ds-caption flex items-center gap-2 text-senior-cinza-600" data-testid="triagem-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Classificando lacunas a partir dos fatos coletados…
          </p>
        )}
        {erro && (
          <p className="ds-caption text-[#7A3A1E]" data-testid="triagem-erro">
            {erro} Nada foi alterado.
          </p>
        )}
        {triagem && (
          <div className="space-y-3" data-testid="triagem-conteudo">
            {GRUPOS_TRIAGEM.map((g) => {
              const itens = triagem.lacunas.filter((l) => l.estado === g.estado);
              if (itens.length === 0) return null;
              return (
                <div key={g.estado} className="rounded-[8px] border border-[#F2F2F2] p-3" data-testid={`triagem-grupo-${g.estado}`}>
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-senior-azul">
                    {g.icon}
                    {g.titulo} <span className="text-senior-cinza-500">({itens.length})</span>
                  </p>
                  <p className="ds-caption mt-0.5 text-senior-cinza-600">{g.descricao}</p>
                  <ul className="mt-2 space-y-2.5">
                    {itens.map((l) => (
                      <li key={l.perguntaId} className="rounded-[6px] bg-[#F7FAF9] p-2.5" data-testid={`triagem-item-${l.perguntaId}`}>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className={`rounded-full px-2 py-0.5 text-[13px] font-semibold ${ESTADO_TRIAGEM_CLASSE[l.estado]}`}>{ESTADO_TRIAGEM_UI[l.estado] ?? ESTADO_TRIAGEM_LABEL[l.estado]}</span>
                          <span className="text-[13px] font-medium text-senior-azul">{l.pergunta}</span>
                          <span className="text-[13px] uppercase tracking-wide text-senior-cinza-500">
                            {l.entidade === "PESSOA_JURIDICA" ? "pessoa jurídica" : "estabelecimento"}
                          </span>
                        </div>
                        {l.fatos.length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {l.fatos.map((f, i) => (
                              <li key={i} className="text-[13px] text-senior-cinza-800">
                                · {f.fato}
                                {f.fonte && <span className="text-senior-cinza-500" title={sourceDetail(f.fonte) ?? f.fonte}> — {sourceLabel(f.fonte)}{f.data ? `, ${formatBR(f.data)}` : ""}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {l.falta && (
                          <p className="ds-caption mt-1.5 text-senior-cinza-600">
                            <span className="font-medium text-[#6B5A00]">O que falta:</span> {l.falta}
                          </p>
                        )}
                        {l.proximaVerificacao && (
                          <p className="ds-caption mt-0.5 text-senior-cinza-600">
                            <span className="font-medium text-senior-azul">Como verificar:</span> {l.proximaVerificacao}
                          </p>
                        )}
                        <p className="ds-caption mt-1 text-senior-cinza-500" title={l.motivo}>
                          Por quê: {l.motivo}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {resumoPorEstado.get("NAO_APLICAVEL") ? (
              <p className="ds-caption text-senior-cinza-500" data-testid="triagem-nao-aplicavel">
                Não aplicáveis ({resumoPorEstado.get("NAO_APLICAVEL")}): perguntas que não se aplicam a esta empresa.
              </p>
            ) : null}
            <p className="ds-caption text-senior-cinza-500">
              Feita em {formatBR(triagem.calculadoEm)} sobre os fatos já coletados ({plural(triagem.lacunas.length, "pergunta avaliada", "perguntas avaliadas")} para esta entidade).
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * v0.10.16 — lista de estabelecimentos do quadro SEM rolagem interna: mostra um
 * resumo inicial e abre os demais por comando (menos painéis aninhados, nada
 * escondido atrás de scroll interno).
 */
function QuadroEmpresasLista({
  empresas,
  raizPropria,
  rowNumber,
}: {
  empresas: EmpresaQuadro[];
  raizPropria: string | null;
  rowNumber: number;
}) {
  const [verTodas, setVerTodas] = useState(false);
  if (empresas.length === 0) return null;
  const visiveis = verTodas ? empresas : empresas.slice(0, 8);
  const restantes = empresas.length - visiveis.length;
  return (
    <div className="mt-1.5">
      <ul className="space-y-1">
        {visiveis.map((e) => {
          const mesmaRaiz = !!raizPropria && e.cnpj.slice(0, 8).toUpperCase() === raizPropria;
          return (
            <li key={e.cnpj} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-medium text-senior-azul">{formatCnpj(e.cnpj)}</span>
              {e.razaoSocial && <span className="min-w-0 truncate text-senior-cinza-600">{e.razaoSocial}</span>}
              {mesmaRaiz && (
                <span className="rounded-full bg-[#EAF1F7] px-2 py-0.5 text-[13px] font-medium text-[#33466C]" data-testid={`quadro-mesma-raiz-${e.cnpj.slice(-6)}`}>
                  mesma raiz — estabelecimento desta pessoa jurídica
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {restantes > 0 && (
        <button
          type="button"
          onClick={() => setVerTodas(true)}
          className="mt-1 text-[13px] font-medium text-[#086B6B] underline-offset-2 hover:underline"
          data-testid={`quadro-ver-mais-${rowNumber}`}
        >
          Ver os outros {restantes} estabelecimento{restantes === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function RelacoesSocietariasPanel({ r, batchId, onAbrirPessoa }: { r: RowDetail; batchId: string; onAbrirPessoa?: (participanteId: string) => void }) {
  const [view, setView] = useState<RelacoesView | null>(null);
  const [quadros, setQuadros] = useState<Record<string, QuadroView>>({});
  const [loading, setLoading] = useState(false);
  const [quadroLoading, setQuadroLoading] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroTipo, setErroTipo] = useState<string | null>(null);
  // v0.11.2 (UX): estados da lista de representantes (busca local + expansão progressiva)
  const [buscaPart, setBuscaPart] = useState("");
  const [passoExpansao, setPassoExpansao] = useState(0);
  // v0.10.24 — identidade governa o estado (sem key de remontagem): reset na fase de
  // render na troca de empresa + guarda de identidade nas respostas em voo (desvio 2
  // do parecer; nó órfão por key reproduzido no navegador).
  const identidade = `${batchId}:${r.rowNumber}`;
  const [identidadeMontada, setIdentidadeMontada] = useState(identidade);
  if (identidadeMontada !== identidade) {
    setIdentidadeMontada(identidade);
    setView(null);
    setQuadros({});
    setLoading(false);
    setQuadroLoading(null);
    setErro(null);
    setErroTipo(null);
    setBuscaPart("");
    setPassoExpansao(0);
  }
  const identidadeRef = useRef(identidade);
  identidadeRef.current = identidade;
  // v0.10.23 — leitura comercial dos quadros públicos (determinística, zero rede, zero IA):
  // recalculada em memória a partir da MESMA view que alimenta a lista técnica.
  const leitura = useMemo(() => lerRelacoes(view), [view]);
  const leituraComAdmin = leitura.grupos.some((g) => g.tipo === "ADMINISTRADOR");
  // v0.11.2 (UX): representantes PESQUISÁVEIS (busca local, zero rede), AGRUPADOS por
  // papel e com expansão progressiva — 15+ registros não podem ser um muro de cartões.
  // Agrupar NÃO funde identidades: cada item mantém o chip de tipo, os avisos e o
  // dossiê próprio (homônimos seguem separados).
  const PASSO_PART = 8;
  const participantesFiltrados = useMemo(() => {
    if (!view) return [];
    const q = buscaPart.trim().toLocaleLowerCase("pt-BR");
    if (!q) return view.participantes;
    const qDig = q.replace(/\D/g, "");
    return view.participantes.filter(
      (p) =>
        p.nomePublico.toLocaleLowerCase("pt-BR").includes(q) ||
        (qDig.length >= 3 && (p.cnpjParticipante ?? "").includes(qDig)),
    );
  }, [view, buscaPart]);
  const gruposPart = useMemo(() => {
    const limite = buscaPart.trim() ? Number.POSITIVE_INFINITY : PASSO_PART * (passoExpansao + 1);
    const visiveis = participantesFiltrados.slice(0, limite);
    const ordem = (papel: string) => (papel.startsWith("Sócio/administrador") ? 0 : papel.startsWith("Participação") ? 1 : 2);
    const grupos = new Map<string, typeof visiveis>();
    for (const p of visiveis) {
      const papel =
        p.tipo === "PJ"
          ? "Participação de pessoa jurídica"
          : p.tipo === "PF"
            ? p.qualificacao
              ? `Sócio/administrador — ${p.qualificacao.qual}`
              : "Sócio/administrador (papel não especificado pela fonte)"
            : "Tipo não confirmado pela fonte";
      const arr = grupos.get(papel) ?? [];
      arr.push(p);
      grupos.set(papel, arr);
    }
    return [...grupos.entries()]
      .map(([papel, itens]) => ({ papel, itens: [...itens].sort((a, b) => a.nomePublico.localeCompare(b.nomePublico, "pt-BR")) }))
      .sort((a, b) => ordem(a.papel) - ordem(b.papel) || a.papel.localeCompare(b.papel, "pt-BR"));
  }, [participantesFiltrados, buscaPart, passoExpansao]);
  const ocultosPart = buscaPart.trim() === "" ? Math.max(0, participantesFiltrados.length - PASSO_PART * (passoExpansao + 1)) : 0;
  const elegivel = r.lookupStatus === "ENRIQUECIDO" && !!r.normalizedCnpj && validateCnpj(r.normalizedCnpj).valid;
  if (!elegivel) return null;

  async function investigar() {
    const alvo = identidade;
    setLoading(true);
    setErro(null);
    setErroTipo(null);
    try {
      const res = await apiFetch(`/api/imports/${batchId}/rows/${r.rowNumber}/relacoes-societarias`, { method: "POST" });
      const data = await res.json();
      if (identidadeRef.current !== alvo) return; // resposta atrasada de outra empresa: descartada
      if (!res.ok || !data.ok) {
        setErro(data?.error?.message ?? "Não foi possível investigar as relações societárias.");
        setErroTipo(data?.error?.fonte?.tipo ?? null);
        return;
      }
      setView(data.relacoes as RelacoesView);
      // v0.10.23 — hidrata o mapa com quadros JÁ persistidos e válidos (leitura pura
      // do cache local: zero consulta externa, zero IA). Expansões feitas nesta
      // sessão têm precedência — a resposta do cache NUNCA sobrescreve estado vivo.
      try {
        const resCache = await apiFetch(`/api/imports/${batchId}/rows/${r.rowNumber}/relacoes-societarias/quadros`);
        const dataCache = await resCache.json();
        if (identidadeRef.current !== alvo) return;
        if (resCache.ok && dataCache.ok && dataCache.quadros) {
          const doCache = dataCache.quadros as Record<string, QuadroView>;
          setQuadros((prev) => ({ ...doCache, ...prev }));
        }
      } catch {
        // leitura pura: falha silenciosa — o mapa segue sem o nível de baixo
      }
    } catch {
      if (identidadeRef.current !== alvo) return;
      setErro("Falha de rede ao investigar as relações societárias.");
    } finally {
      if (identidadeRef.current === alvo) setLoading(false);
    }
  }

  async function investigarConexao(participanteId: string) {
    const alvo = identidade;
    setQuadroLoading(participanteId);
    setErro(null);
    setErroTipo(null);
    try {
      const res = await apiFetch(`/api/imports/${batchId}/rows/${r.rowNumber}/relacoes-societarias/expansao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participanteId }),
      });
      const data = await res.json();
      if (identidadeRef.current !== alvo) return; // resposta atrasada de outra empresa: descartada
      if (!res.ok || !data.ok) {
        setErro(data?.error?.message ?? "Não foi possível investigar esta conexão.");
        setErroTipo(data?.error?.fonte?.tipo ?? null);
        return;
      }
      setQuadros((prev) => ({ ...prev, [participanteId]: data.quadro as QuadroView }));
    } catch {
      if (identidadeRef.current !== alvo) return;
      setErro("Falha de rede ao investigar esta conexão.");
    } finally {
      if (identidadeRef.current === alvo) setQuadroLoading(null);
    }
  }

  return (
    <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4" data-testid="relacoes-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="ds-title-md flex items-center gap-2 text-senior-azul">
          <Network className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
          Relações societárias (quadro público)
        </h4>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 border-[#00968C66] text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
          onClick={investigar}
          disabled={loading}
          aria-label="Consultar as relações registradas nos quadros públicos"
          data-testid="btn-relacoes"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
          {loading ? "Investigando…" : view ? "Atualizar" : "Investigar relações societárias"}
        </Button>
      </div>
      {!view && !erro && (
        <p className="ds-caption mt-2 text-senior-cinza-600">
          Consulte as relações diretas registradas nos quadros públicos. Cada consulta acontece só quando você pedir.
        </p>
      )}
      {erro && <div className="mt-3"><ErroFonteBox erro={erro} tipo={erroTipo} /></div>}
      {view && (
        <div className="mt-3 space-y-3">
          <p className="ds-caption text-senior-cinza-500" data-testid="rel-evidencia">
            Evidência pública: <span title={sourceDetail(view.fonte) ?? view.fonte}>{sourceLabel(view.fonte)}</span>
            {view.baseDados && <> · base pública {view.baseDados}</>}
            {" "}· {view.via === "cache" ? "coletada em" : "consultada em"} {formatBR(view.coletadoEm)} · {plural(view.totalParticipantes, "participante", "participantes")}
          </p>
          {/* v0.10.23 — leitura comercial antes da lista técnica: o que os quadros
              públicos dizem, por tipo de relação, com ressalva material só quando
              o fato existe (administração registrada ≠ leitura de poder). */}
          {leitura.grupos.length > 0 && (
            <div className="rounded-[10px] border border-[#F2F2F2] bg-[#F7FAF9] p-3" data-testid="relacoes-leitura">
              <p className="text-[13px] font-semibold text-[#33466C]">O que os quadros públicos dizem</p>
              <p className="mt-0.5 text-[13px] text-senior-cinza-600">{leitura.resumo}</p>
              <ul className="mt-2 space-y-2">
                {leitura.grupos.map((g) => (
                  <li key={g.tipo} data-testid={`rel-leitura-${g.tipo}`}>
                    <p className="text-[13px] font-medium text-senior-azul">
                      {g.rotulo}
                      {g.nomes.length > 0 && <>: {g.nomes.join(", ")}.</>}
                    </p>
                    <p className="ds-caption text-senior-cinza-500">{g.descricao}</p>
                  </li>
                ))}
              </ul>
              {leituraComAdmin && (
                <p className="ds-caption mt-2 rounded-[6px] bg-[#EAF1F7] px-2 py-1 text-[#33466C]">{AVISO_ADMINISTRACAO}</p>
              )}
            </div>
          )}
          {view.totalParticipantes === 0 && (
            <p className="ds-caption text-senior-cinza-600" data-testid="rel-vazio">
              Nenhum participante registrado no quadro público consultado.
            </p>
          )}
          {/* v0.11.2: busca local + agrupamento por papel + expansão progressiva */}
          {view.totalParticipantes > 5 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-senior-cinza-400" aria-hidden="true" />
              <Input
                value={buscaPart}
                onChange={(e) => setBuscaPart(e.target.value)}
                placeholder="Buscar representante por nome ou CNPJ…"
                className="h-8 rounded-[8px] border-senior-cinza-300 bg-white pl-8 text-[13px]"
                aria-label="Buscar representante por nome ou CNPJ"
                data-testid="rel-busca"
              />
            </div>
          )}
          {gruposPart.map((g, gi) => (
            <section key={g.papel}>
              <p className="ds-caption font-semibold text-senior-cinza-600" data-testid={`rel-grupo-${gi}`}>
                {g.papel} · {plural(g.itens.length, "pessoa", "pessoas")}
              </p>
              <ul className="mt-1 space-y-2" data-testid="rel-lista">
            {g.itens.map((p) => (
              <li key={p.participanteId} className="rounded-[8px] border border-[#F2F2F2] p-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {/* v0.10.16: tipo PROVADO pela fonte — hash = pessoa física, CNPJ com DV = pessoa
                      jurídica, qualquer outra coisa NÃO vira PF por eliminação (estado honesto) */}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[13px] font-semibold ${
                      p.tipo === "PJ"
                        ? "bg-[#086B6B] text-white"
                        : p.tipo === "PF"
                          ? "bg-[#EAF1F7] text-[#33466C]"
                          : "bg-[#F2F2F2] text-senior-cinza-600"
                    }`}
                  >
                    {p.tipo === "PJ" ? "PARTICIPAÇÃO PESSOA JURÍDICA" : p.tipo === "PF" ? "SÓCIO PESSOA FÍSICA" : "TIPO NÃO CONFIRMADO"}
                  </span>
                  <span className="min-w-0 text-[13px] font-medium text-senior-azul">{p.nomePublico}</span>
                  {p.cnpjParticipante && <span className="text-[13px] text-senior-cinza-600">{formatCnpj(p.cnpjParticipante)}</span>}
                  {onAbrirPessoa && p.tipo !== "INDETERMINADO" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
                      onClick={() => onAbrirPessoa(p.participanteId)}
                      aria-label={`Abrir o dossiê de ${p.nomePublico} — empresas vinculadas, papéis e contagens honestas (sem consulta externa)`}
                      data-testid={`btn-pessoa-${p.tipo}-${p.participanteId.slice(0, 6)}`}
                    >
                      <Users className="h-3 w-3" aria-hidden="true" />
                      Dossiê da pessoa
                    </Button>
                  )}
                  {p.tipo !== "INDETERMINADO" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
                      onClick={() => investigarConexao(p.participanteId)}
                      disabled={quadroLoading !== null}
                      aria-label={`Investigar esta conexão — um passo, sob comando (participante ${p.tipo})`}
                      data-testid={`btn-conexao-${p.tipo}-${p.participanteId.slice(0, 6)}`}
                    >
                      {quadroLoading === p.participanteId ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Search className="h-3 w-3" aria-hidden="true" />}
                      Investigar conexão
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-senior-cinza-500">
                  vínculo:{" "}
                  {p.tipo === "PJ"
                    ? "participação societária direta (registrada no quadro público)"
                    : p.tipo === "PF"
                      ? p.qualificacao
                        ? `sócio/administrador — qualificação (cadastro): ${p.qualificacao.qual}${p.qualificacao.entrada ? `, desde ${p.qualificacao.entrada}` : ""}`
                        : "sócio/administrador, qualificação não especificada pela fonte"
                      : "relação registrada no quadro público. A fonte não trouxe identificador que confirme se o participante é pessoa física ou jurídica."}
                </p>
                {p.tipo === "INDETERMINADO" && (
                  <p className="ds-caption mt-1 rounded-[6px] bg-[#F2F2F2] px-2 py-1 text-senior-cinza-600" data-testid={`rel-indeterminado-${p.participanteId.slice(0, 6)}`}>
                    Não foi possível ampliar este vínculo. Os dados já encontrados foram mantidos.
                  </p>
                )}
                {p.comumMesmaPj.length > 0 && (
                  <div className="mt-1.5 space-y-1" data-testid={`mesma-pj-${p.participanteId.slice(0, 6)}`}>
                    {p.comumMesmaPj.map((c) => (
                      <p key={c.cnpj} className="ds-caption rounded-[6px] bg-[#EAF1F7] px-2 py-1 text-[#33466C]">
                        O mesmo participante figura no quadro de {formatCnpj(c.cnpj)} — estabelecimento da MESMA raiz (mesma pessoa jurídica). Não é relação entre empresas distintas.
                      </p>
                    ))}
                  </div>
                )}
                {p.comumCom.length > 0 && (
                  <div className="mt-1.5 space-y-1" data-testid={`comum-${p.participanteId.slice(0, 6)}`}>
                    {p.comumCom.map((c) => (
                      <p key={c.cnpj} className="ds-caption rounded-[6px] bg-[#FFC51114] px-2 py-1 text-[#6B5A00]">
                        Participante comum com {formatCnpj(c.cnpj)}{c.razaoSocial ? ` (${c.razaoSocial})` : ""} — mesma pessoa no quadro público. NÃO caracteriza grupo econômico.
                      </p>
                    ))}
                  </div>
                )}
                {quadros[p.participanteId] && (
                  <div className="mt-2 rounded-[8px] bg-[#F7FAF9] p-2.5" data-testid={`quadro-${p.participanteId.slice(0, 6)}`}>
                    <p className="text-[13px] font-medium text-[#33466C]">{quadros[p.participanteId].leitura}</p>
                    {/* v0.10.6 — contagem por identidade: PJ por raiz distinta; CNPJ completo é estabelecimento */}
                    {/* v0.10.16 (contrato de linguagem): empresas ≠ estabelecimentos, em frases naturais */}
                    <p className="ds-caption mt-0.5 text-senior-cinza-500" data-testid={`quadro-contagem-${p.participanteId.slice(0, 6)}`}>
                      Encontramos {quadros[p.participanteId].totalPessoasJuridicas} {quadros[p.participanteId].totalPessoasJuridicas === 1 ? "empresa" : "empresas"} e {quadros[p.participanteId].totalEmpresas}{" "}
                      {quadros[p.participanteId].totalEmpresas === 1 ? "estabelecimento" : "estabelecimentos"} registrados nesta consulta · fonte: {sourceLabel(quadros[p.participanteId].fonte)} · {formatBR(quadros[p.participanteId].coletadoEm)}
                      {quadros[p.participanteId].via === "cache" && " · informação coletada e reaproveitada"}
                    </p>
                    <QuadroEmpresasLista empresas={quadros[p.participanteId].empresas} raizPropria={r.normalizedCnpj?.slice(0, 8).toUpperCase() ?? null} rowNumber={r.rowNumber} />
                    {quadros[p.participanteId].empresasOcultas > 0 && (
                      <p className="ds-caption mt-1 text-[#8A5A00]">
                        +{plural(quadros[p.participanteId].empresasOcultas, "estabelecimento", "estabelecimentos")} existem no quadro — a exibição respeita um teto de segurança.
                      </p>
                    )}
                    {quadros[p.participanteId].avisos.map((a, i) => (
                      <p key={i} className="ds-caption mt-1 text-[#8A5A00]">{a}</p>
                    ))}
                  </div>
                )}
              </li>
            ))}
              </ul>
            </section>
          ))}
          {ocultosPart > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 self-start px-2 text-[12.5px] text-[#086B6B] hover:bg-[#00968C0D]"
              onClick={() => setPassoExpansao((k) => k + 1)}
              data-testid="rel-mostrar-mais"
            >
              Mostrar mais {ocultosPart} {ocultosPart === 1 ? "representante" : "representantes"}
            </Button>
          )}
          {/* v0.10.23 — mapa leve das relações: desenha SOMENTE ligações já
              persistidas nesta investigação; quando não acrescenta informação
              além da lista, o próprio componente não renderiza nada. */}
          <GrafoRelacoesCard view={view} quadros={quadros} />
          {view.existeParticipanteComum && (
            <p className="ds-caption rounded-[6px] bg-[#FFC51114] px-2 py-1 text-[#6B5A00]" data-testid="rel-disclaimer-comum">
              Sobreposição de quadro societário público indica participante comum — NÃO caracteriza grupo econômico confirmado.
            </p>
          )}
          {view.avisos.length > 0 && (
            <ul className="space-y-1">
              {view.avisos.map((a, i) => <li key={i} className="ds-caption text-[#8A5A00]">{a}</li>)}
            </ul>
          )}
          <p className="ds-caption text-senior-cinza-500">
            Nomes conforme o quadro societário público. Nenhum CPF é armazenado ou exportado; homônimos são distinguíveis
            apenas pelo identificador próprio da fonte — nomes iguais nunca são tratados como mesma pessoa.
          </p>
        </div>
      )}
    </div>
  );
}

/** v0.10.15: ação discreta da ficha — baixa o PDF comercial desta empresa. */
function FichaPdfButton({ batchId, rowNumber }: { batchId: string; rowNumber: number }) {
  const [gerando, setGerando] = useState<null | "executivo" | "completo">(null);
  const { toast } = useToast();
  const baixar = async (nivel: "executivo" | "completo") => {
    setGerando(nivel);
    try {
      const resultado = await baixarArquivo(`/api/imports/${batchId}/export?type=pdf_empresa&row=${rowNumber}&nivel=${nivel}`, null, `ficha-${nivel}-linha-${rowNumber}.pdf`);
      if (!resultado.ok) {
        toast({ title: "Não conseguimos gerar o PDF", description: resultado.erro, variant: "destructive" });
        return;
      }
      toast({ title: "Ficha em PDF pronta", description: `${resultado.nome} foi baixado.` });
    } finally {
      setGerando(null);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={gerando !== null}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-senior-cinza-300 bg-white px-2 py-0.5 text-[13px] font-medium text-senior-cinza-600 transition-colors hover:border-[#00968C] hover:text-[#086B6B] disabled:opacity-60"
          title="Baixar ficha em PDF"
          data-testid={`ficha-pdf-${rowNumber}`}
        >
          {gerando !== null ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <FileText className="h-3 w-3" aria-hidden="true" />}
          Baixar ficha em PDF
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {/* v0.10.22 — dois níveis do mesmo motor: nenhum gera IA, nenhum reconsulta */}
        <DropdownMenuItem onClick={() => baixar("executivo")} data-testid="ficha-pdf-executivo">
          <FileText className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-medium text-senior-azul">Ficha executiva</span>
            <span className="text-[12px] text-senior-cinza-600">1 a 2 páginas para a conversa comercial</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => baixar("completo")} data-testid="ficha-pdf-completo">
          <ScrollText className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-medium text-senior-azul">Ficha completa</span>
            <span className="text-[12px] text-senior-cinza-600">Dossiê com anexos de detalhamento</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Controles de navegação da ficha (modo dividido/foco, telas largas). */
interface NavFicha {
  emFoco: boolean;
  /** posição 1-based na ordem visível atual (pesquisa + filtros); null = fora da lista */
  posicao: number | null;
  total: number | null;
  onAnterior: () => void;
  onProxima: () => void;
  onVoltarLista: () => void;
  onAlternarFoco: () => void;
}

function FichaEmpresa({
  r, onClose, onRetry, busy, deciding, onDecide, onDeepResearch, deepBusy, revalidating, onRevalidate, batchId, loteEmExecucao, onRetryRow, rowRetrying, nav, onAbrirPessoa,
}: {
  r: RowDetail;
  onClose: () => void;
  onRetry: () => void;
  busy: boolean;
  deciding: boolean;
  onDecide: (body: DecideRequest) => void;
  onDeepResearch: (modo: "COMPLETO" | "ADAPTATIVO") => void;
  deepBusy: boolean;
  /** v0.10.0: revalidação manual da ficha cadastral (força consulta real) */
  revalidating: boolean;
  onRevalidate: () => void;
  /** v0.10.5: id do lote para as investigações on-demand de relações/estabelecimentos */
  batchId: string;
  /** v0.10.8: o lote está efetivamente em execução? Linha preparada em lote
   *  confirmado-não-iniciado NÃO se apresenta como "processando". */
  loteEmExecucao: boolean;
  /** v0.10.13: recuperação de consulta falhada DENTRO da ficha (o mesmo comando da tabela) */
  onRetryRow: () => void;
  rowRetrying: boolean;
  /** v0.10.18: navegação (anterior/próxima/ampliar/voltar/fechar) nos modos
   *  dividido e foco — ausente na sobreposição (Sheet) de telas estreitas */
  nav?: NavFicha;
  /** v0.11.1 (Gate 4): abre o dossiê da pessoa (investigação reversa) */
  onAbrirPessoa?: (participanteId: string) => void;
}) {
  const d: AccountDossierView | null = r.aiDossier;
  const situ = rowSituation(r, { loteEmExecucao });
  const alerts = materialAlerts(r);
  const hasAi = r.aiStatus === "OK" && !!r.aiReading;
  const aiRodando = r.aiStatus === "EM_FILA" || r.aiStatus === "GERANDO";
  const aiFalhou = r.aiStatus === "FALHOU";
  const [copiedReading, setCopiedReading] = useState(false);
  const { toast } = useToast();
  // REGRA: copiar de verdade — Clipboard API quando segura, fallback quando não.
  // Feedback só aparece quando o texto realmente foi para a área de transferência.
  const copyReading = async () => {
    const ok = await copyText(buildDossierText());
    if (ok) {
      setCopiedReading(true);
      toast({ title: "Dossiê copiado", description: "A leitura completa, com fatos, teia, notícias e hipóteses, está na área de transferência." });
      window.setTimeout(() => setCopiedReading(false), 2400);
    } else {
      toast({ title: "Não conseguimos copiar", description: "Selecione o texto no dossiê e copie manualmente.", variant: "destructive" });
    }
  };
  // v0.10.13: sem abas — o chip de revisão rola até a seção 1 (identidade), que fica
  // no topo da ficha; nada de "veja a outra aba".
  // v0.11.0 (contrato 9): a rolagem fica CONTIDA no corpo da ficha — a página
  // principal nunca se move ao navegar entre seções.
  const rolarSecaoFicha = (n: number) => {
    const corpo = document.querySelector<HTMLElement>("[data-testid='dossier-ficha']");
    const alvo = corpo?.querySelector<HTMLElement>(`[data-ficha-secao='${n}']`);
    if (!corpo || !alvo) return;
    const delta = alvo.getBoundingClientRect().top - corpo.getBoundingClientRect().top;
    corpo.scrollTo({ top: corpo.scrollTop + delta - 56, behavior: "smooth" }); // 56px = barra sticky de seções
  };
  const rolarParaIdentidade = () => rolarSecaoFicha(1);
  const modelFallback = !!(r.aiModelRequested && r.aiModel && r.aiModelRequested !== r.aiModel.replace(/ \(cache\)/g, ""));
  // ANTI-REPETIÇÃO: a leitura de abertura já é a síntese — seções que repetem o mesmo
  // texto (quem_e == aiReading) somem em vez de mostrar o parágrafo 2x.
  const norm = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const quemEDifere = !!(d?.quemE && norm(d.quemE) !== norm(r.aiReading));
  const noticias = r.research?.noticias ?? [];
  const porteSinais = r.research?.sinaisPorte ?? [];
  // CÓPIA COMPLETA: o dossiê é visual, mas o texto integral continua levável
  // para CRM/e-mail — “Copiar leitura” agora copia TUDO, em ordem de leitura.
  const buildDossierText = (): string => {
    const L: string[] = [];
    const push = (s = "") => L.push(s);
    const bullets = (items: string[]) => items.forEach((i) => push(`• ${i}`));
    push(`${r.legalName ?? r.tradeName ?? "Conta"} — Scout 360`);
    const headBits = [
      (r.headquartersCnpj || r.resolvedCnpj) ? `CNPJ ${formatCnpj((r.headquartersCnpj ?? r.resolvedCnpj) as string)}` : null,
      (r.municipality || r.uf) ? (r.municipality ? `${r.municipality}/${r.uf ?? ""}` : r.uf) : null,
      r.registrationStatus ? `Situação: ${registrationLabel(r.registrationStatus)}` : null,
    ].filter(Boolean);
    if (headBits.length) push(headBits.join(" · "));
    if (r.aiReading) { push(); push(r.aiReading); }
    const ficha: string[] = [];
    if (r.cnaeDescription) ficha.push(`Atividade: ${r.cnaeDescription}`);
    if (r.extra?.porte && !/^demais$/i.test(r.extra.porte)) ficha.push(`Porte declarado: ${r.extra.porte}`);
    if (r.extra?.capitalSocial) ficha.push(`Capital social: ${formatBRL(r.extra.capitalSocial)}`);
    if (r.openingDate) ficha.push(`Abertura: ${formatBR(r.openingDate, false)}`);
    const regimeDossie = regimeTributarioLegivel(r.extra?.regimeTributario);
    if (regimeDossie) ficha.push(`Regime tributário: ${regimeDossie.valor} (registro do exercício; regime atual ainda precisa ser confirmado)`);
    // P1-01: população do município é contexto geográfico, não escala da conta — fora do dossiê copiável
    // v0.10.14: telefone fictício não entra na cópia do dossiê
    const contatoFicha: string[] = [];
    const tel1Dossie = telefoneUtil(r.extra?.telefone);
    const tel2Dossie = telefoneUtil(r.extra?.telefone2);
    if (tel1Dossie) contatoFicha.push(`Telefone 1: ${tel1Dossie}`);
    if (tel2Dossie) contatoFicha.push(`Telefone 2: ${tel2Dossie}`);
    if (r.extra?.email) contatoFicha.push(`E-mail: ${r.extra.email}`);
    if (r.extra?.endereco) contatoFicha.push(`Endereço: ${r.extra.endereco}`);
    if (contatoFicha.length) { push(); push("CONTATO PÚBLICO DA CONTA"); bullets(contatoFicha); }
    if (decisoresOf(r).length) { push(); push("ADMINISTRAÇÃO E REPRESENTANTES REGISTRADOS (QSA público)"); bullets(decisoresOf(r).map((s) => `${s.nome}${s.qual ? ` (${s.qual})` : ""}`)); }
    if (ficha.length) { push(); push("FATOS DA EMPRESA"); bullets(ficha); }
    if (porteSinais.length) {
      push();
      push("SINAIS DE PORTE (fontes públicas, atribuição v0.9.1)");
      const fontes = r.research?.sinaisPorteFontes;
      porteSinais.forEach((s, i) => {
        const f = fontes?.[i] ?? null;
        push(`• ${s}${f ? ` [fonte: ${f.fonte}]` : ""}`);
      });
    }
    if (r.socios.length) { push(); push("TEIA SOCIETÁRIA"); bullets(r.socios.map((s) => `${s.nome}${s.qual ? ` — ${s.qual.replace(/^\d+-/, "")}` : ""}${s.entrada ? ` (desde ${s.entrada})` : ""}`)); }
    if (noticias.length) { push(); push("MUDANÇAS RELEVANTES (NOTÍCIAS)"); bullets(noticias.slice(0, 4).map((n) => `${n.titulo}${n.fonte ? ` (${n.fonte})` : ""}${n.link ? ` — ${n.link}` : ""}`)); }
    if (d?.profunda && quemEDifere && d.quemE) { push(); push("QUEM É ESTA EMPRESA"); push(d.quemE); }
    // P1-01: seção 2 UMA vez só — oQueFaz e operacao sob o MESMO título (era duplicado como "— OPERAÇÃO")
    const fazTexto = [...(d?.oQueFaz ?? []), ...(d?.operacao ?? [])];
    if (fazTexto.length) { push(); push("O QUE FAZ E COMO OPERA"); bullets(fazTexto); }
    if (d?.profunda) {
      if (d.escalaEstrutura?.length) { push(); push("ESCALA COMPROVADA"); bullets(d.escalaEstrutura); }
      if (d.pessoas?.length) { push(); push("ADMINISTRAÇÃO E REPRESENTANTES REGISTRADOS"); bullets(d.pessoas); }
      if (d.tecnologia?.length) { push(); push("TECNOLOGIA E SISTEMAS IDENTIFICADOS"); bullets(d.tecnologia); }
      if (d.mudancasSinais?.length) { push(); push("MUDANÇAS RELEVANTES"); bullets(d.mudancasSinais); }
    }
    if (d?.aderencia?.length) { push(); push("POSSÍVEL RELAÇÃO COM SENIOR OU CONCORRENTES (HIPÓTESE)"); d.aderencia.forEach((f) => push(`• ${PORTFOLIO_LOGOS[f.produto]?.label ?? f.produto}: ${f.processo ?? ""}${f.hipotese ? ` — ${f.hipotese}` : ""}`)); }
    // P1-01: seção 8 UMA vez só — lacunas primeiro, hipóteses depois (mesma seção do dossiê visual).
    // P0-04: hipóteses com rótulos EXPLÍCITOS, sem conectores inventados entre campos do modelo.
    const faltaInvestigar: string[] = [...naoSabemos];
    if (investigarCards.length > 0) {
      investigarCards.forEach((h) => faltaInvestigar.push(`FATO: ${h.fato} → CONSEQUÊNCIA POSSÍVEL: ${h.consequencia} → VALIDAR: ${h.validar}`));
    } else {
      faltaInvestigar.push(...investigarBullets);
    }
    if (faltaInvestigar.length) { push(); push("O QUE FALTA INVESTIGAR"); bullets(faltaInvestigar); }
    push();
    push("Gerada por IA a partir de fontes públicas: hipóteses a validar, nunca conclusões.");
    return L.join("\n");
  };

  /* ---------------- v0.10.13: FICHA ÚNICA em 7 seções (sem abas) ----------------
   * 1 Identidade · 2 Resumo (dados públicos) · 3 Contatos e representantes ·
   * 4 Matriz, filiais e relações · 5 Análise comercial (quando existir) ·
   * 6 O que falta descobrir · 7 Fontes, datas e histórico (recolhida).
   * Cadastro aparece UMA vez; seção nasce só quando tem o que mostrar. */
  const techItens = (d?.tecnologia ?? []).map(parseTechItem);
  const decisores = decisoresOf(r);
  // "Aderência ainda não comprovada" mora na análise — não repete nas lacunas
  const naoSabemos = (d?.naoSabemos ?? []).filter((t) => !/ader(ê|e)ncia ainda n(ã|a)o comprovada/i.test(t));
  const investigarCards = d?.hipotesesDetalhadas ?? [];
  const investigarBullets = investigarCards.length > 0 ? [] : r.aiHypotheses;
  const faz = [...(d?.oQueFaz ?? []), ...(d?.operacao ?? [])];
  const escala = d?.escalaEstrutura ?? [];
  const temResumo = !!(r.cnaeDescription || r.openingDate || r.extra);
  // v0.10.14: contato exige telefone UTILIZÁVEL (fictício não conta) — a seção 3
  // nasce só quando tem algo real para mostrar
  const temContatos = !!(telefoneUtil(r.extra?.telefone) || telefoneUtil(r.extra?.telefone2) || r.extra?.email?.trim() || r.extra?.endereco?.trim());
  const temRepresentantes = decisores.length > 0 || r.socios.length > 0;
  const elegivelGrafos = r.lookupStatus === "ENRIQUECIDO" && !!r.normalizedCnpj && validateCnpj(r.normalizedCnpj).valid;
  const temLacunasDaLeitura = naoSabemos.length > 0 || investigarCards.length > 0 || investigarBullets.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-0 bg-background" data-testid="ai-dialog">
        {/* CABEÇALHO COMPACTO FIXO — identidade e alertas sempre visíveis; o corpo rola sozinho */}
        <div className="shrink-0 gap-2 border-b border-senior-cinza-300 bg-background px-6 pb-4 pt-5">
          {/* v0.11.1 (Gate 2): o NOME da entidade é o elemento principal do cabeçalho.
              Denominação secundária registrada (nome comercial) fica claramente
              identificada — nunca substitui a razão social. */}
          <h2 className="ds-title text-senior-azul" data-testid="ai-dialog-title">
            {r.legalName ?? r.tradeName ?? "Conta"}
          </h2>
          {r.legalName && r.tradeName && r.tradeName !== r.legalName && (
            <p className="ds-caption text-senior-cinza-600" data-testid="ficha-nome-comercial">
              Denominação secundária registrada: <span className="font-medium text-senior-cinza-800">{r.tradeName}</span>
            </p>
          )}
          <p className="ds-body flex flex-wrap items-center gap-x-3 gap-y-1 text-senior-cinza-600">
            {(r.headquartersCnpj || r.resolvedCnpj) && (
              <span className="font-semibold tabular-nums text-senior-azul">CNPJ {formatCnpj((r.headquartersCnpj ?? r.resolvedCnpj) as string)}</span>
            )}
            {(r.municipality || r.uf) && <span>{r.municipality ? `${r.municipality}/${r.uf ?? ""}` : r.uf}</span>}
            {r.registrationStatus && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    ["BAIXADA", "SUSPENSA", "INAPTA", "NULA"].includes(r.registrationStatus.toUpperCase())
                      ? "bg-[#C4353F]"
                      : r.registrationStatus.toUpperCase() === "ATIVA"
                        ? "bg-[#00968C]"
                        : "bg-[#E0A400]"
                  }`}
                />
                Situação: {registrationLabel(r.registrationStatus)}
              </span>
            )}
          </p>

          {/* faixa de identidade — o que foi resolvido, em chips */}
          <div className="flex flex-wrap items-center gap-2" data-testid="dossier-identity">
            {situ.key === "REVIEW" ? (
              // chip clicável: rola até a seção 1 (identidade), que abre a ficha
              <button
                onClick={rolarParaIdentidade}
                className="inline-flex max-w-44 items-center gap-1 whitespace-nowrap rounded-full border border-transparent bg-[#FFC51133] px-2 py-0.5 text-[13px] font-medium text-[#33466C] transition-shadow hover:shadow-[0_0_0_2px_#FFC51166] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFC511]"
                title="Ir para a confirmação de identidade"
                data-testid={`dossier-review-chip-${r.rowNumber}`}
              >
                {TONE_ICON.revisao}
                <span className="truncate">Revisar identificação</span>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : (
              <SituationBadge s={situ} testId={`dossier-situation-${r.rowNumber}`} />
            )}
            <RowTrustChip r={r} />
            <FoundTypeChip isHeadquarters={r.foundIsHeadquarters} />
            {/* v0.11.1 (Gate 2): setor/porte APARENTES saem do cabeçalho (eram hipóteses
                competindo com identidade) e vão para a seção de leitura comercial,
                rotulados como hipótese de IA. */}
            {d?.profunda && (
              <Badge variant="outline" className="gap-1 whitespace-nowrap border-[#00968C40] bg-[#00968C0D] text-[13px] font-semibold text-[#086B6B]" data-testid="deep-badge">
                <Search className="h-3 w-3" aria-hidden="true" /> Pesquisa profunda
              </Badge>
            )}
          </div>

          {/* v0.10.16: exportação em local PRÓPRIO — fora dos selos de identidade,
              comando explícito único (sem controles repetidos no corpo) */}
          <div className="flex items-center justify-between gap-2 border-t border-senior-cinza-200 pt-2" data-testid="ficha-acoes">
            <FichaPdfButton batchId={batchId} rowNumber={r.rowNumber} />
            {/* v0.10.18 — navegação entre empresas (split/foco): anterior, próxima,
                ampliar/reduzir, voltar à lista e fechar — a ordem segue a pesquisa e
                os filtros atuais da lista */}
            {nav && (
              <div className="flex items-center gap-1.5" data-testid="ficha-nav">
                {nav.posicao != null && nav.total != null && (
                  <span className="ds-caption tabular-nums text-senior-cinza-600" data-testid="ficha-nav-posicao">
                    {nav.posicao} de {nav.total}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 rounded-[8px] border-senior-cinza-300 p-0 text-senior-azul"
                  onClick={nav.onAnterior}
                  disabled={nav.posicao == null || nav.posicao <= 1}
                  aria-label="Empresa anterior"
                  title="Empresa anterior"
                  data-testid="ficha-nav-anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 rounded-[8px] border-senior-cinza-300 p-0 text-senior-azul"
                  onClick={nav.onProxima}
                  disabled={nav.posicao == null || nav.total == null || nav.posicao >= nav.total}
                  aria-label="Próxima empresa"
                  title="Próxima empresa"
                  data-testid="ficha-nav-proxima"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-[8px] border-senior-cinza-300 px-2 text-senior-azul"
                  onClick={nav.onAlternarFoco}
                  aria-label={nav.emFoco ? "Reduzir ficha (modo dividido)" : "Ampliar ficha (modo foco)"}
                  title={nav.emFoco ? "Reduzir ficha" : "Ampliar ficha"}
                  data-testid="ficha-nav-ampliar"
                >
                  {nav.emFoco ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  <span className="hidden xl:inline">{nav.emFoco ? "Reduzir" : "Ampliar"}</span>
                </Button>
                {nav.emFoco && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-[8px] border-senior-cinza-300 px-2 text-senior-azul"
                    onClick={nav.onVoltarLista}
                    aria-label="Voltar à lista"
                    title="Voltar à lista"
                    data-testid="ficha-nav-voltar"
                  >
                    <ListIcon className="h-4 w-4" />
                    <span className="hidden xl:inline">Voltar à lista</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 rounded-[8px] border-senior-cinza-300 p-0 text-senior-azul"
                  onClick={onClose}
                  aria-label="Fechar ficha"
                  title="Fechar ficha"
                  data-testid="ficha-nav-fechar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            {!nav && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 rounded-[8px] border-senior-cinza-300 p-0 text-senior-azul"
                onClick={onClose}
                aria-label="Fechar ficha"
                title="Fechar ficha"
                data-testid="ficha-nav-fechar"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* alertas materiais — saltam antes de qualquer decisão de exportação */}
          {alerts.length > 0 && (
            <div className="space-y-1.5 rounded-[8px] border border-[#FFC51166] bg-[#FFC51114] p-3" data-testid="dossier-alerts">
              {alerts.map((a, i) => (
                <p key={i} className="ds-body flex items-start gap-1.5 text-[#33466C]">
                  {a.tone === "alerta" ? (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8a6d00]" aria-hidden="true" />
                  ) : (
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00968C]" aria-hidden="true" />
                  )}
                  {a.text}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* CORPO — UMA coluna, UMA rolagem, ficha única em seções numeradas.
            v0.11.0 (contrato 5/7): respiro real — padding de leitura 24px+, container
            queries para colunas adaptativas (2 colunas só com largura suficiente). */}
        <div className="cnpj-scroll @container min-h-0 flex-1 overflow-y-auto px-6 py-5" data-testid="dossier-ficha">
          {/* v0.10.20 — navegação discreta por seções: salta para a área sem
              percorrer a ficha inteira. A barra é fixa DENTRO do corpo e os
              títulos têm scroll-mt — a barra nunca encobre um título. */}
          <div
            className="sticky top-0 z-10 -mx-6 mb-6 bg-background/95 px-6 py-2 shadow-[0_1px_0_#DCE9E6] backdrop-blur-sm"
            role="navigation"
            aria-label="Seções da ficha"
            data-testid="ficha-nav-secoes"
          >
            {/* v0.11.2 (UX): barra ÚNICA de seções — sem quebrar em duas linhas.
                Chips encolhem para caber e a barra rola no próprio trilho (scrollbar
                oculta): navegação secundária não disputa espaço com o conteúdo. */}
            <div className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {[
                /* v0.11.1 (Gate 2): a navegação segue o modelo de blocos do contrato
                   comercial: o que sabemos (identidade/fatos/contatos/estrutura),
                   leitura (hipótese), o que falta confirmar, o que investigar agora
                   e fontes. Os números continuam sendo os das seções reais. */
                { n: 1, label: "Identidade" },
                { n: 2, label: "Fatos da empresa" },
                { n: 3, label: "Contatos e sócios" },
                { n: 4, label: "Estrutura e relações" },
                ...(hasAi || aiRodando || aiFalhou ? [{ n: 5, label: "Leitura comercial (IA)" }] : []),
                { n: 6, label: "O que falta confirmar" },
                { n: 7, label: "O que investigar agora" },
                { n: 8, label: "Fontes e histórico" },
              ].map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => rolarSecaoFicha(s.n)}
                  className="shrink-0 whitespace-nowrap rounded-full border border-senior-cinza-300 bg-white px-2 py-0.5 text-[12px] font-medium text-senior-cinza-600 transition-colors hover:bg-[#00968C14] hover:text-[#086B6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C]"
                  data-testid={`ficha-secao-ir-${s.n}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-9">
            {/* 1 — IDENTIDADE, SITUAÇÃO CADASTRAL E DIVERGÊNCIAS (sempre primeiro) */}
            <FichaSecao
              n={1}
              titulo="Identidade e situação cadastral"
              descricao="O que você enviou, o que o registro público responde e o que depende da sua conferência."
              testId="ficha-secao-identidade"
            >
              {situ.key === "AGUARDANDO" && (
                <div className="flex items-center gap-2 rounded-[10px] border border-[#00968C38] bg-[#00968C0A] px-4 py-3 text-sm text-senior-azul" data-testid={`consulta-andamento-${r.rowNumber}`}>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#00968C]" aria-hidden="true" />
                  Consultando as fontes públicas desta pista. A tela atualiza sozinha.
                </div>
              )}
              {situ.key === "AGUARDANDO_INICIO" && (
                <div className="flex items-start gap-2.5 rounded-[10px] border border-senior-cinza-300 bg-white px-4 py-3" data-testid={`consulta-preparada-${r.rowNumber}`}>
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-senior-cinza-600" aria-hidden="true" />
                  <p className="ds-body text-senior-cinza-600">Esta entrada está pronta. Inicie o processamento do lote para consultar as fontes públicas.</p>
                </div>
              )}
              {situ.key === "ERRO" && (
                <div className="rounded-[10px] border border-[#F1BDBD] bg-[#FDF1F1] p-4" data-testid={`consulta-erro-${r.rowNumber}`}>
                  <h4 className="ds-title-md text-[#8C2F39]">A consulta não concluiu</h4>
                  <p className="ds-body mt-1 text-senior-cinza-600">
                    {r.lookupError ? `${r.lookupError} Nada foi perdido.` : "A fonte pública não respondeu agora. Nada foi perdido: os fatos já coletados continuam aqui."}
                  </p>
                  <RowAction onClick={onRetryRow} disabled={rowRetrying} testId={`retry-row-${r.rowNumber}`}>
                    {rowRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />} Tentar novamente
                  </RowAction>
                </div>
              )}
              <IdentityFlow r={r} />
              {/* v0.10.13: cada painel de identidade aparece UMA vez — a duplicação entre
                  abas Dados/Evidências acabou junto com as abas */}
              {situ.key === "LOCALIZADO" && (
                <IdentidadeDivergentePanel r={r} busy={busy} deciding={deciding} onDecide={onDecide} />
              )}
              {situ.key === "REVIEW" && r.resolution && (
                <ReviewPanel r={r} busy={busy} deciding={deciding} onDecide={onDecide} />
              )}
              {situ.key === "CONFIRMED" && <WhyPanel r={r} />}
              {situ.key === "UNRESOLVED" && <UnresolvedPanel r={r} busy={busy} deciding={deciding} onDecide={onDecide} />}
              {r.resolution && r.resolution.notas.length > 0 && situ.key !== "UNRESOLVED" && (
                <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4">
                  <h4 className="ds-title-md text-senior-azul">Observações da identificação</h4>
                  <ul className="mt-2 space-y-1.5">
                    {r.resolution.notas.map((n, i) => (
                      <li key={i} className="ds-body flex items-start gap-1.5 text-senior-cinza-600">
                        <CircleHelp className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </FichaSecao>

            {/* 2 — FATOS DA EMPRESA: principais dados públicos, sem IA obrigatória */}
            {temResumo && (
              <FichaSecao
                n={2}
                titulo="Fatos da empresa"
                descricao="Principais dados do registro público. Disponíveis sem leitura automática."
                testId="ficha-secao-resumo"
              >
                <CompanyFicha r={r} />
                {/* v0.10.16: dados complementares do registro abrem por comando — a leitura
                    essencial fica na frente, sem cartões aninhados abertos ao mesmo tempo */}
                {(r.extra?.naturezaJuridica || r.extra?.mei || r.extra?.setorPrimario || (r.extra?.cnaesSecundarios?.length ?? 0) > 0) && (
                  <TechDisclosure
                    title="Mais dados do registro público"
                    subtitle="Setor do CNAE, natureza jurídica, MEI e outras atividades registradas."
                    testId="registro-publico-toggle"
                  >
                    <PublicDataPanel r={r} />
                  </TechDisclosure>
                )}
              </FichaSecao>
            )}

            {/* 3 — CONTATOS E SÓCIOS */}
            {(temContatos || temRepresentantes) && (
              <FichaSecao
                n={3}
                titulo="Contatos e sócios"
                testId="ficha-secao-contatos"
              >
                <ContactSection r={r} />
                <DecisoresSection r={r} />
                <SociosPanel r={r} />
              </FichaSecao>
            )}

            {/* 4 — ESTRUTURA: MATRIZ, FILIAIS E RELAÇÕES (comando explícito) */}
            {elegivelGrafos && (
              <FichaSecao
                n={4}
                titulo="Estrutura e relações"
                descricao="Unidades da mesma empresa e pessoas nos quadros públicos. Cada consulta acontece só quando você pedir."
                testId="ficha-secao-relacoes"
              >
                {/* v0.10.24 — sem key de remontagem: os painéis reinicializam o estado na
                    troca de identidade (padrão de render-phase reset) e descartam respostas
                    atrasadas de outra empresa; a key aqui produzia nó órfão visível. */}
                <MatrizFiliaisPanel r={r} batchId={batchId} />
                <RelacoesSocietariasPanel r={r} batchId={batchId} onAbrirPessoa={onAbrirPessoa} />
              </FichaSecao>
            )}

            {/* 5 — LEITURA COMERCIAL (quando existir — nunca um painel vazio) */}
            {(hasAi || aiRodando || aiFalhou) && (
              <FichaSecao
                n={5}
                titulo="Leitura comercial (IA)"
                descricao="Hipóteses geradas a partir das fontes públicas. Nunca conclusões."
                testId="ficha-secao-analise"
                acoes={hasAi ? (
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C14]"
                      onClick={copyReading}
                      data-testid="ai-copy"
                    >
                      {copiedReading ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                      {copiedReading ? "Copiado ✓" : "Copiar leitura"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C14]"
                      onClick={onRetry}
                      disabled={busy}
                      data-testid="ai-regenerate"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Gerar de novo
                    </Button>
                  </span>
                ) : undefined}
              >
                {aiRodando && (
                  <div className="flex items-center gap-2 rounded-[10px] border border-[#00968C38] bg-[#00968C0A] px-4 py-3 text-sm text-senior-azul" data-testid="ai-waiting-dialog">
                    <Loader2 className="h-4 w-4 animate-spin text-[#00968C]" aria-hidden="true" />
                    {AI_STATE[r.aiStatus ?? ""] ?? "Preparando leitura"}. A tela atualiza sozinha.
                  </div>
                )}
                {aiFalhou && (() => {
                  // P0-09: o motivo (mensagem humana já sanitizada pelo backend) deixa de ser escondido;
                  // quando a pesquisa foi salva, o estado fica explícito — a síntese falhou, o pacote vale.
                  const pesquisaSalva = r.researchStatus === "OK";
                  const motivo = r.aiError ? (r.aiError.length > 240 ? `${r.aiError.slice(0, 240).trimEnd()}…` : r.aiError) : null;
                  return (
                    <div className="rounded-[10px] border border-[#F1BDBD] bg-[#FDF1F1] px-4 py-3" data-testid="ai-failed-dialog">
                      <p className="ds-body text-[#8C2F39]">
                        {pesquisaSalva
                          ? "A pesquisa desta conta foi salva. A síntese da leitura é que falhou."
                          : "Não conseguimos preparar a leitura desta conta agora."}
                      </p>
                      {pesquisaSalva && (
                        <p className="ds-caption mt-1 text-senior-cinza-600">
                          Tentar de novo reaproveita o pacote de pesquisa já salvo — nenhuma nova varredura no site da empresa; só a leitura é refeita.
                        </p>
                      )}
                      {motivo && (
                        <p className="ds-caption mt-1 text-[#8C2F39]" data-testid="ai-error-reason">
                          {motivo}
                        </p>
                      )}
                      <RowAction onClick={onRetry} disabled={busy} testId="ai-retry-dialog">
                        <RotateCcw className="h-3.5 w-3.5" /> Tentar de novo
                      </RowAction>
                    </div>
                  );
                })()}
                {hasAi && (
                  <div className="space-y-6">
                    <div className="space-y-2.5">
                      {/* v0.11.1 (Gate 2): setor/porte aparentes vieram do cabeçalho — aqui
                          são hipóteses rotuladas, com cor de incerteza (âmbar). */}
                      {(r.aiSector || (r.aiSize && !/indeterminad/i.test(r.aiSize) && !/demais/i.test(r.aiSize))) && (
                        <p className="ds-caption flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-[#FFC51133] bg-[#FFC5110A] px-2.5 py-1.5 text-[#6B5A00]" data-testid="scout-aparentes">
                          <CircleHelp className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {r.aiSector && <span>Setor aparente: <span className="font-semibold">{r.aiSector}</span></span>}
                          {r.aiSector && r.aiSize && !/indeterminad/i.test(r.aiSize) && <span aria-hidden="true">·</span>}
                          {r.aiSize && !/indeterminad/i.test(r.aiSize) && !/demais/i.test(r.aiSize) && <span>Porte aparente: <span className="font-semibold">{r.aiSize}</span></span>}
                        </p>
                      )}
                      {r.aiReading && (
                        <SpotlightCard>
                          <p className="ds-body rounded-[9px] border border-senior-cinza-300 bg-white p-3 font-medium leading-relaxed text-senior-azul" data-testid="ai-reading">
                            {r.aiReading}
                          </p>
                        </SpotlightCard>
                      )}
                      {d?.entidadeEscopo && (
                        <p className="ds-body rounded-[8px] border border-[#33466C26] bg-[#33466C08] p-2.5 text-[#33466C]" data-testid="scout-entidade-escopo">
                          <strong className="font-semibold">Entidade analisada:</strong> {d.entidadeEscopo}
                        </p>
                      )}
                      {quemEDifere && d?.quemE && <p className="ds-body text-senior-azul">{d.quemE}</p>}
                      {r.aiProfile && <p className="ds-caption italic text-senior-cinza-600" data-testid="scout-perfil">{r.aiProfile}</p>}
                    </div>
                    {faz.length > 0 && (
                      <SubSecaoAnalise titulo="O que faz e como opera" testId="scout-operacao">
                        <ul className="space-y-1">
                          {faz.map((o, i) => (
                            <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                              <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-[#00968C]" aria-hidden="true" />
                              {o}
                            </li>
                          ))}
                        </ul>
                      </SubSecaoAnalise>
                    )}
                    {(escala.length > 0 || porteSinais.length > 0) && (
                      <SubSecaoAnalise titulo="Escala comprovada" testId="scout-escala">
                        <div className="space-y-2">
                          {escala.length > 0 && (
                            <ul className="space-y-1">
                              {escala.map((o, i) => (
                                <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                                  <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#33466C]" aria-hidden="true" />
                                  {o}
                                </li>
                              ))}
                            </ul>
                          )}
                          <PorteSignals sinais={porteSinais} fontes={r.research?.sinaisPorteFontes} />
                        </div>
                      </SubSecaoAnalise>
                    )}
                    {/* v0.10.13: representantes do CADASTRO ficam na seção 3 — aqui só o
                        que a pesquisa pública trouxe, sem repetir o quadro oficial */}
                    {(d?.pessoas?.length ?? 0) > 0 && (
                      <SubSecaoAnalise titulo="Administração e representantes em fontes públicas" testId="scout-pessoas">
                        <ul className="space-y-1">
                          {d!.pessoas!.map((o, i) => (
                            <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#33466C]" aria-hidden="true" />
                              {o}
                            </li>
                          ))}
                        </ul>
                      </SubSecaoAnalise>
                    )}
                    {techItens.length > 0 && (
                      <SubSecaoAnalise titulo="Tecnologia e sistemas identificados" testId="scout-tecnologia">
                        <ul className="space-y-1.5">
                          {techItens.map((t, i) => (
                            <TechStateRow key={i} item={t} />
                          ))}
                        </ul>
                      </SubSecaoAnalise>
                    )}
                    {(d?.mudancasSinais?.length ?? 0) > 0 && (
                      <SubSecaoAnalise titulo="Mudanças relevantes" testId="scout-mudancas">
                        <ul className="space-y-1">
                          {d!.mudancasSinais!.map((o, i) => (
                            <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                              <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00968C]" aria-hidden="true" />
                              {o}
                            </li>
                          ))}
                        </ul>
                      </SubSecaoAnalise>
                    )}
                    {noticias.length > 0 && <NewsSection noticias={noticias} />}
                    {/* Seção SEMPRE existe quando há leitura: com evidência (processo → tecnologia →
                        lacuna) ou com a resposta honesta "Aderência ainda não comprovada". */}
                    <SubSecaoAnalise titulo="Possível relação com Senior ou concorrentes" testId="scout-aderencia">
                      {(d?.aderencia?.length ?? 0) > 0 ? (
                        <div className="space-y-2">
                          <ul className="space-y-2">
                            {d!.aderencia!.map((f, i) => (
                              <li
                                key={i}
                                className="flex items-start gap-3 rounded-[8px] border border-senior-cinza-300 bg-white px-3 py-2.5"
                                data-testid={`scout-aderencia-item-${i}`}
                              >
                                <span className="flex h-9 w-12 shrink-0 items-center justify-center">
                                  <PortfolioLogo produto={f.produto} className="h-6 w-auto" />
                                </span>
                                <span className="min-w-0">
                                  <span className="ds-body font-medium text-senior-azul">{PORTFOLIO_LOGOS[f.produto]?.label ?? f.produto}</span>
                                  {f.processo && <span className="ds-caption block text-senior-cinza-600">Processo observado: {f.processo}</span>}
                                  <span className="ds-caption mt-0.5 flex items-start gap-1 italic text-senior-cinza-600">
                                    <CircleHelp className="mt-0.5 h-3 w-3 shrink-0 text-[#B08300]" aria-hidden="true" /> {f.hipotese}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="ds-caption text-senior-cinza-600">
                            Aderência é hipótese até validação com quem conhece o processo — nunca promessa de funcionalidade.
                          </p>
                        </div>
                      ) : (
                        <p className="ds-body flex items-start gap-1.5 text-senior-cinza-600" data-testid="scout-aderencia-vazia">
                          <CircleHelp className="mt-1 h-3.5 w-3.5 shrink-0 text-senior-cinza-400" aria-hidden="true" />
                          Aderência ainda não comprovada — a pesquisa não encontrou processo observado que conecte esta conta ao portfólio Senior ou a um concorrente identificável.
                        </p>
                      )}
                    </SubSecaoAnalise>
                    <p className="ds-caption text-senior-cinza-600">
                      Gerada por IA a partir dos dados públicos consultados{r.research ? ` + pacote de pesquisa (${plural(r.research.paginasOk, "página", "páginas")} do site oficial, ${plural(r.research.buscasOk, "busca", "buscas")})` : ""}
                      {r.aiProcessedAt ? ` · leitura de ${formatBR(r.aiProcessedAt)}` : ""} — hipóteses a validar, nunca conclusões.
                    </p>
                  </div>
                )}
              </FichaSecao>
            )}

            {/* 6 — O QUE FALTA CONFIRMAR (v0.11.1 Gate 2: bloco próprio — o "O que
                sabemos" do painel repetia as seções 1-4 e saiu; as consultas viraram
                a seção 7). Sempre honesto: hipótese e lacunas rotuladas. */}
            <FichaSecao
              n={6}
              titulo="O que falta confirmar"
              descricao="Pontos que merecem conferência e perguntas que as fontes ainda não responderam."
              testId="ficha-secao-lacunas"
            >
              <ProximoMovimentoPanel r={r} batchId={batchId} blocos={["validar", "naoEncontramos"]} />
              {/* O QUE FALTA DESCOBRIR — lacunas apontadas pela leitura */}
              {temLacunasDaLeitura && (
                <div className="space-y-2.5" data-testid="scout-nao-sabemos">
                  <p className="ds-caption font-semibold text-senior-cinza-600">Apontado pela leitura</p>
                  {naoSabemos.length > 0 && (
                    <ul className="space-y-1">
                      {naoSabemos.map((o, i) => (
                        <li key={i} className="ds-body flex items-start gap-1.5 text-senior-cinza-600">
                          <CircleHelp className="mt-1 h-3.5 w-3.5 shrink-0 text-senior-cinza-400" aria-hidden="true" />
                          {o}
                        </li>
                      ))}
                    </ul>
                  )}
                  {investigarCards.length > 0 && (
                    <div className="space-y-2" data-testid="scout-hipoteses">
                      {investigarCards.map((h, i) => (
                        <HypothesisCard key={i} h={h} i={i} />
                      ))}
                    </div>
                  )}
                  {investigarBullets.length > 0 && (
                    <ul className="space-y-1" data-testid="scout-hipoteses">
                      {investigarBullets.map((h, i) => (
                        <li key={i} className="ds-body flex items-start gap-1.5 text-senior-azul">
                          <CircleHelp className="mt-1 h-3 w-3 shrink-0 text-[#B08300]" aria-hidden="true" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </FichaSecao>

            {/* 7 — O QUE INVESTIGAR AGORA: consultas sob comando (v0.11.1 Gate 2:
                bloco de AÇÕES separado do bloco de LACUNAS — a jornada fica
                lacuna → ação, sem misturar os dois no mesmo título). */}
            <FichaSecao
              n={7}
              titulo="O que investigar agora"
              descricao="Consultas às fontes públicas, sempre sob o seu comando."
              testId="ficha-secao-investigar"
            >
              <TriagemPanel r={r} batchId={batchId} />
              {/* CONSULTA COMPLETA — a ação principal da investigação, sempre sob comando */}
              <DeepResearchBar
                r={r}
                deepBusy={deepBusy}
                onDeepResearch={onDeepResearch}
                onQuickReading={onRetry}
                quickBusy={busy}
                hasLeitura={hasAi}
              />
              {/* RESULTADO — cobertura factual do que a pesquisa já respondeu */}
              {r.research && <CoberturaFactual r={r} />}
            </FichaSecao>

            {/* 8 — FONTES, DATAS E HISTÓRICO (área expansível, recolhida por padrão) */}
            <FichaSecao
              n={8}
              titulo="Fontes, datas e histórico"
              descricao="Rastro completo da consulta, evidências e detalhes técnicos. Aberto só quando você precisa conferir."
              testId="ficha-secao-fontes"
              recolhida
            >
              <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="ds-caption font-semibold uppercase tracking-wide text-senior-cinza-600">Rastro da consulta</p>
                  {r.lookupStatus === "ENRIQUECIDO" && r.normalizedCnpj && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRevalidate}
                      disabled={revalidating}
                      data-testid={`revalidar-${r.rowNumber}`}
                      aria-label="Revalidar consulta (faz nova consulta às fontes públicas)"
                      title="Faz NOVA consulta às fontes públicas e substitui a ficha cadastral (até 4 consultas)"
                    >
                      <RotateCcw className={`h-3.5 w-3.5 ${revalidating ? "animate-spin" : ""}`} aria-hidden="true" />
                      {revalidating ? "Revalidando…" : "Revalidar consulta"}
                    </Button>
                  )}
                </div>
                <dl className="mt-2 divide-y divide-[#F2F2F2]">
                  {/* v0.10.8: categoria da consulta à frente; a origem técnica fica disponível
                      no mesmo painel (camada secundária) — rastreabilidade preservada */}
                  <DefRow label="Consulta realizada">
                    {sourceLabel(r.source)}
                    {sourceDetail(r.source) && <span className="text-senior-cinza-500"> · origem técnica: {sourceDetail(r.source)}</span>}
                  </DefRow>
                  {r.queriedAt && <DefRow label="Consulta em">{formatBR(r.queriedAt)}</DefRow>}
                  {r.collectedAt && r.queriedAt && r.collectedAt !== r.queriedAt && (
                    <DefRow label="Coleta original (fonte)">
                      {formatBR(r.collectedAt)}
                      <span className="text-senior-cinza-500"> — os dados foram coletados nessa data e reaproveitados na consulta acima</span>
                    </DefRow>
                  )}
                  {r.fontes?.cache && (
                    <DefRow label="Ficha cadastral" data-testid="rastro-ficha">
                      coleta original {formatBR(r.fontes.cache.consultaOriginal)} · válida até {formatBR(r.fontes.cache.validoAte)} · reuso {formatBR(r.fontes.cache.reaproveitadoEm)}
                    </DefRow>
                  )}
                  {r.fontes && r.fontes.complementacoes.length > 0 && (
                    <DefRow label="Complementado por" data-testid="rastro-complementacao">
                      <span className="flex flex-wrap gap-1">
                        {r.fontes.complementacoes.map((c, i) => (
                          <span key={i} className="rounded-full bg-[#F2F2F2] px-2 py-0.5 text-[13px] text-[#33466C]" title={`Campos preenchidos${c.fonte ? ` (origem técnica: ${c.fonte})` : ""}: ${c.campos.join(", ")}`}>
                            {sourceLabel(c.fonte)}: {c.campos.slice(0, 4).join(", ")}{c.campos.length > 4 ? ` +${c.campos.length - 4}` : ""}
                          </span>
                        ))}
                      </span>
                    </DefRow>
                  )}
                  {r.resolvedCnpj && <DefRow label="CNPJ encontrado"><span className="tabular-nums">{formatCnpj(r.resolvedCnpj)}</span></DefRow>}
                  {r.headquartersCnpj && <DefRow label="CNPJ da matriz"><span className="tabular-nums">{formatCnpj(r.headquartersCnpj)}</span></DefRow>}
                  {r.matrizStatus && <DefRow label="Matriz">{r.matrizStatus === "RESOLVIDA" ? "Confirmada pelo registro oficial (identificador matriz/filial)" : "Não localizada nas fontes públicas"}</DefRow>}
                  {r.research && (
                    <DefRow label="Pacote de pesquisa" data-testid="rastro-pacote">
                      {r.research.dominio ? `${r.research.dominio} · ` : ""}
                      {plural(r.research.paginasOk, "página lida", "páginas lidas")} de {r.research.paginasTentadas} · {plural(r.research.buscasOk, "busca", "buscas")} com resultado
                      {r.researchAt ? ` · ${formatBR(r.researchAt)}` : ""}
                    </DefRow>
                  )}
                  {r.research && r.research.paginas.length > 0 && (
                    <DefRow label="Páginas rastreadas">
                      <span className="flex flex-wrap gap-1">
                        {r.research.paginas.map((p, i) => (
                          <a key={i} href={p.url} target="_blank" rel="noreferrer" title={p.titulo} className="rounded-full bg-[#F2F2F2] px-2 py-0.5 text-[13px] text-[#33466C] underline-offset-2 hover:underline">
                            {p.tipo}
                          </a>
                        ))}
                      </span>
                    </DefRow>
                  )}
                </dl>
              </div>
              {(d?.evidencias?.length ?? 0) > 0 && (
                <TechDisclosure
                  title={`Evidências da pesquisa (${d!.evidencias!.length})`}
                  subtitle="Cada achado com status e fonte, incluindo o que foi buscado e não encontrado."
                  testId={`dossier-evidencias-accordion-${r.rowNumber}`}
                >
                  <ul className="space-y-2.5">
                    {d!.evidencias!.map((ev, i) => (
                      <EvidenceChipRow key={i} ev={ev} />
                    ))}
                  </ul>
                </TechDisclosure>
              )}
              <TechDisclosure title="Detalhes técnicos" subtitle="Para suporte e auditoria, inclui a origem técnica do modelo de leitura. Pode deixar fechado." testId={`dossier-tech-${r.rowNumber}`}>
                <dl className="divide-y divide-[#F2F2F2]">
                  {r.aiModelRequested && <DefRow label="Modelo solicitado (config)">{r.aiModelRequested}</DefRow>}
                  {r.aiModel && <DefRow label="Modelo efetivo da leitura">{r.aiModel}{modelFallback ? " (fallback do gateway: conta sem permissão para o solicitado)" : ""}</DefRow>}
                  <DefRow label="Linha da lista">Nº {r.rowNumber}</DefRow>
                  <DefRow label="Entrada original"><span className="break-all">{r.entrada ?? r.rawCnpj ?? "—"}</span></DefRow>
                  {r.rawCnpj && <DefRow label="CNPJ na entrada"><span className="break-all tabular-nums">{r.rawCnpj}</span></DefRow>}
                  {r.normalizedCnpj && <DefRow label="CNPJ normalizado"><span className="tabular-nums">{formatCnpj(r.normalizedCnpj)}</span></DefRow>}
                  <DefRow label="Como processamos">{(r.resolution?.metodo ?? []).join(" · ") || (LOOKUP_STATE[r.lookupStatus] ?? "—")}</DefRow>
                  <DefRow label="Estado da consulta">{LOOKUP_STATE[r.lookupStatus] ?? r.lookupStatus}</DefRow>
                  {r.lookupError && <DefRow label="Detalhe do erro"><span className="break-all">{r.lookupError}</span></DefRow>}
                  {r.branchIdentifier !== null && r.branchIdentifier !== undefined && <DefRow label="Tipo do registro consultado">{r.branchIdentifier === 1 ? "Matriz (registro oficial)" : `Filial nº ${r.branchIdentifier}`}</DefRow>}
                </dl>
              </TechDisclosure>
            </FichaSecao>
          </div>
        </div>
    </div>
  );
}

/**
 * v0.10.18 — FICHA EM SOBREPOSIÇÃO (Sheet). Em telas estreitas (< 1024px) e
 * no modo Lista, a ficha abre sobre a lista, como antes. Em telas largas com
 * modo Dividido/Foco, o BatchDetailCard renderiza `FichaEmpresa` direto no
 * painel da direita (mesmo conteúdo, mesma apresentação — nunca duas fichas).
 */
function CompanyDossier(props: Omit<Parameters<typeof FichaEmpresa>[0], "nav">) {
  return (
    <Sheet open onOpenChange={(v) => !v && props.onClose()}>
      <SheetContent
        side="right"
        /* painel mais largo quando há espaço — ficha única legível, sem terceira coluna */
        className="flex w-full flex-col gap-0 p-0 sm:max-w-none lg:w-[640px] lg:max-w-[640px] xl:w-[720px] xl:max-w-[720px] 2xl:w-[800px] 2xl:max-w-[800px]"
        data-testid="ai-dialog"
      >
        {/* a11y: título/descrição para leitores de tela (o cabeçalho visual é o da ficha) */}
        <SheetTitle className="sr-only">Ficha da empresa</SheetTitle>
        <SheetDescription className="sr-only">
          Dados públicos, identidade, contatos, relações e investigação da empresa selecionada.
        </SheetDescription>
        <FichaEmpresa {...props} />
      </SheetContent>
    </Sheet>
  );
}
/* ==================================================================== */
/* Componente principal                                                  */
/* ==================================================================== */

const FILA_ESTADO_LABEL: Record<ResearchQueueView["estado"], { label: string; tone: string; icon: typeof Play }> = {
  RODANDO: { label: "Fila rodando", tone: "text-[#086B6B]", icon: Loader2 },
  PAUSADA: { label: "Fila pausada (cota)", tone: "text-[#9A6B15]", icon: CircleAlert },
  PARADA: { label: "Fila interrompida", tone: "text-[#8a6d00]", icon: Square },
  CONCLUIDA: { label: "Fila concluída", tone: "text-[#086B6B]", icon: CircleCheck },
};

/** P4 (v0.10.9) — PLANO DE CONSULTAS: propõe, nunca executa sozinho.
 * Cada item só roda quando o operador aprova — e a aprovação chama o MESMO
 * comando que já existe na ficha (nenhum executor novo). Zero IA: a seleção é
 * a própria triagem determinística (estado "Fonte estruturada pode resolver"). */
function PlanoConsultasPanel({ detail, linhas }: { detail: BatchDetail; linhas: RowDetail[] }) {
  const [plano, setPlano] = useState<PlanoConsultasV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [aprovando, setAprovando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmarItem, setConfirmarItem] = useState<PlanoConsultasV1["itens"][number] | null>(null);

  async function gerar() {
    setLoading(true);
    setErro(null);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/plano`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErro(data?.error?.message ?? "Não foi possível gerar o plano de consultas.");
        setPlano(null);
        return;
      }
      setPlano(data.plano as PlanoConsultasV1);
    } catch {
      setErro("Falha de rede ao gerar o plano de consultas.");
    } finally {
      setLoading(false);
    }
  }

  // recalcula a CADA abertura — cálculo local (sem consulta externa) que reflete
  // as investigações feitas desde a última abertura; o plano é regenerado após
  // cada aprovação (a triagem da lacuna recalcula sozinha)
  useEffect(() => {
    if (aberto) void gerar();
  }, [aberto]);

  function endpointDoComando(comando: string): string {
    if (comando === "investigar_estabelecimentos_raiz") return "matriz-filiais";
    if (comando === "investigar_relacoes_societarias") return "relacoes-societarias";
    return "revalidate";
  }

  async function aprovar(item: PlanoConsultasV1["itens"][number]) {
    const chave = `${item.linha}:${item.pergunta_id}`;
    setAprovando(chave);
    setResultado(null);
    setConfirmarItem(null);
    try {
      const res = await apiFetch(`/api/imports/${detail.id}/rows/${item.linha}/${endpointDoComando(item.comando_executor)}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setResultado({ ok: false, msg: data?.error?.message ?? "A consulta não pôde ser concluída. Nada foi perdido." });
      } else {
        setResultado({ ok: true, msg: "Consulta concluída. Plano atualizado." });
      }
    } catch {
      setResultado({ ok: false, msg: "Falha de rede durante a consulta aprovada." });
    } finally {
      setAprovando(null);
      void gerar(); // regenera o plano (triagem recalculada)
    }
  }

  const custoZero = plano?.itens.filter((i) => i.chamadas_estimadas === 0) ?? [];
  const [bulkBusy, setBulkBusy] = useState(false);

  /* ——— v0.11.0 (contrato 8): agrupamento POR TIPO de consulta — o mesmo aviso
     técnico e a mesma nota de custo iguais aparecem UMA vez por grupo, e as
     perguntas fora do alcance ficam em áreas expansíveis por tema. Nada executa
     sozinho: a aprovação continua INDIVIDUAL (mesmo comando da ficha). ——— */
  const nomePorLinha = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of linhas) {
      const nome = l.legalName ?? l.tradeName ?? null;
      if (nome) m.set(l.rowNumber, nome);
    }
    return m;
  }, [linhas]);
  const nomeDaLinha = useCallback(
    (item: { linha: number; cnpj_completo: string }) => nomePorLinha.get(item.linha) ?? formatCnpj(item.cnpj_completo),
    [nomePorLinha]
  );

  const gruposPlano = useMemo(() => {
    if (!plano) return [];
    const ordem: string[] = [];
    const mapa = new Map<string, PlanoConsultasV1["itens"]>();
    for (const item of plano.itens) {
      if (!mapa.has(item.fonte_candidata)) {
        mapa.set(item.fonte_candidata, []);
        ordem.push(item.fonte_candidata);
      }
      mapa.get(item.fonte_candidata)!.push(item);
    }
    return ordem.map((fonte) => {
      const itens = mapa.get(fonte)!;
      const chamadas = itens.reduce((s, i) => s + i.chamadas_estimadas, 0);
      const cacheReutilizavel = itens.length > 0 && itens.every((i) => i.cache_reutilizavel);
      const avisoComum = itens.every((i) => i.o_que_nao_resolve === itens[0].o_que_nao_resolve) ? itens[0].o_que_nao_resolve : null;
      return { fonte, itens, chamadas, cacheReutilizavel, avisoComum };
    });
  }, [plano]);

  const empresasNoPlano = useMemo(() => (plano ? new Set(plano.itens.map((i) => i.cnpj_completo)).size : 0), [plano]);

  const TEMA_LABEL: Record<string, string> = {
    identidade: "Identidade",
    estabelecimentos: "Estabelecimentos",
    relacoes_societarias: "Relações",
    regime_tributario: "Regime tributário",
    contabilidade_interna: "Contabilidade interna",
    tecnologia_erp: "Tecnologia/ERP",
  };
  const gruposFora = useMemo(() => {
    if (!plano) return [];
    const ordem: string[] = [];
    const mapa = new Map<string, PlanoConsultasV1["fora_do_escopo_api"]>();
    for (const f of plano.fora_do_escopo_api) {
      if (!mapa.has(f.pergunta_id)) {
        mapa.set(f.pergunta_id, []);
        ordem.push(f.pergunta_id);
      }
      mapa.get(f.pergunta_id)!.push(f);
    }
    return ordem.map((tema) => ({ tema, itens: mapa.get(tema)! }));
  }, [plano]);

  async function aprovarCustoZero() {
    setBulkBusy(true);
    setResultado(null);
    let ok = 0;
    let falha = 0;
    for (const item of custoZero) {
      const chave = `${item.linha}:${item.pergunta_id}`;
      setAprovando(chave);
      try {
        const res = await apiFetch(`/api/imports/${detail.id}/rows/${item.linha}/${endpointDoComando(item.comando_executor)}`, { method: "POST" });
        if (res.ok) ok++; else falha++;
      } catch {
        falha++;
      }
    }
    setAprovando(null);
    setBulkBusy(false);
    setResultado({ ok: falha === 0, msg: falha === 0 ? `${plural(ok, "consulta de custo 0 aprovada", "consultas de custo 0 aprovadas")} — plano atualizado.` : `${plural(ok, "aprovada", "aprovadas")}, ${falha} não puderam ser concluídas.` });
    void gerar();
  }

  return (
    <Collapsible
      open={aberto}
      onOpenChange={setAberto}
      className="rounded-[10px] border border-senior-cinza-300 bg-white"
      data-testid="plano-panel"
    >
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={aberto} data-testid="btn-plano">
          <span>
            <span className="ds-title-md block text-senior-azul">Plano de consultas — proposto</span>
            <span className="ds-caption mt-0.5 block text-senior-cinza-600">
              Consultas candidatas às fontes públicas organizadas com o custo de cada uma visível antes de aprovar. Nada executa sozinho.
            </span>
          </span>
          {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-senior-cinza-600" /> : <ChevronRight className="h-4 w-4 shrink-0 text-senior-cinza-600" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-senior-cinza-300 px-4 py-3">
        {loading && (
          <p className="ds-caption flex items-center gap-2 text-senior-cinza-600" data-testid="plano-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Organizando o plano a partir do que já foi coletado…
          </p>
        )}
        {erro && (
          <p className="ds-caption text-[#7A3A1E]" data-testid="plano-erro">
            {erro} Nada foi alterado.
          </p>
        )}
        {plano && (
          <div className="space-y-4" data-testid="plano-conteudo">
            {/* RESUMO COMPACTO (contrato 8): consultas · empresas · chamadas · grupos */}
            <div className="flex flex-wrap items-center gap-2" data-testid="plano-resumo">
              <span className="ds-caption font-semibold text-senior-azul">
                {plano.itens.length === 0
                  ? "Nenhuma consulta pendente por fonte estruturada."
                  : plural(plano.itens.length, "consulta proposta", "consultas propostas")}
              </span>
              {plano.itens.length > 0 && (
                <>
                  <Badge variant="outline" className="rounded-full border-senior-cinza-300 bg-white text-[13px] font-medium text-senior-cinza-600">
                    {plural(empresasNoPlano, "empresa", "empresas")} envolvida{empresasNoPlano === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-senior-cinza-300 bg-white text-[13px] font-medium text-senior-cinza-600">
                    {plural(plano.resumo.chamadas_totais, "chamada", "chamadas")} públicas no total
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-senior-cinza-300 bg-white text-[13px] font-medium text-senior-cinza-600">
                    {plural(gruposPlano.length, "grupo", "grupos")} por tipo
                  </Badge>
                </>
              )}
            </div>

            {plano.itens.length === 0 ? (
              <p className="ds-caption text-senior-cinza-600" data-testid="plano-vazio">
                O que ainda falta não depende de consulta a dados públicos — veja em “Investigar”, na ficha de cada empresa.
              </p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1 sn-scroll" data-testid="plano-itens">
                {gruposPlano.map((g, gi) => (
                  <div key={g.fonte} className="overflow-hidden rounded-[10px] border border-senior-cinza-300 bg-white" data-testid={`plano-grupo-${gi}`}>
                    {/* cabeçalho do grupo — a explicação comum e o custo do grupo aparecem UMA vez */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-senior-cinza-200 bg-[#F8FAF9] px-3 py-2">
                      <p className="min-w-0 text-[13px] font-semibold text-senior-azul">
                        {g.fonte}
                        <span className="ds-caption ml-2 font-normal text-senior-cinza-600">
                          {plural(g.itens.length, "consulta", "consultas")} · {plural(g.chamadas, "chamada", "chamadas")}
                          {g.cacheReutilizavel ? " · reaproveita descoberta já feita" : ""}
                        </span>
                      </p>
                    </div>
                    {g.avisoComum && (
                      <p className="border-b border-senior-cinza-200 bg-white px-3 py-2 ds-caption text-senior-cinza-500">
                        O que esta consulta NÃO resolve: {g.avisoComum}
                      </p>
                    )}
                    <div className="divide-y divide-[#F2F2F2]">
                      {g.itens.map((item, i) => {
                        const chave = `${item.linha}:${item.pergunta_id}`;
                        const bloqueado = item.bloqueios_ativos.length > 0;
                        const idxGlobal = plano.itens.indexOf(item);
                        return (
                          <div key={chave} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-3 py-2.5" data-testid={`plano-item-${idxGlobal}`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium leading-snug text-senior-azul">{item.pergunta}</p>
                              <p className="ds-caption mt-0.5 truncate text-senior-cinza-600" title={nomeDaLinha(item)}>
                                {nomeDaLinha(item)} · linha {item.linha} · {formatCnpj(item.cnpj_completo)}
                              </p>
                              {!g.avisoComum && <p className="ds-caption mt-1 text-senior-cinza-500">{item.o_que_nao_resolve}</p>}
                              {bloqueado && (
                                <p className="ds-caption mt-1 text-[#8a6d00]" data-testid={`plano-bloqueio-${idxGlobal}`}>
                                  Adiado para o fim do plano: a consulta está temporariamente indisponível (a última tentativa falhou) — executar agora seria insistir contra uma fonte fora do ar.
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2.5">
                              <span className="ds-caption whitespace-nowrap text-senior-cinza-600">
                                custo: <b className="font-semibold text-senior-azul">{plural(item.chamadas_estimadas, "chamada", "chamadas")}</b>
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 rounded-[8px] border-[#00968C]/40 text-[#006B63] hover:bg-[#00968C]/10"
                                disabled={aprovando !== null || bulkBusy}
                                onClick={() => setConfirmarItem(item)}
                                data-testid={`plano-aprovar-${idxGlobal}`}
                              >
                                {aprovando === chave ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                                Aprovar
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {custoZero.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 rounded-[8px] border-[#00968C]/40 text-[#006B63] hover:bg-[#00968C]/10" disabled={aprovando !== null || bulkBusy} onClick={() => void aprovarCustoZero()} data-testid="plano-aprovar-custo-zero">
                {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                Aprovar itens de custo 0 ({custoZero.length})
              </Button>
            )}

            {resultado && (
              <p className={`ds-caption ${resultado.ok ? "text-[#086B6B]" : "text-[#7A3A1E]"}`} data-testid="plano-resultado">
                {resultado.msg}
              </p>
            )}

            {/* perguntas fora do alcance — áreas expansíveis POR TEMA (contrato 8) */}
            {gruposFora.length > 0 && (
              <div data-testid="plano-fora">
                <p className="ds-caption font-semibold text-senior-cinza-600">
                  Fora do alcance de consulta por dados públicos ({plano.fora_do_escopo_api.length})
                </p>
                <div className="mt-2 space-y-1.5">
                  {gruposFora.map((t) => (
                    <Collapsible key={t.tema}>
                      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-[8px] border border-[#F2F2F2] bg-white px-2.5 py-1.5 text-left transition-colors hover:bg-[#F2F2F2]" data-testid={`plano-fora-trigger-${t.tema}`}>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-senior-cinza-600 transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
                        <span className="text-[13px] font-medium text-senior-azul">{TEMA_LABEL[t.tema] ?? t.tema}</span>
                        <span className="ds-caption text-senior-cinza-600">· {plural(t.itens.length, "pergunta", "perguntas")}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-1 space-y-1 border-l-2 border-[#F2F2F2] pl-3">
                          {t.itens.map((f, i) => (
                            <p key={`${f.linha}:${f.pergunta_id}:${i}`} className="ds-caption text-senior-cinza-600">
                              <b className="font-semibold text-senior-cinza-600">{f.cnpj_completo ? formatCnpj(f.cnpj_completo) : `linha ${f.linha}`}</b> — {f.motivo}
                            </p>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </div>
            )}

            <p className="ds-caption text-senior-cinza-500" data-testid="plano-gate">
              Cada aprovação usa o mesmo comando da ficha — 1 consulta por vez, com teto por rodada. O plano é regenerado após cada aprovação.
              <span className="ml-2 inline-flex items-center gap-2">
                <a href={`/api/imports/${detail.id}/plano?formato=json`} download className="underline hover:text-senior-azul" data-testid="plano-download-json">Baixar plano (.json)</a>
                <a href={`/api/imports/${detail.id}/plano?formato=jsonl`} download className="underline hover:text-senior-azul" data-testid="plano-download-jsonl">(.jsonl)</a>
              </span>
            </p>
          </div>
        )}
      </CollapsibleContent>

      <AlertDialog open={confirmarItem !== null} onOpenChange={(o) => !o && setConfirmarItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar esta consulta?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmarItem ? (
                <>
                  {confirmarItem.pergunta} — {formatCnpj(confirmarItem.cnpj_completo)}. Custo: {plural(confirmarItem.chamadas_estimadas, "chamada", "chamadas")}
                  {confirmarItem.chamadas_nota ? ` — ${confirmarItem.chamadas_nota}` : ""}. A consulta usa o mesmo comando da ficha e consulta fontes públicas oficiais.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="plano-cancelar">Agora não</AlertDialogCancel>
            <AlertDialogAction className="sn-btn-verde" onClick={() => confirmarItem && void aprovar(confirmarItem)} data-testid="plano-confirmar">
              Aprovar consulta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Collapsible>
  );
}

/** Progresso consolidado da fila de pesquisa por seleção — per/conta fica na coluna Scout. */
function FilaPesquisaPanel({ fila, onParar, onRetomar }: { fila: ResearchQueueView; onParar: () => void; onRetomar: () => void }) {
  const meta = FILA_ESTADO_LABEL[fila.estado];
  const Icon = meta.icon;
  const processadas = Math.min(fila.posicao, fila.total);
  const pendentes = Math.max(0, fila.total - processadas);
  const pct = fila.total > 0 ? Math.min(100, Math.round((processadas / fila.total) * 100)) : 0;
  return (
    <div
      className="glass-chip relative mt-[25px] overflow-hidden rounded-[14px] border border-[#BFE3DB] p-4"
      data-testid="fila-pesquisa-panel"
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F6F2]">
            <Icon className={`h-4 w-4 ${fila.estado === "RODANDO" ? "animate-spin text-[#086B6B]" : meta.tone}`} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="ds-title-md text-senior-azul">
              <span data-testid="fila-estado">{meta.label}</span>
              {" · "}
              <span data-testid="fila-progresso" className="tabular-nums">{processadas} de {fila.total} contas concluídas</span>
            </p>
            <p className="ds-caption text-senior-cinza-600">
              {fila.concluidas} com dossiê pronto · {fila.puladas} já estavam prontas · {fila.falhas} sem sucesso · {pendentes} na fila
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fila.estado === "RODANDO" && (
            <Button variant="outline" size="sm" className="h-8 rounded-[8px] border-[#8a6d0055] text-[#8a6d00] hover:bg-[#FFC51133]" onClick={onParar} data-testid="fila-parar">
              <Square className="h-3.5 w-3.5" /> Interromper
            </Button>
          )}
          {(fila.estado === "PAUSADA" || fila.estado === "PARADA") && pendentes > 0 && (
            <Button size="sm" className="sn-btn-verde h-8" onClick={onRetomar} data-testid="fila-retomar">
              <Play className="h-3.5 w-3.5" /> Retomar pendências
            </Button>
          )}
        </div>
      </div>
      <Progress value={pct} className="mt-3 h-2" aria-label={`Progresso da fila: ${pct}%`} data-testid="fila-progress-bar" />
      {fila.motivoPausa && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B5426]" data-testid="fila-motivo">
          {fila.motivoPausa}
        </p>
      )}
    </div>
  );
}

export interface BatchFilterPatch {
  cnpj?: string;
  lookup?: string;
  resolucao?: string;
  pesquisa?: string;
}

export function BatchDetailCard({
  detail,
  rows,
  pagination,
  events,
  busy,
  retryingRow,
  retryingAiRow,
  retryAllBusy,
  summaryBusy,
  summaryError,
  decidingRow,
  kindFilter,
  outcomeFilter,
  situationFilter,
  search,
  onSearchChange,
  onProcess,
  onRetryRow,
  onRetryAiRow,
  onRetryAiAll,
  onBatchSummary,
  onDecideRow,
  onDeepResearch,
  deepResearchingRow,
  onFilaPesquisa,
  pesquisaFilter,
  canExport,
  onPageChange,
  onFilterChange,
  initialDossierRow,
  revalidatingRow,
  onRevalidateRow,
}: {
  detail: BatchDetail;
  rows: RowDetail[];
  pagination: Pagination | null;
  events: AuditEventView[];
  busy: boolean;
  retryingRow: number | null;
  retryingAiRow: number | null;
  retryAllBusy: boolean;
  summaryBusy: boolean;
  summaryError: string | null;
  decidingRow: number | null;
  kindFilter: string;
  outcomeFilter: string;
  situationFilter: string;
  search: string;
  onSearchChange: (v: string) => void;
  onProcess: () => void;
  onRetryRow: (rowNumber: number) => void;
  onRetryAiRow: (rowNumber: number) => void;
  onRetryAiAll: () => void;
  onBatchSummary: () => void;
  onDecideRow: (rowNumber: number, body: DecideRequest) => void;
  /** Pesquisa profunda da conta (nível 2): site oficial + buscas + síntese com modelo de dossiê */
  onDeepResearch: (rowNumber: number, modo?: "COMPLETO" | "ADAPTATIVO") => void;
  deepResearchingRow: number | null;
  /** Mesa de Contas: fila de pesquisa profunda das contas selecionadas (v0.9.0) */
  onFilaPesquisa: (acao: "iniciar" | "parar" | "retomar", rowNumbers: number[], modo?: "COMPLETO" | "ADAPTATIVO") => void;
  pesquisaFilter: string;
  canExport: boolean;
  onPageChange: (p: number) => void;
  onFilterChange: (patch: BatchFilterPatch) => void;
  /** Deep link ?empresa=N: abre o dossiê desta linha quando o lote carregar. */
  initialDossierRow?: number | null;
  /** v0.10.0: revalidação manual da ficha cadastral da linha (força consulta real) */
  revalidatingRow: number | null;
  onRevalidateRow: (rowNumber: number) => void;
}) {
  // Fase 6: a expansão inline saiu — o dossiê em Sheet é a única expansão (ver expanded removido)
  const [dossierRowNumber, setDossierRowNumber] = useState<number | null>(initialDossierRow ?? null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Mesa de Contas: modo de coleta da fila (COMPLETO = pipeline integral; ADAPTATIVO = experimental)
  const [filaModo, setFilaModo] = useState<"COMPLETO" | "ADAPTATIVO">("COMPLETO");
  // Fase 1.3: SEM ordenação por score — a fila volta à ordem padrão (linha da planilha)
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [tableFlash, setTableFlash] = useState(false);

  // dossiê derivado da linha atual: atualiza sozinho quando os dados mudam
  // (ex.: leitura regenerada) e fecha se a linha sai da prévia
  const dossierRow = dossierRowNumber != null ? rows.find((x) => x.rowNumber === dossierRowNumber) ?? null : null;

  /* ————— v0.10.18: ESTAÇÃO DE TRABALHO — Lista | Dividido | Foco ————— */
  // Mesmos componentes, três apresentações. Em telas largas a mesa e a ficha
  // vivem num grupo de painéis redimensionável (react-resizable-panels v3);
  // em telas estreitas a ficha volta para a sobreposição (Sheet).
  const { prefs, atualizar: atualizarPrefs, restaurarPadrao: restaurarVisualizacao } = useScoutUi();
  const modoVisual = prefs.modo;
  const setModoVisual = useCallback((m: ModoVisual) => atualizarPrefs({ modo: m }), [atualizarPrefs]);
  const telaLarga = useLarguraMinima(1024); // estimativa inicial (janela) até o contêiner reportar
  // v0.11.0 (contrato 4.B): a divisão responde à largura do CONTÊINER real da mesa
  // (ResizeObserver) — com a barra lateral do ChatGPT aberta a área útil encolhe e
  // a mesa passa a priorizar UM painel legível, sem espremer dois.
  const secaoMesaRef = useRef<HTMLElement | null>(null);
  const larguraMesa = useLarguraConteiner(secaoMesaRef);
  const podeDividir = larguraMesa > 0 ? larguraMesa >= 980 : telaLarga;
  // v0.11.2 (UX da mesa): painel da lista estreito (Dividido com arraste, telas
  // médias) troca a tabela comprimida por LINHAS COMPACTAS — nome, identificação,
  // situação e ação sem rolagem horizontal; detalhes secundários ficam na ficha.
  const [resetPaineis, setResetPaineis] = useState(0);
  const panelListaRef = useRef<ImperativePanelHandle | null>(null);
  const panelFichaRef = useRef<ImperativePanelHandle | null>(null);
  // v0.11.0 (contrato 4): distribuição inicial ≈ 32/68 — a lista navega, a ficha lê.
  const ultimaListaPct = useRef(32);
  const ajustandoRef = useRef(false);
  const usarSplit = podeDividir;
  const splitAtivo = usarSplit && modoVisual !== "lista";

  // modos são tamanhos de painel: a lista e a ficha NUNCA remontam ao trocar
  // (sem nova consulta externa, sem perder seleção, filtros ou rolagem)
  useEffect(() => {
    if (!usarSplit) return;
    // v0.10.18: Foco sem ficha aberta não existe — sem empresa selecionada,
    // o modo volta para Dividido (a lista nunca fica inacessível)
    if (modoVisual === "foco" && dossierRowNumber == null) {
      setModoVisual("dividido");
      return;
    }
    const lista = panelListaRef.current;
    const ficha = panelFichaRef.current;
    if (!lista || !ficha) return;
    ajustandoRef.current = true;
    if (modoVisual === "foco") {
      lista.collapse();
      ficha.expand();
      ficha.resize(100);
    } else if (modoVisual === "lista") {
      ficha.collapse();
      lista.expand();
      lista.resize(100);
    } else {
      // v0.10.18: painel recolhido não absorve resize — expand() primeiro
      lista.expand();
      ficha.expand();
      const pct = Math.min(72, Math.max(24, ultimaListaPct.current || 32));
      lista.resize(pct);
      ficha.resize(100 - pct);
    }
    const t = window.setTimeout(() => {
      ajustandoRef.current = false;
    }, 300);
    return () => window.clearTimeout(t);
  }, [usarSplit, modoVisual, dossierRowNumber]);

  // abrir uma empresa no modo Lista entra no Dividido — a lista continua à mão
  const abrirDossier = (n: number) => {
    setDossierRowNumber(n);
    if (telaLarga && modoVisual === "lista") setModoVisual("dividido");
  };

  // v0.11.2 (UX da mesa): cliques do USUÁRIO marcam seleção manual (estado, não ref —
  // render decide com valores atuais) — a auto-seleção de resultado único nunca
  // sobrescreve a escolha de quem usa.
  const [selecaoManual, setSelecaoManual] = useState(false);
  const [autoAbertoLote, setAutoAbertoLote] = useState<string | null>(null); // lote já auto-aberto: fechar depois NÃO reabre
  const abrirDossierManual = (n: number) => {
    setSelecaoManual(true);
    abrirDossier(n);
  };

  // v0.11.1 (Gate 4 — investigação reversa): dossiê da pessoa abrir/fechar.
  // "Ver na mesa" FECHA o dossiê antes de abrir a ficha da empresa: fechamento
  // inequívoco (a ficha assume a tela — nunca fica escondida atrás do dossiê).
  // O retorno ao contexto da pessoa é o botão "Dossiê da pessoa" no painel de
  // relações (estado da mesa, buscas e filtros preservados).
  const [pessoaAberta, setPessoaAberta] = useState<string | null>(null);
  const abrirEmpresaDaPessoa = (n: number) => {
    setPessoaAberta(null);
    abrirDossier(n);
  };

  // fechar devolve o foco para a linha da lista (teclado funciona sem perder o lugar)
  const fecharDossier = () => {
    const n = dossierRowNumber;
    setDossierRowNumber(null);
    requestAnimationFrame(() => {
      if (n == null) return;
      const alvo = document.querySelector<HTMLElement>(`[data-testid="scout-open-${n}"]`);
      alvo?.scrollIntoView({ block: "nearest" });
      alvo?.focus();
    });
  };

  const indiceDossier = dossierRow ? rows.findIndex((x) => x.rowNumber === dossierRow.rowNumber) : -1;
  const navFicha: NavFicha | undefined = usarSplit && dossierRow
    ? {
        emFoco: modoVisual === "foco",
        posicao: indiceDossier >= 0 ? indiceDossier + 1 : null,
        total: rows.length,
        onAnterior: () => {
          if (indiceDossier > 0) abrirDossierManual(rows[indiceDossier - 1].rowNumber);
        },
        onProxima: () => {
          if (indiceDossier >= 0 && indiceDossier < rows.length - 1) abrirDossierManual(rows[indiceDossier + 1].rowNumber);
        },
        onVoltarLista: () => setModoVisual("dividido"),
        onAlternarFoco: () => setModoVisual(modoVisual === "foco" ? "dividido" : "foco"),
      }
    : undefined;

  const restaurarVisualizacaoPadrao = () => {
    // limpa os tamanhos salvos dos painéis e volta ao layout de fábrica
    try {
      const chaves: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.includes(CHAVE_PAINEL_MESA)) chaves.push(k);
      }
      chaves.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      // sem armazenamento: só o estado em memória volta ao padrão
    }
    ultimaListaPct.current = 32;
    setModoVisual("dividido");
    setResetPaineis((k) => k + 1);
  };

  const MODOS: { valor: ModoVisual; label: string; icone: typeof ListIcon; titulo: string }[] = [
    { valor: "lista", label: "Lista", icone: ListIcon, titulo: "Só a lista de empresas" },
    { valor: "dividido", label: "Dividido", icone: Columns2, titulo: "Lista e ficha lado a lado" },
    { valor: "foco", label: "Foco", icone: Maximize2, titulo: "Ficha em destaque para leitura" },
  ];

  /* ————— v0.10.19: TABELA DE TRABALHO — visão, colunas e ordenação ————— */
  const visaoDetalhada = prefs.visaoTabela === "detalhada";
  const colunas = prefs.colunas;
  const ordenacao = prefs.ordenacao;
  // a ordenação rearranja a página atual SEM refazer consultas (server-side
  // pagination intacta); a ordem padrão é a linha da planilha
  const linhasVisiveis = useMemo(() => {
    if (ordenacao === "padrao") return rows;
    const copia = [...rows];
    copia.sort((a, b) => {
      if (ordenacao === "empresa") {
        const na = (a.legalName ?? a.tradeName ?? `~${a.rowNumber}`).toLocaleLowerCase("pt-BR");
        const nb = (b.legalName ?? b.tradeName ?? `~${b.rowNumber}`).toLocaleLowerCase("pt-BR");
        return na.localeCompare(nb, "pt-BR");
      }
      const la = [a.uf ?? "", a.municipality ?? ""].join("/").toLocaleLowerCase("pt-BR");
      const lb = [b.uf ?? "", b.municipality ?? ""].join("/").toLocaleLowerCase("pt-BR");
      return la.localeCompare(lb, "pt-BR") || a.rowNumber - b.rowNumber;
    });
    return copia;
  }, [rows, ordenacao]);

  const alternarOrdenacao = (campo: "empresa" | "localizacao") => {
    atualizarPrefs({ ordenacao: ordenacao === campo ? "padrao" : campo });
  };

  // v0.10.19 — filtros rápidos com contagem (a contagem é do LOTE inteiro,
  // nunca da página): Todas | Dossiês | Identificadas | Revisar | Na fila | Falhas
  // v0.11.3 (missão Lotes+Mesa): CADA botão aplica o CONJUNTO COMPLETO de filtros
  // que define a sua contagem — o número do botão e a tabela filtrada contam
  // sempre o mesmo conjunto (nenhum botão herda um filtro de outro).
  const nIdentificadas = detail.totalConfirmed + detail.totalDirectCnpj;
  const FILTROS_RAPIDOS: { valor: string; label: string; n: number; ativo: boolean; aplicar: () => void }[] = [
    {
      valor: "todas",
      label: "Todas",
      n: detail.rowCount,
      ativo: situationFilter === "ALL" && outcomeFilter === "ALL" && pesquisaFilter === "ALL",
      aplicar: () => onFilterChange({ resolucao: "ALL", lookup: "ALL", pesquisa: "ALL" }),
    },
    {
      // v0.11.3: população da MESA — dossiês prontos (pesquisa+síntese+cadastro+
      // identidade sem bloqueio). O contador é o canônico do servidor
      // (pesquisaProfunda.dossiesProntos) e o filtro é o mesmo DOSSIE_PRONTO_WHERE:
      // botão e tabela NUNCA divergem.
      valor: "dossies",
      label: "Dossiês",
      n: detail.pesquisaProfunda.dossiesProntos,
      ativo: situationFilter === "ALL" && outcomeFilter === "ALL" && pesquisaFilter === "dossie_pronto",
      aplicar: () => onFilterChange({ resolucao: "ALL", lookup: "ALL", pesquisa: "dossie_pronto" }),
    },
    {
      valor: "identificadas",
      label: "Identificadas",
      n: nIdentificadas,
      ativo: situationFilter === "CONFIRMED",
      aplicar: () => onFilterChange({ resolucao: "CONFIRMED", lookup: "ALL", pesquisa: "ALL" }),
    },
    {
      valor: "revisar",
      label: "Revisar",
      n: detail.totalReview,
      ativo: situationFilter === "REVIEW",
      aplicar: () => onFilterChange({ resolucao: "REVIEW", lookup: "ALL", pesquisa: "ALL" }),
    },
    {
      valor: "pendentes",
      label: "Na fila",
      // v0.11.0 (Gate 3/C): mesma população do filtro FILA que o botão aplica —
      // totalPending (usado no hint "X de Y concluídas") inclui falhas recuperáveis.
      n: detail.totalFila,
      ativo: situationFilter === "ALL" && outcomeFilter === "FILA",
      aplicar: () => onFilterChange({ resolucao: "ALL", lookup: "FILA", pesquisa: "ALL" }),
    },
    {
      valor: "falhas",
      label: "Falhas",
      n: detail.totalFalhasConsulta,
      ativo: situationFilter === "ALL" && outcomeFilter === "FALHAS",
      aplicar: () => onFilterChange({ resolucao: "ALL", lookup: "FALHAS", pesquisa: "ALL" }),
    },
  ];

  // trocou o lote em tela: zera seleção (ajuste durante o render — padrão React)
  const [prevBatchId, setPrevBatchId] = useState(detail.id);
  // v0.11.0 (Gate 6): no estado de INVESTIGAÇÃO (lote concluído) o resumo do lote
  // recolhe para UMA LINHA — a primeira dobra pertence à mesa. Os cards completos
  // (com as 8 leituras nos hints) abrem sob comando e voltam a fechar ao trocar de lote.
  const [resumoExpandido, setResumoExpandido] = useState(false);
  if (prevBatchId !== detail.id) {
    setPrevBatchId(detail.id);
    setSelected(new Set());
    setResumoExpandido(false);
  }

  // REGRA DA JORNADA: "Revisar identificação" nunca fica preso quando não existe
  // mais nada nesse estado — senão a prévia aparece vazia após a revisão
  useEffect(() => {
    if (canExport && situationFilter === "REVIEW" && detail.totalReview === 0) {
      onFilterChange({ resolucao: "ALL" });
    }
  }, [canExport, situationFilter, detail.totalReview, onFilterChange]);

  const viewResults = () => {
    // v0.10.17: o alvo tem scroll-mt-24 — o cabeçalho fixo (72px) nunca encobre o título
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTableFlash(true);
    window.setTimeout(() => setTableFlash(false), 1800);
  };

  // v0.11.3 (missão Lotes+Mesa): retorno da MESA para a área LOTES — rola até a
  // faixa de acompanhamento (entradas → identificadas → revisão → pesquisa → dossiês).
  // Navegação SEM EFEITO COLATERAL: nenhuma consulta, nenhum filtro, nenhuma fila.
  const acompanharLotes = () => {
    document.querySelector('[data-testid="lotes-acompanhamento"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectedList = [...selected].sort((a, b) => a - b);
  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.rowNumber));
  const toggleAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) rows.forEach((r) => next.delete(r.rowNumber));
      else rows.forEach((r) => next.add(r.rowNumber));
      return next;
    });
  };
  const toggleOne = (n: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(n);
      else next.delete(n);
      return next;
    });
  };

  // v0.10.8 (coerência de estados): CONFIRMED NÃO é execução — nada consulta antes
  // do clique em "Iniciar agora". `active` só fica true com PROCESSING ou lease vivo.
  const active = detail.status === "PROCESSING" || detail.processingNow;
  const aguardandoInicio = detail.status === "CONFIRMED" && !detail.processingNow;
  const processable = detail.totalValid + detail.totalReference;
  const coverage = processable > 0 ? Math.min(100, Math.round((detail.totalEnriched / processable) * 100)) : 0;
  // identificadas = confirmadas pela resolução + entradas que já vieram com CNPJ válido e concluíram
  const identificadas = detail.totalConfirmed + detail.totalDirectCnpj;
  // v0.10.15 (reconciliação): as 8 leituras do lote ficam explícitas nos hints —
  // entradas × processadas × aguardando × localizadas × compatíveis × revisão × validadas × falhas
  const processadas = Math.max(0, processable - detail.totalPending);
  // v0.10.17 (contrato de linguagem): "24 de 24 consultas concluídas" — progresso
  // em um par de números coerente; nada de "processada(s) · 0 aguardando execução".
  const hintEntradas = processable > 0
    ? `${processadas} de ${processable} consultas concluídas${detail.totalInvalid > 0 ? ` · ${detail.totalInvalid} sem CNPJ utilizável` : ""}`
    : "A consulta começa quando você iniciar o lote";
  // v0.10.17 (rótulo × cálculo): o número é de RAÍZES DISTINTAS (empresas), não de
  // CNPJs — matriz e filiais da mesma raiz são UMA empresa. O rótulo diz o que conta.
  const hintIdentificadas = detail.totalReview > 0
    ? `${plural(detail.totalPessoasJuridicasLocalizadas, "empresa", "empresas")} localizadas no total · ${detail.totalReview} aguardando a sua revisão${detail.totalValidado > 0 ? ` · ${plural(detail.totalValidado, "validada", "validadas")} por você` : ""}`
    : `${plural(identificadas, "linha", "linhas")} com coleta concluída${detail.totalValidado > 0 ? ` · ${plural(detail.totalValidado, "validada", "validadas")} por você` : ""}`;
  const hintNaoIdentificadas = detail.totalFalhasConsulta > 0
    ? `inclui ${detail.totalFalhasConsulta} com falha de consulta (tentar de novo disponível)`
    : undefined;
  // v0.11.2 (UX da mesa): resultado único concluído NÃO deixa o painel da ficha
  // vazio — a conta é apresentada automaticamente UMA VEZ por lote (ajuste durante
  // o render, mesmo padrão do bloco prevBatchId acima; converge sem cascata). A
  // abertura é LEITURA do já coletado — nenhuma consulta externa dispara — e a
  // escolha manual (selecaoManual) nunca é sobrescrita; fechar depois do auto-abrir
  // NÃO reabre (autoAbertoLote = id do lote).
  if (
    canExport && !active &&
    rows.length === 1 && (pagination?.total == null || pagination.total === 1) &&
    !selecaoManual && dossierRowNumber == null && autoAbertoLote !== detail.id
  ) {
    setAutoAbertoLote(detail.id);
    setDossierRowNumber(rows[0].rowNumber);
  }
  const showProcessBtn = detail.status === "CONFIRMED" || detail.status === "FAILED" || (detail.status === "PARTIAL" && detail.totalPending > 0);
  // v0.10.8 (P1 — ações elegíveis): a pesquisa profunda só faz sentido para contas
  // com cadastro concluído. O que a UI sabe das linhas visíveis define o estado do botão;
  // o servidor continua validando cada rowNumber (a UI nunca é a guarda final).
  const selecaoInfo = (() => {
    let prontas = 0;
    let aguardando = 0;
    for (const n of selectedList) {
      const r = rows.find((x) => x.rowNumber === n);
      if (!r) continue; // linha de outra página — o servidor valida
      if (r.lookupStatus === "ENRIQUECIDO") prontas++;
      else aguardando++;
    }
    return { prontas, aguardando, foraDestaPagina: selectedList.length - prontas - aguardando };
  })();
  const pesquisaElegivel = selecaoInfo.prontas > 0 || (selecaoInfo.foraDestaPagina > 0 && selecaoInfo.aguardando === 0);

  // v0.11.0: BARRA DA MESA — envolve TODA a estação (lista + ficha), fora dos painéis
  // v0.11.3 (missão Lotes+Mesa): o rótulo "MESA DE INVESTIGAÇÃO" subiu para o
  // cabeçalho da área (MesaIntro) — a barra fica só com os controles de trabalho.
  const mesaBarra = (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-senior-cinza-200 bg-white/50 px-3 py-1" data-testid="mesa-barra">
      {/* v0.11.0 (Gate 6): FILTROS RÁPIDOS na BARRA DA MESA (largura total) —
          antes viviam dentro da coluna estreita da lista (~420px no Dividido),
          quebravam em duas linhas e roubavam ~110px de empresas visíveis. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="Filtros rápidos" data-testid="filtros-rapidos">
        {FILTROS_RAPIDOS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={f.aplicar}
            aria-pressed={f.ativo}
            className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C] ${f.ativo ? "border-[#00968C66] bg-[#00968C14] text-[#086B6B]" : "border-senior-cinza-300 bg-white text-senior-cinza-600 hover:bg-[#F2F2F2]"}`}
            data-testid={`filtro-rapido-${f.valor}`}
          >
            {f.label}
            <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${f.ativo ? "bg-[#00968C26]" : "bg-[#F2F2F2]"}`}>{f.n}</span>
          </button>
        ))}
      </div>
      {/* v0.11.2 (adendo P0): progresso da PESQUISA PROFUNDA separado da identificação
          cadastral — as duas etapas nunca se confundem (estado, contagem e lugar) */}
      {detail.filaPesquisa && (detail.filaPesquisa.estado === "RODANDO" || detail.filaPesquisa.pendentes.length > 0) && (
        <span
          className="inline-flex h-6 items-center gap-1 rounded-full border border-senior-cinza-300 bg-white px-2 text-[12px] text-senior-cinza-600"
          data-testid="fila-resumo-barra"
          title="Pesquisa profunda (sob comando) — progresso da fila atual, separado da identificação cadastral"
        >
          {detail.filaPesquisa.estado === "RODANDO" ? <Loader2 className="h-3 w-3 animate-spin text-[#086B6B]" aria-hidden="true" /> : <Clock className="h-3 w-3" aria-hidden="true" />}
          Pesquisa profunda: {detail.filaPesquisa.concluidas}/{detail.filaPesquisa.concluidas + detail.filaPesquisa.pendentes.length}
          {detail.filaPesquisa.falhas > 0 ? ` · ${detail.filaPesquisa.falhas} com falha` : ""}
        </span>
      )}
      {/* v0.11.0 (Gate 6): hint só quando NÃO há ficha aberta — com empresa
          selecionada a dica já cumpriu seu papel e cada linha conta. */}
      {dossierRowNumber == null && (
        <span className="ds-caption text-senior-cinza-400" data-testid="preview-label">
          {aguardandoInicio ? "os resultados aparecem depois de iniciar a consulta" : "clique na empresa para abrir a ficha ao lado"}
        </span>
      )}
      <span className="min-w-2 flex-1" />
      {podeDividir && (
        <div
          role="group"
          aria-label="Modo de visualização"
          className="flex items-center gap-0.5 rounded-[8px] border border-senior-cinza-300 bg-white p-0.5"
          data-testid="modo-visual"
        >
          {MODOS.map((m) => {
            const Icone = m.icone;
            const ativo = modoVisual === m.valor;
            return (
              <button
                key={m.valor}
                type="button"
                onClick={() => setModoVisual(m.valor)}
                aria-pressed={ativo}
                title={m.titulo}
                className={`flex h-6 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C] ${ativo ? "bg-[#00968C14] text-[#086B6B]" : "text-senior-cinza-600 hover:bg-[#F2F2F2]"}`}
                data-testid={`modo-${m.valor}`}
              >
                <Icone className="h-3.5 w-3.5" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // v0.11.0: conteúdo da MESA — lista única com cabeçalho compacto; a superfície
  // (borda/vidro) pertence ao invólucro da estação; a auditoria saiu do painel.
  const mesaConteudo = (
    <div
      ref={tableRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden @container"
      data-testid="preview-table"
    >
      {/* CABEÇALHO COMPACTO DA LISTA — pesquisa e filtro principal em uma linha;
          ajustes secundários (visão, colunas, estado da pesquisa) no menu discreto (contrato 6) */}
      <div className="shrink-0 space-y-1.5 border-b border-senior-cinza-200 bg-white/60 px-3 py-1.5" data-testid="lista-cabecalho">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-senior-cinza-400" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar por empresa, CNPJ ou domínio…"
              className="h-8 rounded-[8px] border-senior-cinza-300 bg-white pl-9 text-sm placeholder:text-senior-cinza-400"
              aria-label="Buscar entradas"
              data-testid="search-input"
            />
            {search && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-senior-cinza-400 hover:bg-[#F2F2F2]"
                aria-label="Limpar busca"
                data-testid="search-clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* v0.10.12 (painel de decisões): o filtro de situação permanece como filtro principal */}
          <Select value={situationFilter} onValueChange={(v) => onFilterChange({ resolucao: v })}>
            <SelectTrigger className="h-8 w-32 shrink-0 rounded-[8px] border-senior-cinza-300 bg-white text-[13px]" aria-label="Filtrar por situação" data-testid="filter-situacao">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as situações</SelectItem>
              <SelectItem value="CONFIRMED">Identificadas</SelectItem>
              <SelectItem value="REVIEW">Revisar</SelectItem>
              <SelectItem value="UNRESOLVED">Não encontradas</SelectItem>
            </SelectContent>
          </Select>
          {/* Ajustes secundários em menu discreto (contrato 6): visão, colunas e pesquisa */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-senior-cinza-300 bg-white px-2.5 text-[13px] font-medium text-senior-cinza-600 transition-colors hover:bg-[#F2F2F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C]"
                aria-label="Ajustes da lista"
                data-testid="ajustes-lista"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Ajustes</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Visão da tabela</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => atualizarPrefs({ visaoTabela: "essencial", colunas: { localizacao: true, atividade: false, situacao: false, porte: false } })}
                data-testid="visao-essencial"
              >
                <span className="inline-flex w-4 justify-center">{!visaoDetalhada && <Check className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />}</span>
                <span className="flex-1">Essencial</span>
                <span className="ds-caption text-senior-cinza-400">colunas de trabalho</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => atualizarPrefs({ visaoTabela: "detalhada", colunas: { localizacao: true, atividade: true, situacao: true, porte: true } })}
                data-testid="visao-detalhada"
              >
                <span className="inline-flex w-4 justify-center">{visaoDetalhada && <Check className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" />}</span>
                <span className="flex-1">Detalhada</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={colunas.localizacao}
                onCheckedChange={(v) => atualizarPrefs({ colunas: { ...colunas, localizacao: v === true } })}
                data-testid="coluna-localizacao"
              >
                Localização
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={colunas.atividade}
                onCheckedChange={(v) => atualizarPrefs({ colunas: { ...colunas, atividade: v === true } })}
                data-testid="coluna-atividade"
              >
                Atividade cadastrada
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={colunas.situacao}
                onCheckedChange={(v) => atualizarPrefs({ colunas: { ...colunas, situacao: v === true } })}
                data-testid="coluna-situacao"
              >
                Situação cadastral
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={colunas.porte}
                onCheckedChange={(v) => atualizarPrefs({ colunas: { ...colunas, porte: v === true } })}
                data-testid="coluna-porte"
              >
                Porte
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={colunas.localizacao && !colunas.atividade && !colunas.situacao && !colunas.porte}
                onCheckedChange={() => atualizarPrefs({ colunas: { localizacao: true, atividade: false, situacao: false, porte: false } })}
                data-testid="colunas-restaurar"
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Padrão (só localização)
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {/* Mesa de Contas (v0.9.0): estado da PESQUISA por conta — agora no menu de ajustes */}
              {/* v0.11.3: "Dossiês prontos" usa o MESMO filtro canônico do filtro rápido
                  da barra (dossie_pronto = pesquisa+síntese+cadastro+identidade sem
                  bloqueio) — antes "Com dossiê pronto" contava só researchStatus OK,
                  uma população DIFERENTE do chip "Dossiês" da barra. */}
              <DropdownMenuLabel>Estado da pesquisa</DropdownMenuLabel>
              {[
                { v: "ALL", l: "Todas" },
                { v: "dossie_pronto", l: "Dossiês prontos" },
                { v: "gerando", l: "Pesquisando agora" },
                { v: "falhou", l: "Pesquisa falhou" },
                { v: "sem_pesquisa", l: "Sem pesquisa ainda" },
              ].map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.v}
                  checked={pesquisaFilter === o.v}
                  onCheckedChange={() => onFilterChange({ pesquisa: o.v })}
                  data-testid={`filter-pesquisa-${o.v}`}
                >
                  {o.l}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={restaurarVisualizacaoPadrao} data-testid="modo-restaurar">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restaurar visualização padrão
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* v0.10.19 — filtros rápidos movidos para a BARRA DA MESA (v0.11.0 Gate 6):
            contagem do lote inteiro em largura total, sem quebrar dentro da coluna da lista */}
        {selectedList.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-senior-cinza-200 pt-2" data-testid="lista-selecao">
            <span className="ds-caption font-medium text-[#086B6B]" data-testid="selection-count">{plural(selectedList.length, "selecionada", "selecionadas")}</span>
            {/* Mesa de Contas: pesquisa profunda APENAS das contas explicitamente selecionadas.
                v0.10.8 (P1 — ações elegíveis): o botão só habilita com conta(s) com cadastro
                concluído; a barra informa quantas estão prontas e quantas aguardam coleta. */}
            {!pesquisaElegivel && selecaoInfo.aguardando > 0 && (
              <span className="ds-caption text-senior-cinza-600" data-testid="pesquisa-inelegivel-hint">
                {selecaoInfo.aguardando} aguardando coleta cadastral
              </span>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="sn-btn-verde h-7 text-[12.5px]"
                  disabled={busy || !pesquisaElegivel}
                  title={pesquisaElegivel ? "Pesquisa profunda das contas selecionadas com cadastro concluído" : "Nenhuma conta selecionada tem cadastro concluído. Aguarde a coleta ou selecione contas prontas"}
                  data-testid="btn-pesquisar-selecionadas"
                >
                  <ListChecks className="h-3.5 w-3.5" /> Pesquisar selecionadas ({selecaoInfo.prontas} prontas de {selectedList.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Pesquisar {plural(selecaoInfo.prontas, "conta pronta", "contas prontas")}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cada conta pesquisada faz buscas públicas e leitura de páginas do site da empresa, seguidas da leitura com o modelo de dossiê.
                    As contas com dossiê fresco são puladas sem repetir chamadas. Você pode interromper a fila a qualquer momento sem perder o que já ficou pronto.
                    {selecaoInfo.aguardando > 0 && <b> {plural(selecaoInfo.aguardando, "conta selecionada", "contas selecionadas")} {selecaoInfo.aguardando === 1 ? "ainda aguarda coleta cadastral e fica" : "ainda aguardam coleta cadastral e ficam"} fora desta fila.</b>}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-1.5 py-1">
                  <p className="ds-caption font-medium text-senior-cinza-600">Modo de coleta:</p>
                  <label className="flex cursor-pointer items-start gap-2 rounded-[8px] border border-senior-cinza-300 p-2.5 text-[13px] hover:bg-[#F0F9F8] data-[state=checked]:border-[#00968C]" data-testid="modo-completo">
                    <input type="radio" name="fila-modo" checked={filaModo === "COMPLETO"} onChange={() => setFilaModo("COMPLETO")} className="mt-0.5 accent-[#00968C]" />
                    <span><strong className="text-senior-azul">Completa</strong> — pipeline integral de investigação (comportamento padrão; mais buscas).</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-[8px] border border-senior-cinza-300 p-2.5 text-[13px] hover:bg-[#F0F9F8]" data-testid="modo-adaptativo">
                    <input type="radio" name="fila-modo" checked={filaModo === "ADAPTATIVO"} onChange={() => setFilaModo("ADAPTATIVO")} className="mt-0.5 accent-[#00968C]" />
                    <span><strong className="text-senior-azul">Adaptativa</strong> — experimental: buscas dirigidas + extras só por lacuna, com motivo registrado. Menos chamadas; cobertura pode ser menor.</span>
                  </label>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="fila-cancel">Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="sn-btn-verde"
                    onClick={() => onFilaPesquisa("iniciar", selectedList, filaModo)}
                    data-testid="fila-confirm"
                  >
                    Confirmar {plural(selectedList.length, "conta", "contas")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <button
              className="ds-caption text-senior-cinza-600 underline underline-offset-2 hover:text-senior-azul"
              onClick={() => setSelected(new Set())}
              data-testid="selection-clear"
            >
              limpar
            </button>
          </div>
        )}
      </div>

      {/* v0.11.3 (missão Lotes+Mesa): MESA VAZIA — nenhum dossiê pronto neste lote.
          Estado honesto com próximos passos; a lista continua abaixo (nada desaparece). */}
      {canExport && detail.pesquisaProfunda.dossiesProntos === 0 && (
        <div className="shrink-0 px-3 pt-2.5">
          <MesaEmptyState detail={detail} onAcompanharLotes={acompanharLotes} onVerTodas={() => {
            onFilterChange({ cnpj: "ALL", lookup: "ALL", resolucao: "ALL", pesquisa: "ALL" });
            onSearchChange("");
          }} />
        </div>
      )}

      {/* TABELA — a ÚNICA rolagem interna do painel da lista (contrato 9):
          header sticky; sem max-h próprio — a altura vem do painel da estação.
          P1-08: o contêiner interno do Table (overflow-x-auto) criaria um segundo scroll
          e quebraria o sticky; o scroll dos 2 eixos fica no wrap de fora ([data-slot] override). */}
      {/* v0.11.2: DUAS apresentações SEMPRE montadas, escolhidas por CONTAINER QUERY
          (@container no mesaConteudo) — a decisão é da largura REAL da coluna da lista
          (funciona durante o arrasto do Dividido, sem medição JS): abaixo de 900px de
          coluna, linhas compactas (nunca rolagem horizontal); a partir de 900px, tabela. */}
        <div className="cnpj-scroll min-h-0 flex-1 overflow-y-auto @min-[900px]:hidden" data-testid="rows-compacta">
          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="empty-rows">
              <Inbox className="h-8 w-8 text-senior-cinza-300" aria-hidden="true" />
              <p className="ds-body text-senior-cinza-600">Nenhuma conta com este filtro.</p>
              {(kindFilter !== "ALL" || outcomeFilter !== "ALL" || situationFilter !== "ALL" || pesquisaFilter !== "ALL" || search) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-[8px] border-senior-cinza-300 text-senior-azul hover:bg-[#F2F2F2]"
                  onClick={() => {
                    onFilterChange({ cnpj: "ALL", lookup: "ALL", resolucao: "ALL", pesquisa: "ALL" });
                    onSearchChange("");
                  }}
                  data-testid="clear-filters"
                >
                  Ver todas as contas
                </Button>
              )}
            </div>
          )}
          {linhasVisiveis.map((r) => {
            const situ = rowSituation(r, { loteEmExecucao: active });
            return (
              <div
                key={r.rowNumber}
                role="button"
                tabIndex={0}
                onClick={() => abrirDossierManual(r.rowNumber)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirDossierManual(r.rowNumber); } }}
                className="group cursor-pointer border-b border-senior-cinza-200/70 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-[#00968C0A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00968C]"
                data-testid={`data-row-${r.rowNumber}`}
                aria-label={`Abrir dossiê de ${r.legalName ?? `linha ${r.rowNumber}`}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(r.rowNumber)}
                      onCheckedChange={(v) => toggleOne(r.rowNumber, v === true)}
                      aria-label={`Selecionar ${r.legalName ?? `linha ${r.rowNumber}`}`}
                      data-testid={`select-row-${r.rowNumber}`}
                    />
                  </span>
                  <CompanyAvatar name={r.legalName ?? r.tradeName ?? null} />
                  <span className="block min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="ds-body min-w-0 flex-1 truncate font-semibold text-senior-azul" title={r.legalName ?? undefined}>
                        {r.legalName ?? (r.cnpjStatus === "INVALIDA" ? "CNPJ inválido" : r.cnpjStatus === "DUPLICADA" ? `Repetida da linha ${r.duplicateOf ?? "anterior"}` : "—")}
                      </span>
                      <SituationBadge s={situ} testId={`situation-badge-${r.rowNumber}`} />
                    </span>
                    <span className="ds-caption mt-0.5 flex min-w-0 items-center gap-1.5 text-senior-cinza-600">
                      <span className="truncate">
                        {r.resolvedCnpj ? formatCnpj(r.resolvedCnpj) : (r.entrada ?? r.referenceValue ?? (r.rawCnpj ? formatCnpj(r.rawCnpj) : "pista —"))}
                        {r.foundIsHeadquarters === false && r.headquartersCnpj ? ` · filial de ${formatCnpj(r.headquartersCnpj)}` : ""}
                      </span>
                      <RegistrationAlertBadge r={r} />
                    </span>
                  </span>
                  <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    {r.aiStatus === "OK" ? (
                      <RowAction onClick={() => abrirDossierManual(r.rowNumber)} title="Abrir leitura Scout 360" testId={`scout-open-${r.rowNumber}`}>
                        <Sparkles className="h-3.5 w-3.5" /> Análise
                      </RowAction>
                    ) : situ.key === "LOCALIZADO" ? (
                      <RowAction onClick={() => abrirDossierManual(r.rowNumber)} title="Revisar a identificação desta conta" testId={`action-review-${r.rowNumber}`}>
                        <CircleAlert className="h-3.5 w-3.5" /> Revisar
                      </RowAction>
                    ) : (
                      <ChevronDown className="h-4 w-4 text-senior-cinza-400" aria-hidden="true" />
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      <div
        className="hidden cnpj-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden @min-[900px]:block [&_[data-slot=table-container]]:overflow-x-visible"
        data-testid="rows-table-wrap"
      >
          <Table>
            {/* P1-08: header acima das células sticky do corpo (z-20 > z-10) — o canto superior esquerdo não é coberto */}
            <TableHeader className="sticky top-0 z-20">
              {/* P1-08: só os th NÃO-fixos ficam transparentes (3+) — os 2 sticky precisam do bg sólido deles mesmos */}
              <TableRow className="glass-strong border-b-0 hover:bg-transparent shadow-[inset_0_-1px_0_#DCE9E6] [&>th:nth-child(n+3)]:bg-transparent">
                <TableHead className="sticky left-0 z-10 w-10 bg-white pr-0">
                  <Checkbox
                    checked={allPageSelected ? true : selectedList.length > 0 && rows.some((r) => selected.has(r.rowNumber)) ? "indeterminate" : false}
                    onCheckedChange={() => toggleAllPage()}
                    aria-label="Selecionar contas visíveis"
                    data-testid="select-all"
                  />
                </TableHead>
                <TableHead className="ds-caption sticky left-10 z-10 min-w-44 bg-white text-senior-cinza-600 shadow-[inset_-1px_0_0_#DCE9E6]">
                  <button
                    type="button"
                    onClick={() => alternarOrdenacao("empresa")}
                    className="inline-flex items-center gap-1 transition-colors hover:text-senior-azul focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C] rounded"
                    aria-label={ordenacao === "empresa" ? "Empresa: ordem alfabética ativa. Clique para voltar à ordem da planilha" : "Ordenar por empresa (A a Z)"}
                    data-ordenacao={ordenacao === "empresa" ? "asc" : "nenhuma"}
                    data-testid="ordena-empresa"
                  >
                    Empresa
                    {ordenacao === "empresa" ? <ArrowDownAZ className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" /> : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </TableHead>
                <TableHead className="ds-caption min-w-36 text-senior-cinza-600">Identificação</TableHead>
                {colunas.localizacao && (
                  <TableHead className="ds-caption hidden text-senior-cinza-600 md:table-cell">
                    <button
                      type="button"
                      onClick={() => alternarOrdenacao("localizacao")}
                      className="inline-flex items-center gap-1 transition-colors hover:text-senior-azul focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C] rounded"
                      aria-label={ordenacao === "localizacao" ? "Localização: ordem alfabética ativa. Clique para voltar à ordem da planilha" : "Ordenar por localização"}
                      data-ordenacao={ordenacao === "localizacao" ? "asc" : "nenhuma"}
                      data-testid="ordena-localizacao"
                    >
                      Localização
                      {ordenacao === "localizacao" ? <ArrowDownAZ className="h-3.5 w-3.5 text-[#086B6B]" aria-hidden="true" /> : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                    </button>
                  </TableHead>
                )}
                {colunas.atividade && <TableHead className="ds-caption min-w-32 text-senior-cinza-600">Atividade cadastrada</TableHead>}
                {colunas.situacao && <TableHead className="ds-caption min-w-24 text-senior-cinza-600">Situação cadastral</TableHead>}
                {colunas.porte && <TableHead className="ds-caption min-w-20 text-senior-cinza-600">Porte</TableHead>}
                <TableHead className="ds-caption min-w-32 text-senior-cinza-600">Próxima ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2 + (colunas.localizacao ? 1 : 0) + (colunas.atividade ? 1 : 0) + (colunas.situacao ? 1 : 0) + (colunas.porte ? 1 : 0) + 1}>
                    <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="empty-rows">
                      <Inbox className="h-8 w-8 text-senior-cinza-300" aria-hidden="true" />
                      <p className="ds-body text-senior-cinza-600">Nenhuma conta com este filtro.</p>
                      {(kindFilter !== "ALL" || outcomeFilter !== "ALL" || situationFilter !== "ALL" || pesquisaFilter !== "ALL" || search) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-[8px] border-senior-cinza-300 text-senior-azul hover:bg-[#F2F2F2]"
                          onClick={() => {
                            onFilterChange({ cnpj: "ALL", lookup: "ALL", resolucao: "ALL", pesquisa: "ALL" });
                            onSearchChange("");
                          }}
                          data-testid="clear-filters"
                        >
                          Ver todas as contas
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {linhasVisiveis.map((r) => {
                const situ = rowSituation(r, { loteEmExecucao: active });
                return (
                  <TableRow
                    key={r.rowNumber}
                    className="group cursor-pointer transition-all duration-200 hover:bg-[#00968C0A] hover:shadow-[inset_3px_0_0_0_#00968C]"
                    onClick={() => abrirDossierManual(r.rowNumber)}
                    title="Abrir dossiê da empresa"
                    data-testid={`data-row-${r.rowNumber}`}
                  >
                    <TableCell className="sticky left-0 z-10 w-10 bg-white pr-0 transition-colors duration-200 group-hover:bg-[#F0F9F8]" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(r.rowNumber)}
                        onCheckedChange={(v) => toggleOne(r.rowNumber, v === true)}
                        aria-label={`Selecionar ${r.legalName ?? `linha ${r.rowNumber}`}`}
                        data-testid={`select-row-${r.rowNumber}`}
                      />
                    </TableCell>
                    {/* P1-08: coluna Empresa fixa à esquerda (fundo branco sólido + hairline à direita);
                        hover do <tr> não atravessa o bg — a célula acompanha com o mesmo tom composto.
                        v0.10.12: a empresa recebe a situação cadastral (alerta) e o vínculo matriz/filial
                        na própria célula — a tabela ganha o CNPJ localizado sem coluna extra. */}
                    <TableCell className="sticky left-10 z-10 bg-white shadow-[inset_-1px_0_0_#DCE9E6] transition-colors duration-200 group-hover:bg-[#F0F9F8]">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <CompanyAvatar name={r.legalName ?? r.tradeName ?? null} />
                        <span className="block min-w-0">
                          {r.legalName ? (
                            <span className="ds-body block max-w-56 truncate font-semibold text-senior-azul" title={r.legalName}>{r.legalName}</span>
                          ) : r.cnpjStatus === "INVALIDA" ? (
                            <span className="ds-body text-senior-cinza-600">CNPJ inválido</span>
                          ) : r.cnpjStatus === "DUPLICADA" ? (
                            <span className="ds-body text-senior-cinza-600">Repetida da linha {r.duplicateOf ?? "anterior"}</span>
                          ) : (
                            <span className="ds-body text-senior-cinza-400">—</span>
                          )}
                          {r.tradeName && r.tradeName !== r.legalName && (
                            <span className="ds-caption block max-w-56 truncate text-senior-cinza-600" title={r.tradeName}>{r.tradeName}</span>
                          )}
                          <span className="ds-caption block max-w-52 truncate text-senior-cinza-400" title={r.entrada ?? r.referenceValue ?? r.rawCnpj ?? ""}>
                            pista: {r.entrada ?? r.referenceValue ?? (r.rawCnpj ? formatCnpj(r.rawCnpj) : "—")}
                          </span>
                          {(r.foundIsHeadquarters === false || r.resolvedCnpj) && (
                            <span className="ds-caption block truncate whitespace-nowrap text-senior-cinza-600">
                              {r.foundIsHeadquarters === false && r.headquartersCnpj
                                ? `filial · matriz ${formatCnpj(r.headquartersCnpj)}`
                                : r.foundIsHeadquarters === false
                                  ? "encontrado como filial"
                                  : r.lookupKind !== "CNPJ" && r.resolvedCnpj
                                    ? `CNPJ ${formatCnpj(r.resolvedCnpj)}`
                                    : null}
                            </span>
                          )}
                          <RegistrationAlertBadge r={r} />
                        </span>
                      </span>
                    </TableCell>
                    {/* v0.10.12: IDENTIFICAÇÃO — estado com ícone + texto (nunca só cor) e a base
                        da identificação na linha de baixo (validação humana, confiança, divergência). */}
                    <TableCell data-testid={`situation-${r.rowNumber}`} title={situ.hint}>
                      <SituationBadge s={situ} testId={`situation-badge-${r.rowNumber}`} />
                      {(situ.key === "LOCALIZADO" || situ.key === "REVIEW") && r.identityDivergencias.length > 0 ? (
                        <span className="ds-caption mt-1 block max-w-44 truncate text-[#33466C]" title={r.identityDivergencias.map((d) => d.descricao).join(" ")}>
                          {r.identityDivergencias[0].descricao}
                        </span>
                      ) : situ.key === "CONFIRMED" && r.identityStage === "VALIDADO" ? (
                        <span className="ds-caption mt-1 block">
                          <IdentityStageChip stage="VALIDADO" />
                        </span>
                      ) : situ.key === "CONFIRMED" ? (
                        <span className="mt-1 block">
                          <RowTrustChip r={r} />
                        </span>
                      ) : null}
                    </TableCell>
                    {colunas.localizacao && (
                      <TableCell className="hidden md:table-cell">
                        {r.municipality || r.uf ? (
                          <span className="ds-body whitespace-nowrap text-senior-azul">{r.municipality ? `${r.municipality}/${r.uf ?? ""}` : r.uf}</span>
                        ) : (
                          <span className="ds-body text-senior-cinza-400">—</span>
                        )}
                      </TableCell>
                    )}
                    {/* v0.10.19 — colunas opcionais da visão Detalhada (cadastro relevante) */}
                    {colunas.atividade && (
                      <TableCell>
                        {r.cnaeDescription ? (
                          <span className="ds-caption block max-w-44 truncate text-senior-cinza-600" title={r.cnaeDescription}>{r.cnaeDescription}</span>
                        ) : (
                          <span className="ds-body text-senior-cinza-400">—</span>
                        )}
                      </TableCell>
                    )}
                    {colunas.situacao && (
                      <TableCell>
                        {r.registrationStatus ? (
                          <span className={`ds-caption whitespace-nowrap font-medium ${["ATIVA"].includes(r.registrationStatus) ? "text-[#086B6B]" : "text-[#8a6d00]"}`}>{registrationLabel(r.registrationStatus)}</span>
                        ) : (
                          <span className="ds-body text-senior-cinza-400">—</span>
                        )}
                      </TableCell>
                    )}
                    {colunas.porte && (
                      <TableCell>
                        {r.extra?.porte && !/^demais$/i.test(r.extra.porte) ? (
                          <span className="ds-caption whitespace-nowrap text-senior-cinza-600">{r.extra.porte}</span>
                        ) : (
                          <span className="ds-body text-senior-cinza-400">—</span>
                        )}
                      </TableCell>
                    )}
                    {/* v0.10.12: PRÓXIMA AÇÃO — uma coluna, uma ação por estado (antes eram duas
                        colunas com três gatilhos para a mesma tela). Texto SEMPRE com o ícone. */}
                    <TableCell>
                      {r.aiStatus === "OK" ? (
                        isDossiePronto(r) ? (
                          // v0.11.3 (missão Lotes+Mesa): dossiê PRONTO (pesquisa+síntese+
                          // cadastro+identidade sem bloqueio) — a ação da linha é a leitura
                          // comercial na Mesa. Rótulo, ícone e title dedicados; mesmo
                          // handler e testId (navegação idêntica, zero efeito colateral).
                          <RowAction onClick={() => abrirDossier(r.rowNumber)} title="Dossiê pronto para investigação — abrir a leitura na Mesa" testId={`scout-open-${r.rowNumber}`}>
                            <Layers className="h-3.5 w-3.5" /> Ler dossiê
                          </RowAction>
                        ) : (
                          <RowAction onClick={() => abrirDossier(r.rowNumber)} title="Abrir leitura Scout 360" testId={`scout-open-${r.rowNumber}`}>
                            <Sparkles className="h-3.5 w-3.5" /> Ver análise
                          </RowAction>
                        )
                      ) : r.researchStatus === "GERANDO" ? (
                        <span className="ds-caption inline-flex items-center gap-1 text-[#086B6B]" data-testid={`scout-researching-${r.rowNumber}`}>
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Pesquisando a conta
                        </span>
                      ) : r.researchStatus === "OK" && r.aiStatus === "GERANDO" ? (
                        <span className="ds-caption inline-flex items-center gap-1 text-[#086B6B]" data-testid={`scout-synthesizing-${r.rowNumber}`}>
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Sintetizando dossiê
                        </span>
                      ) : detail.filaPesquisa?.pendentes?.includes(r.rowNumber) ? (
                        // Mesa de Contas: conta na fila de pesquisa, aguardando a vez
                        <span className="ds-caption inline-flex items-center gap-1 text-senior-cinza-600" data-testid={`scout-queued-${r.rowNumber}`}>
                          <Clock className="h-3 w-3" aria-hidden="true" /> {detail.filaPesquisa.estado === "RODANDO" ? "Na fila de pesquisa" : "Na fila (parada)"}
                        </span>
                      ) : r.aiStatus === "EM_FILA" || r.aiStatus === "GERANDO" ? (
                        <span className="ds-caption inline-flex items-center gap-1 text-[#086B6B]" data-testid={`scout-waiting-${r.rowNumber}`}>
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Leitura em preparo
                        </span>
                      ) : situ.key === "LOCALIZADO" ? (
                        // decisão pendente: revisar a identidade é a ação da linha
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowAction onClick={() => abrirDossier(r.rowNumber)} title="Revisar a identificação desta conta" testId={`action-review-${r.rowNumber}`}>
                            <CircleAlert className="h-3.5 w-3.5" /> Revisar
                          </RowAction>
                        </span>
                      ) : r.aiStatus === "FALHOU" ? (
                        // P0-09: falha de leitura tem ação explícita na própria linha (mesmo handler do dossiê)
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowAction
                            onClick={() => onRetryAiRow(r.rowNumber)}
                            disabled={busy || retryingAiRow === r.rowNumber}
                            title="Refazer a leitura desta conta"
                            testId={`scout-retry-${r.rowNumber}`}
                          >
                            {retryingAiRow === r.rowNumber ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Tentar de novo
                          </RowAction>
                        </span>
                      ) : RETRYABLE.has(r.lookupStatus) ? (
                        // falha de consulta: tentar de novo é a ação da linha
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowAction onClick={() => onRetryRow(r.rowNumber)} disabled={busy || retryingRow === r.rowNumber} title="Tentar consultar de novo" testId={`retry-row-${r.rowNumber}`}>
                            {retryingRow === r.rowNumber ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Tentar novamente
                          </RowAction>
                        </span>
                      ) : (
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowAction onClick={() => abrirDossier(r.rowNumber)} title="Abrir o dossiê da empresa" testId={`expand-${r.rowNumber}`}>
                            <ChevronDown className="h-3.5 w-3.5" /> Abrir dossiê
                          </RowAction>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* paginação — pé fixo do painel da lista */}
        {pagination && pagination.total > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-senior-cinza-300 bg-white/40 px-3 py-2.5" data-testid="pagination">
            <p className="ds-caption text-senior-cinza-600">
              {plural(pagination.total, "entrada", "entradas")} · página {pagination.page} de {pagination.totalPages}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-[5px] border-senior-cinza-300"
                disabled={pagination.page <= 1}
                onClick={() => onPageChange(pagination.page - 1)}
                aria-label="Página anterior"
                data-testid="pagination-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-[5px] border-senior-cinza-300"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => onPageChange(pagination.page + 1)}
                aria-label="Próxima página"
                data-testid="pagination-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
    </div>
  );

  return (
    <section ref={secaoMesaRef} aria-labelledby="resultado-title" data-testid="card-detail">
      <SectionTitle
        title="Resultado deste lote"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span data-testid="detail-file-name" className="font-semibold text-senior-azul">{detail.fileName}</span>
            <BatchStateBadge status={detail.status} />
          </span>
        }
        action={
          <>
            {showProcessBtn && (
              <Button className="sn-btn-verde h-9" onClick={onProcess} disabled={busy} data-testid="btn-process">
                <Play className="h-4 w-4" /> {detail.status === "CONFIRMED" ? "Iniciar agora" : detail.status === "FAILED" ? "Tentar novamente" : "Concluir pendências"}
              </Button>
            )}
            {detail.aiEnabled && detail.aiDone < detail.aiTotal && (detail.status === "DONE" || detail.status === "PARTIAL") && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 rounded-[8px] border-senior-cinza-300 text-[#086B6B] hover:bg-[#00968C14]"
                onClick={onRetryAiAll}
                disabled={retryAllBusy}
                data-testid="btn-retry-ai-all"
              >
                <Sparkles className="h-4 w-4" /> Gerar leituras que faltam
              </Button>
            )}
          </>
        }
      />

      {/* v0.10.16 — apresentação progressiva da home:
          · aguardando início: só o que a etapa precisa (entradas, prontas, comando Iniciar);
          · durante/depois: indicadores completos com as 8 leituras nos hints. */}
      {aguardandoInicio ? (
        <div className="sn-surface glass-reflex relative flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-5" data-testid="op-metrics-pre">
          <div className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-4">
            <OpMetric value={detail.rowCount} label="Entradas recebidas" testId="stat-entradas" />
            <OpMetric value={processable} label="Prontas para consulta" tone="verde" testId="stat-prontas" />
            {detail.totalInvalid > 0 && <OpMetric value={detail.totalInvalid} label="Sem CNPJ utilizável" testId="stat-invalidas-pre" />}
          </div>
          <p className="ds-caption w-full text-senior-cinza-600">
            Nada foi consultado ainda. Clique em <b className="font-semibold text-senior-azul">Iniciar agora</b> para começar.
          </p>
        </div>
      ) : canExport && !resumoExpandido ? (
        /* v0.11.3 (missão Lotes+Mesa): ÁREA LOTES — faixa de ACOMPANHAMENTO POR ETAPAS.
           Cada etapa com o próprio número e denominador (contrato de estados: as
           dimensões coexistem — 11 identificadas com 3 dossiês prontos NUNCA aparecem
           como 11 prontos). O resumo completo (8 leituras nos hints) abre sob comando.
           Este ponto é o alvo do retorno "Acompanhar em Lotes" vindo da Mesa. */
        <div className="space-y-1" data-testid="op-metrics-mini">
          <div className="scroll-mt-24" data-testid="lotes-acompanhamento">
            <AcompanhamentoStrip detail={detail} />
          </div>
          <div className="px-1">
            <button
              type="button"
              onClick={() => setResumoExpandido(true)}
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#086B6B] underline-offset-2 hover:underline"
              aria-expanded={false}
              data-testid="btn-expandir-resumo"
            >
              Resumo completo <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
      <div className="sn-surface glass-reflex relative flex flex-wrap items-center gap-x-0 gap-y-4 px-6 py-4" data-testid="op-metrics">
        {canExport && (
          <button
            type="button"
            onClick={() => setResumoExpandido(false)}
            className="inline-flex shrink-0 items-center gap-1 self-start pl-0 pr-4 text-[12.5px] font-medium text-[#086B6B] underline-offset-2 hover:underline"
            aria-expanded={true}
            data-testid="btn-recolher-resumo"
          >
            Recolher <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
          </button>
        )}
        <div className="w-1/2 pr-4 sm:w-auto sm:flex-1 sm:pr-6">
          <OpMetric value={detail.rowCount} label="Entradas recebidas" hint={hintEntradas} testId="stat-entradas" />
        </div>
        <div className="w-1/2 border-l border-white/70 pl-4 sm:w-auto sm:flex-1 sm:pl-6">
          {/* v0.10.7 (auditoria): quantidade DISTINTA pela raiz — matriz+filiais da mesma
              raiz são UMA pessoa jurídica; o contador por linha segue no hint. */}
          {/* v0.10.14 (reconciliação): o número principal é o que a tabela confirma como
              identificado; o total localizado (incluindo as em revisão) segue no hint —
              resumo e tabela contam o mesmo conjunto. */}
          <OpMetric
            value={detail.totalPessoasJuridicas}
            label="Pessoas jurídicas identificadas"
            hint={hintIdentificadas}
            tone="verde"
            testId="stat-identificadas"
          />
        </div>
        <div className="w-1/2 border-l border-white/70 pl-4 sm:w-auto sm:flex-1 sm:pl-6 sm:border-l sm:pl-6">
          {/* v0.10.7 (auditoria): matrizes DISTINTAS (uma por raiz) — linhas da mesma
              raiz resolvem a MESMA matriz; o contador por linha segue no hint. */}
          <OpMetric value={detail.totalMatrizesDistintas} label="Matrizes distintas confirmadas" hint={`${plural(detail.totalMatriz, "linha", "linhas")} com matriz resolvida`} tone="verde" testId="stat-matrizes" />
        </div>
        <div className="w-1/2 border-l border-white/70 pl-4 sm:w-auto sm:flex-1 sm:pl-6">
          <OpMetric value={detail.totalReview} label="Para revisão" tone={detail.totalReview > 0 ? "atencao" : "neutro"} testId="stat-revisao" />
        </div>
        <div className="w-1/2 border-l border-white/70 pl-4 sm:w-auto sm:flex-1 sm:pl-6">
          <OpMetric value={detail.totalUnresolved} label="Não identificadas" hint={hintNaoIdentificadas} tone={detail.totalUnresolved > 0 ? "atencao" : "neutro"} testId="stat-nao-identificadas" />
        </div>
        <div className="w-1/2 border-l border-white/70 pl-4 sm:w-auto sm:flex-1 sm:pl-6">
          {/* P1-02 + v0.10.8: esta % é cobertura de CADASTRO concluído (não de "identificação" —
              resolver identidade e concluir cadastro são etapas diferentes; o rótulo não esconde isso) */}
          <OpMetric value={coverage} suffix="%" label="Cadastros concluídos" tone="verde" testId="stat-cobertura" />
        </div>
        {detail.aiEnabled && detail.aiTotal > 0 && (
          <div className="w-1/2 border-l border-white/70 pl-4 sm:w-auto sm:flex-1 sm:pl-6">
            {/* P1-02: leituras Scout têm a própria métrica honesta — nunca "pesquisa pronta" */}
            <OpMetric value={`${detail.aiDone} de ${detail.aiTotal}`} label="Leituras Scout prontas" tone="verde" testId="stat-leituras" />
          </div>
        )}
      </div>
      )}

      {/* v0.11.0 (Gate 6): banner de revisão separado REMOVIDO — o CTA
          "Revisar agora" mora no painel de resultado (uma linha) e a explicação
          segue no title do botão e no estado das linhas. A primeira dobra
          pertence à MESA DE INVESTIGAÇÃO, não ao resumo do lote. */}

      {/* estado do processamento / aguardando início / resultado pronto (estado crítico) */}
      <div className="mt-4 space-y-3">
        {active && <ProgressPanel detail={detail} />}
        {/* v0.10.8: CONFIRMED = "Aguardando início" — sem spinner, sem progresso,
            com o comando claro que inicia a execução */}
        {aguardandoInicio && <WaitingStartPanel detail={detail} />}
        {canExport && (
          <ResultsReadyPanel
            detail={detail}
            selected={selectedList}
            onViewResults={viewResults}
            onReview={() => {
              // feedback imediato: filtro + rolagem + destaque da prévia — nunca um clique mudo
              // v0.11.3: reset de pesquisa/lookup — as identidades em revisão NÃO são
              // dossiês prontos; o clique nunca pode cair num filtro que as esconde.
              onFilterChange({ resolucao: "REVIEW", lookup: "ALL", pesquisa: "ALL" });
              viewResults();
            }}
          />
        )}
        {!canExport && !active && detail.status === "PREVIEW" && (
          <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-5 ds-body text-senior-cinza-600">
            Confirme o lote para começar a identificação.
          </div>
        )}
      </div>

      {/* v0.11.0 (contrato 3/9): A ESTAÇÃO vem logo após as métricas e o estado —
          panorama, plano de consultas, leitura do conjunto e telemetria ficam
          ABAIXO da mesa (área secundária do lote), sem empurrar a estação para
          fora da primeira dobra. */}
      {/* v0.11.3 (missão Lotes+Mesa): cabeçalho da SEGUNDA ÁREA — a Mesa de
          investigação é a experiência de LEITURA dos dossiês prontos sobre a MESMA
          base de registros de Lotes (visibilidade derivada — nada é copiado nem
          recoletado ao entrar). O chip declara o denominador honesto; o retorno
          "Acompanhar em Lotes" leva à faixa de etapas sem efeito colateral. */}
      {!aguardandoInicio && detail.status !== "PREVIEW" && (
        <MesaIntro
          detail={detail}
          onAcompanharLotes={acompanharLotes}
        />
      )}

      {usarSplit ? (
        <div
          className={`sn-surface glass-reflex relative mt-5 overflow-hidden rounded-[14px] border border-senior-cinza-200 bg-white/40 transition-shadow duration-500 ${tableFlash ? "ring-2 ring-[#00968C80] ring-offset-2" : ""}`}
          data-testid="mesa-split"
        >
          {mesaBarra}
          {/* v0.11.2 (adendo P0): em Foco a empresa selecionada e o progresso do lote
              ficam VISÍVEIS na primeira dobra — sem rolar até a área secundária */}
          {modoVisual === "foco" && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-senior-cinza-200 bg-white/60 px-3 py-1" data-testid="foco-status">
              <span className="ds-caption flex min-w-0 items-center gap-1.5 text-senior-cinza-600">
                <span className="max-w-48 truncate font-semibold text-senior-azul" title={detail.fileName}>{detail.fileName}</span>
                <BatchStateBadge status={detail.status} />
              </span>
              {detail.aiEnabled && detail.aiTotal > 0 && (
                <span className="ds-caption text-senior-cinza-600">
                  Leituras Scout: <b className="font-semibold tabular-nums text-senior-azul">{detail.aiDone}/{detail.aiTotal}</b>
                </span>
              )}
              {detail.filaPesquisa && detail.filaPesquisa.pendentes.length > 0 && (
                <span className="ds-caption text-senior-cinza-600">
                  Pesquisa profunda: <b className="font-semibold tabular-nums text-senior-azul">{detail.filaPesquisa.concluidas}/{detail.filaPesquisa.concluidas + detail.filaPesquisa.pendentes.length}</b> na fila
                </span>
              )}
              <span className="ds-caption ml-auto hidden text-senior-cinza-400 lg:inline">lista e progresso acessíveis por “Voltar à lista”</span>
            </div>
          )}
          <ResizablePanelGroup
            key={resetPaineis}
            direction="horizontal"
            autoSaveId={CHAVE_PAINEL_MESA}
            style={{ height: "max(620px, calc(100vh - 430px))" }}
            onLayout={(tamanhos) => {
            const lista = tamanhos[0] ?? 0;
            if (ajustandoRef.current) {
              // ajuste programático (troca de modo): só anota a proporção real
              if (lista > 0 && lista < 99) ultimaListaPct.current = lista;
              return;
            }
            // arraste do usuário: o MODO segue o que está na tela
            if (lista === 0) {
              if (modoVisual !== "foco") setModoVisual("foco");
            } else if ((tamanhos[1] ?? 0) === 0) {
              if (modoVisual !== "lista") setModoVisual("lista");
            } else {
              ultimaListaPct.current = lista;
              if (modoVisual !== "dividido") setModoVisual("dividido");
            }
          }}
        >
          <ResizablePanel
            ref={panelListaRef}
            defaultSize={32}
            minSize={24}
            collapsible
            collapsedSize={0}
            className="min-w-0"
          >
            {/* única rolagem do painel: a tabela interna — sem rolagem dupla (contrato 9) */}
            {mesaConteudo}
          </ResizablePanel>

          {/* divisória arrastável — também por teclado (setas), escondida quando
              um dos lados está recolhido (Foco/Lista) */}
          <ResizableHandle
            withHandle
            disabled={modoVisual !== "dividido"}
            className={modoVisual === "dividido" ? "bg-senior-cinza-200" : "w-0 opacity-0"}
            aria-label="Redimensionar lista e ficha"
          />

          {/* ficha da empresa — mesmo componente da sobreposição, direto no painel */}
          <ResizablePanel
            ref={panelFichaRef}
            defaultSize={68}
            minSize={40}
            collapsible
            collapsedSize={0}
            className="min-w-0"
          >
            {dossierRow ? (
              <FichaEmpresa
                r={dossierRow}
                busy={retryingAiRow === dossierRow.rowNumber}
                deciding={decidingRow === dossierRow.rowNumber}
                deepBusy={deepResearchingRow === dossierRow.rowNumber || dossierRow.researchStatus === "GERANDO" || (dossierRow.researchStatus === "OK" && dossierRow.aiStatus === "GERANDO")}
                revalidating={revalidatingRow === dossierRow.rowNumber}
                onRevalidate={() => onRevalidateRow(dossierRow.rowNumber)}
                batchId={detail.id}
                loteEmExecucao={active}
                onRetryRow={() => onRetryRow(dossierRow.rowNumber)}
                rowRetrying={retryingRow === dossierRow.rowNumber}
                nav={navFicha}
                onClose={fecharDossier}
                onRetry={() => onRetryAiRow(dossierRow.rowNumber)}
                onDeepResearch={(modo) => onDeepResearch(dossierRow.rowNumber, modo)}
                onAbrirPessoa={setPessoaAberta}
                onDecide={(body) => {
                  onDecideRow(dossierRow.rowNumber, body);
                  // o dossiê fecha só quando a identidade é confirmada — nas outras saídas
                  // (nova pista, não identificada, voltar) o painel continua aberto no estado novo
                  if ("cnpj" in body && body.cnpj) setDossierRowNumber(null);
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8" data-testid="ficha-vazia">
                <div className="max-w-sm text-center">
                  <p className="ds-body text-senior-cinza-600">
                    Escolha uma conta na lista para abrir a ficha aqui, ao lado. A lista continua disponível para busca e filtros.
                  </p>
                  {detail.totalReview > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 h-8 rounded-[8px] border-[#8a6d0055] text-[#8a6d00] hover:bg-[#FFC51133]"
                      onClick={() => onFilterChange({ resolucao: "REVIEW", lookup: "ALL", pesquisa: "ALL" })}
                      data-testid="ficha-vazia-revisar"
                    >
                      <CircleAlert className="h-4 w-4" /> Ver as {detail.totalReview} em revisão de identidade
                    </Button>
                  )}
                </div>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
        </div>
      ) : (
        <div
          className={`sn-surface glass-reflex relative mt-5 flex max-h-[68vh] scroll-mt-24 flex-col overflow-hidden rounded-[14px] border border-senior-cinza-200 bg-white/40 transition-shadow duration-500 ${tableFlash ? "ring-2 ring-[#00968C80] ring-offset-2" : ""}`}
          data-testid="mesa-single"
        >
          {mesaBarra}
          {mesaConteudo}
        </div>
      )}

      {/* ÁREA SECUNDÁRIA DO LOTE — abaixo da estação (contrato 3/9): leitura do
          conjunto, fila de pesquisa, panorama, plano de consultas e telemetria.
          Nada aqui cria uma longa sequência que empurre a mesa para fora da tela. */}
      {detail.aiEnabled && detail.totalEnriched > 0 && (detail.status === "DONE" || detail.status === "PARTIAL") && (
        <div className="mt-4">
          <SummaryPanel detail={detail} busy={summaryBusy} error={summaryError} onGenerate={onBatchSummary} />
        </div>
      )}

      {/* Mesa de Contas (v0.9.0): progresso consolidado da fila de pesquisa por seleção */}
      {detail.filaPesquisa && <FilaPesquisaPanel fila={detail.filaPesquisa} onParar={() => onFilaPesquisa("parar", [])} onRetomar={() => onFilaPesquisa("retomar", [])} />}

      {/* v0.10.16: panorama só faz sentido quando existem contas localizadas — nunca antes da consulta */}
      {!aguardandoInicio && detail.status !== "PREVIEW" && (
        <div className="mt-4">
          <PanoramaPanel detail={detail} />
        </div>
      )}

      {/* P4 (v0.10.9) — plano de consultas proposto: NADA executa sozinho */}
      {!aguardandoInicio && detail.status !== "PREVIEW" && detail.totalEnriched > 0 && (
        <div className="mt-4">
          <PlanoConsultasPanel detail={detail} linhas={rows} />
        </div>
      )}

      {/* Lote A3 — telemetria consolidada: camada técnica RECOLHIDA na jornada (v0.10.16) */}
      {!aguardandoInicio && detail.status !== "PREVIEW" && (
        <div className="mt-4">
          <TechDisclosure
            title="Detalhes técnicos do lote"
            subtitle="Telemetria das consultas: chamadas, cache, limites e etapas. Área de suporte e auditoria."
            testId="tech-lote"
          >
            <TelemetryPanel batchId={detail.id} />
          </TechDisclosure>
        </div>
      )}

      {/* auditoria — camada secundária no nível do lote, fora do painel da lista */}
      <div className="mt-4">
        <TechDisclosure title="Auditoria da execução" subtitle="Registro completo das consultas, para suporte e conferência." testId="audit-toggle">
          <AuditPanel events={events} detail={detail} />
        </TechDisclosure>
      </div>

      {/* sobreposição (Sheet) só em telas estreitas — em telas largas a ficha vive no painel */}
      {dossierRow && !usarSplit && (
        <CompanyDossier
          r={dossierRow}
          busy={retryingAiRow === dossierRow.rowNumber}
          deciding={decidingRow === dossierRow.rowNumber}
          deepBusy={deepResearchingRow === dossierRow.rowNumber || dossierRow.researchStatus === "GERANDO" || (dossierRow.researchStatus === "OK" && dossierRow.aiStatus === "GERANDO")}
          revalidating={revalidatingRow === dossierRow.rowNumber}
          onRevalidate={() => onRevalidateRow(dossierRow.rowNumber)}
          batchId={detail.id}
          loteEmExecucao={active}
          onRetryRow={() => onRetryRow(dossierRow.rowNumber)}
          rowRetrying={retryingRow === dossierRow.rowNumber}
          onClose={fecharDossier}
          onRetry={() => onRetryAiRow(dossierRow.rowNumber)}
          onDeepResearch={(modo) => onDeepResearch(dossierRow.rowNumber, modo)}
          onAbrirPessoa={setPessoaAberta}
          onDecide={(body) => {
            onDecideRow(dossierRow.rowNumber, body);
            // o dossiê fecha só quando a identidade é confirmada — nas outras saídas
            // (nova pista, não identificada, voltar) o painel continua aberto no estado novo
            if ("cnpj" in body && body.cnpj) setDossierRowNumber(null);
          }}
        />
      )}

      {/* v0.11.1 (Gate 4): DOSSIÊ DA PESSOA — investigação reversa sobre os caches
          já coletados (leitura pura, zero consulta externa). Pode coexistir com a
          ficha da empresa: fechar a ficha devolve o contexto ao dossiê da pessoa. */}
      <PessoaDossieSheet
        batchId={detail.id}
        participanteId={pessoaAberta}
        open={pessoaAberta != null}
        onClose={() => setPessoaAberta(null)}
        onAbrirEmpresa={abrirEmpresaDaPessoa}
      />
    </section>
  );
}
