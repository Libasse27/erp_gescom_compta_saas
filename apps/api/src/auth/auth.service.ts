import { Injectable, UnauthorizedException } from "@nestjs/common";
import { RefreshTokenStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../common/audit/audit-log.service";
import { parseDurationMs } from "../common/duration";
import { env } from "../config/env";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000;

// Message volontairement identique dans tous les cas d'échec (email inconnu,
// mot de passe invalide, compte verrouillé) pour ne pas permettre
// l'énumération de comptes (CLAUDE.md §6).
const GENERIC_LOGIN_ERROR = "Identifiants invalides";

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export type LoginResult =
  | { mfaRequired: true; challengeToken: string }
  | { mfaRequired: false; accessToken: string; refreshToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly mfaService: MfaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async login(email: string, password: string, meta: RequestMetadata): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await this.auditLog.record({
        action: "LOGIN_FAILED",
        resource: "User",
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.auditLog.record({
        userId: user.id,
        enterpriseId: user.enterpriseId ?? undefined,
        action: "LOGIN_FAILED",
        resource: "User",
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason: "locked" },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordValid = await this.passwordService.verify(user.passwordHash, password);

    if (!passwordValid) {
      const failedLoginCount = user.failedLoginCount + 1;
      const shouldLock = failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
        },
      });

      if (shouldLock) {
        await this.auditLog.record({
          userId: user.id,
          enterpriseId: user.enterpriseId ?? undefined,
          action: "ACCOUNT_LOCKED",
          resource: "User",
          resourceId: user.id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { failedLoginCount },
        });
      }

      await this.auditLog.record({
        userId: user.id,
        enterpriseId: user.enterpriseId ?? undefined,
        action: "LOGIN_FAILED",
        resource: "User",
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    if (user.isSuperAdmin) {
      // Invariant garanti par scripts/create-super-admin.ts : un Super Admin
      // est toujours créé avec la MFA déjà activée (CLAUDE.md §6).
      if (!user.mfaEnabled) {
        await this.auditLog.record({
          userId: user.id,
          action: "LOGIN_FAILED",
          resource: "User",
          resourceId: user.id,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: "mfa_not_configured" },
        });
        throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
      }

      return { mfaRequired: true, challengeToken: this.tokenService.signMfaChallengeToken(user.id) };
    }

    const tokens = await this.issueTokenPair(user.id, user.enterpriseId, user.isSuperAdmin);

    await this.auditLog.record({
      userId: user.id,
      enterpriseId: user.enterpriseId ?? undefined,
      action: "LOGIN",
      resource: "User",
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { mfaRequired: false, ...tokens };
  }

  async issueTokenPair(
    userId: string,
    enterpriseId: string | null,
    isSuperAdmin: boolean,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const rawRefreshToken = this.tokenService.generateOpaqueToken();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: this.tokenService.generateFamilyId(),
        tokenHash: this.tokenService.hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + parseDurationMs(env.jwtRefreshTtl())),
      },
    });

    const accessToken = this.tokenService.signAccessToken({ id: userId, enterpriseId, isSuperAdmin });
    return { accessToken, refreshToken: rawRefreshToken };
  }

  async verifyMfaAndIssueTokens(
    challengeToken: string,
    code: string,
    meta: RequestMetadata,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let userId: string;
    try {
      userId = this.tokenService.verifyMfaChallengeToken(challengeToken).sub;
    } catch {
      throw new UnauthorizedException("Défi MFA invalide ou expiré");
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException("Défi MFA invalide ou expiré");
    }

    const secret = this.mfaService.decryptSecret(user.mfaSecret);
    const codeValid = this.mfaService.verifyCode(secret, code);

    if (!codeValid) {
      await this.auditLog.record({
        userId: user.id,
        action: "MFA_CHALLENGE_FAILED",
        resource: "User",
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Code MFA invalide");
    }

    const tokens = await this.issueTokenPair(user.id, user.enterpriseId, user.isSuperAdmin);

    await this.auditLog.record({
      userId: user.id,
      action: "LOGIN",
      resource: "User",
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { mfa: true },
    });

    return tokens;
  }

  async refresh(rawToken: string, meta: RequestMetadata): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.tokenService.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

    if (!existing) {
      throw new UnauthorizedException("Jeton de rafraîchissement invalide");
    }

    if (existing.status !== RefreshTokenStatus.ACTIVE) {
      // Un token déjà ROTATED ou REVOKED est représenté : signe de vol.
      // Révocation de toute la famille (CLAUDE.md §6).
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, status: { not: RefreshTokenStatus.REVOKED } },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      });

      await this.auditLog.record({
        userId: existing.userId,
        enterpriseId: existing.user.enterpriseId ?? undefined,
        action: "REFRESH_TOKEN_REUSE_DETECTED",
        resource: "RefreshToken",
        resourceId: existing.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      throw new UnauthorizedException("Session compromise, veuillez vous reconnecter");
    }

    if (existing.expiresAt < new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      });
      throw new UnauthorizedException("Session expirée");
    }

    const rawNewToken = this.tokenService.generateOpaqueToken();
    const newToken = await this.prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        familyId: existing.familyId,
        tokenHash: this.tokenService.hashToken(rawNewToken),
        expiresAt: new Date(Date.now() + parseDurationMs(env.jwtRefreshTtl())),
      },
    });

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { status: RefreshTokenStatus.ROTATED, replacedByTokenId: newToken.id },
    });

    const accessToken = this.tokenService.signAccessToken({
      id: existing.user.id,
      enterpriseId: existing.user.enterpriseId,
      isSuperAdmin: existing.user.isSuperAdmin,
    });

    return { accessToken, refreshToken: rawNewToken };
  }

  async logout(rawToken: string, currentUserId: string, meta: RequestMetadata): Promise<void> {
    const tokenHash = this.tokenService.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    // Idempotent : un logout avec un token déjà invalide/absent ne doit pas
    // échouer bruyamment ni révéler d'information.
    if (!existing || existing.userId !== currentUserId) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, status: { not: RefreshTokenStatus.REVOKED } },
      data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { id: currentUserId } });

    await this.auditLog.record({
      userId: currentUserId,
      enterpriseId: user?.enterpriseId ?? undefined,
      action: "LOGOUT",
      resource: "User",
      resourceId: currentUserId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        enterpriseId: true,
        isSuperAdmin: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
      },
    });
    return user;
  }
}
