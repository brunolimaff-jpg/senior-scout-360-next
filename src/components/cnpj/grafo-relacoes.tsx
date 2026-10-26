'use client';

/**
 * grafo-relacoes.tsx — MAPA LEVE DAS RELAÇÕES (v0.10.23 — Entrega 5, experimento controlado).
 *
 * Desenho SVG determinístico (sem biblioteca de grafos, sem medição de texto):
 *  - Nível 0: a empresa consultada (raiz).
 *  - Nível 1: participantes do quadro público (PF, PJ, tipo não confirmado).
 *  - Nível 2: empresas de quadros JÁ expandidos por comando e empresas com
 *             participante compartilhado já calculadas.
 *  - Usa SOMENTE links persistidos (cache local) — nenhum consulta acontece aqui.
 *  - Experimento controlado: se o mapa não disser nada além da lista
 *    (grafoTemValor = false), ele NÃO aparece — estrela raiz→participantes é
 *    decoração, e decoração foi descartada pelo contrato.
 *  - Acessível: role="img", aria-label com a leitura, <title> por nó e por aresta.
 */

import { useMemo } from "react";
import { Network } from "lucide-react";
import {
  construirGrafoRelacoes,
  grafoTemValor,
  type ArestaGrafoTipo,
  type GrafoRelacoes,
  type NoGrafo,
} from "@/lib/inteligencia";
import { plural } from "@/lib/linguagem";
import type { RelacoesView, QuadroView } from "@/lib/types";
import { formatBR, TechDisclosure } from "./senior";

/* paleta coerente com o DS (verde-petróleo/azul-marinho, sem indigo) */
const CORES: Record<NoGrafo["tipo"], { fill: string; stroke: string; texto: string; tracejado?: boolean }> = {
  empresa: { fill: "#086B6B", stroke: "#086B6B", texto: "#FFFFFF" },
  "participante-pf": { fill: "#EAF1F7", stroke: "#33466C", texto: "#33466C" },
  "participante-pj": { fill: "#00968C14", stroke: "#086B6B", texto: "#086B6B" },
  "participante-indeterminado": { fill: "#F2F2F2", stroke: "#8A8A8A", texto: "#5A5A5A" },
  "empresa-quadro": { fill: "#FFFFFF", stroke: "#7FB5AE", texto: "#33466C" },
  "empresa-compartilhada": { fill: "#FFC51114", stroke: "#B8860B", texto: "#6B5A00", tracejado: true },
  agregado: { fill: "#FFFFFF", stroke: "#B9C6C2", texto: "#5A5A5A", tracejado: true },
};

const COR_ARESTA: Record<ArestaGrafoTipo, string> = {
  participacao: "#9AB0AC",
  quadro: "#7FB5AE",
  "mesma-empresa": "#8A8A8A",
  compartilhado: "#B8860B",
};

const LEGENDA: { tipo: ArestaGrafoTipo; rotulo: string }[] = [
  { tipo: "participacao", rotulo: "Participante do quadro público" },
  { tipo: "quadro", rotulo: "Empresa de quadro já expandido (consulta feita)" },
  { tipo: "compartilhado", rotulo: "Empresa com participante compartilhado (mesmo lote)" },
];

/* ------------------------- geometria determinística ------------------------- */
const W = 760;
const MARGEM = 18;
const RAIZ_W = 240;
const RAIZ_H = 52;
const RAIZ_Y = 16;
const L1_W = 148;
const L1_H = 50;
const L1_Y = 108;
const L2_W = 148;
const L2_H = 40;
const L2_GAP = 24;
const L2_TOP = L1_Y + L1_H + 34;

/** divide o rótulo em até 2 linhas por palavras, sem medir texto */
function duasLinhas(texto: string, maxLinha = 21): [string, string | null] {
  const t = texto.trim();
  if (t.length <= maxLinha) return [t, null];
  const palavras = t.split(/\s+/);
  let l1 = "";
  let i = 0;
  while (i < palavras.length) {
    const tentativa = l1 ? `${l1} ${palavras[i]}` : palavras[i];
    if (tentativa.length > maxLinha) break;
    l1 = tentativa;
    i += 1;
  }
  if (!l1) l1 = t.slice(0, maxLinha);
  const resto = t.slice(l1.length).trim();
  const l2 = resto.length > maxLinha ? `${resto.slice(0, maxLinha - 1).trimEnd()}…` : resto || null;
  return [l1, l2];
}

function NoSvg({ no, x, y, mesmaEmpresa }: { no: NoGrafo; x: number; y: number; mesmaEmpresa: boolean }) {
  const c = CORES[no.tipo];
  const largura = no.nivel === 0 ? RAIZ_W : no.nivel === 1 ? L1_W : L2_W;
  const altura = no.nivel === 0 ? RAIZ_H : no.nivel === 1 ? L1_H : L2_H;
  const [l1, l2] = duasLinhas(no.rotulo, no.nivel === 0 ? 26 : 21);
  const cx = x + largura / 2;
  const corTexto = c.texto;
  return (
    <g>
      <title>{`${no.nomeCompleto}${no.subtitulo && no.tipo !== "agregado" ? ` — ${no.subtitulo}` : ""}${mesmaEmpresa ? " — também figura no quadro de outro estabelecimento da mesma empresa" : ""}`}</title>
      <rect
        x={x}
        y={y}
        width={largura}
        height={altura}
        rx={10}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.4}
        strokeDasharray={c.tracejado || mesmaEmpresa ? "5 3" : undefined}
      />
      <text x={cx} y={l2 ? y + altura / 2 - 4 : y + altura / 2 + 4} textAnchor="middle" fontSize={11.5} fill={corTexto} fontWeight={600}>
        {l1}
      </text>
      {l2 && (
        <text x={cx} y={y + altura / 2 + 11} textAnchor="middle" fontSize={11.5} fill={corTexto} fontWeight={600}>
          {l2}
        </text>
      )}
      {no.nivel === 0 && no.subtitulo && (
        <text x={cx} y={y + altura - 7} textAnchor="middle" fontSize={9} fill={corTexto} opacity={0.85}>
          {no.subtitulo}
        </text>
      )}
      {mesmaEmpresa && no.nivel === 1 && (
        <text x={cx} y={y + altura + 12} textAnchor="middle" fontSize={9} fill="#5A5A5A">
          também na mesma empresa
        </text>
      )}
    </g>
  );
}

function ArestaSvg({ de, para, tipo, rotulo }: { de: { x: number; y: number; h: number; w: number }; para: { x: number; y: number }; tipo: ArestaGrafoTipo; rotulo: string }) {
  const x1 = de.x + de.w / 2;
  const y1 = de.y + de.h;
  const x2 = para.x + de.w / 2 > x1 ? para.x + 6 : para.x;
  const y2 = para.y;
  return (
    <g>
      <title>{rotulo}</title>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={COR_ARESTA[tipo]} strokeWidth={1.6} strokeDasharray={tipo === "compartilhado" ? "5 3" : undefined} />
    </g>
  );
}

export function GrafoRelacoesCard({ view, quadros }: { view: RelacoesView; quadros: Record<string, QuadroView> }) {
  const grafo: GrafoRelacoes = useMemo(() => construirGrafoRelacoes(view, quadros), [view, quadros]);
  const comValor = grafoTemValor(grafo);
  if (!comValor) return null; // experimento controlado: sem ligações além da lista, o mapa não existe

  // posições determinísticas
  const participantes = grafo.nos.filter((n) => n.nivel === 1);
  const n1 = Math.max(1, participantes.length);
  const slot1 = (W - 2 * MARGEM) / n1;
  const pos1 = new Map<string, { x: number; y: number; h: number; w: number }>();
  participantes.forEach((no, i) => {
    pos1.set(no.id, { x: MARGEM + slot1 * i + (slot1 - L1_W) / 2, y: L1_Y, h: L1_H, w: L1_W });
  });

  // nível 2 empilhado sob cada participante (até 2 + agregado)
  const filhosPorPai = new Map<string, NoGrafo[]>();
  for (const aresta of grafo.arestas) {
    if (aresta.tipo === "participacao" || aresta.tipo === "mesma-empresa") continue;
    const alvo = grafo.nos.find((n) => n.id === aresta.para);
    if (!alvo) continue;
    const lista = filhosPorPai.get(aresta.de) ?? [];
    if (!lista.some((n) => n.id === alvo.id)) lista.push(alvo);
    filhosPorPai.set(aresta.de, lista);
  }
  const pos2 = new Map<string, { x: number; y: number; h: number; w: number }>();
  let profundidadeMax = 0;
  for (const [paiId, filhos] of filhosPorPai) {
    const pai = pos1.get(paiId);
    if (!pai) continue;
    filhos.forEach((no, k) => {
      const y = L2_TOP + k * (L2_H + L2_GAP);
      pos2.set(no.id, { x: pai.x, y, h: L2_H, w: L2_W });
      profundidadeMax = Math.max(profundidadeMax, k + 1);
    });
  }

  const raizX = (W - RAIZ_W) / 2;
  const H = L2_TOP + Math.max(0, profundidadeMax - 1) * (L2_H + L2_GAP) + L2_H + 26;

  const mesmaEmpresaIds = new Set(
    grafo.arestas.filter((a) => a.tipo === "mesma-empresa" && a.de !== "raiz").map((a) => a.de)
  );

  const ariaLabel = `Mapa das relações. ${grafo.resumo} ${grafo.nos.length + 1} nós e ${grafo.arestas.length} ligações desenhadas.`;

  return (
    <TechDisclosure
      title="Mapa das relações"
      subtitle={grafo.resumo}
      testId="grafo-relacoes-toggle"
    >
      <div className="space-y-3" data-testid="grafo-relacoes">
        <div className="cnpj-scroll overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={ariaLabel}
            className="min-w-[640px]"
            data-testid="grafo-relacoes-svg"
          >
            {/* arestas primeiro (ficam sob os nós) */}
            {grafo.arestas.map((a, i) => {
              if (a.de === "raiz") {
                const alvo = pos1.get(a.para);
                if (!alvo) return null;
                return <ArestaSvg key={i} de={{ x: raizX, y: RAIZ_Y, h: RAIZ_H, w: RAIZ_W }} para={{ x: alvo.x, y: alvo.y }} tipo={a.tipo} rotulo={a.rotulo} />;
              }
              const pai = pos1.get(a.de);
              const alvo = pos2.get(a.para);
              if (!pai || !alvo) return null; // aresta mesma-empresa para a raiz é contada no contorno tracejado
              return <ArestaSvg key={i} de={pai} para={{ x: alvo.x, y: alvo.y }} tipo={a.tipo} rotulo={a.rotulo} />;
            })}
            {/* raiz */}
            <NoSvg no={grafo.raiz} x={raizX} y={RAIZ_Y} mesmaEmpresa={false} />
            {/* nível 1 */}
            {participantes.map((no) => {
              const p = pos1.get(no.id);
              if (!p) return null;
              return <NoSvg key={no.id} no={no} x={p.x} y={p.y} mesmaEmpresa={mesmaEmpresaIds.has(no.id)} />;
            })}
            {/* nível 2 */}
            {grafo.nos
              .filter((n) => n.nivel === 2)
              .map((no) => {
                const p = pos2.get(no.id);
                if (!p) return null;
                return <NoSvg key={no.id} no={no} x={p.x} y={p.y} mesmaEmpresa={false} />;
              })}
          </svg>
        </div>

        {/* legenda */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legenda do mapa">
          {LEGENDA.map((l) => (
            <li key={l.tipo} className="flex items-center gap-1.5 text-[12.5px] text-senior-cinza-600">
              <svg width="26" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="25" y2="5" stroke={COR_ARESTA[l.tipo]} strokeWidth="2" strokeDasharray={l.tipo === "compartilhado" ? "5 3" : undefined} />
              </svg>
              {l.rotulo}
            </li>
          ))}
        </ul>
        {mesmaEmpresaIds.size > 0 && (
          <p className="ds-caption text-senior-cinza-500">
            Contorno tracejado no participante: ele também figura no quadro de outro estabelecimento da MESMA empresa (não é relação entre empresas distintas).
          </p>
        )}

        {/* proveniência mínima — de onde veio cada ligação de nível 2 */}
        {grafo.quadrosUsados.length > 0 && (
          <p className="ds-caption text-senior-cinza-500" data-testid="grafo-proveniencia">
            Empresas do nível de baixo vêm de {plural(grafo.quadrosUsados.length, "quadro já consultado", "quadros já consultados")} (
            {grafo.quadrosUsados.map((q) => q.participante).join(", ")}), coletados em {formatBR(grafo.quadrosUsados[0].coletadoEm)} ou antes.
          </p>
        )}
        <p className="ds-caption flex items-start gap-1.5 text-senior-cinza-500">
          <Network className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          O mapa desenha só ligações já persistidas nesta investigação. Para ligar alguém novo, use o botão Investigar conexão na lista acima. Sobreposição de quadro NÃO caracteriza grupo econômico.
        </p>
      </div>
    </TechDisclosure>
  );
}
