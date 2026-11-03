// G8.4 — contrato de claim da FILA DE PESQUISA em duas conexões independentes.
// Objetivo: medir se `researchQueueJson` (estado da fila) suporta dois executores sem
// duplicar trabalho. Não valida runBatch nem chamadas externas: só o claim do estado.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const lab = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const pgModule = await import('embedded-postgres');
const EmbeddedPostgres = pgModule.default;
const require = createRequire(pathToFileURL(`${lab}/test-prisma.mjs`));
const { PrismaClient } = require('./generated-client');
const port = 55440;
const password = randomBytes(24).toString('hex');
const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres?sslmode=disable&connection_limit=2`;
const directory = `${lab}/cluster-${randomBytes(6).toString('hex')}`;
const postgres = new EmbeddedPostgres({ databaseDir: directory, port, user:'postgres', password, persistent:true, createPostgresUser:false, initdbFlags:['--locale=C','--encoding=UTF8'], postgresFlags:['-h','127.0.0.1'], onLog: () => {}, onError: e => console.error('PostgreSQL:', String(e)) });
let started = false;
const clients = [];
function run(args) { return new Promise((resolve,reject) => { const child=spawn(process.execPath,[`${repo}/node_modules/prisma/build/index.js`,...args,'--schema',`${lab}/schema.prisma`],{cwd:repo,env:{...process.env,DATABASE_URL:url},stdio:'ignore'}); child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error(`Prisma exit ${code}`))); }); }

try {
  await postgres.initialise();
  await postgres.start(); started = true;
  await run(['migrate','deploy']);

  const a = new PrismaClient({datasources:{db:{url}}});
  const b = new PrismaClient({datasources:{db:{url}}});
  clients.push(a,b);
  await Promise.all([a.$connect(),b.$connect()]);

  const batch = 'g8-queue-race';
  const queue = { estado:'RODANDO', rowNumbers:[1,2,3], posicao:0, concluidas:0, puladas:0, falhas:0, heartbeat:new Date().toISOString(), solicitadoEm:new Date().toISOString(), modoPesquisa:'COMPLETO', motivoPausa:null };
  await a.importBatch.create({data:{id:batch,fileName:'sintetico.csv',storedPath:'sintetico.csv',fileSize:0,researchQueueJson:JSON.stringify(queue)}});

  // ---- Observação A: update cego (o que `writeQueue` faz hoje) ----
  // Dois executores leem o MESMO estado e cada um grava por cima.
  const [ra, rb] = await Promise.all([
    a.importBatch.findUnique({where:{id:batch},select:{researchQueueJson:true}}),
    b.importBatch.findUnique({where:{id:batch},select:{researchQueueJson:true}}),
  ]);
  assert.equal(ra.researchQueueJson, rb.researchQueueJson, 'ambos leem o mesmo estado sem lock');

  const stateA = { ...JSON.parse(ra.researchQueueJson), posicao:1, concluidas:1 };
  const stateB = { ...JSON.parse(rb.researchQueueJson), posicao:1, concluidas:1 };
  // mesma linha processada por dois workers; ambos respondem sucesso (count 1 de cada)
  const [wa, wb] = await Promise.all([
    a.importBatch.updateMany({where:{id:batch},data:{researchQueueJson:JSON.stringify(stateA)}}),
    b.importBatch.updateMany({where:{id:batch},data:{researchQueueJson:JSON.stringify(stateB)}}),
  ]);
  console.log('OBS-A updateMany cego: escritas aceitas =', wa.count + wb.count, '(esperado 2 — nenhuma exclusão)');
  const final = JSON.parse((await a.importBatch.findUniqueOrThrow({where:{id:batch}})).researchQueueJson);
  console.log('OBS-A estado final posicao =', final.posicao, 'concluidas =', final.concluidas, '(linhas 1..3; só 1 posição avançou)');

  // ---- Observação B: o que seria claim condicional de posição ----
  // Esperado para um claim correto: só quem vê posicao=N atualiza para N+1.
  await a.importBatch.update({where:{id:batch},data:{researchQueueJson:JSON.stringify(queue)}});
  const claim = (client, from) => client.importBatch.updateMany({
    where: { id: batch, researchQueueJson: { equals: JSON.stringify({ ...queue, posicao: from }) } },
    data: { researchQueueJson: JSON.stringify({ ...queue, posicao: from + 1 }) },
  });
  // Nota: igualdade do JSON inteiro só funciona porque sabemos o snapshot exato.
  // Se o heartbeat mudar a string, o claim falha — mostra que JSON não é chave de claim.
  const [ca, cb] = await Promise.all([claim(a,0), claim(b,0)]);
  console.log('OBS-B claim por igualdade de JSON textual: vencedores =', ca.count + cb.count, '(esperado 1)');

  // ---- Observação C: compare-and-set com versão explícita é possível mas exige coluna ----
  // Sem coluna de versão no schema, CAS sobre JSON é frágil a qualquer campo mutável.
  const schema = await a.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'ImportBatch' AND column_name ILIKE '%version%'`;
  console.log('OBS-C coluna de versão dedicada em ImportBatch =', schema.length, '(esperado 0 — CAS precisa de coluna)');

  // ---- Observação D: proposta de fix mínimo — CAS sobre a string JSON recém-lida ----
  // Mesmo formato do claimBatchLease: updateMany condicional, 1 vencedor. Sem schema novo.
  await a.importBatch.update({where:{id:batch},data:{researchQueueJson:JSON.stringify(queue)}});
  const casWrite = async (client, raw, next) => (await client.importBatch.updateMany({
    where: { id: batch, researchQueueJson: raw },           // <- a string EXATA lida
    data: { researchQueueJson: JSON.stringify(next) },
  })).count;
  const [rawA, rawB] = await Promise.all([
    a.importBatch.findUniqueOrThrow({where:{id:batch},select:{researchQueueJson:true}}),
    b.importBatch.findUniqueOrThrow({where:{id:batch},select:{researchQueueJson:true}}),
  ]);
  assert.equal(rawA.researchQueueJson, rawB.researchQueueJson);
  const claimedA = { ...JSON.parse(rawA.researchQueueJson), posicao:1, concluidas:1, heartbeat:new Date().toISOString() };
  const claimedB = { ...JSON.parse(rawB.researchQueueJson), posicao:1, concluidas:1, heartbeat:new Date().toISOString() };
  const [da, db] = await Promise.all([
    casWrite(a, rawA.researchQueueJson, claimedA),
    casWrite(b, rawB.researchQueueJson, claimedB),
  ]);
  console.log('OBS-D CAS na string lida: vencedores =', da + db, '(esperado 1 — fix viável sem schema novo)');
  assert.equal(da + db, 1, 'CAS deve eleger exatamente um executor');

  // ---- Observação E: CAS depois que outro escriba mexeu no JSON (heartbeat) ----
  // Um terceiro escritor altera o heartbeat; o claim antigo do executor fica obsoleto.
  const stale = (await a.importBatch.findUniqueOrThrow({where:{id:batch},select:{researchQueueJson:true}})).researchQueueJson;
  await b.importBatch.update({where:{id:batch},data:{researchQueueJson:JSON.stringify({...JSON.parse(stale), heartbeat:new Date(Date.now()+1000).toISOString()})}});
  const staleWinner = await casWrite(a, stale, {...JSON.parse(stale), posicao:2});
  console.log('OBS-E CAS com JSON obsoleto: vencedores =', staleWinner, '(esperado 0 — escritor perdedor detecta e relê)');

  // ---- Observação F: G8.3 — role de aplicação sem privilégios de owner/DDL ----
  // Mede o que a fronteira de acesso daria: SELECT/INSERT/UPDATE/SELECT em tabelas do app,
  // nenhum DDL, nenhum acesso a pg_catalog sensível.
  await a.$executeRawUnsafe(`DROP ROLE IF EXISTS scout_app`);
  await a.$executeRawUnsafe(`CREATE ROLE scout_app LOGIN PASSWORD '${password}'`);
  await a.$executeRawUnsafe(`GRANT CONNECT ON DATABASE postgres TO scout_app`);
  await a.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO scout_app`);
  await a.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scout_app`);
  await a.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM scout_app`);
  const appUrl = url.replace('postgres:','scout_app:');
  const appClient = new PrismaClient({datasources:{db:{url:appUrl}}});
  clients.push(appClient);
  await appClient.$connect();
  const readOk = (await appClient.importBatch.count()) >= 0;
  let ddlDenied = false;
  try { await appClient.$executeRawUnsafe(`CREATE TABLE scout_app_escape (id int)`); } catch { ddlDenied = true; }
  console.log('OBS-F role app: leitura =', readOk, '| DDL negado =', ddlDenied, '(esperado: true | true)');
  assert.equal(readOk, true);
  assert.equal(ddlDenied, true);

  // ---- Observação G: RLS habilitado por padrão? (no Supabase é; no PG puro, não) ----
  const rls = await a.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE relname = 'ImportBatch'`;
  console.log('OBS-G RLS em ImportBatch =', rls[0]?.relrowsecurity, '(PG puro: false — RLS é do Supabase/hospedagem, não do schema)');
  await a.importBatch.delete({where:{id:batch}});
  console.log('FIM: medição concluída. Cluster sintético:', directory);
} finally {
  await Promise.all(clients.map(c=>c.$disconnect()));
  if (started) await postgres.stop();
}
