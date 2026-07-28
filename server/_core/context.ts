import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { resolveOrgOwnerId } from "../organizations";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** معرّف مالك المنظمة الفعلي (نفس user.id إن كان مالكاً، أو مالك منظمته إن كان مستخدماً فرعياً) */
  effectiveUserId: number | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  const effectiveUserId = user ? await resolveOrgOwnerId(user) : null;

  return {
    req: opts.req,
    res: opts.res,
    user,
    effectiveUserId,
  };
}
