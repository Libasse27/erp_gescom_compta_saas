import { Body, Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { registerSchema } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { ProvisioningService } from "./provisioning.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Route publique (pas de JwtAuthGuard : personne n'est encore authentifié à
// ce stade) — voir docs/PROMPT-MAITRE-SAAS.md Phase 6.
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
