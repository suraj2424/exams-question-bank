"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";

type AppShellProps = {
  topbar: ReactNode;
  rail?: ReactNode;
  stage: ReactNode;
  context?: ReactNode;
  status?: ReactNode;
  railLabel?: string;
  contextLabel?: string;
  wide?: boolean;
  layout?: "full" | "hub";
};

const COLLAPSE_KEY = "qb.sidebar.collapsed";

export function AppShell({
  topbar,
  rail,
  stage,
  context,
  status,
  railLabel = "Panel",
  contextLabel = "Details",
  wide,
  layout = "full",
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  const toggleCollapse = useCallback(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setMobileOpen(false);
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const desk = layout === "hub" ? "hub" : wide ? "wide" : "full";

  return (
    <div className="desk" data-desk={desk} data-sidebar={collapsed ? "collapsed" : "expanded"}>
      <aside className="hall" data-open={mobileOpen} aria-label="Main navigation">
        <Suspense fallback={<div className="hall-scroll" />}>
          <AppSidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
        </Suspense>
      </aside>
      {mobileOpen ? <div className="backdrop" onClick={() => setMobileOpen(false)} /> : null}

      <div className="desk-main">
        <div className="topbar">
          <button
            type="button"
            className="hall-menu-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          {topbar}
        </div>
        <div className="desk-body" data-layout={layout === "hub" ? "hub" : "full"}>
          {layout === "hub" ? null : (
            <aside className="desk-rail" aria-label={railLabel}>
              {rail}
            </aside>
          )}
          <main className="desk-stage">{stage}</main>
          {layout === "hub" ? null : (
            <aside className="desk-context" aria-label={contextLabel}>
              {context}
            </aside>
          )}
        </div>
        <div className="statusbar">{status}</div>
      </div>
    </div>
  );
}
