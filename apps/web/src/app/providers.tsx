"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/session/auth-provider";

export function Providers({ children }: { children: ReactNode }) {
  // Une instance par montage (pas de module-level singleton) : évite de
  // partager un cache entre requêtes différentes côté serveur (Next.js RSC).
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
