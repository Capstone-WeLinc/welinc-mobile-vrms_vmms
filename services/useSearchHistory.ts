import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearRecentSearches,
  getRecentSearches,
  recordRecentSearch,
  type SearchHistorySurface,
} from "./searchHistory";

interface SearchHistoryState {
  key: string;
  items: string[];
  loading: boolean;
  error: string | null;
}

export function useSearchHistory(
  userId: string | undefined,
  surface: SearchHistorySurface,
) {
  const storageKey = userId ? `${userId}:${surface}` : "";
  const requestId = useRef(0);
  const [state, setState] = useState<SearchHistoryState>({
    key: "",
    items: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!userId) return;
    const currentRequestId = ++requestId.current;
    void getRecentSearches(userId, surface)
      .then((items) => {
        if (requestId.current !== currentRequestId) return;
        setState({ key: storageKey, items, loading: false, error: null });
      })
      .catch(() => {
        if (requestId.current !== currentRequestId) return;
        setState({
          key: storageKey,
          items: [],
          loading: false,
          error: "Unable to load recent searches.",
        });
      });

    return () => {
      if (requestId.current === currentRequestId) requestId.current += 1;
    };
  }, [storageKey, surface, userId]);

  const recordSearch = useCallback(
    async (query: string): Promise<boolean> => {
      if (!userId || !query.trim()) return true;
      const currentRequestId = ++requestId.current;
      try {
        const items = await recordRecentSearch(userId, surface, query);
        if (requestId.current === currentRequestId) {
          setState({ key: storageKey, items, loading: false, error: null });
        }
        return true;
      } catch {
        if (requestId.current === currentRequestId) {
          setState((current) => ({
            key: storageKey,
            items: current.key === storageKey ? current.items : [],
            loading: false,
            error: "Unable to save this search.",
          }));
        }
        return false;
      }
    },
    [storageKey, surface, userId],
  );

  const clearHistory = useCallback(async (): Promise<boolean> => {
    if (!userId) return true;
    const currentRequestId = ++requestId.current;
    try {
      await clearRecentSearches(userId, surface);
      if (requestId.current === currentRequestId) {
        setState({ key: storageKey, items: [], loading: false, error: null });
      }
      return true;
    } catch {
      if (requestId.current === currentRequestId) {
        setState((current) => ({
          key: storageKey,
          items: current.key === storageKey ? current.items : [],
          loading: false,
          error: "Unable to clear recent searches.",
        }));
      }
      return false;
    }
  }, [storageKey, surface, userId]);

  return {
    items: state.key === storageKey ? state.items : [],
    loading: Boolean(userId) && (state.key !== storageKey || state.loading),
    error: state.key === storageKey ? state.error : null,
    recordSearch,
    clearHistory,
  };
}
