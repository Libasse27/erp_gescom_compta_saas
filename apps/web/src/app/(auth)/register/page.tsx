"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { registerSchema } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth, SessionApiError } from "@/lib/session/auth-provider";
import { cn } from "@/lib/utils";

interface PublicPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  trialDays: number;
  maxUsers: number | null;
}

// z.input (pas z.infer/z.output) : "country" a un .default() côté schéma,
// donc optionnel côté saisie mais requis côté validé — react-hook-form doit
// être typé sur la forme d'entrée, le resolver produit la sortie à la soumission.
type RegisterFormValues = z.input<typeof registerSchema>;

const STEP_FIELDS = {
  1: ["firstName", "lastName", "email", "phone", "password"] as const,
  2: ["enterpriseName", "legalName", "ninea", "rccm", "sector", "address", "city", "country", "enterprisePhone", "enterpriseEmail"] as const,
  3: ["planId"] as const,
};

export default function RegisterPage() {
  const { register: registerAccount } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { country: "SN", planId: "" },
  });

  const selectedPlanId = useWatch({ control: form.control, name: "planId" });

  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const res = await apiFetch("/plans");
      if (!res.ok) throw new Error("Impossible de charger les forfaits");
      return res.json() as Promise<PublicPlan[]>;
    },
    enabled: step === 3,
  });

  async function goNext() {
    if (step === 1) {
      setConfirmError(null);
      const password = form.getValues("password");
      if (password !== confirmPassword) {
        setConfirmError("Les mots de passe ne correspondent pas");
        return;
      }
    }
    const valid = await form.trigger(STEP_FIELDS[step] as unknown as (keyof RegisterFormValues)[]);
    if (valid) {
      setStep((current) => (current < 3 ? ((current + 1) as 1 | 2 | 3) : current));
    }
  }

  function goBack() {
    setStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current));
  }

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);
    try {
      await registerAccount(values);
      router.push("/app");
    } catch (error) {
      setFormError(error instanceof SessionApiError ? error.message : "Une erreur est survenue");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Créer votre compte</CardTitle>
          <CardDescription>Étape {step} sur 3</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              {step === 1 && (
                <>
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prénom</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Téléphone (optionnel)</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mot de passe</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-2">
                    <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <FormField
                    control={form.control}
                    name="enterpriseName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom de l&apos;entreprise</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="legalName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Raison sociale (optionnel)</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="ninea"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>NINEA (optionnel)</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="rccm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>RCCM (optionnel)</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Adresse (optionnel)</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ville (optionnel)</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sector"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Secteur (optionnel)</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              {step === 3 && (
                <div className="grid gap-3">
                  {plansQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement des forfaits…</p>}
                  {plansQuery.isError && (
                    <p className="text-sm text-destructive">Impossible de charger les forfaits.</p>
                  )}
                  {plansQuery.data?.map((plan) => {
                    const selected = selectedPlanId === plan.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => form.setValue("planId", plan.id, { shouldValidate: true })}
                        className={cn(
                          "flex items-center justify-between rounded-lg border p-4 text-left transition-colors",
                          selected ? "border-primary bg-accent" : "hover:bg-accent/50",
                        )}
                      >
                        <div>
                          <p className="font-medium">{plan.name}</p>
                          {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                          {plan.maxUsers !== null && (
                            <p className="text-sm text-muted-foreground">Jusqu&apos;à {plan.maxUsers} utilisateurs</p>
                          )}
                        </div>
                        <p className="font-semibold">{plan.priceMonthly.toLocaleString("fr-SN")} FCFA/mois</p>
                      </button>
                    );
                  })}
                  <FormField
                    control={form.control}
                    name="planId"
                    render={() => (
                      <FormItem>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <div className="flex justify-between">
                {step > 1 ? (
                  <Button type="button" variant="outline" onClick={goBack}>
                    Précédent
                  </Button>
                ) : (
                  <span />
                )}
                {step < 3 ? (
                  <Button type="button" onClick={goNext}>
                    Suivant
                  </Button>
                ) : (
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Créer mon compte
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
