import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('./generated-client');
const schema = fileURLToPath(new URL('./schema.prisma', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const cli = `${repo}/node_modules/prisma/build/index.js`;
const port = Number(process.env.G8_LAB_PORT || 55439);
const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable&connection_limit=1`;
const db = new PGlite();
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
function prisma(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, '--schema', schema], { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Prisma exited ${code}`)));
  });
}
let client;
try {
  await server.start();
  await prisma(['migrate', 'deploy']);
  await prisma(['migrate', 'deploy']);
  client = new PrismaClient({ datasources: { db: { url } } });
  const when = new Date('2026-01-01T12:34:56.000Z');
  await client.importBatch.create({ data: { id: 'g8-sintetico', fileName: 'sintetico.csv', storedPath: 'sintetico.csv', fileSize: 0, rowCount: 1, researchQueueJson: JSON.stringify({ estado: 'PAUSADA' }) } });
  await client.importRow.create({ data: { id: 'g8-linha', batchId: 'g8-sintetico', rowNumber: 1, updatedAt: when } });
  const batch = await client.importBatch.findUniqueOrThrow({ where: { id: 'g8-sintetico' }, include: { rows: true } });
  assert.equal(batch.rows.length, 1);
  assert.equal(batch.rows[0].updatedAt.toISOString(), when.toISOString());
  assert.equal(JSON.parse(batch.researchQueueJson).estado, 'PAUSADA');
  await assert.rejects(client.importRow.create({ data: { id: 'g8-orfao', batchId: 'inexistente', rowNumber: 2 } }));
  await assert.rejects(client.$transaction(async tx => { await tx.importBatch.update({ where: { id: 'g8-sintetico' }, data: { fileName: 'temporario' } }); throw new Error('rollback'); }));
  assert.equal((await client.importBatch.findUniqueOrThrow({ where: { id: 'g8-sintetico' } })).fileName, 'sintetico.csv');
  const source = await readFile(`${repo}/src/lib/plano/planner.ts`, 'utf8');
  const match = source.match(/const \[r\] = await db\.\$queryRaw<FpRow\[]>`([\s\S]*?)`;/);
  assert.ok(match, 'consulta do planejador não localizada');
  let n = 0;
  const raw = match[1].replace(/\$\{batchId\}/g, () => `$${++n}`);
  const result = await client.$queryRawUnsafe(raw, ...Array(n).fill('g8-sintetico'));
  assert.equal(Number(result[0].row_count), 1);
  await client.importBatch.delete({ where: { id: 'g8-sintetico' } });
  assert.equal(await client.importRow.count(), 0);
  console.log('PASS: migration deploy/replay, Prisma CRUD, FK, data, JSON texto, transação, SQL real do planejador e cascata.');
} finally {
  if (client) await client.$disconnect();
  await server.stop();
  await db.close();
}
