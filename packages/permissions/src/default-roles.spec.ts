import { DEFAULT_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS } from "./default-roles";
import { isPermissionKey, PERMISSION_KEYS } from "./permission-keys";

describe("permissions catalog", () => {
  it("has no duplicate permission key", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("maps every default role to only valid permission keys", () => {
    for (const role of DEFAULT_ROLE_NAMES) {
      for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(isPermissionKey(key)).toBe(true);
      }
    }
  });

  it("gives ADMIN every permission in the catalog", () => {
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.ADMIN)).toEqual(new Set(PERMISSION_KEYS));
  });

  it("gives LECTEUR only read permissions", () => {
    for (const key of DEFAULT_ROLE_PERMISSIONS.LECTEUR) {
      expect(key.endsWith(".read")).toBe(true);
    }
  });

  it("never grants users.manage, settings.manage or billing.manage outside ADMIN", () => {
    const sensitive = ["users.manage", "settings.manage", "billing.manage"];
    for (const role of DEFAULT_ROLE_NAMES) {
      if (role === "ADMIN") continue;
      for (const key of sensitive) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(key);
      }
    }
  });
});
