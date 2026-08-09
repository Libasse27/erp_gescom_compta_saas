"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, extractErrorMessage } from "@/lib/api";

function VerifyEmailStatus() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"pending" | "success" | "error">(() => (token ? "pending" : "error"));
  const [message, setMessage] = useState<string | null>(() => (token ? null : "Lien de vérification invalide."));

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    apiFetch("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setState("success");
        } else {
          const data = await res.json();
          setState("error");
          setMessage(extractErrorMessage(data, "Lien invalide ou expiré"));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState("error");
          setMessage("Une erreur est survenue");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "pending") {
    return <p className="text-sm text-muted-foreground">Vérification en cours…</p>;
  }
  if (state === "success") {
    return <p className="text-sm">Votre email a été vérifié. Vous pouvez fermer cette page.</p>;
  }
  return <p className="text-sm text-destructive">{message}</p>;
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Vérification de l&apos;email</CardTitle>
          <CardDescription>Confirmation de votre adresse email</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}>
            <VerifyEmailStatus />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
