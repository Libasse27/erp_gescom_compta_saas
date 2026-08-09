import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateOnboardingStateInput } from "@erp/validation";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  available: boolean;
  done?: boolean;
  reason?: "phase_8";
}

export interface OnboardingState {
  currentStep: number;
  completedAt: string | null;
  checklist: OnboardingChecklistItem[];
}

const ONBOARDING_QUERY_KEY = ["onboarding"];

export function useOnboarding() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: () => authenticatedFetch<OnboardingState>("/onboarding", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}

export function useAdvanceOnboarding() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateOnboardingStateInput) =>
      authenticatedFetch<OnboardingState>("/onboarding", accessToken!, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, data);
    },
  });
}
