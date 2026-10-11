import { describe, expect, it } from "vitest";
import { canManageMember, rolesBelow } from "@/lib/memberRoles";

describe("role rules (UI hints mirroring the backend: only STRICTLY lower roles)", () => {
  it("rolesBelow: what each role may grant", () => {
    expect(rolesBelow("OWNER")).toEqual(["ADMIN", "MEMBER", "VIEWER"]);
    expect(rolesBelow("ADMIN")).toEqual(["MEMBER", "VIEWER"]);
    expect(rolesBelow("MEMBER")).toEqual(["VIEWER"]);
    expect(rolesBelow("VIEWER")).toEqual([]);
  });

  it("OWNER is never grantable", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) expect(rolesBelow(role)).not.toContain("OWNER");
  });

  it("canManageMember: never equals or above (so never yourself's rank, never the owner)", () => {
    expect(canManageMember("OWNER", "ADMIN")).toBe(true);
    expect(canManageMember("OWNER", "OWNER")).toBe(false);
    expect(canManageMember("ADMIN", "MEMBER")).toBe(true);
    expect(canManageMember("ADMIN", "ADMIN")).toBe(false);
    expect(canManageMember("ADMIN", "OWNER")).toBe(false);
    expect(canManageMember("MEMBER", "VIEWER")).toBe(true); // a MEMBER's UI never shows controls: member:manage gates the panel
    expect(canManageMember("VIEWER", "VIEWER")).toBe(false);
  });
});
