import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { createPendingPaymentSchema } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { AuthenticatedUser } from "../auth/types";
import { PaymentsBootstrapService } from "./payments-bootstrap.service";

@Controller("admin/enterprises/:enterpriseId/payments")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PaymentsBootstrapController {
  constructor(private readonly paymentsBootstrapService: PaymentsBootstrapService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("enterpriseId", new ParseUUIDPipe()) enterpriseId: string,
    @Body(new ZodValidationPipe(createPendingPaymentSchema))
    body: { provider: "WAVE" | "ORANGE_MONEY" | "FREE_MONEY" | "STRIPE" | "CARD"; providerReference: string; amount: number; currency: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.paymentsBootstrapService.createPendingPayment(enterpriseId, body, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
