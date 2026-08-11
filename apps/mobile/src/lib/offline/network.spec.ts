import { act, renderHook } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";
import type { NetInfoChangeHandler, NetInfoState } from "@react-native-community/netinfo";
import { setupOnlineManager, useIsOnline } from "./network";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

const mockAddEventListener = NetInfo.addEventListener as jest.MockedFunction<typeof NetInfo.addEventListener>;

function state(isConnected: boolean | null, isInternetReachable: boolean | null): NetInfoState {
  return { isConnected, isInternetReachable } as NetInfoState;
}

describe("setupOnlineManager / useIsOnline", () => {
  it("répercute les changements d'état NetInfo sur useIsOnline, y compris isInternetReachable=null traité comme en ligne", async () => {
    let listener: NetInfoChangeHandler | undefined;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb;
      return jest.fn();
    });

    setupOnlineManager();
    expect(mockAddEventListener).toHaveBeenCalledTimes(1);

    const { result } = await renderHook(() => useIsOnline());

    await act(async () => listener?.(state(false, false)));
    expect(result.current).toBe(false);

    await act(async () => listener?.(state(true, true)));
    expect(result.current).toBe(true);

    await act(async () => listener?.(state(false, false)));
    expect(result.current).toBe(false);

    // isInternetReachable encore inconnu juste après le démarrage : ne doit
    // pas être traité comme hors-ligne.
    await act(async () => listener?.(state(true, null)));
    expect(result.current).toBe(true);
  });
});
