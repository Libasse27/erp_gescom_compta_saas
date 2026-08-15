import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { RequestContext } from "./request-context";

// Doit s'exécuter en tout premier, avant TenantContextMiddleware (voir
// app.module.ts) : c'est la seule façon d'englober la requête entière —
// y compris les routes publiques qui n'ouvrent jamais de TenantContext —
// dans l'AsyncLocalStorage lu ensuite par StructuredLoggerService.
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Un reverse proxy en amont (Caddy, Phase 10.6) peut déjà porter un id
    // de corrélation ; sinon on en génère un. Valeur utilisée uniquement
    // pour grouper des lignes de log entre elles, jamais pour une décision
    // de sécurité — un id falsifié par un client n'a donc pas d'impact.
    const incoming = req.headers["x-request-id"];
    const requestId = typeof incoming === "string" && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    res.setHeader("X-Request-Id", requestId);
    RequestContext.run({ requestId }, next);
  }
}
