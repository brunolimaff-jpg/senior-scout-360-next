# Testes — estrutura mínima versionada

Duas camadas, separadas por custo:

## Verificações rápidas (`tests/unit`)

Sem banco, sem rede. Rodam em segundos:

```bash
bun test tests/unit
```

Cobrem as regras puras da Mesa de Investigação (G7): o que é dossiê pronto e
quando a ficha pode abrir automaticamente (nunca com conta não identificada).

## Regressão (suítes priorizadas em `scripts/`)

Seleção curada dos harnesses históricos da VM — **não** são os 77 scripts
originais; ficaram apenas os que cobrem identidade, importação/contadores,
pessoas/relações, exportações e PDF:

| Suíte | Cobertura |
|---|---|
| `scripts/test-v01012-identidade.ts` | confiança de identidade + export real |
| `scripts/test-v01015-exportacoes.ts` | exportações Excel/PDF/CSV pelas rotas reais |
| `scripts/test-v01024-lab-route.ts` | rota de laboratório + mock de provedor |
| `scripts/test-v0111-pdf-v4.ts` | contrato do PDF v4 (conteúdo + render) |
| `scripts/test-v0111-pessoas-reversa.ts` | investigação reversa de pessoas |
| `scripts/test-v0103-regressoes.ts` | regressões gerais da cadeia |

Dependências de ambiente:

- **Bun** ≥ 1.4 (as suítes usam `bunx prisma` e o runtime Bun).
- **poppler-utils** (`pdftoppm`) para a etapa de renderização página a página do
  PDF (`test-v0111-pdf-v4`). No Ubuntu: `sudo apt-get install -y poppler-utils`.
  Sem o binário, apenas a checagem de render falha — o diagnóstico é explícito.
- Banco: as suítes que usam rotas reais (`v01012`, `v01015`) exigem a aplicação
  no ar em `:3000` lendo o MESMO `DATABASE_URL`; as demais criam banco isolado
  em `/tmp` e não dependem do servidor. O CI sobe o app com `db/ci.db`.

O workflow `.github/workflows/ci.yml` executa: tipos (escopo `src/`), lint,
unitários, build e a bateria de regressão com banco de CI.

Fixtures são 100% sintéticas (CNPJs `99.000.x`, nomes genéricos). Nenhuma suíte
faz coleta externa em massa; chaves de mock (`chave-mock-…`) existem apenas em
servidores locais de teste em loopback.
