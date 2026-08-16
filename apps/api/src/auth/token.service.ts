import { randomBytes, createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string;
  enterpriseId: string | null;
  isSuperAdmin: boolean;
}

export interface MfaChallengePayload {
  sub: string;
  type: "mfa_challenge";
}

// Corrige SEC-01 (docs/audit/SECURITY-AUDIT.md) : access token et jeton de
// défi MFA partagent le même secret (JWT_ACCESS_SECRET) et sont émis par le
// même JwtService, sans quoi les deux se distinguaient uniquement par un
// champ `type` vérifié d'un seul côté (verifyMfaChallengeToken), jamais par
// verifyAccessToken. Un jeton de défi MFA (obtenu avec le seul mot de passe,
// avant tout second facteur) franchissait donc JwtAuthGuard comme un jeton
// de session complet. `typ` distingue désormais les deux côtés ; issuer et
// audience réduisent la surface de rejeu d'un jeton émis pour un autre
// usage/service partageant par erreur le même secret.
const ACCESS_TOKEN_TYPE = "access";
const JWT_ISSUER = "erp-gescom-compta-saas-api";
const JWT_AUDIENCE = "erp-gescom-compta-saas-clients";

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(user: { id: string; enterpriseId: string | null; isSuperAdmin: boolean }): string {
    return this.jwtService.sign(
      { typ: ACCESS_TOKEN_TYPE, enterpriseId: user.enterpriseId, isSuperAdmin: user.isSuperAdmin },
      {
        subject: user.id,
        expiresIn: env.jwtAccessTtl(),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: "HS256",
      },
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = this.jwtService.verify<{
      sub: string;
      typ?: string;
      enterpriseId: string | null;
      isSuperAdmin: boolean;
    }>(token, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithms: ["HS256"] });

    if (payload.typ !== ACCESS_TOKEN_TYPE) {
      throw new Error("Jeton invalide : type incorrect");
    }

    return { sub: payload.sub, enterpriseId: payload.enterpriseId, isSuperAdmin: payload.isSuperAdmin };
  }

  // Jeton intermédiaire à courte durée de vie (5 min) : atteste que le mot de
  // passe a déjà été vérifié pour ce user, sans encore accorder de session.
  signMfaChallengeToken(userId: string): string {
    return this.jwtService.sign(
      { type: "mfa_challenge" },
      { subject: userId, expiresIn: "5m", issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: "HS256" },
    );
  }

  verifyMfaChallengeToken(token: string): MfaChallengePayload {
    const payload = this.jwtService.verify<{ sub: string; type: string }>(token, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (payload.type !== "mfa_challenge") {
      throw new Error("Jeton de défi MFA invalide");
    }
    return { sub: payload.sub, type: "mfa_challenge" };
  }

  // Valeur opaque (pas un JWT) : la seule autorité est la base de données
  // (RefreshToken.tokenHash), ce qui rend la révocation immédiate et triviale.
  generateOpaqueToken(): string {
    return randomBytes(48).toString("base64url");
  }

  generateFamilyId(): string {
    return randomUUID();
  }

  hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
}
