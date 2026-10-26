"use client";
/**
 * use-scout-ui.ts — preferências de INTERFACE da estação de trabalho (v0.10.19).
 *
 * Contrato (BRUNO FORGE 3.3):
 * - Salva SOMENTE preferências de interface (modo de visualização, largura dos
 *   painéis, visão da tabela, colunas visíveis, ordenação). NUNCA dados
 *   empresariais, credenciais ou conteúdo sensível.
 * - Armazenamento indisponível (modo privado, cota cheia): usa o layout padrão
 *   sem interromper a aplicação.
 * - "Restaurar visualização padrão" volta ao layout de fábrica.
 */
import * as React from "react";

export type ModoVisual = "lista" | "dividido" | "foco";
export type VisaoTabela = "essencial" | "detalhada";
export type OrdenacaoTabela = "padrao" | "empresa" | "localizacao";

export interface ColunasTabela {
  localizacao: boolean;
  atividade: boolean;
  situacao: boolean;
  porte: boolean;
}

const CHAVE_PREFS = "scout360.ui.v1";

interface PrefsUi {
  modo: ModoVisual;
  visaoTabela: VisaoTabela;
  colunas: ColunasTabela;
  ordenacao: OrdenacaoTabela;
}

const PADRAO: PrefsUi = {
  modo: "dividido",
  visaoTabela: "essencial",
  colunas: { localizacao: true, atividade: false, situacao: false, porte: false },
  ordenacao: "padrao",
};

function normalizar(dados: Partial<PrefsUi> | null | undefined): PrefsUi {
  const modo = dados?.modo === "lista" || dados?.modo === "dividido" || dados?.modo === "foco" ? dados.modo : PADRAO.modo;
  const visaoTabela = dados?.visaoTabela === "detalhada" ? "detalhada" : "essencial";
  const ordenacao = dados?.ordenacao === "empresa" || dados?.ordenacao === "localizacao" ? dados.ordenacao : "padrao";
  const c: Partial<ColunasTabela> = dados?.colunas ?? {};
  return {
    modo,
    visaoTabela,
    ordenacao,
    colunas: {
      localizacao: typeof c.localizacao === "boolean" ? c.localizacao : PADRAO.colunas.localizacao,
      atividade: typeof c.atividade === "boolean" ? c.atividade : PADRAO.colunas.atividade,
      situacao: typeof c.situacao === "boolean" ? c.situacao : PADRAO.colunas.situacao,
      porte: typeof c.porte === "boolean" ? c.porte : PADRAO.colunas.porte,
    },
  };
}

function lerPrefs(): PrefsUi {
  if (typeof window === "undefined") return normalizar(null);
  try {
    const bruto = window.localStorage.getItem(CHAVE_PREFS);
    if (!bruto) return normalizar(null);
    return normalizar(JSON.parse(bruto) as Partial<PrefsUi>);
  } catch {
    return normalizar(null);
  }
}

function salvarPrefs(prefs: PrefsUi): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE_PREFS, JSON.stringify(prefs));
  } catch {
    // armazenamento indisponível: segue com o layout em memória, sem interromper
  }
}

/**
 * Preferências da estação (modo, tabela, colunas, ordenação) — hidratação
 * segura: o primeiro render usa o padrão; a preferência entra em efeito
 * depois da montagem.
 */
export function useScoutUi() {
  const [prefs, setPrefsEstado] = React.useState<PrefsUi>(PADRAO);
  React.useEffect(() => {
    setPrefsEstado(lerPrefs());
  }, []);
  const atualizar = React.useCallback((parcial: Partial<PrefsUi>) => {
    setPrefsEstado((atual) => {
      const novo = { ...atual, ...parcial, colunas: { ...atual.colunas, ...(parcial.colunas ?? {}) } };
      salvarPrefs(novo);
      return novo;
    });
  }, []);
  const restaurarPadrao = React.useCallback(() => {
    setPrefsEstado({ ...PADRAO, colunas: { ...PADRAO.colunas } });
    salvarPrefs({ ...PADRAO, colunas: { ...PADRAO.colunas } });
  }, []);
  return { prefs, atualizar, restaurarPadrao };
}

/** Consulta de largura mínima reativa (para alternar split × sobreposição). */
export function useLarguraMinima(px: number): boolean {
  const [ok, setOk] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = () => setOk(mql.matches);
    mql.addEventListener("change", onChange);
    setOk(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [px]);
  return ok;
}

/**
 * v0.11.0 (contrato 4.B) — largura do CONTÊINER real, observada por ResizeObserver.
 * A divisão da mesa responde à área útil do Scout (que encolhe com a barra lateral
 * do ChatGPT ou com o navegador), não à largura externa da janela.
 * Fallback sem ResizeObserver: largura da janela (comportamento anterior).
 */
export function useLarguraConteiner(ref: React.RefObject<HTMLElement | null>): number {
  const [largura, setLargura] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      const onR = () => setLargura(window.innerWidth);
      setLargura(window.innerWidth);
      window.addEventListener("resize", onR);
      return () => window.removeEventListener("resize", onR);
    }
    const ro = new ResizeObserver((entries) => {
      // contentRect ignora padding — é a área ÚTIL que governa o leiaute
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setLargura(Math.round(w));
    });
    ro.observe(el);
    setLargura(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return largura;
}

/** Chave de persistência dos painéis (react-resizable-panels autoSaveId).
 *  v0.11.0: chave v2 — a divisão padrão passou de 45/55 para 32/68 (contrato 4).
 *  Preferências antigas sob a chave v1 são ignoradas (não apagadas); o modo,
 *  colunas e ordenação do operador continuam valendo (chave scout360.ui.v1 intacta). */
export const CHAVE_PAINEL_MESA = "scout360.mesa.paineis.v2";
