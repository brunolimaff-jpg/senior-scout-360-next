# G8 — laboratório PostgreSQL local

Esta é uma proposta isolada de schema e migration, não o schema SQLite operacional nem uma autorização para usar o Supabase. O laboratório cria um banco PGlite em memória e abre um servidor somente em `127.0.0.1:55439`; ele não lê ou copia o banco do operador. A porta pode ser alterada por `G8_LAB_PORT`.

## Reproduzir

No diretório raiz do repositório, com as dependências do Scout já instaladas:

```bash
npm ci --prefix experiments/g8-postgres
```

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55439/postgres?sslmode=disable' bunx prisma generate --schema experiments/g8-postgres/schema.prisma
```

```bash
npm run test --prefix experiments/g8-postgres
```

O teste cria banco em memória, aplica `migrate deploy` duas vezes e verifica CRUD sintético via Prisma Client, data UTC, JSON textual, chave estrangeira, rollback, consulta SQL do planejador e cascata. O banco é descartado ao encerrar o processo. Não execute contra Supabase nem contra um banco persistente: o teste cria seu próprio servidor em loopback. Não copie arquivos reais, credenciais ou backups para este diretório.

## PostgreSQL 17 real

```bash
npm run test:postgres --prefix experiments/g8-postgres
```

O teste inicia PostgreSQL 17 local na porta 55440 com dados sintéticos, cria um diretório de cluster novo e ignorado pelo Git, aplica a migration duas vezes e usa duas conexões independentes para testar claim, heartbeat e retomada de lease. O servidor é encerrado ao fim; o cluster sintético é mantido no diretório do laboratório. A disponibilidade dos binários portáteis depende do sistema operacional e da arquitetura.

## Limites

PGlite não é um servidor PostgreSQL completo: o adaptador multiplexa uma conexão interna. O teste em PostgreSQL 17 verifica o contrato do lease, mas não executa `runBatch` completo, cancelamento nem a fila de pesquisa. A migration é experimental e independente de qualquer futura migration de produção. Acesso/RLS no Supabase, arquivo sintético histórico ausente e cutover continuam pendentes. O laboratório fica separado das migrations SQLite operacionais.
