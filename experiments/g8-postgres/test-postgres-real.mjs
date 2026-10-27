import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
function run(args) { return new Promise((resolve,reject) => { const child=spawn(process.execPath,[`${repo}/node_modules/prisma/build/index.js`,...args,'--schema',`${lab}/schema.prisma`],{cwd:repo,env:{...process.env,DATABASE_URL:url},stdio:'inherit'}); child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error(`Prisma exit ${code}`))); }); }
try {
  await postgres.initialise();
  await postgres.start(); started = true;
  await run(['migrate','deploy']);
  await run(['migrate','deploy']);
  const a=new PrismaClient({datasources:{db:{url}}}), b=new PrismaClient({datasources:{db:{url}}}); clients.push(a,b);
  await Promise.all([a.$connect(),b.$connect()]);
  const ids=await Promise.all([a.$queryRaw`SELECT pg_backend_pid() AS pid`,b.$queryRaw`SELECT pg_backend_pid() AS pid`]);
  assert.notEqual(ids[0][0].pid,ids[1][0].pid,'conexões independentes');
  const batch='g8-native-synthetic';
  await a.importBatch.create({data:{id:batch,fileName:'sintetico.csv',storedPath:'sintetico.csv',fileSize:0,researchQueueJson:JSON.stringify({estado:'PAUSADA'})}});
  const date=new Date('2026-01-01T12:34:56.000Z');
  await a.importRow.create({data:{id:'g8-native-row',batchId:batch,rowNumber:1,updatedAt:date}});
  assert.equal((await a.importRow.findUniqueOrThrow({where:{id:'g8-native-row'}})).updatedAt.toISOString(),date.toISOString());
  assert.equal(JSON.parse((await a.importBatch.findUniqueOrThrow({where:{id:batch}})).researchQueueJson).estado,'PAUSADA');
  await assert.rejects(a.importRow.create({data:{id:'g8-orphan',batchId:'absent',rowNumber:2}}));
  await assert.rejects(a.$transaction(async t=>{await t.importBatch.update({where:{id:batch},data:{fileName:'rollback.csv'}});throw new Error('rollback');}));
  assert.equal((await a.importBatch.findUniqueOrThrow({where:{id:batch}})).fileName,'sintetico.csv');
  const src=await readFile(`${repo}/src/lib/plano/planner.ts`,'utf8');
  const raw=src.match(/const \[r\] = await db\.\$queryRaw<FpRow\[]>`([\s\S]*?)`;/)?.[1]; assert.ok(raw);
  let n=0; const sql=raw.replace(/\$\{batchId\}/g,()=>`$${++n}`);
  assert.equal(Number((await a.$queryRawUnsafe(sql,...Array(n).fill(batch)))[0].row_count),1);
  const lease=async(client,owner)=>client.importBatch.updateMany({where:{id:batch,OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lt:new Date()}}]},data:{leaseOwner:owner,leaseExpiresAt:new Date(Date.now()+60000)}});
  const results=await Promise.all([lease(a,'worker-a'),lease(b,'worker-b')]);
  assert.equal(results[0].count+results[1].count,1,'apenas um claim');
  const winner=results[0].count?'worker-a':'worker-b', loser=winner==='worker-a'?'worker-b':'worker-a';
  assert.equal((await b.importBatch.updateMany({where:{id:batch,leaseOwner:loser},data:{leaseExpiresAt:new Date(Date.now()+60000)}})).count,0);
  assert.equal((await a.importBatch.updateMany({where:{id:batch,leaseOwner:winner},data:{leaseExpiresAt:new Date(Date.now()+60000)}})).count,1);
  await a.importBatch.update({where:{id:batch},data:{leaseExpiresAt:new Date(Date.now()-1000)}});
  assert.equal((await lease(b,loser)).count,1);
  assert.equal((await a.importBatch.updateMany({where:{id:batch,leaseOwner:winner},data:{leaseExpiresAt:new Date(Date.now()+60000)}})).count,0);
  await a.importBatch.delete({where:{id:batch}}); assert.equal(await a.importRow.count(),0);
  console.log('PASS: PostgreSQL 17 local; replay migration; Prisma CRUD/FK/UTC/JSON/rollback/SQL/cascata; duas conexões independentes: claim exclusivo, heartbeat e retomada após expiração.');
  console.log('LIMITES: apenas o contrato do lease foi testado; execução integral, cancelamento de tarefas e fila de pesquisa não foram testados. Cluster sintético:',directory);
} finally {
  await Promise.all(clients.map(c=>c.$disconnect()));
  if(started) await postgres.stop();
}
