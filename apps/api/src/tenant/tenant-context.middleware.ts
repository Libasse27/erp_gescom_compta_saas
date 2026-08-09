import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { TokenService } from "../auth/token.service";
import { TenantContext } from "./tenant-context";

// S'exécute AVANT les guards (JwtAuthGuard inclus) : c'est la seule façon
// d'envelopper tout le reste de la requête dans l'AsyncLocalStorage — un
// guard ne peut pas "encapsuler" ce qui vient après lui, seulement
// autoriser/refuser. Ne fait aucune vérification d'autorisation : c'est
// strictement le rôle de JwtAuthGuard, qui s'exécute ensuite indépendamment.
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tokenService: TokenService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      next();
      return;
    }

    try {
      const payload = this.tokenService.verifyAccessToken(authHeader.slice("Bearer ".length));

      // Un Super Admin n'appartient à aucune entreprise : pas de contexte
      // tenant pour lui (les routes plateforme n'en ont pas besoin).
      if (!payload.enterpriseId) {
        next();
        return;
      }

      TenantContext.run(
        { tenantId: payload.enterpriseId, userId: payload.sub, isSuperAdmin: payload.isSuperAdmin },
        next,
      );
    } catch {
      // JWT invalide/expiré : aucun contexte peuplé. JwtAuthGuard rejettera
      // la requête plus loin dans le pipeline pour les routes protégées.
      next();
    }
  }
}
