import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Request } from "express";
import { SubscriptionStatus } from "@prisma/client";
import { EntitlementsService } from "../entitlements.service";

// Abonnement EXPIRED/SUSPENDED/CANCELLED => lecture seule : les requêtes GET
// restent autorisées, tout le reste est refusé (docs/PROMPT-MAITRE-SAAS.md
// Phase 4, critère "abonnement expiré"). TRIAL/ACTIVE/PAST_DUE gardent un
// accès complet (la grâce sur PAST_DUE est un sujet Phase 5, pas remis en
// cause ici). Une entreprise SANS AUCUN abonnement n'est PAS bloquée : avant
// la Phase 6 (provisioning automatique), rien ne garantit qu'une Subscription
// existe encore, et cette absence n'est pas "un abonnement expiré".
const BLOCKING_STATUSES: ReadonlyArray<SubscriptionStatus> = [
  SubscriptionStatus.EXPIRED,
  SubscriptionStatus.SUSPENDED,
  SubscriptionStatus.CANCELLED,
];

// Opt-in, comme PermissionsGuard/FeatureGuard/LimitGuard (@UseGuards sur la
// route concernée, après JwtAuthGuard) — PAS global : la plupart des routes
// (auth, logout, routes Super Admin) ne sont pas des actions métier tenant et
// ne doivent jamais être bloquées par le statut d'un abonnement.
@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
  constructor(private readonly entitlements: EntitlementsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === "GET") {
      return true;
    }

    const { subscriptionStatus } = await this.entitlements.getCurrent();

    if (subscriptionStatus && BLOCKING_STATUSES.includes(subscriptionStatus)) {
      throw new ForbiddenException("Abonnement inactif : accès en lecture seule");
    }

    return true;
  }
}
