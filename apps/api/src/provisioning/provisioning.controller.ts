import { Body, Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { registerSchema } from "@erp/validation";
import { AUTH_RATE_LIMIT } from "../common/rate-limit";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { ProvisioningService } from "./provisioning.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Route publique (pas de JwtAuthGuard : personne n'est encore authentifié à
// ce stade) — voir docs/PROMPT-MAITRE-SAAS.md Phase 6.
// Corrige BIL-14 (docs/audit/BILLING-AUDIT.md) : ce contrôleur partage le
// préfixe HTTP `auth` avec AuthController (POST /auth/register) mais vivait
// dans un module distinct — il retombait donc sur la limite globale (100/min)
// au lieu du throttling renforcé de `/auth/*` (CLAUDE.md §6), alors que
// `register` est l'endpoint le plus coûteux de l'API (Argon2 + transaction
// de tout le plan comptable SYSCOHADA). Même limite que AuthController, pas
// de limite dédiée : décision produit à réévaluer plus tard si les
// métriques le justifient (voir BIL-14).
@Throttle(AUTH_RATE_LIMIT)
@Controller("auth")
export class ProvisioningController {
  constructor(private readonly provisioningService: ProvisioningService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  register(
    @Body(new ZodValidationPipe(registerSchema))
    body: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      password: string;
      enterpriseName: string;
      legalName?: string;
      ninea?: string;
      rccm?: string;
      sector?: string;
      address?: string;
      city?: string;
      country: string;
      enterprisePhone?: string;
      enterpriseEmail?: string;
      planId: string;
    },
    @Req() req: Request,
  ) {
    return this.provisioningService.register(body, requestMeta(req));
  }
}
