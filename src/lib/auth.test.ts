/**
 * Trava P0 do authMode() — fail-closed em produção (issue #12, P0-1).
 *
 * Regressão versionada dos 4 critérios: produção sem configuração fecha,
 * produção com token exige credencial (header/Bearer/cookie), o modo local
 * segue aberto e /api + /api/qa/pacote herdam a mesma guarda. Sem banco e sem
 * rede: importa o módulo real e as rotas que dependem da guarda.
 */
// @ts-ignore — `bun:test` é fornecido pelo runtime; bun-types não está no `types` do tsconfig.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET as healthGET } from "../app/api/route";
import { GET as pacoteGET } from "../app/api/qa/pacote/route";
import { assertAccess, authConfigError, authMode, tryIssueSession } from "./auth";

const ENV_KEYS = ["NODE_ENV", "SCOUT_EXPORT_TOKEN", "SCOUT_AUTH_REQUIRED"] as const;
const saved: Record<string, string | undefined> = {};
const TOKEN = "segredo-de-teste-com-tamanho-fixo";

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function pedido(caminho = "/api/stats", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${caminho}`, { headers });
}

describe("SCOUT-P0-001 — produção nunca em OPEN", () => {
  test("produção sem configuração: 503 AUTH_MISCONFIG em dados, /api e /api/qa/pacote", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SCOUT_EXPORT_TOKEN;
    delete process.env.SCOUT_AUTH_REQUIRED;

    expect(authMode()).toBe("OPEN");
    expect(authConfigError()).not.toBeNull();

    const denied = await assertAccess(pedido());
    expect(denied?.status).toBe(503);
    expect(denied?.headers.get("cache-control")).toBe("no-store");
    expect((await denied!.json()).error.code).toBe("AUTH_MISCONFIG");

    const saude = await (await healthGET()).json();
    expect(saude.configError).not.toBeNull();

    const pacote = await pacoteGET(pedido("/api/qa/pacote"));
    expect(pacote.status).toBe(503);
  });

  test("produção com token: anônimo 401, header/Bearer válidos passam, token errado de mesmo tamanho 401", async () => {
    process.env.NODE_ENV = "production";
    process.env.SCOUT_EXPORT_TOKEN = TOKEN;
    delete process.env.SCOUT_AUTH_REQUIRED;

    expect(authMode()).toBe("TOKEN");
    expect(authConfigError()).toBeNull();
    expect((await assertAccess(pedido()))?.status).toBe(401);
    expect(await assertAccess(pedido("/api/stats", { "x-export-token": TOKEN }))).toBeNull();
    expect(await assertAccess(pedido("/api/stats", { authorization: `Bearer ${TOKEN}` }))).toBeNull();
    expect((await assertAccess(pedido("/api/stats", { "x-export-token": "x".repeat(TOKEN.length) })))?.status).toBe(401);
  });

  test("produção com token: cookie de sessão emitido por tryIssueSession passa", async () => {
    process.env.NODE_ENV = "production";
    process.env.SCOUT_EXPORT_TOKEN = TOKEN;
    delete process.env.SCOUT_AUTH_REQUIRED;

    const cookie = await tryIssueSession(TOKEN);
    expect(cookie).not.toBeNull();
    const cookieHeader = cookie!.split(";")[0];
    expect(await assertAccess(pedido("/api/stats", { cookie: cookieHeader }))).toBeNull();
  });

  test("desenvolvimento local sem env: aberto e sem configError", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SCOUT_EXPORT_TOKEN;
    delete process.env.SCOUT_AUTH_REQUIRED;

    expect(authMode()).toBe("OPEN");
    expect(authConfigError()).toBeNull();
    expect(await assertAccess(pedido())).toBeNull();
  });
});
