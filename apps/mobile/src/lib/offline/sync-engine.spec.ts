import { renderHook } from "@testing-library/react-native";
import { useAuth } from "../auth-context";
import { processQueue } from "./mutation-queue";
import { useIsOnline } from "./network";
import { useSyncEngine } from "./sync-engine";

// Factories explicites pour ../auth-context et ./mutation-queue : sans
// factory, jest.mock introspecte le module réel pour générer l'automock, ce
// qui charge transitivement db.ts (real expo-sqlite openDatabaseSync() au
// chargement) — auth-context.tsx importe ./offline, mutation-queue.ts
// importe ./db. ./network n'a pas ce problème (aucun appel natif à son
// chargement, seulement dans setupOnlineManager()), automock suffit.
jest.mock("../auth-context", () => ({
  useAuth: jest.fn(),
}));
jest.mock("./mutation-queue", () => ({
  processQueue: jest.fn(),
}));
jest.mock("./network");

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseIsOnline = useIsOnline as jest.MockedFunction<typeof useIsOnline>;
const mockProcessQueue = processQueue as jest.MockedFunction<typeof processQueue>;

function mockAuth(status: "loading" | "authenticated" | "unauthenticated", accessToken: string | null = null) {
  mockUseAuth.mockReturnValue({
    status,
    accessToken,
    user: null,
    login: jest.fn(),
    verifyMfa: jest.fn(),
    logout: jest.fn(),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockProcessQueue.mockResolvedValue(undefined);
});

describe("useSyncEngine", () => {
  it("déclenche processQueue quand authentifié et déjà en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);

    await renderHook(() => useSyncEngine());

    expect(mockProcessQueue).toHaveBeenCalledTimes(1);
  });

  it("ne déclenche rien si non authentifié, même en ligne", async () => {
    mockAuth("unauthenticated");
    mockUseIsOnline.mockReturnValue(true);

    await renderHook(() => useSyncEngine());

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("ne déclenche rien en session authentifiée mais hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);

    await renderHook(() => useSyncEngine());

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("déclenche processQueue au passage offline→online pendant une session déjà authentifiée", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);

    const { rerender } = await renderHook(() => useSyncEngine());
    expect(mockProcessQueue).not.toHaveBeenCalled();

    mockUseIsOnline.mockReturnValue(true);
    await rerender(undefined);

    expect(mockProcessQueue).toHaveBeenCalledTimes(1);
  });

  it("transmet un getAccessToken qui lit la valeur courante du jeton en mémoire", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);

    await renderHook(() => useSyncEngine());

    const deps = mockProcessQueue.mock.calls[0]?.[0];
    expect(deps?.getAccessToken()).toBe("access-1");
  });
});
