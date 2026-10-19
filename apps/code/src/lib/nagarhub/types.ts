export type NagarHubUser = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  bio?: string | null;
  createdAt?: string;
};

export type NagarHubRepository = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  createdAt: string;
  updatedAt: string;
  owner: string | null;
  namespace: string | null;
  namespaceType: "USER" | "ORGANIZATION";
  role?: string | null;
  cloneUrl: string | null;
  defaultBranch?: string | null;
  branch?: string | null;
  branches?: string[];
};

export type NagarHubRepositoryDetails = NagarHubRepository & {
  files?: { name: string; path: string; kind: string }[];
  commits?: { sha: string; message: string; author: string; date: string }[];
  readme?: string | null;
  branches: string[];
  defaultBranch: string | null;
};

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: { code: string; message: string } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
