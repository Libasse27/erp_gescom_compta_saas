import { Injectable, LoggerService } from "@nestjs/common";
import { RequestContext } from "./request-context";
import { TenantContext } from "../../tenant/tenant-context";
import { env } from "../../config/env";

type Level = "verbose" | "debug" | "log" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<Level, number> = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface HttpLogEntry {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

// Implémente l'interface LoggerService de Nest : passé à NestFactory.create
// (main.ts), il devient la sortie de TOUT `new Logger(context)` de
// l'application (bootstrap Nest inclus), sans avoir à injecter quoi que ce
// soit partout — comportement standard du static Logger de Nest. Une seule
// ligne JSON par appel ("JSON lines"), consommable telle quelle par
// n'importe quel agrégateur de logs (Loki, CloudWatch, ELK...). Voir
// docs/deployment/LOGGING.md pour le format complet et sa justification.
@Injectable()
export class StructuredLoggerService implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("log", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("verbose", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  // Utilisé par HttpLoggingMiddleware — champs structurés dédiés
  // (method/path/statusCode/durationMs) plutôt qu'un message texte formaté,
  // pour rester interrogeable (ex. filtrer statusCode >= 500) dans un
  // agrégateur de logs.
  logHttpRequest(entry: HttpLogEntry): void {
    const level: Level = entry.statusCode >= 500 ? "error" : entry.statusCode >= 400 ? "warn" : "log";
    this.emit(level, {
      message: `${entry.method} ${entry.path} ${entry.statusCode} ${entry.durationMs.toFixed(1)}ms`,
      context: "HTTP",
      ...entry,
    });
  }

  private write(level: Level, message: unknown, optionalParams: unknown[]): void {
    let context: string | undefined;
    let stack: string | undefined;

    if (level === "error" && optionalParams.length >= 2) {
      // Convention Nest : error(message, trace, context).
      [stack, context] = optionalParams as [string, string];
    } else if (optionalParams.length >= 1) {
      const last = optionalParams[optionalParams.length - 1];
      if (typeof last === "string") {
        context = last;
      }
      if (level === "error" && optionalParams.length === 1 && typeof optionalParams[0] === "string" && optionalParams[0].includes("\n")) {
        // Un seul paramètre qui ressemble à une stack trace plutôt qu'à un
        // contexte (ex. logger.error(err.message, err.stack)).
        stack = optionalParams[0] as string;
        context = undefined;
      }
    }

    this.emit(level, {
      message: typeof message === "string" ? message : JSON.stringify(message),
      ...(context ? { context } : {}),
      ...(stack ? { stack } : {}),
    });
  }

  private emit(level: Level, fields: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < (LEVEL_PRIORITY[env.logLevel() as Level] ?? LEVEL_PRIORITY.log)) {
      return;
    }

    const requestId = RequestContext.getRequestId();
    const tenantStore = TenantContext.getStore();

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      ...fields,
      ...(requestId ? { requestId } : {}),
      ...(tenantStore ? { tenantId: tenantStore.tenantId, userId: tenantStore.userId } : {}),
    };

    const line = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
