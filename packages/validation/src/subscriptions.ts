import { z } from "zod";

export const changeSubscriptionPlanSchema = z.object({
  planId: z.string().uuid(),
  reason: z.string().trim().min(1).optional(),
});
export type ChangeSubscriptionPlanInput = z.infer<typeof changeSubscriptionPlanSchema>;
