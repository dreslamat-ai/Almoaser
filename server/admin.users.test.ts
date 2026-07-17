import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db helpers so tests don't need a live database
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAllUsers: vi.fn(async () => [
      { id: 1, name: "Admin", email: "a@a.com", role: "admin", isActive: true, loginMethod: "manus", createdAt: new Date(), lastSignedIn: new Date() },
      { id: 2, name: "User", email: "u@u.com", role: "user", isActive: true, loginMethod: "manus", createdAt: new Date(), lastSignedIn: new Date() },
    ]),
    setUserRole: vi.fn(async () => undefined),
    setUserActive: vi.fn(async () => undefined),
  };
});

function makeCtx(role: "admin" | "user", id = 1): TrpcContext {
  return {
    user: {
      id,
      openId: `test-${id}`,
      name: "Test",
      email: "t@t.com",
      loginMethod: "manus",
      role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

describe("admin.users", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns users list for admin", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const list = await caller.admin.users();
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveProperty("isActive");
  });

  it("rejects non-admin", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 2));
    await expect(caller.admin.users()).rejects.toThrow();
  });
});

describe("admin.setUserRole", () => {
  it("allows admin to change another user's role", async () => {
    const caller = appRouter.createCaller(makeCtx("admin", 1));
    const res = await caller.admin.setUserRole({ userId: 2, role: "admin" });
    expect(res.success).toBe(true);
  });

  it("prevents admin from demoting self", async () => {
    const caller = appRouter.createCaller(makeCtx("admin", 1));
    await expect(caller.admin.setUserRole({ userId: 1, role: "user" })).rejects.toThrow(/لا يمكنك/);
  });

  it("rejects non-admin", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 2));
    await expect(caller.admin.setUserRole({ userId: 1, role: "user" })).rejects.toThrow();
  });
});

describe("admin.setUserActive", () => {
  it("allows admin to deactivate another user", async () => {
    const caller = appRouter.createCaller(makeCtx("admin", 1));
    const res = await caller.admin.setUserActive({ userId: 2, isActive: false });
    expect(res.success).toBe(true);
  });

  it("prevents admin from deactivating self", async () => {
    const caller = appRouter.createCaller(makeCtx("admin", 1));
    await expect(caller.admin.setUserActive({ userId: 1, isActive: false })).rejects.toThrow(/لا يمكنك/);
  });
});
