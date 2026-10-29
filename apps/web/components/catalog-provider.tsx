"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PracticeCatalog } from "@/lib/catalog-types";

type CatalogContextValue = {
  catalog: PracticeCatalog | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const CatalogContext = createContext<CatalogContextValue>({
  catalog: null,
  loading: true,
  refresh: async () => undefined,
});

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/practice/catalog", { cache: "no-store" });
      if (!res.ok) throw new Error("catalog failed");
      setCatalog((await res.json()) as PracticeCatalog);
    } catch {
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ catalog, loading, refresh }), [catalog, loading, refresh]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  return useContext(CatalogContext);
}
