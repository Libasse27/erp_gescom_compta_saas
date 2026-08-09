import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Code TOTP invalide"),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

// Politique de mot de passe partagée frontend/backend — voir CLAUDE.md §6
// (argon2id côté hash, la longueur/complexité minimale se valide ici).
export const passwordSchema = z
  .string()
  .min(10, "Le mot de passe doit contenir au moins 10 caractères")
  .regex(/[a-z]/, "Le mot de passe doit contenir une minuscule")
  .regex(/[A-Z]/, "Le mot de passe doit contenir une majuscule")
  .regex(/[0-9]/, "Le mot de passe doit contenir un chiffre");

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  roleId: z.string().uuid(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
