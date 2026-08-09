import { SetMetadata } from "@nestjs/common";

export const WITHIN_LIMIT_KEY = "within_limit";

// Consommé par LimitGuard, qui sait compter l'usage courant pour chaque clé
// (voir USAGE_COUNTERS dans limit.guard.ts).
export const WithinLimit = (limitKey: string) => SetMetadata(WITHIN_LIMIT_KEY, limitKey);
