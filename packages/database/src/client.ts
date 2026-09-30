import { PrismaClient } from "@prisma/client";

// One Prisma client per long-running API process. Consumers share this export.
export const prisma = new PrismaClient();
