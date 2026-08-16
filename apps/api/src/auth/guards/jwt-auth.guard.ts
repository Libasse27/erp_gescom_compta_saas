import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { TokenService } from "../token.service";
import { AuthenticatedUser } from "../types";

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

interface CachedAccountStatus {
  active: boolean;
  expiresAt: number;
}

// Corrige BIL-04 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, seule la
// signature du JWT était vérifiée ici, jamais l'état du compte/entreprise
// en base. AuthService (SEC-03) revalide bien User.status/Enterprise.status
// au login et au refresh, mais un access token déjà émis (valide jusqu'à
// 15 min, env.jwtAccessTtl) restait pleinement utilisable sur toute cette
// fenêtre après une suspension — et une entreprise suspendue par le Super
// Admin (super-admin.service.ts) n'avait aucun levier pour couper l'accès
// avant l'expiration naturelle du jeton. Revalidé désormais à chaque
// requête authentifiée, via la connexion d'identité (PrismaService,
// docs/adr/0018-...) puisque cette vérification doit s'appliquer même hors
// TenantContext (Super Admin). Court cache mémoire par processus — même
// patron que EntitlementsService — pour borner la charge Postgres ; TTL 0
// en test pour un comportement déterministe (voir test/setup-env.js).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly statusCache = new Map<string, CachedAccountStatus>();

  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Authentification requise");
    }

    let payload;
    try {
      payload = this.tokenService.verifyAccessToken(authHeader.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Jeton invalide ou expiré");
    }

    if (!(await this.isAccountActive(payload.sub))) {
      throw new UnauthorizedException("Compte ou entreprise suspendu(e)");
    }

    request.user = { id: payload.sub, enterpriseId: payload.enterpriseId, isSuperAdmin: payload.isSuperAdmin };
    return true;
  }

  private async isAccountActive(userId: string): Promise<boolean> {
    const cached = this.statusCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.active;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { enterprise: true } });
    const active = !!user && user.status === "ACTIVE" && (!user.enterprise || user.enterprise.status === "ACTIVE");

    const ttl = env.accountStatusCacheTtlMs();
    if (ttl > 0) {
      this.statusCache.set(userId, { active, expiresAt: Date.now() + ttl });
    }
    return active;
  }
}
