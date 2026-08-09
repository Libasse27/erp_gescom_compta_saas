import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthToken, AuthTokenType, RefreshTokenStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../common/audit/audit-log.service";
import { MAIL_SENDER, MailSender } from "../notifications/mail-sender";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { RequestMetadata } from "./auth.service";

const PASSWORD_RESET_TTL_MS = 60 * 60_000; // 1h
const EMAIL_VERIFICATION_TTL_MS = 24 * 3_600_000; // 24h

const GENERIC_TOKEN_ERROR = "Jeton invalide ou expiré";

// Réinitialisation de mot de passe et vérification d'email — séparé de
// AuthService (login/session) pour garder chaque service centré sur une
// responsabilité. Utilise AuthToken (une seule table pour ces deux usages
// proches, voir schema.prisma).
@Injectable()
export class AccountRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditLog: AuditLogService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {}

  // Ne révèle jamais si l'email existe : toujours un succès silencieux côté
  // appelant (CLAUDE.md §6 — pas d'énumération de comptes).
  async requestPasswordReset(email: string, meta: RequestMetadata): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }

    const rawToken = this.tokenService.generateOpaqueToken();

    await this.prisma.$transaction([
      // N'importe quel lien de reset émis précédemment et non utilisé est
      // invalidé : un seul lien valide à la fois.
      this.prisma.authToken.updateMany({
        where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authToken.create({
        data: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          tokenHash: this.tokenService.hashToken(rawToken),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      }),
    ]);

    await this.mailSender.send({
      to: user.email,
      subject: "Réinitialisation de votre mot de passe",
      // La construction d'une URL frontend (domaine, route) est un souci de
      // Phase 7 ; on transmet le jeton brut pour l'instant.
      body: `Jeton de réinitialisation (valable 1h) : ${rawToken}`,
    });

    await this.auditLog.record({
      userId: user.id,
      enterpriseId: user.enterpriseId ?? undefined,
      action: "PASSWORD_RESET_REQUESTED",
      resource: "User",
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  async resetPassword(rawToken: string, newPassword: string, meta: RequestMetadata): Promise<void> {
    const authToken = await this.findValidToken(rawToken, AuthTokenType.PASSWORD_RESET);
    if (!authToken) {
      throw new UnauthorizedException(GENERIC_TOKEN_ERROR);
    }

    const newPasswordHash = await this.passwordService.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: authToken.userId },
        data: { passwordHash: newPasswordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.authToken.update({ where: { id: authToken.id }, data: { consumedAt: new Date() } }),
      // Un reset de mot de passe invalide toutes les sessions existantes —
      // si le mot de passe a fuité, les sessions actives aussi doivent l'être.
      this.prisma.refreshToken.updateMany({
        where: { userId: authToken.userId, status: { not: RefreshTokenStatus.REVOKED } },
        data: { status: RefreshTokenStatus.REVOKED, revokedAt: new Date() },
      }),
    ]);

    await this.auditLog.record({
      userId: authToken.userId,
      action: "PASSWORD_RESET_COMPLETED",
      resource: "User",
      resourceId: authToken.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  // Pas encore de déclencheur HTTP public : appelé par le provisioning
  // (Phase 6) après création d'un compte. Le token brut est renvoyé pour que
  // l'appelant l'inclue dans l'email de bienvenue.
  async issueEmailVerificationToken(userId: string): Promise<string> {
    const rawToken = this.tokenService.generateOpaqueToken();
    await this.prisma.authToken.create({
      data: {
        userId,
        type: AuthTokenType.EMAIL_VERIFICATION,
        tokenHash: this.tokenService.hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    return rawToken;
  }

  async verifyEmail(rawToken: string, meta: RequestMetadata): Promise<void> {
    const authToken = await this.findValidToken(rawToken, AuthTokenType.EMAIL_VERIFICATION);
    if (!authToken) {
      throw new UnauthorizedException(GENERIC_TOKEN_ERROR);
    }

    await this.prisma.$transaction([
      this.prisma.authToken.update({ where: { id: authToken.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: authToken.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);

    await this.auditLog.record({
      userId: authToken.userId,
      action: "EMAIL_VERIFIED",
      resource: "User",
      resourceId: authToken.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private async findValidToken(rawToken: string, type: AuthTokenType): Promise<AuthToken | null> {
    const tokenHash = this.tokenService.hashToken(rawToken);
    const authToken = await this.prisma.authToken.findUnique({ where: { tokenHash } });

    if (!authToken || authToken.type !== type || authToken.consumedAt || authToken.expiresAt < new Date()) {
      return null;
    }

    return authToken;
  }
}
