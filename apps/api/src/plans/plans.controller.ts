import { Controller, Get } from "@nestjs/common";
import { PlansService } from "./plans.service";

// Route publique (pas de JwtAuthGuard) : le catalogue de forfaits doit être
// visible avant inscription (choix du forfait, docs/SPECIFICATIONS-SAAS.md
// §7 étape 3).
@Controller("plans")
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  list() {
    return this.plansService.listActive();
  }
}
