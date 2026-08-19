import { Prisma } from "@prisma/client";

export interface SerializableRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 25;
const MAX_DELAY_MS = 100;

function isSerializationFailure(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rejoue une transaction Serializable qui échoue avec P2034 (conflit de
// sérialisation Postgres, erreur SQL 40001 — cf. StockRepository.createMovement,
// SalesRepository.confirm, PurchasesRepository.confirm). Postgres annule toute
// la transaction en cas de P2034 : rien n'est committé, rejouer le callback en
// entier depuis zéro est donc la seule stratégie correcte, jamais une écriture
// partielle. Toute autre erreur (métier ou technique) est relancée
// immédiatement sans nouvelle tentative : seul P2034 est, par construction,
// transitoire (le message Prisma dit explicitement "please retry your
// transaction"). L'appelant garde la responsabilité de mapper l'échec final
// en ConflictException (409) — ce helper ne change pas le contrat d'erreur,
// il retente avant de le laisser s'exprimer tel quel.
export async function runWithSerializableRetry<T>(
  operation: () => Promise<T>,
  options: SerializableRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < maxAttempts) {
        // Backoff borné : 25ms, 50ms (plafond 100ms), + jusqu'à 50% de
        // jitter pour éviter que des tentatives concurrentes se resynchronisent.
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS);
        await sleep(delay + delay * Math.random() * 0.5);
      }
    }
  }

  throw lastError;
}
