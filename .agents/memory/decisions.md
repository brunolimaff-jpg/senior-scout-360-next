# decisions — Scout 360

- 2026-11-03 (Bruno): implementar e enviar o claim distribuído da fila de pesquisa. Feito: CAS na string JSON exata (mesmo padrão do lease de lote), `dono` + heartbeat de 30 s, releitura entre contas; `writeQueue` cego removido.
- 2026-10-27 (Bruno): Supabase/PostgreSQL é direção para persistência do Scout existente; criação do projeto autorizada, não migração real nem deploy.
- 2026-10-27 (Bruno): GitHub Actions desativado por cota; não reativar nem criar CI remota sem autorização. Verificações locais.
- 2026-10-27 (Bruno): não delegar a modelos de fronteira sem permissão explícita.

- 2026-10-26: Mesa só abre ficha de dossiê pronto (`src/lib/dossie-mesa.ts`); ação de PDF
  apenas com `lookupStatus ENRIQUECIDO`. Vault: `Projetos/Scout-360/Decisões/2026-10-26-mesa-pronta-e-ci.md`.
- 2026-10-26: CI adotado (6 suítes curadas + unitários; banco de CI; poppler p/ PDF).
- 2026-10-26 (aberta): provedor de IA e infraestrutura Cloudflare — aguardando decisão de Bruno/Planejador.
- 2026-10-26 (Bruno): foco em design/produto; provedores de IA e Cloudflare de lado nesta fase.
  Auditoria antes de implementar; implementação só com OK por rodada (R1–R4 do parecer).
  Vault: `Projetos/Scout-360/Decisões/2026-10-26-foco-design-antes-de-provedores.md`.
