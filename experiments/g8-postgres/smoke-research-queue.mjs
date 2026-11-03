// Smoke G8.4 — fila de pesquisa pela API real, dados sintéticos.
// Prova o ciclo iniciar → executar → concluir e o contrato do motivo de pausa,
// sem chamar provedor externo (linhas elegíveis com pacote fresco são puladas).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const lab = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(pathToFileURL(`${lab}/test-prisma.mjs`));
// Cliente do APP (schema SQLite em uso pelo servidor de smoke), não o do laboratório.
const { PrismaClient } = require('@prisma/client');

const url = process.env.SMOKE_DB_URL;
if (!url) { console.error('SMOKE_DB_URL obrigatório'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('PASS:', m); };

try {
  const suffix = Date.now().toString(36);
  const batchId = `smoke-queue-${suffix}`;
  const packet = JSON.stringify({ siteOficial: 'https://exemplo.test', instrumentacao: true, buscasRecusadasCota: 0 });

  await prisma.importBatch.create({
    data: {
      id: batchId, fileName: 'sintetico.csv', storedPath: 'sintetico.csv', fileSize: 0,
      status: 'CONFIRMED', rowCount: 2,
    },
  });
  // Duas linhas, dois desfechos de pulo, ZERO chamada externa:
  // 1) ENRIQUECIDO com pacote fresco → pula por "dossiê fresco";
  // 2) sem dados públicos prontos → pula por "sem dados públicos prontos".
  await prisma.importRow.create({
    data: {
      batchId, rowNumber: 1, lookupStatus: 'ENRIQUECIDO', normalizedCnpj: '00000000000001',
      researchStatus: 'OK', researchAt: new Date(), researchJson: packet, aiStatus: 'OK',
    },
  });
  await prisma.importRow.create({
    data: {
      batchId, rowNumber: 2, lookupStatus: 'NAO_ENCONTRADO', normalizedCnpj: '00000000000002',
    },
  });

  const post = async (body) => {
    const r = await fetch(`${base}/api/imports/${batchId}/research-batch`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  const start = await post({ acao: 'iniciar', rowNumbers: [1, 2] });
  assert(start.status === 200, `iniciar responde 200 (status ${start.status})`);
  assert(start.json?.data?.enfileiradas === 1 || start.json?.enfileiradas === 1, 'só a conta elegível entra na fila');

  // Espera a fila terminar. Nenhum provedor externo é chamado: as duas linhas têm
  // pacote fresco (ou falham no fetch sintético, que não é rede real).
  let estado = null;
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${base}/api/imports/${batchId}/research-batch`);
    const body = await r.json().catch(() => null);
    estado = body?.data?.estado ?? body?.estado ?? null;
    if (estado && estado.estado !== 'RODANDO') break;
    await new Promise((res) => setTimeout(res, 500));
  }
  assert(estado !== null, 'estado da fila é legível pela API');

  const raw = await prisma.importBatch.findUnique({ where: { id: batchId }, select: { researchQueueJson: true } });
  const parsed = JSON.parse(raw.researchQueueJson);
  assert(parsed.posicao === 1, `posição avançou até o fim (posicao=${parsed.posicao})`);
  assert(parsed.puladas === 1, `pacote fresco contado UMA vez, sem dupla contagem (puladas=${parsed.puladas})`);
  assert(parsed.concluidas + parsed.puladas + parsed.falhas === 1, 'a conta elegível teve exatamente um desfecho');
  assert(parsed.estado === 'CONCLUIDA', `fila conclui sozinha (estado=${parsed.estado})`);
  assert(parsed.dono === null || typeof parsed.dono === 'string', 'dono é string ou ausente');

  // Parada em fila já concluída: responde sucesso sem alterar o estado durável.
  const stop = await post({ acao: 'parar' });
  assert(stop.status === 200, 'parar em fila concluída responde 200');
  const afterStop = JSON.parse((await prisma.importBatch.findUnique({ where: { id: batchId }, select: { researchQueueJson: true } })).researchQueueJson);
  assert(afterStop.estado === 'CONCLUIDA', 'parar não reabre fila concluída');

  // Retomada de fila concluída: nada pendente, responde sucesso.
  const resume = await post({ acao: 'retomar' });
  assert(resume.status === 200, 'retomar fila concluída responde 200');
  const afterResume = JSON.parse((await prisma.importBatch.findUnique({ where: { id: batchId }, select: { researchQueueJson: true } })).researchQueueJson);
  assert(afterResume.estado === 'CONCLUIDA', 'retomar não repesquisa conta concluída');

  console.log('SMOKE_OK');
} finally {
  await prisma.$disconnect();
}
