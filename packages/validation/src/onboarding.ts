import { z } from "zod";

export const updateOnboardingStateSchema = z
  .object({
    step: z.number().int().min(5).max(7).optional(),
    completed: z.literal(true).optional(),
  })
  .refine((data) => data.step !== undefined || data.completed !== undefined, {
    message: "step ou completed doit être fourni",
  });
export type UpdateOnboardingStateInput = z.infer<typeof updateOnboardingStateSchema>;
