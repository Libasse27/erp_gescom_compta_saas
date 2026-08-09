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

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(user: { id: string; enterpriseId: string | null; isSuperAdmin: boolean }): string {
    return this.jwtService.sign(
      { enterpriseId: user.enterpriseId, isSuperAdmin: user.isSuperAdmin },
      { subject: user.id, expiresIn: env.jwtAccessTtl() },
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = this.jwtService.verify<{ sub: string; enterpriseId: string | null; isSuperAdmin: boolean }>(token);
    return { sub: payload.sub, enterpriseId: payload.enterpriseId, isSuperAdmin: payload.isSuperAdmin };
  }

  // Jeton intermédiaire à courte durée de vie (5 min) : atteste que le mot de
  // passe a déjà été vérifié pour ce user, sans encore accorder de session.
  signMfaChallengeToken(userId: string): string {
    return this.jwtService.sign({ type: "mfa_challenge" }, { subject: userId, expiresIn: "5m" });
  }

  verifyMfaChallengeToken(token: string): MfaChallengePayload {
    const payload = this.jwtService.verify<{ sub: string; type: string }>(token);
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
