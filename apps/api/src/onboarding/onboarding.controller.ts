import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { updateOnboardingStateSchema, type UpdateOnboardingStateInput } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OnboardingService } from "./onboarding.service";

// Progression propre à l'entreprise du membre connecté — pas de permission
// dédiée, même traitement que /subscriptions/me (docs/PROMPT-MAITRE-SAAS.md
// Phase 7.2).
@Controller("onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  getState() {
    return this.onboardingService.getState();
  }

  @Patch()
  advance(@Body(new ZodValidationPipe(updateOnboardingStateSchema)) body: UpdateOnboardingStateInput) {
    return this.onboardingService.advance(body);
  }
}
