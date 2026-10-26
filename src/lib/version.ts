/**
 * Versão do aplicativo para telemetria/auditoria.
 * Fonte única: package.json (lido uma vez no boot do processo server).
 * Nunca inventar versão — se a leitura falhar, registra "desconhecida".
 */
import { readFileSync } from "fs";
import path from "path";

let cachedVersion: string | null = null;

export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    cachedVersion = typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : "desconhecida";
  } catch {
    cachedVersion = "desconhecida";
  }
  return cachedVersion;
}
