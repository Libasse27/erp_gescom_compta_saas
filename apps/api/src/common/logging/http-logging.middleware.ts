import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { StructuredLoggerService } from "./structured-logger.service";

// Doit s'exécuter APRÈS TenantContextMiddleware (voir app.module.ts) : le
// listener 'finish' enregistré ci-dessous hérite de l'AsyncLocalStorage
// actif au moment de sa création (RequestContext toujours, TenantContext si
// authentifié) — le construire plus tôt dans la chaîne le priverait du
// tenantId au moment où il se déclenche.
@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: StructuredLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      this.logger.logHttpRequest({
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  }
}
