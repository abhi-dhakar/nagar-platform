"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentClient } from "./client";
import type { GitBranch, GitLogResponse, GitRemote, GitStatus } from "@nagar/agent-protocol";

export type GitState = {
  status: GitStatus | null;
  branches: GitBranch[];
  remotes: GitRemote[];
  log: GitLogResponse | null;
  loading: boolean;
  error: string | null;
  isRepo: boolean;
  currentBranch: string | null;
};

export function useGit(client: AgentClient | null, workspaceId: string | null) {
  const [state, setState] = useState<GitState>({
    status: null,
    branches: [],
    remotes: [],
    log: null,
    loading: false,
    error: null,
    isRepo: false,
    currentBranch: null,
  });

  const refresh = useCallback(async () => {
    if (!client || !workspaceId) {
      setState((s) => ({ ...s, status: null, branches: [], remotes: [], log: null, isRepo: false, currentBranch: null }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [statusRes, branchesRes, remotesRes, logRes] = await Promise.all([
        client.gitStatus(workspaceId).catch((e: unknown) => ({ status: null as GitStatus | null, error: e })),
        client.gitBranches(workspaceId).catch(() => ({ branches: [] as GitBranch[] })),
        client.gitRemotes(workspaceId).catch(() => ({ remotes: [] as GitRemote[] })),
        client.gitLog(workspaceId, { limit: 50 }).catch(() => ({ commits: [], hasMore: false } as GitLogResponse)),
      ]);

      const status = (statusRes as { status: GitStatus | null })?.status ?? null;
      const branches = (branchesRes as { branches: GitBranch[] })?.branches ?? [];
      const remotes = (remotesRes as { remotes: GitRemote[] })?.remotes ?? [];
      const log = (logRes as GitLogResponse)?.commits ? (logRes as GitLogResponse) : null;

      // Determine current branch from status or branches
      let currentBranch: string | null = status?.branch ?? null;
      if (!currentBranch) {
        const current = branches.find((b: GitBranch) => b.current);
        currentBranch = current?.name ?? null;
      }

      const statusError = (statusRes as { error?: unknown })?.error;
      setState({
        status,
        branches,
        remotes,
        log,
        loading: false,
        error: statusError ? (statusError instanceof Error ? statusError.message : String(statusError)) : null,
        isRepo: status ? status.isRepo : false,
        currentBranch,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const init = useCallback(async (branch = "main") => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitInit(workspaceId, branch);
    await refresh();
  }, [client, workspaceId, refresh]);

  const stage = useCallback(async (paths: string[]) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitAdd(workspaceId, paths);
    await refresh();
  }, [client, workspaceId, refresh]);

  const unstage = useCallback(async (paths: string[]) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitReset(workspaceId, paths);
    await refresh();
  }, [client, workspaceId, refresh]);

  const discard = useCallback(async (path: string) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitRestore(workspaceId, path);
    await refresh();
  }, [client, workspaceId, refresh]);

  const commit = useCallback(async (message: string, author?: { name: string; email: string }) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    const result = await client.gitCommit(workspaceId, message, author);
    await refresh();
    return result;
  }, [client, workspaceId, refresh]);

  const createBranch = useCallback(async (name: string, checkout?: boolean) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitCreateBranch(workspaceId, name, checkout ? { checkout: true } : {});
    await refresh();
  }, [client, workspaceId, refresh]);

  const checkout = useCallback(async (name: string, create?: boolean) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitCheckout(workspaceId, name, create);
    await refresh();
  }, [client, workspaceId, refresh]);

  const deleteBranch = useCallback(async (name: string, force?: boolean) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitDeleteBranch(workspaceId, name, force);
    await refresh();
  }, [client, workspaceId, refresh]);

  const merge = useCallback(async (branch: string, message?: string) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    const result = await client.gitMerge(workspaceId, branch, message);
    await refresh();
    return result;
  }, [client, workspaceId, refresh]);

  const fetch = useCallback(async (opts?: { remote?: string; credentials?: { username: string; password: string } }) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    return client.gitFetch(workspaceId, opts ?? {});
  }, [client, workspaceId]);

  const pull = useCallback(async (opts?: { remote?: string; branch?: string; credentials?: { username: string; password: string }; rebase?: boolean }) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    const result = await client.gitPull(workspaceId, opts ?? {});
    await refresh();
    return result;
  }, [client, workspaceId, refresh]);

  const push = useCallback(async (opts?: { remote?: string; branch?: string; setUpstream?: boolean; credentials?: { username: string; password: string }; force?: boolean }) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    return client.gitPush(workspaceId, opts ?? {});
  }, [client, workspaceId]);

  const addRemote = useCallback(async (name: string, url: string) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitAddRemote(workspaceId, name, url);
    await refresh();
  }, [client, workspaceId, refresh]);

  const removeRemote = useCallback(async (name: string) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitRemoveRemote(workspaceId, name);
    await refresh();
  }, [client, workspaceId, refresh]);

  const diff = useCallback(async (path?: string, staged?: boolean) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    return client.gitDiff(workspaceId, { ...(path ? { path } : {}), ...(staged !== undefined ? { staged } : {}) });
  }, [client, workspaceId]);

  const setConfig = useCallback(async (key: string, value: string) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    await client.gitConfigSet(workspaceId, key, value);
  }, [client, workspaceId]);

  const getConfig = useCallback(async (key?: string) => {
    if (!client || !workspaceId) throw new Error("No workspace");
    return client.gitConfigGet(workspaceId, key);
  }, [client, workspaceId]);

  return {
    ...state,
    refresh,
    init,
    stage,
    unstage,
    discard,
    commit,
    createBranch,
    checkout,
    deleteBranch,
    merge,
    fetch,
    pull,
    push,
    addRemote,
    removeRemote,
    diff,
    setConfig,
    getConfig,
  };
}
