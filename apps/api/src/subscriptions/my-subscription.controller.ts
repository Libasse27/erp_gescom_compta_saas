import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MySubscriptionService } from "./my-subscription.service";

@Controller("subscriptions/me")
@UseGuards(JwtAuthGuard)
export class MySubscriptionController {
  constructor(private readonly mySubscriptionService: MySubscriptionService) {}

  @Get()
  getCurrent() {
    return this.mySubscriptionService.getCurrent();
  }
}
