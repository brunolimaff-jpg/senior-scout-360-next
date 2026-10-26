import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __scoutRevisaoFatos?: number
}

// v0.10.11 (piloto): revisão dos FATOS — contador que sobe a cada ESCRITA nas
// tabelas que o planejador/triagem leem. A invalidação do cache do plano é
// EXATA (nunca devolve retrato velho) e não custa consulta nenhuma.
// Lê-se com revisaoFatos() — usada pelo fingerprint do plano.
globalForPrisma.__scoutRevisaoFatos ??= 0

/** Modelos cuja escrita muda fatos que alimentam o plano de consultas. */
const MODELOS_DE_FATO = new Set([
  'ImportBatch',
  'ImportRow',
  'TelemetryEvent',
  'CadastroCache',
  'RelacaoSocietariaCache',
  'QuadroParticipanteCache',
  'EstabelecimentoRootCache',
])

const OPERACOES_DE_ESCRITA = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
])

// Log de query (dev) é opt-in: o log síncrono de cada consulta pesa sob carga.
const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.SCOUT_LOG_QUERIES === '1' ? ['query'] : [],
  })

export const db = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args)
        if (
          model &&
          MODELOS_DE_FATO.has(model) &&
          OPERACOES_DE_ESCRITA.has(operation)
        ) {
          globalForPrisma.__scoutRevisaoFatos = (globalForPrisma.__scoutRevisaoFatos ?? 0) + 1
        }
        return result
      },
    },
  },
})

/** Revisão corrente dos fatos — muda a cada escrita relevante (leitura O(1)). */
export function revisaoFatos(): number {
  return globalForPrisma.__scoutRevisaoFatos ?? 0
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = base
