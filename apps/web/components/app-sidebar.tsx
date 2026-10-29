"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, FileText, LayoutGrid, Library, Menu } from "lucide-react";
import { useCatalog } from "@/components/catalog-provider";
import { useLang } from "@/components/lang-provider";
import { ui } from "@/lib/i18n";

type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export function AppSidebar({ collapsed, onToggleCollapse }: AppSidebarProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { lang } = useLang();
  const t = ui[lang];
  const { catalog, loading } = useCatalog();
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [papersOpen, setPapersOpen] = useState(false);

  const activeSection = params.get("section") ?? "";
  const activeTopic = params.get("topic") ?? "";
  const activePaper = params.get("paperKey") ?? "";

  const toggleSection = (name: string) => {
    setOpenSections((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  };

  useEffect(() => {
    if (!activeSection) return;
    setOpenSections((prev) => (prev.includes(activeSection) ? prev : [...prev, activeSection]));
  }, [activeSection]);

  const sections = catalog?.sections ?? [];
  const topics = catalog?.topics ?? [];
  const papers = catalog?.papers ?? [];

  return (
    <>
      <div className="hall-brand">
        <button
          type="button"
          className="hall-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
          title={collapsed ? t.expandSidebar : t.collapseSidebar}
        >
          {collapsed ? <Menu className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rotate-180" />}
        </button>
        {!collapsed ? (
          <span className="hall-brand-text">
            <span className="hall-brand-title">IBPS PO</span>
            <span className="hall-brand-sub">Bilingual Practice</span>
          </span>
        ) : null}
      </div>

      <div className="hall-scroll">
        <section className="hall-group">
          {!collapsed ? <h2 className="hall-group-title">{t.sidebarLibrary}</h2> : null}
          <Link href="/" className="hall-item" data-active={pathname === "/" || undefined} title={t.documents}>
            <Library className="sidebar-icon" strokeWidth={1.8} />
            <span className="hall-label">{t.documents}</span>
            {catalog ? <span className="hall-count">{catalog.documents}</span> : null}
          </Link>
        </section>

        <section className="hall-group">
          {!collapsed ? <h2 className="hall-group-title">{t.sidebarPractice}</h2> : null}
          <Link
            href="/practice"
            className="hall-item"
            data-active={pathname === "/practice" || undefined}
            title={t.backToPractice}
          >
            <LayoutGrid className="sidebar-icon" strokeWidth={1.8} />
            <span className="hall-label">{t.backToPractice}</span>
          </Link>
          <Link
            href="/practice/session?mode=mixed"
            target="_blank"
            rel="noopener noreferrer"
            className="hall-item"
            title={t.mixedPractice}
          >
            <FileText className="sidebar-icon" strokeWidth={1.8} />
            <span className="hall-label">{t.mixedPractice}</span>
            {catalog ? <span className="hall-count">{catalog.totalQuestions}</span> : null}
          </Link>

          {sections.map((section) => {
            const open = openSections.includes(section.name);
            const sectionTopics = topics.filter((topic) => topic.section === section.name);
            return (
              <div key={section.name}>
                <button
                  type="button"
                  className="hall-item"
                  data-active={activeSection === section.name && !activeTopic ? "true" : undefined}
                  onClick={() => toggleSection(section.name)}
                  aria-expanded={open}
                  title={section.name}
                >
                  <ChevronRight className={`hall-chevron ${open ? "hall-chevron-open" : ""}`} data-open={open} />
                  <span className="hall-label">{section.name}</span>
                  <span className="hall-count">{section.count}</span>
                </button>
                <div className="hall-sub" data-open={open}>
                  {open
                    ? sectionTopics.map((topic) => (
                        <Link
                          key={`${section.name}-${topic.name}`}
                          href={`/practice/session?section=${encodeURIComponent(section.name)}&topic=${encodeURIComponent(topic.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hall-item"
                          data-active={activeTopic === topic.name || undefined}
                          title={topic.name}
                        >
                          <span className="hall-dot" aria-hidden="true" />
                          <span className="hall-label">{topic.name}</span>
                          <span className="hall-count">{topic.count}</span>
                        </Link>
                      ))
                    : null}
                </div>
              </div>
            );
          })}

          {papers.length > 0 ? (
            <div>
              <button
                type="button"
                className="hall-item"
                data-active={papersOpen || activePaper !== "" ? "true" : undefined}
                onClick={() => setPapersOpen((open) => !open)}
                aria-expanded={papersOpen}
                title={t.papers}
              >
                <ChevronRight className={`hall-chevron ${papersOpen ? "hall-chevron-open" : ""}`} data-open={papersOpen} />
                <span className="hall-label">{t.papers}</span>
                <span className="hall-count">{papers.length}</span>
              </button>
              <div className="hall-sub" data-open={papersOpen}>
                {papersOpen
                  ? papers.map((paper) => (
                      <Link
                        key={paper.paperKey}
                        href={`/practice/session?paperKey=${encodeURIComponent(paper.paperKey)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hall-item"
                        data-active={activePaper === paper.paperKey || undefined}
                        title={paper.title ?? paper.paperKey}
                      >
                        <span className="hall-dot" aria-hidden="true" />
                        <span className="hall-label">{paper.title ?? paper.paperKey}</span>
                        <span className="hall-count">{paper.count}</span>
                      </Link>
                    ))
                  : null}
              </div>
            </div>
          ) : null}

          {loading ? <p className="hall-hint">{t.loadingCatalog}</p> : null}
          {!loading && (catalog?.totalQuestions ?? 0) === 0 ? (
            <p className="hall-hint">{t.noQuestions}</p>
          ) : null}
        </section>
      </div>
    </>
  );
}
