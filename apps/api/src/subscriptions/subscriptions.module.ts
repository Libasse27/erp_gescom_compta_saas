import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MySubscriptionController } from "./my-subscription.controller";
import { MySubscriptionService } from "./my-subscription.service";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController, MySubscriptionController],
  providers: [SubscriptionsService, MySubscriptionService],
})
export class SubscriptionsModule {}
