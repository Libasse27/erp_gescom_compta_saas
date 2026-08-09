import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DEFAULT_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS } from "@erp/permissions";
import { RegisterInput } from "@erp/validation";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../common/audit/audit-log.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AccountRecoveryService } from "../auth/account-recovery.service";
import { AuthService, RequestMetadata } from "../auth/auth.service";
import { PasswordService } from "../auth/password.service";
import { SYSCOHADA_ACCOUNT_CLASSES } from "./syscohada-chart-of-accounts";

const TRIAL_DAY_MS = 24 * 3_600_000;

// Point d'entrée unique du provisioning (docs/adr/0003-atomicite-provisioning.md) :
// une seule transaction Prisma, tout ou rien. Flux pré-tenant (aucune
// entreprise n'existe encore, donc aucun TenantContext possible) — connexion
// d'identité, comme AuthService/InvitationsService.acceptInvitation
// (docs/adr/0008-...).
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly authService: AuthService,
    private readonly accountRecovery: AccountRecoveryService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async register(
    input: RegisterInput,
    meta: RequestMetadata,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) {
      throw new NotFoundException("Forfait introuvable");
    }

    const passwordHash = await this.passwordService.hash(input.password);

    let created: { userId: string; enterpriseId: string; email: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const enterprise = await tx.enterprise.create({
          data: {
            name: input.enterpriseName,
            legalName: input.legalName,
            ninea: input.ninea,
            rccm: input.rccm,
            address: input.address,
            city: input.city,
            country: input.country,
            phone: input.enterprisePhone,
            email: input.enterpriseEmail,
            sector: input.sector,
          },
        });

        const startDate = new Date();
        const subscription = await tx.subscription.create({
          data: {
            enterpriseId: enterprise.id,
            planId: plan.id,
            status: "TRIAL",
            startDate,
            trialEndDate: new Date(startDate.getTime() + plan.trialDays * TRIAL_DAY_MS),
          },
        });

        await tx.enterprise.update({
          where: { id: enterprise.id },
          data: { currentSubscriptionId: subscription.id },
        });

        const user = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            enterpriseId: enterprise.id,
            status: "ACTIVE",
          },
        });

        await this.seedDefaultRoles(tx, enterprise.id, user.id);

        await tx.account.createMany({
          data: SYSCOHADA_ACCOUNT_CLASSES.map((account) => ({
            enterpriseId: enterprise.id,
            code: account.code,
            label: account.label,
          })),
        });

        await tx.setting.create({
          data: {
            scope: "ENTERPRISE",
            enterpriseId: enterprise.id,
            key: "commercial.defaults",
            value: { currency: enterprise.currency, locale: "fr-SN", timezone: "Africa/Dakar" },
          },
        });

        return { userId: user.id, enterpriseId: enterprise.id, email: user.email };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Un compte existe déjà avec cet email, ou NINEA/RCCM déjà utilisé pour ce pays");
      }
      throw error;
    }

    const verificationToken = await this.accountRecovery.issueEmailVerificationToken(created.userId);
    await this.notifications.notify({
      userId: created.userId,
      enterpriseId: created.enterpriseId,
      type: "WELCOME",
      to: created.email,
      subject: "Bienvenue sur la plateforme",
      body: `Votre entreprise a été créée. Jeton de vérification d'email (valable 24h) : ${verificationToken}`,
    });

    await this.auditLog.record({
      userId: created.userId,
      enterpriseId: created.enterpriseId,
      action: "ENTERPRISE_PROVISIONED",
      resource: "Enterprise",
      resourceId: created.enterpriseId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.authService.issueTokenPair(created.userId, created.enterpriseId, false);
  }

  private async seedDefaultRoles(tx: Prisma.TransactionClient, enterpriseId: string, adminUserId: string): Promise<void> {
    const requiredKeys = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())];
    const permissions = await tx.permission.findMany({ where: { key: { in: requiredKeys } } });
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

    const missing = requiredKeys.filter((key) => !permissionIdByKey.has(key));
    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `Catalogue de permissions non initialisé (clés manquantes : ${missing.join(", ")}) — lancer "pnpm prisma:seed"`,
      );
    }

    for (const roleName of DEFAULT_ROLE_NAMES) {
      const role = await tx.role.create({
        data: { enterpriseId, name: roleName, isSystem: true },
      });

      const permissionIds = DEFAULT_ROLE_PERMISSIONS[roleName].map((key) => permissionIdByKey.get(key)!);
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        });
      }

      if (roleName === "ADMIN") {
        await tx.userRole.create({ data: { userId: adminUserId, roleId: role.id } });
      }
    }
  }
}
