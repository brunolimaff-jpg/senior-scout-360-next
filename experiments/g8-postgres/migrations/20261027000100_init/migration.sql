-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'CSV',
    "delimiter" TEXT NOT NULL DEFAULT ';',
    "encoding" TEXT NOT NULL DEFAULT 'UTF-8',
    "hasHeader" BOOLEAN NOT NULL DEFAULT true,
    "headerJson" TEXT NOT NULL DEFAULT '[]',
    "cnpjColumnIndex" INTEGER,
    "cnpjColumnDetect" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "totalValid" INTEGER NOT NULL DEFAULT 0,
    "totalInvalid" INTEGER NOT NULL DEFAULT 0,
    "totalDuplicate" INTEGER NOT NULL DEFAULT 0,
    "totalReference" INTEGER NOT NULL DEFAULT 0,
    "totalResolved" INTEGER NOT NULL DEFAULT 0,
    "totalEnriched" INTEGER NOT NULL DEFAULT 0,
    "totalPending" INTEGER NOT NULL DEFAULT 0,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiTotal" INTEGER NOT NULL DEFAULT 0,
    "aiDone" INTEGER NOT NULL DEFAULT 0,
    "aiFailed" INTEGER NOT NULL DEFAULT 0,
    "totalConfirmed" INTEGER NOT NULL DEFAULT 0,
    "totalReview" INTEGER NOT NULL DEFAULT 0,
    "totalUnresolved" INTEGER NOT NULL DEFAULT 0,
    "totalLocalizado" INTEGER NOT NULL DEFAULT 0,
    "totalValidado" INTEGER NOT NULL DEFAULT 0,
    "aiSummary" TEXT,
    "aiSummaryAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "researchQueueJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "originalCellsJson" TEXT NOT NULL DEFAULT '[]',
    "lookupKind" TEXT NOT NULL DEFAULT 'CNPJ',
    "referenceValue" TEXT,
    "resolvedCnpj" TEXT,
    "reverseSource" TEXT,
    "cluesJson" TEXT,
    "resolutionJson" TEXT,
    "resolutionState" TEXT,
    "resolutionConfidence" TEXT,
    "identityStage" TEXT,
    "identityDivergenciasJson" TEXT,
    "cnpjRoot" TEXT,
    "headquartersCnpj" TEXT,
    "foundIsHeadquarters" BOOLEAN,
    "matrizStatus" TEXT,
    "branchIdentifier" INTEGER,
    "rawCnpj" TEXT NOT NULL DEFAULT '',
    "normalizedCnpj" TEXT NOT NULL DEFAULT '',
    "cnpjStatus" TEXT NOT NULL DEFAULT 'SEM_CNPJ',
    "invalidReason" TEXT,
    "duplicateOf" INTEGER,
    "lookupStatus" TEXT NOT NULL DEFAULT 'PENDENTE',
    "lookupError" TEXT,
    "legalName" TEXT,
    "tradeName" TEXT,
    "registrationStatus" TEXT,
    "statusDate" TEXT,
    "situationReason" TEXT,
    "branchType" TEXT,
    "openingDate" TEXT,
    "cnaeCode" TEXT,
    "cnaeDescription" TEXT,
    "municipality" TEXT,
    "uf" TEXT,
    "source" TEXT,
    "queriedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "rawJson" TEXT,
    "sociosJson" TEXT,
    "extraJson" TEXT,
    "aiStatus" TEXT,
    "aiReading" TEXT,
    "aiSector" TEXT,
    "aiSize" TEXT,
    "aiProfile" TEXT,
    "aiHypothesesJson" TEXT,
    "aiQuestionsJson" TEXT,
    "aiDossierJson" TEXT,
    "aiModel" TEXT,
    "aiModelRequested" TEXT,
    "aiProcessedAt" TIMESTAMP(3),
    "aiError" TEXT,
    "researchJson" TEXT,
    "researchStatus" TEXT,
    "researchAt" TIMESTAMP(3),
    "researchError" TEXT,
    "dossierEvidenceSha" TEXT,
    "dossierSystemSha" TEXT,
    "dossierPromptVersion" TEXT,
    "dossierTemperature" DOUBLE PRECISION,
    "collectedAt" TIMESTAMP(3),
    "fontesJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadastroCache" (
    "cnpj" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "coletadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "dadosJson" TEXT NOT NULL,
    "provenienciaJson" TEXT NOT NULL DEFAULT '{}',
    "matrizJson" TEXT,
    "complementacoes" INTEGER NOT NULL DEFAULT 0,
    "revalidacoes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CadastroCache_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "event" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "batchId" TEXT,
    "rowId" TEXT,
    "rowNumber" INTEGER,
    "empresa" TEXT,
    "cnpj" TEXT,
    "etapa" TEXT,
    "tipo" TEXT NOT NULL,
    "fonte" TEXT,
    "operacao" TEXT,
    "alvo" TEXT,
    "httpStatus" INTEGER,
    "erro" TEXT,
    "tentativas" INTEGER,
    "cacheHit" BOOLEAN,
    "resultados" INTEGER,
    "aproveitaveis" INTEGER,
    "motivoDescarte" TEXT,
    "modeloSolicitado" TEXT,
    "modeloEfetivo" TEXT,
    "tokensPrompt" INTEGER,
    "tokensCompletion" INTEGER,
    "tokensTotal" INTEGER,
    "tokensInformado" BOOLEAN,
    "pacoteChars" INTEGER,
    "duracaoMs" INTEGER,
    "appVersao" TEXT,
    "promptVersao" TEXT,
    "estadoFinal" TEXT,
    "payloadJson" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabComparison" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "empresa" TEXT,
    "cnpj" TEXT,
    "provider" TEXT NOT NULL,
    "baseUrlPath" TEXT,
    "modelRequested" TEXT NOT NULL,
    "modelEffective" TEXT,
    "promptVersion" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "systemPromptSha" TEXT,
    "evidenceChars" INTEGER,
    "evidenceHash" TEXT,
    "packetReuse" BOOLEAN NOT NULL,
    "content" TEXT,
    "parsedOk" BOOLEAN,
    "tokensPrompt" INTEGER,
    "tokensCompletion" INTEGER,
    "tokensTotal" INTEGER,
    "tokensInformado" BOOLEAN,
    "durationMs" INTEGER,
    "httpStatus" INTEGER,
    "error" TEXT,
    "estadoFinal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelacaoSocietariaCache" (
    "cnpj" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "baseDados" TEXT,
    "coletadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "relacoesJson" TEXT NOT NULL,
    "totalParticipantes" INTEGER NOT NULL DEFAULT 0,
    "avisosJson" TEXT,

    CONSTRAINT "RelacaoSocietariaCache_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "QuadroParticipanteCache" (
    "participanteId" TEXT NOT NULL,
    "tipoParticipante" TEXT NOT NULL,
    "rotulo" TEXT,
    "fonte" TEXT NOT NULL,
    "baseDados" TEXT,
    "coletadoEm" TIMESTAMP(3) NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "empresasJson" TEXT NOT NULL,
    "totalEmpresas" INTEGER NOT NULL DEFAULT 0,
    "truncado" BOOLEAN NOT NULL DEFAULT false,
    "avisosJson" TEXT,

    CONSTRAINT "QuadroParticipanteCache_pkey" PRIMARY KEY ("participanteId")
);

-- CreateTable
CREATE TABLE "EstabelecimentoRootCache" (
    "cnpjRaiz" TEXT NOT NULL,
    "fonteDescoberta" TEXT NOT NULL,
    "coletadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "estabelecimentosJson" TEXT NOT NULL,
    "coberturaJson" TEXT NOT NULL,
    "raizAlfanumerica" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EstabelecimentoRootCache_pkey" PRIMARY KEY ("cnpjRaiz")
);

-- CreateIndex
CREATE INDEX "ImportRow_batchId_rowNumber_idx" ON "ImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportRow_lookupStatus_idx" ON "ImportRow"("lookupStatus");

-- CreateIndex
CREATE INDEX "ImportRow_aiStatus_idx" ON "ImportRow"("aiStatus");

-- CreateIndex
CREATE INDEX "ImportRow_resolutionState_idx" ON "ImportRow"("resolutionState");

-- CreateIndex
CREATE INDEX "CadastroCache_validoAte_idx" ON "CadastroCache"("validoAte");

-- CreateIndex
CREATE INDEX "AuditEvent_batchId_createdAt_idx" ON "AuditEvent"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_batchId_startedAt_idx" ON "TelemetryEvent"("batchId", "startedAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_runId_idx" ON "TelemetryEvent"("runId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_tipo_idx" ON "TelemetryEvent"("tipo");

-- CreateIndex
CREATE INDEX "LabComparison_rowId_createdAt_idx" ON "LabComparison"("rowId", "createdAt");

-- CreateIndex
CREATE INDEX "LabComparison_batchId_idx" ON "LabComparison"("batchId");

-- CreateIndex
CREATE INDEX "RelacaoSocietariaCache_validoAte_idx" ON "RelacaoSocietariaCache"("validoAte");

-- CreateIndex
CREATE INDEX "QuadroParticipanteCache_validoAte_idx" ON "QuadroParticipanteCache"("validoAte");

-- CreateIndex
CREATE INDEX "EstabelecimentoRootCache_validoAte_idx" ON "EstabelecimentoRootCache"("validoAte");

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
