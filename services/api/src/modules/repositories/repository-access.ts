import { prisma } from "@nagar/database";

export type RepositoryAccessRole = "READ" | "WRITE" | "ADMIN";
export type OrganizationAccessRole = "OWNER" | "ADMIN" | "MEMBER";

const roleRank: Record<RepositoryAccessRole, number> = { READ: 1, WRITE: 2, ADMIN: 3 };

export function roleAtLeast(
  role: RepositoryAccessRole | null,
  minimum: RepositoryAccessRole,
): boolean {
  return role !== null && roleRank[role] >= roleRank[minimum];
}

/**
 * The single place that decides what a user may do with a repository:
 *
 * - the personal owner is ADMIN;
 * - organization OWNER/ADMIN are ADMIN, organization MEMBER is WRITE;
 * - an explicit repository collaborator has their granted role;
 * - when several apply, the highest wins.
 */
export function effectiveRole(input: {
  isOwner: boolean;
  organizationRole?: OrganizationAccessRole | null;
  collaboratorRole?: RepositoryAccessRole | null;
}): RepositoryAccessRole | null {
  if (input.isOwner) return "ADMIN";
  let highest: RepositoryAccessRole | null = null;
  if (input.organizationRole) highest = input.organizationRole === "MEMBER" ? "WRITE" : "ADMIN";
  const collaborator = input.collaboratorRole ?? null;
  if (collaborator && (!highest || roleRank[collaborator] > roleRank[highest]))
    highest = collaborator;
  return highest;
}

export async function repositoryRole(
  repositoryId: string,
  ownerId: string | null,
  organizationId: string | null,
  userId: string | null,
): Promise<RepositoryAccessRole | null> {
  if (!userId) return null;
  if (ownerId && userId === ownerId) return "ADMIN";
  const [organizationMember, member] = await Promise.all([
    organizationId
      ? prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
          select: { role: true },
        })
      : Promise.resolve(null),
    prisma.repositoryMember.findUnique({
      where: { repositoryId_userId: { repositoryId, userId } },
      select: { role: true },
    }),
  ]);
  return effectiveRole({
    isOwner: false,
    organizationRole: organizationMember?.role ?? null,
    collaboratorRole: member?.role ?? null,
  });
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
  return roleAtLeast(role, minimum);
}

/**
 * Of the given users, those who currently hold at least `minimum` on the repository. One batch
 * of queries, so it is cheap enough to use when summarizing many reviews.
 */
export async function usersWithRole(
  repository: { id: string; ownerId: string | null; organizationId: string | null },
  userIds: readonly string[],
  minimum: RepositoryAccessRole,
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const [members, organizationMembers] = await Promise.all([
    prisma.repositoryMember.findMany({
      where: { repositoryId: repository.id, userId: { in: ids } },
      select: { userId: true, role: true },
    }),
    repository.organizationId
      ? prisma.organizationMember.findMany({
          where: { organizationId: repository.organizationId, userId: { in: ids } },
          select: { userId: true, role: true },
        })
      : Promise.resolve([]),
  ]);
  const collaboratorRoles = new Map(members.map((member) => [member.userId, member.role]));
  const organizationRoles = new Map(
    organizationMembers.map((member) => [member.userId, member.role]),
  );
  return new Set(
    ids.filter((id) =>
      roleAtLeast(
        effectiveRole({
          isOwner: repository.ownerId === id,
          organizationRole: organizationRoles.get(id) ?? null,
          collaboratorRole: collaboratorRoles.get(id) ?? null,
        }),
        minimum,
      ),
    ),
  );
}
