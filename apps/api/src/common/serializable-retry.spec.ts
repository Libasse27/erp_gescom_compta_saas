import { Prisma } from "@prisma/client";
import { runWithSerializableRetry } from "./serializable-retry";

function p2034(message = "Transaction failed due to a write conflict or a deadlock. Please retry your transaction"): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, { code: "P2034", clientVersion: "test" });
}

// sleep injecté à zéro : ces tests ne doivent jamais réellement attendre, le
// backoff lui-même est un détail d'implémentation non observable ici.
const noopSleep = async () => {};

describe("runWithSerializableRetry", () => {
  it("returns the result immediately when the operation succeeds on the first attempt", async () => {
    const operation = jest.fn().mockResolvedValue("ok");

    const result = await runWithSerializableRetry(operation, { sleep: noopSleep });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries after a single P2034 and returns the eventual success", async () => {
    const operation = jest.fn().mockRejectedValueOnce(p2034()).mockResolvedValueOnce("ok");

    const result = await runWithSerializableRetry(operation, { sleep: noopSleep });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("stops after maxAttempts consecutive P2034 failures", async () => {
    const operation = jest.fn().mockRejectedValue(p2034());

    await expect(runWithSerializableRetry(operation, { maxAttempts: 3, sleep: noopSleep })).rejects.toMatchObject({
      code: "P2034",
    });
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("propagates the exact original P2034 error once retries are exhausted", async () => {
    const error = p2034("boom");
    const operation = jest.fn().mockRejectedValue(error);

    await expect(runWithSerializableRetry(operation, { maxAttempts: 2, sleep: noopSleep })).rejects.toBe(error);
  });

  it("never retries a Prisma error that is not P2034", async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError("unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const operation = jest.fn().mockRejectedValue(uniqueViolation);

    await expect(runWithSerializableRetry(operation, { sleep: noopSleep })).rejects.toBe(uniqueViolation);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-Prisma error (e.g. a business exception)", async () => {
    const businessError = new Error("stock insuffisant");
    const operation = jest.fn().mockRejectedValue(businessError);

    await expect(runWithSerializableRetry(operation, { sleep: noopSleep })).rejects.toBe(businessError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
