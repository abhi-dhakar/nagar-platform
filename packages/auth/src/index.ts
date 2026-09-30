import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth, type Auth } from "better-auth";
import { prisma } from "@nagar/database";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must be set to a random value of at least 32 characters.");
}

const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const auth: Auth = betterAuth({
  appName: "Nagar",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
  secret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
}) as unknown as Auth;

export type NagarAuth = typeof auth;
