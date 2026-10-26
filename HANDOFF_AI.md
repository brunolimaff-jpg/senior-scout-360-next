# HANDOFF_AI — Scout 360

> Ponteiro operacional. Narrativa curada no Bruno Vault:
> `Sessões/2026-10/2026-10-26T16-21-12-scout-360-g7-consolidacao.md`
> Projeto: `Projetos/Scout-360/hub.md`

## Estado (26/10/2026)

- Repo local: `C:\Users\bruno.ferreira\dev\scout360-next` (fora do OneDrive).
- Remoto privado: `brunolimaff-jpg/senior-scout-360-next` — `main` em `ede6518`.
- Branch de trabalho: `g7/consolidacao-local` (+ commits de sessão paralela) — **Draft PR #1**.
- Arquivo auditado da VM: `C:\Users\bruno.ferreira\dev\scout360-vm-archive` (HEAD `43f42cd`).
- Servidores locais: encerrados. Probe vinext: `C:\Users\bruno.ferreira\dev\scout360-vinext-probe`.
- CI: `.github/workflows/ci.yml` ativo; runs verdes (push 4m14s / PR 2m57s em 26/10).

## Validado nesta fase

- Mesa: auto-abertura exige dossiê pronto (`src/lib/dossie-mesa.ts`); PDF só com
  conteúdo coletado. Unit 9/9 · tsc src 0 · lint 0 · build OK.
- API: Cenário A (conta não identificada → 0 dossiês, fica em Lotes) e Cenário B
  (3 dossiês de 11; filtro canônico = contador). Persistência após reinício.
- CI Linux: v01012 40/40 · v01015 71/71 · v01024 8/8 · PDF v4 39/39 · Pessoas 37/37 · v0103 50/50.
- **NAO VALIDADO**: jornada visual desktop/mobile (sem browser automation na sessão).

## Decisões abertas (não implementar sem decisão)

1. Provedor de IA: LiteLLM corporativo (acesso não comprovado) × DeepSeek pago × Z.ai oficial.
   Contrato/detalhes em `RELATORIO-G7P-PROVEDORES.md`. Nada foi trocado.
2. Infra: Workers reestruturado (D1/R2/Queues) × Containers (pago, storage efêmero) ×
   local/VPS com disco + Cloudflare como CDN. Bundle vinext: 19 MiB (1,1 MiB gzip).

## Próximo passo sugerido

Aguardar decisão de provedor/infra. Quando houver, implementar o menor piloto
(adapter no `resolve-service`, HTML direto para leitura) e validar com amostra
sintética antes de ativar.

## Não fazer

- Merge na `main`, deploy, D1/R2/Containers ou consumo pago sem decisão explícita.
- Dados reais do operador em repo/endereço público.
- Reimplementar Lotes/Mesa v0.11.2/v0.11.3.
