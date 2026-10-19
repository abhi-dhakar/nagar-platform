"use client";

import { useCallback, useEffect, useState } from "react";
import { getMe, listRepositories, createRepository, getHubBaseUrl, setStoredHubUrl, signIn as apiSignIn, signUp as apiSignUp, signOut as apiSignOut } from "./client";
import type { NagarHubRepository, NagarHubUser } from "./types";

export type NagarHubState = {
  hubUrl: string;
  user: NagarHubUser | null;
  repositories: NagarHubRepository[];
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  isAuthenticated: boolean;
};

export function useNagarHub() {
  const [hubUrl, setHubUrl] = useState(() => getHubBaseUrl());
  const [user, setUser] = useState<NagarHubUser | null>(null);
  const [repositories, setRepositories] = useState<NagarHubRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [initialChecked, setInitialChecked] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const me = await getMe();
      setUser(me);
      try {
        const repos = await listRepositories();
        setRepositories(repos);
      } catch (e) {
        // If repo listing fails but me succeeded, keep user but set error
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        const err = e as { code?: string };
        setErrorCode(err?.code ?? null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const err = e as { status?: number; code?: string };
      if (err?.status === 401) {
        setUser(null);
        setRepositories([]);
        setError(null);
        setErrorCode(null);
      } else {
        setError(msg);
        setErrorCode(err?.code ?? null);
      }
    } finally {
      setLoading(false);
      setInitialChecked(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateHubUrl = useCallback((url: string) => {
    const normalized = url.trim().replace(/\/+$/, "") || "http://localhost:4000";
    setStoredHubUrl(normalized);
    setHubUrl(normalized);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      await apiSignIn(email, password);
      await refresh();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      const err = e as { code?: string; status?: number };
      setErrorCode(err?.code ?? String(err?.status ?? ""));
      return false;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const signUp = useCallback(async (data: { name: string; email: string; password: string; username: string }) => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      await apiSignUp(data);
      await refresh();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      const err = e as { code?: string };
      setErrorCode(err?.code ?? null);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await apiSignOut();
    } catch {
      // ignore signout errors
    }
    setUser(null);
    setRepositories([]);
    setError(null);
    setErrorCode(null);
    setLoading(false);
  }, []);

  const createRepo = useCallback(async (data: { name: string; description?: string; visibility: "PUBLIC" | "PRIVATE" }) => {
    setLoading(true);
    setError(null);
    try {
      const repo = await createRepository(data);
      // Refresh list
      const repos = await listRepositories();
      setRepositories(repos);
      return repo;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      const err = e as { code?: string };
      setErrorCode(err?.code ?? null);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    hubUrl,
    user,
    repositories,
    loading,
    error,
    errorCode,
    isAuthenticated: !!user,
    initialChecked,
    refresh,
    updateHubUrl,
    signIn,
    signUp,
    signOut,
    createRepo,
  };
}
