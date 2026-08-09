import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthTokenType } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../common/audit/audit-log.service";
import { MAIL_SENDER, MailSender } from "../notifications/mail-sender";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { AuthService, RequestMetadata } from "../auth/auth.service";

const INVITATION_TTL_MS = 7 * 24 * 3_600_000; // 7 jours
const GENERIC_TOKEN_ERROR = "Jeton invalide ou expiré";

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly auditLog: AuditLogService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {}

  async invite(
    inviterEnterpriseId: string,
    input: { email: string; firstName: string; lastName: string; roleId: string },
    meta: RequestMetadata,
  ): Promise<{ userId: string }> {
    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });

    // Un ADMIN ne peut assigner qu'un rôle appartenant à sa propre
    // entreprise — jamais un rôle d'un autre tenant (isolation, CLAUDE.md §5).
    if (!role || role.enterpriseId !== inviterEnterpriseId) {
      throw new ForbiddenException("Rôle invalide");
    }

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException("Un compte existe déjà avec cet email");
    }

    // Mot de passe temporaire inutilisable : personne ne le connaît, il sera
    // remplacé lors de l'acceptation de l'invitation.
    const unusablePassword = randomBytes(32).toString("base64url");
    const rawInvitationToken = this.tokenService.generateOpaqueToken();

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: await this.passwordService.hash(unusablePassword),
          enterpriseId: inviterEnterpriseId,
          status: "PENDING_INVITE",
        },
      });

      await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });

      await tx.authToken.create({
        data: {
          userId: created.id,
          type: AuthTokenType.INVITATION,
          tokenHash: this.tokenService.hashToken(rawInvitationToken),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });

      return created;
    });

    await this.mailSender.send({
      to: user.email,
      subject: "Invitation à rejoindre votre entreprise",
      body: `Jeton d'invitation (valable 7 jours) : ${rawInvitationToken}`,
    });

    await this.auditLog.record({
      userId: user.id,
      enterpriseId: inviterEnterpriseId,
      action: "USER_INVITED",
      resource: "User",
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { roleId: role.id },
    });

    return { userId: user.id };
  }

  async acceptInvitation(
    rawToken: string,
    password: string,
    meta: RequestMetadata,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.tokenService.hashToken(rawToken);
    const authToken = await this.prisma.authToken.findUnique({ where: { tokenHash } });

    if (
      !authToken ||
      authToken.type !== AuthTokenType.INVITATION ||
      authToken.consumedAt ||
      authToken.expiresAt < new Date()
    ) {
      throw new UnauthorizedException(GENERIC_TOKEN_ERROR);
    }

    const passwordHash = await this.passwordService.hash(password);

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.authToken.update({ where: { id: authToken.id }, data: { consumedAt: new Date() } });
      return tx.user.update({
        where: { id: authToken.userId },
        data: { passwordHash, status: "ACTIVE", emailVerifiedAt: new Date() },
      });
    });

    await this.auditLog.record({
      userId: user.id,
      enterpriseId: user.enterpriseId ?? undefined,
      action: "INVITATION_ACCEPTED",
      resource: "User",
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.authService.issueTokenPair(user.id, user.enterpriseId, user.isSuperAdmin);
  }
}
