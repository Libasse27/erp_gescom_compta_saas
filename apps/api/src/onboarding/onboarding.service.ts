import { BadRequestException, Injectable } from "@nestjs/common";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { TenantContext } from "../tenant/tenant-context";

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  done: boolean;
  available: true;
}

export interface LockedOnboardingChecklistItem {
  key: string;
  label: string;
  available: false;
  reason: "phase_8";
}

export interface OnboardingStateSummary {
  currentStep: number;
  completedAt: Date | null;
  checklist: (OnboardingChecklistItem | LockedOnboardingChecklistItem)[];
}

const LOCKED_CHECKLIST_ITEMS: LockedOnboardingChecklistItem[] = [
  { key: "first_client", label: "Premier client", available: false, reason: "phase_8" },
  { key: "first_product", label: "Premier produit", available: false, reason: "phase_8" },
  { key: "first_sale", label: "Première vente", available: false, reason: "phase_8" },
  { key: "accounting_configured", label: "Configuration comptable", available: false, reason: "phase_8" },
];

// Assistant post-inscription (docs/SPECIFICATIONS-SAAS.md §23). Les étapes
// 1-4 du wizard sont déjà couvertes par le provisioning (Phase 6) — cette
// ressource ne pilote que les étapes 5-7. La checklist est recalculée à
// chaque lecture depuis des faits réels (jamais un flag dupliqué qui
// pourrait diverger de l'état réel) ; seuls currentStep/completedAt sont
// persistés, pour rendre l'assistant reprenable après abandon.
@Injectable()
export class OnboardingService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async getState(): Promise<OnboardingStateSummary> {
    const tenantId = TenantContext.getRequiredTenantId();

    const [state, enterprise, userCount] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.onboardingState.upsert({
          where: { enterpriseId: tenantId },
          create: { enterpriseId: tenantId },
          update: {},
        }),
        tx.enterprise.findUnique({
          where: { id: tenantId },
          select: { currentSubscriptionId: true },
        }),
        tx.user.count(),
      ]),
    );

    const checklist: (OnboardingChecklistItem | LockedOnboardingChecklistItem)[] = [
      { key: "enterprise_created", label: "Entreprise créée", done: true, available: true },
      { key: "profile_completed", label: "Profil complété", done: true, available: true },
      {
        key: "plan_activated",
        label: "Plan activé",
        done: enterprise?.currentSubscriptionId != null,
        available: true,
      },
      { key: "first_user_added", label: "Premier utilisateur ajouté", done: userCount >= 1, available: true },
      ...LOCKED_CHECKLIST_ITEMS,
    ];

    return { currentStep: state.currentStep, completedAt: state.completedAt, checklist };
  }

  async advance(input: { step?: number; completed?: true }): Promise<OnboardingStateSummary> {
    const tenantId = TenantContext.getRequiredTenantId();

    await this.tenantPrisma.run(async (tx) => {
      // Créée à la volée si absente (idempotent même si PATCH arrive avant tout GET).
      const current = await tx.onboardingState.upsert({
        where: { enterpriseId: tenantId },
        create: { enterpriseId: tenantId },
        update: {},
      });

      if (input.step !== undefined && input.step < current.currentStep) {
        throw new BadRequestException("Impossible de revenir en arrière dans l'assistant");
      }

      return tx.onboardingState.update({
        where: { enterpriseId: tenantId },
        data: {
          ...(input.step !== undefined ? { currentStep: input.step } : {}),
          ...(input.completed ? { completedAt: new Date() } : {}),
        },
      });
    });

    return this.getState();
  }
}
