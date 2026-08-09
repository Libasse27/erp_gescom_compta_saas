"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, mfaVerifySchema, type LoginInput, type MfaVerifyInput } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useAuth, SessionApiError } from "@/lib/session/auth-provider";

export default function LoginPage() {
  const { login, verifyMfa } = useAuth();
  const router = useRouter();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loginForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const mfaForm = useForm<MfaVerifyInput>({
    resolver: zodResolver(mfaVerifySchema),
    defaultValues: { challengeToken: "", code: "" },
  });

  async function onLoginSubmit(values: LoginInput) {
    setFormError(null);
    try {
      const result = await login(values.email, values.password);
      if (result.mfaRequired) {
        setChallengeToken(result.challengeToken);
        mfaForm.setValue("challengeToken", result.challengeToken);
        return;
      }
      router.push("/app");
    } catch (error) {
      setFormError(error instanceof SessionApiError ? error.message : "Une erreur est survenue");
    }
  }

  async function onMfaSubmit(values: MfaVerifyInput) {
    setFormError(null);
    try {
      await verifyMfa(values.challengeToken, values.code);
      router.push("/app");
    } catch (error) {
      setFormError(error instanceof SessionApiError ? error.message : "Une erreur est survenue");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Connexion</CardTitle>
          <CardDescription>
            {challengeToken ? "Entrez le code de votre application d'authentification" : "Accédez à votre espace"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!challengeToken ? (
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="grid gap-4">
                <FormField
                  control={loginForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={loginForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mot de passe</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="current-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <Button type="submit" disabled={loginForm.formState.isSubmitting} className="w-full">
                  Se connecter
                </Button>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <a href="/forgot-password" className="hover:underline">
                    Mot de passe oublié ?
                  </a>
                  <a href="/register" className="hover:underline">
                    Créer un compte
                  </a>
                </div>
              </form>
            </Form>
          ) : (
            <Form {...mfaForm}>
              <form onSubmit={mfaForm.handleSubmit(onMfaSubmit)} className="grid gap-4">
                <FormField
                  control={mfaForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code de vérification</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <Button type="submit" disabled={mfaForm.formState.isSubmitting} className="w-full">
                  Vérifier
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
