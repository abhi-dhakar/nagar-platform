import { prisma } from "@nagar/database";

export type RepositoryAccessRole = "READ" | "WRITE" | "ADMIN";

const roleRank: Record<RepositoryAccessRole, number> = { READ: 1, WRITE: 2, ADMIN: 3 };

export async function repositoryRole(
  repositoryId: string,
  ownerId: string | null,
  organizationId: string | null,
  userId: string | null,
): Promise<RepositoryAccessRole | null> {
  if (!userId) return null;
  if (ownerId && userId === ownerId) return "ADMIN";
  let highest: RepositoryAccessRole | null = null;
  if (organizationId) {
    const organizationMember = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (organizationMember) highest = organizationMember.role === "MEMBER" ? "WRITE" : "ADMIN";
  }
  const member = await prisma.repositoryMember.findUnique({
    where: { repositoryId_userId: { repositoryId, userId } },
    select: { role: true },
  });
  if (member && (!highest || roleRank[member.role] > roleRank[highest])) highest = member.role;
  return highest;
}

export async function canAccessRepository(
  repository: {
    id: string;
    ownerId: string | null;
    organizationId?: string | null;
    visibility: "PUBLIC" | "PRIVATE";
  },
  userId: string | null,
  minimum: RepositoryAccessRole = "READ",
): Promise<boolean> {
  if (repository.visibility === "PUBLIC" && minimum === "READ") return true;
  const role = await repositoryRole(
    repository.id,
    repository.ownerId,
    repository.organizationId ?? null,
    userId,
  );
  return role !== null && roleRank[role] >= roleRank[minimum];
}
