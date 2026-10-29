"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useCatalog } from "@/components/catalog-provider";
import { LangToggle } from "@/components/lang-toggle";
import { useLang } from "@/components/lang-provider";
import { ui } from "@/lib/i18n";

const SIZES = [10, 20, 50];

export default function PracticeHubPage() {
  const { lang, setLang } = useLang();
  const t = ui[lang];
  const { catalog, loading } = useCatalog();
  const [size, setSize] = useState(10);

  const sections = catalog?.sections ?? [];
  const topics = useMemo(() => catalog?.topics ?? [], [catalog]);
  const papers = catalog?.papers ?? [];

  const topicsBySection = useMemo(() => {
    const map = new Map<string, typeof topics>();
    for (const topic of topics) {
      const list = map.get(topic.section) ?? [];
      list.push(topic);
      map.set(topic.section, list);
    }
    return map;
  }, [topics]);

  const totalQuestions = catalog?.totalQuestions ?? 0;
  const maxSectionCount = sections.reduce((max, section) => Math.max(max, section.count), 0);

  const topicHref = (section: string, topic: string) =>
    `/practice/session?section=${encodeURIComponent(section)}&topic=${encodeURIComponent(topic)}&size=${size}`;
  const sectionHref = (section: string) =>
    `/practice/session?section=${encodeURIComponent(section)}&size=${size}`;
  const paperHref = (paperKey: string) =>
    `/practice/session?paperKey=${encodeURIComponent(paperKey)}&size=${size}`;

  return (
    <AppShell
      layout="hub"
      topbar={
        <>
          <div className="topbar-brand">
            <h1 className="topbar-title">{t.sidebarPractice}</h1>
            <p className="topbar-sub">{t.chooseTopicHint}</p>
          </div>
          <div className="topbar-actions">
            <label className="topbar-field">
              {t.length}
              <select
                className="size-select"
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
                aria-label={t.length}
              >
                {SIZES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <LangToggle lang={lang} onLangChange={setLang} />
          </div>
        </>
      }
      status={
        <>
          <span className="min-w-0 flex-1 truncate">
            {loading ? t.loadingCatalog : `${totalQuestions} ${t.questions}`}
          </span>
          <span className="hidden shrink-0 whitespace-nowrap sm:inline">
            {sections.length} {t.topics} · {papers.length} {t.papers}
          </span>
        </>
      }
      stage={
        <div className="hub">
          <div className="hub-inner">
            <section className="ticket">
              <div className="ticket-main">
                <span className="ticket-eyebrow">{t.app}</span>
                <h2 className="ticket-title">{t.chooseTopic}</h2>
                <p className="ticket-sub">{t.chooseTopicHint}</p>
              </div>
              <div className="ticket-stubs">
                <div className="ticket-stub">
                  <span className="ticket-stub-label">{t.questions}</span>
                  <span className="ticket-stub-value">{totalQuestions}</span>
                </div>
                <div className="ticket-stub">
                  <span className="ticket-stub-label">{t.topics}</span>
                  <span className="ticket-stub-value">{topics.length}</span>
                </div>
                <div className="ticket-stub">
                  <span className="ticket-stub-label">{t.papers}</span>
                  <span className="ticket-stub-value">{papers.length}</span>
                </div>
              </div>
            </section>

            <div className="hub-columns">
              <div className="hub-primary">
                <Link
                  href={`/practice/session?mode=mixed&size=${size}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hub-mixed"
                >
                  <span className="hub-mixed-text">
                    <span className="hub-mixed-label">{t.mixedPractice}</span>
                    <span className="hub-mixed-count">
                      {totalQuestions} {t.questions}
                    </span>
                  </span>
                  <span className="hub-mixed-cta">
                    {t.startPractice} <ArrowRight size={14} strokeWidth={2} />
                  </span>
                </Link>
              </div>

              <section className="hub-panel">
                <h3 className="hub-title">{t.topics}</h3>
                <div className="hub-sections">
                  {sections.map((section) => {
                    const sectionTopics = topicsBySection.get(section.name) ?? [];
                    const share = maxSectionCount > 0 ? (section.count / maxSectionCount) * 100 : 0;
                    return (
                      <article key={section.name} className="hub-card">
                        <div className="hub-card-head">
                          <h4 className="hub-card-title">{section.name}</h4>
                          <span className="hub-count">
                            {section.count} {t.questions}
                          </span>
                        </div>
                        <div className="hub-bar" aria-hidden="true">
                          <span className="hub-bar-fill" style={{ width: `${share}%` }} />
                        </div>
                        <div className="hub-topic-list">
                          {sectionTopics.map((topic) => (
                            <Link
                              key={topic.name}
                              href={topicHref(section.name, topic.name)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hub-topic"
                            >
                              <span className="hub-topic-label">{topic.name}</span>
                              <span className="hub-count">{topic.count}</span>
                            </Link>
                          ))}
                          <Link
                            href={sectionHref(section.name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hub-topic hub-topic-cta-row"
                          >
                            <span className="hub-topic-label hub-topic-cta">
                              {t.startPractice} <ArrowRight size={12} strokeWidth={2.5} />
                            </span>
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="hub-panel">
                <h3 className="hub-title">{t.papers}</h3>
                <div className="hub-papers">
                  {papers.map((paper) => (
                    <Link
                      key={paper.paperKey}
                      href={paperHref(paper.paperKey)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hub-paper"
                    >
                      <span className="min-w-0">
                        <span className="hub-paper-title">{paper.title ?? paper.paperKey}</span>
                        <span className="hub-count">
                          {paper.count} {t.questions}
                        </span>
                      </span>
                      <span className="hub-arrow" aria-hidden="true">
                        <ArrowRight size={14} strokeWidth={2} />
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            {!loading && totalQuestions === 0 ? <p className="empty">{t.noQuestions}</p> : null}
          </div>
        </div>
      }
    />
  );
}
