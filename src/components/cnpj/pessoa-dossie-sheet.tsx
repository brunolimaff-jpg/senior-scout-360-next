"use client";
/**
 * pessoa-dossie-sheet.tsx — DOSSIÊ DA PESSOA (v0.11.1, Gate 4 — investigação reversa).
 *
 * Jornada: Empresa → Pessoas relacionadas → Dossiê da Pessoa → Empresas
 * vinculadas → Retorno ao contexto anterior.
 *
 * Regras do contrato:
 * - Identidade por participanteId da fonte; homônimos NUNCA são unidos (o
 *   dossiê avisa quando existem outros participantes com o mesmo nome).
 * - Raízes de CNPJ distintas = empresas; CNPJs completos = estabelecimentos.
 * - Papel por identificador ≠ papel associado por nome (rótulo próprio).
 * - Nenhuma consulta externa acontece ao abrir: só cache local. A expansão de
 *   quadro continua sendo comando explícito (mesma rota da ficha).
 * - A11y: SheetTitle/SheetDescription visíveis, Escape fecha, foco devolvido.
 */
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client-api";
import { formatCnpj } from "@/lib/cnpj";
import { plural } from "@/lib/linguagem";
import type { PessoaReversaView } from "@/lib/pessoas/reversa";
import { Loader2, Building2, Users, Network, ArrowRight, CircleHelp, ArrowLeft, Search } from "lucide-react";

export function PessoaDossieSheet({
  batchId,
  participanteId,
  open,
  onClose,
  onAbrirEmpresa,
}: {
  batchId: string;
  participanteId: string | null;
  open: boolean;
  onClose: () => void;
  /** abre a ficha da empresa do lote (o contexto da mesa é preservado) */
  onAbrirEmpresa: (rowNumber: number) => void;
}) {
  const [pessoa, setPessoa] = useState<PessoaReversaView | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliando, setAmpliando] = useState(false);
  // v0.11.2 (UX): busca local nas empresas relacionadas do dossiê
  const [buscaEmpresa, setBuscaEmpresa] = useState("");
  const identidadeRef = useRef<string | null>(participanteId);
  identidadeRef.current = participanteId;

  useEffect(() => {
    if (!open || !participanteId) return;
    let vivo = true;
    setLoading(true);
    setErro(null);
    apiFetch(`/api/imports/${batchId}/pessoas/${encodeURIComponent(participanteId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!vivo || identidadeRef.current !== participanteId) return; // resposta atrasada: descartada
        if (data?.ok) setPessoa((data.pessoa as PessoaReversaView | null) ?? null);
        else setErro(data?.error?.message ?? "Não foi possível carregar o dossiê desta pessoa.");
      })
      .catch(() => {
        if (vivo && identidadeRef.current === participanteId) setErro("Falha de rede ao carregar o dossiê da pessoa.");
      })
      .finally(() => {
        if (vivo && identidadeRef.current === participanteId) setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [batchId, participanteId, open]);

  // reset na troca de identidade (B nunca começa com o dossiê de A)
  const [idMontado, setIdMontado] = useState(participanteId);
  if (idMontado !== participanteId) {
    setIdMontado(participanteId);
    setPessoa(null);
    setErro(null);
    setAmpliando(false);
    setBuscaEmpresa("");
  }

  async function ampliarQuadro() {
    if (!pessoa || pessoa.empresasNoLote.length === 0) return;
    const rowNumber = pessoa.empresasNoLote[0].rowNumber;
    setAmpliando(true);
    setErro(null);
    try {
      const res = await apiFetch(`/api/imports/${batchId}/rows/${rowNumber}/relacoes-societarias/expansao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participanteId: pessoa.participanteId }),
      });
      const data = await res.json();
      if (identidadeRef.current !== pessoa.participanteId) return;
      if (!res.ok || !data.ok) {
        setErro(data?.error?.message ?? "Não foi possível ampliar o quadro agora. Os dados já encontrados continuam aqui.");
        return;
      }
      // a expansão persiste no cache — reler o dossiê (leitura pura)
      const res2 = await apiFetch(`/api/imports/${batchId}/pessoas/${encodeURIComponent(pessoa.participanteId)}`);
      const data2 = await res2.json();
      if (identidadeRef.current === pessoa.participanteId && data2?.ok) {
        setPessoa((data2.pessoa as PessoaReversaView | null) ?? null);
      }
    } catch {
      if (identidadeRef.current === pessoa.participanteId) setErro("Falha de rede durante a expansão do quadro.");
    } finally {
      if (identidadeRef.current === pessoa.participanteId) setAmpliando(false);
    }
  }

  // agrupamento por RAIZ: uma empresa, vários estabelecimentos (nunca confundir)
  const gruposRaiz = (() => {
    if (!pessoa?.quadro || pessoa.tipo === "PJ") return [];
    const m = new Map<string, { razaoSocial: string | null; estabelecimentos: string[] }>();
    for (const e of pessoa.quadro.empresas) {
      const dig = (e.cnpj || "").replace(/\D/g, "");
      if (!dig) continue;
      const raiz = dig.slice(0, 8);
      const g = m.get(raiz) ?? { razaoSocial: e.razaoSocial, estabelecimentos: [] };
      if (!g.razaoSocial && e.razaoSocial) g.razaoSocial = e.razaoSocial;
      g.estabelecimentos.push(e.cnpj);
      m.set(raiz, g);
    }
    return Array.from(m.entries());
  })();

  // v0.11.2 (UX): filtro local das EMPRESAS RELACIONADAS (por razão social, raiz ou
  // CNPJ) — dezenas de raízes não podem exigir rolagem para achar uma empresa.
  const gruposRaizFiltrados = (() => {
    const q = buscaEmpresa.trim().toLocaleLowerCase("pt-BR");
    if (!q) return gruposRaiz;
    const qDig = q.replace(/\D/g, "");
    // v0.11.2-fix: CNPJ/raiz só entra na comparação com >=3 dígitos — includes("")
    // seria sempre true e a busca por nome não filtrava nada.
    return gruposRaiz.filter(
      ([raiz, g]) =>
        (g.razaoSocial ?? "").toLocaleLowerCase("pt-BR").includes(q) ||
        (qDig.length >= 3 && (raiz.includes(qDig) || g.estabelecimentos.some((c) => c.includes(qDig)))),
    );
  })();

  const rowsNoLote = new Map((pessoa?.empresasNoLote ?? []).map((e) => [e.cnpjFormatado.replace(/\D/g, ""), e.rowNumber]));
  const raizNoLote = new Set(Array.from(rowsNoLote.keys()).map((c) => c.slice(0, 8)));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-none lg:w-[560px] lg:max-w-[560px] xl:w-[640px] xl:max-w-[640px]"
        data-testid="pessoa-dossie"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b border-senior-cinza-300 bg-background px-5 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[13px] text-senior-cinza-600 hover:bg-senior-cinza-300/40"
              onClick={onClose}
              aria-label="Voltar ao contexto anterior (ficha da empresa)"
              data-testid="pessoa-voltar"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Voltar
            </Button>
            <span className="ds-caption text-senior-cinza-500">Dossiê da pessoa</span>
          </div>
          {pessoa ? (
            <>
              <SheetTitle className="ds-title text-senior-azul" data-testid="pessoa-nome">
                {pessoa.nomePublico}
              </SheetTitle>
              <SheetDescription className="ds-caption text-senior-cinza-600" data-testid="pessoa-descricao">
                {pessoa.tipo === "PF"
                  ? "Pessoa física identificada pelo próprio identificador na fonte pública. Nenhum CPF é exibido ou armazenado."
                  : pessoa.tipo === "PJ"
                    ? `Participação de pessoa jurídica${pessoa.cnpjParticipanteFormatado ? ` (${pessoa.cnpjParticipanteFormatado})` : ""}.`
                    : "Participante com identidade não confirmada: a fonte não provou se é pessoa física ou jurídica."}
              </SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle className="ds-title text-senior-azul">Dossiê da pessoa</SheetTitle>
              <SheetDescription className="ds-caption text-senior-cinza-600">
                Identidade, empresas vinculadas e papéis registrados nos quadros públicos.
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 px-5 py-4" data-testid="pessoa-corpo">
          {loading && (
            <p className="flex items-center gap-2 text-[13px] text-senior-cinza-600" data-testid="pessoa-loading">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00968C]" aria-hidden="true" /> Carregando o dossiê desta pessoa…
            </p>
          )}
          {!loading && erro && (
            <div className="rounded-[10px] border border-[#F1BDBD] bg-[#FDF1F1] p-3 text-[13px] text-[#8C2F39]" data-testid="pessoa-erro">
              {erro}
            </div>
          )}
          {!loading && !erro && pessoa && (
            <>
              {/* CONTAGENS HONESTAS — raízes ≠ estabelecimentos; homônimos nunca unidos.
                  v0.11.2: cada número declara o ESCOPO — lote + quadro público completo
                  (quando o armazenamento não truncou); o recorte de exibição é declarado. */}
              <div className="grid grid-cols-2 gap-2.5" data-testid="pessoa-contagens">
                <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-3">
                  <p className="ds-caption text-senior-cinza-600">Empresas distintas (raízes)</p>
                  <p className="text-xl font-bold tabular-nums text-senior-azul" data-testid="pessoa-raizes">{pessoa.raizesDistintas}</p>
                  <p className="ds-caption mt-0.5 text-[11px] leading-tight text-senior-cinza-400">deste lote + quadro público coletado</p>
                </div>
                <div className="rounded-[10px] border border-senior-cinza-300 bg-white p-3">
                  <p className="ds-caption text-senior-cinza-600">Estabelecimentos citados</p>
                  <p className="text-xl font-bold tabular-nums text-senior-azul" data-testid="pessoa-estabelecimentos">{pessoa.estabelecimentosCitados}</p>
                  {pessoa.quadro && (
                    <p className="ds-caption mt-0.5 text-[11px] leading-tight text-senior-cinza-400" data-testid="pessoa-escopo-coleta">
                      coleta: {pessoa.quadro.totalEmpresas} na fonte · {pessoa.quadro.empresas.length} exibidos{pessoa.quadro.empresasOcultas > 0 ? ` (+${pessoa.quadro.empresasOcultas} no teto de exibição)` : ""}
                    </p>
                  )}
                </div>
              </div>
              {pessoa.tipo !== "PJ" && (
                <p className="ds-caption text-senior-cinza-600">
                  <span className="font-semibold text-senior-cinza-800">Uma empresa, várias unidades.</span> As filiais não representam empresas independentes: a contagem de empresas é por raiz de CNPJ.
                </p>
              )}
              {pessoa.homonimosNoLote > 0 && (
                <p className="ds-caption rounded-[8px] bg-[#FFC51114] px-2.5 py-2 text-[#6B5A00]" data-testid="pessoa-homonimos">
                  <CircleHelp className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {plural(pessoa.homonimosNoLote, "outro participante", "outros participantes")} com o mesmo nome neste lote {pessoa.homonimosNoLote === 1 ? "fica" : "ficam"} separado{pessoa.homonimosNoLote === 1 ? "" : "s"}: nomes iguais nunca são tratados como a mesma pessoa.
                </p>
              )}

              {/* EMPRESAS DO LOTE — retorno navegável ao contexto da mesa */}
              {pessoa.empresasNoLote.length > 0 && (
                <section data-testid="pessoa-no-lote">
                  <h3 className="ds-title-md flex items-center gap-2 text-senior-azul">
                    <Building2 className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
                    Empresas deste lote onde a pessoa aparece
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {pessoa.empresasNoLote.map((e) => (
                      <li key={e.rowNumber} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-senior-cinza-300 bg-white px-3 py-2.5">
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-senior-azul">{e.razaoSocial ?? e.cnpjFormatado}</span>
                          <span className="ds-caption block text-senior-cinza-600 tabular-nums">CNPJ {e.cnpjFormatado} · linha {e.rowNumber}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-[#00968C66] px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
                          onClick={() => onAbrirEmpresa(e.rowNumber)}
                          data-testid={`pessoa-ver-empresa-${e.rowNumber}`}
                        >
                          Ver na mesa <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* PAPÉIS REGISTRADOS — origem honesta: identificador × nome */}
              {pessoa.papeis.length > 0 && (
                <section data-testid="pessoa-papeis">
                  <h3 className="ds-title-md flex items-center gap-2 text-senior-azul">
                    <Users className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
                    Papéis registrados
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {pessoa.papeis.map((p, i) => (
                      <li key={i} className="rounded-[8px] border border-[#F2F2F2] px-3 py-2">
                        <p className="text-[13px] text-senior-azul">
                          <span className="font-semibold">{p.papel}</span> em {p.razaoSocial ?? p.cnpjFormatado}
                          {p.desde ? ` (desde ${p.desde})` : ""}
                        </p>
                        {p.papelPorNome && (
                          <p className="ds-caption mt-0.5 text-[#6B5A00]" data-testid={`papel-por-nome-${i}`}>
                            Papel associado pelo nome no cadastro público: a fonte não confirma esta função pelo identificador próprio. Confirme antes de usar.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* EMPRESAS VINCULADAS (quadro ampliado) — agrupado por raiz */}
              {pessoa.tipo !== "PJ" && (
                <section data-testid="pessoa-quadro">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="ds-title-md flex items-center gap-2 text-senior-azul">
                      <Network className="h-4 w-4 text-[#086B6B]" aria-hidden="true" />
                      Empresas vinculadas (quadro público)
                    </h3>
                    {pessoa.quadro ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-[#00968C66] px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
                        onClick={ampliarQuadro}
                        disabled={ampliando}
                        data-testid="pessoa-ampliar"
                      >
                        {ampliando ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                        {ampliando ? "Ampliando…" : "Atualizar quadro"}
                      </Button>
                    ) : (
                      pessoa.empresasNoLote.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-[#00968C66] px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C0D]"
                          onClick={ampliarQuadro}
                          disabled={ampliando}
                          data-testid="pessoa-ampliar"
                        >
                          {ampliando ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                          {ampliando ? "Ampliando…" : "Ampliar quadro (sob comando)"}
                        </Button>
                      )
                    )}
                  </div>
                  {!pessoa.quadro && (
                    <p className="ds-caption mt-2 text-senior-cinza-600" data-testid="pessoa-quadro-vazio">
                      O quadro público desta conexão ainda não foi ampliado. Nenhuma consulta acontece sem o seu comando.
                    </p>
                  )}
                  {pessoa.quadro && (
                    <>
                      <p className="ds-caption mt-2 text-senior-cinza-500" data-testid="pessoa-quadro-resumo">
                        {pessoa.quadro.leitura} Coleta de {new Date(pessoa.quadro.coletadoEm).toLocaleDateString("pt-BR")}: {plural(pessoa.quadro.totalEmpresas, "estabelecimento registrado", "estabelecimentos registrados")} na fonte.
                        {pessoa.quadro.truncado && " Teto de armazenamento aplicado: o total real é maior."}
                      </p>
                      {pessoa.quadro && pessoa.quadro.empresas.length > 4 && (
                        <div className="relative mt-2">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-senior-cinza-400" aria-hidden="true" />
                          <input
                            value={buscaEmpresa}
                            onChange={(e) => setBuscaEmpresa(e.target.value)}
                            placeholder="Buscar empresa relacionada por nome, raiz ou CNPJ…"
                            className="h-8 w-full rounded-[8px] border border-senior-cinza-300 bg-white pl-8 pr-2 text-[13px] placeholder:text-senior-cinza-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00968C]"
                            aria-label="Buscar empresa relacionada por nome, raiz ou CNPJ"
                            data-testid="pessoa-busca-empresa"
                          />
                        </div>
                      )}
                      {gruposRaiz.length > 0 ? (
                        gruposRaizFiltrados.length === 0 ? (
                          <p className="ds-caption mt-2 rounded-[8px] bg-[#F2F2F2] px-2.5 py-2 text-senior-cinza-600" data-testid="pessoa-busca-vazia">
                            Nenhuma empresa relacionada corresponde a esta busca. Os dados já carregados continuam aqui.
                          </p>
                        ) : (
                        <ul className="mt-2 space-y-2">
                          {gruposRaizFiltrados.map(([raiz, g]) => {
                            const cnpjPrimeiro = g.estabelecimentos[0] ?? "";
                            const noLote = raizNoLote.has(raiz) || (cnpjPrimeiro ? rowsNoLote.has(cnpjPrimeiro) : false);
                            return (
                              <li key={raiz} className="rounded-[8px] border border-senior-cinza-300 bg-white px-3 py-2.5" data-testid={`pessoa-empresa-${raiz}`}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="min-w-0">
                                    <span className="block text-[13px] font-semibold text-senior-azul">{g.razaoSocial ?? `Raiz ${raiz}`}</span>
                                    <span className="ds-caption block text-senior-cinza-600">
                                      {plural(g.estabelecimentos.length, "estabelecimento", "estabelecimentos")} desta empresa
                                      {pessoa.quadro && pessoa.quadro.empresasOcultas > 0 && g.estabelecimentos.length >= pessoa.quadro.empresas.length ? " (lista com teto)" : ""}
                                    </span>
                                  </span>
                                  {noLote && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 gap-1 px-2 text-[13px] text-[#086B6B] hover:bg-[#00968C14]"
                                      onClick={() => {
                                        const alvo = Array.from(rowsNoLote.entries()).find(([c]) => c.slice(0, 8) === raiz);
                                        if (alvo) onAbrirEmpresa(alvo[1]);
                                      }}
                                      data-testid={`pessoa-ver-empresa-raiz-${raiz}`}
                                    >
                                      Ver na mesa <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                    </Button>
                                  )}
                                </div>
                                {g.estabelecimentos.length > 1 && (
                                  <p className="ds-caption mt-1 text-senior-cinza-500 tabular-nums">
                                    {g.estabelecimentos.slice(0, 4).map((c) => formatCnpj(c)).join(" · ")}
                                    {g.estabelecimentos.length > 4 ? ` · +${g.estabelecimentos.length - 4}` : ""}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        )
                      ) : (
                        <p className="ds-caption mt-2 text-senior-cinza-600">O quadro ampliado não citou estabelecimentos para este participante.</p>
                      )}
                      {pessoa.quadro.empresasOcultas > 0 && (
                        <p className="ds-caption mt-1.5 text-[#8A5A00]" data-testid="pessoa-quadro-ocultas">
                          +{plural(pessoa.quadro.empresasOcultas, "estabelecimento", "estabelecimentos")} existem no quadro — a exibição respeita um teto de segurança.
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}

              {/* PJ: o quadro do participante é o quadro de SÓCIOS dele */}
              {pessoa.tipo === "PJ" && (
                <p className="ds-caption rounded-[8px] bg-[#EAF1F7] px-2.5 py-2 text-[#33466C]" data-testid="pessoa-pj-nota">
                  Esta participação é de pessoa jurídica. O quadro público dela lista os sócios dessa empresa, não empresas em que ela participa. Nenhuma relação entre empresas distintas é inferida aqui.
                </p>
              )}

              {pessoa.identidadeIncerta && (
                <p className="ds-caption rounded-[8px] bg-[#FFC51114] px-2.5 py-2 text-[#6B5A00]" data-testid="pessoa-incerta">
                  Identidade não confirmada: a fonte pública não trouxe identificador que prove se este participante é pessoa física ou jurídica. Os dados já encontrados foram mantidos.
                </p>
              )}

              <p className="ds-caption text-senior-cinza-500">
                Nomes conforme o quadro societário público. Nenhum CPF é armazenado ou exportado. Cobertura parcial: a fonte pública cobre parte dos vínculos.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
