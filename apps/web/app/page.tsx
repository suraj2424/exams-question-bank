"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StateCard } from "@/components/state-card";
import { DocumentDetail } from "@/components/documents/document-detail";
import { DocumentFacts } from "@/components/documents/document-facts";
import { DocumentList } from "@/components/documents/document-list";
import { IngestForm } from "@/components/documents/ingest-form";
import { LangToggle } from "@/components/lang-toggle";
import { useLang } from "@/components/lang-provider";
import type { DocumentDetail as Detail, DocumentListItem } from "@/lib/document-types";

const POLL_MS = 2500;

export default function LibraryPage() {
  const { lang, setLang } = useLang();
  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const selectedRef = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      if (!res.ok) throw new Error("could not load documents");
      const data = (await res.json()) as DocumentListItem[];
      setItems(data);
      setError(null);
      if (!selectedRef.current && data.length > 0) {
        selectedRef.current = data[0].jobId;
        setSelectedId(data[0].jobId);
      }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (jobId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/documents/${jobId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("could not load the document");
      const data = (await res.json()) as Detail;
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const busy = useMemo(
    () => items.some((item) => item.status === "queued" || item.status === "running"),
    [items],
  );

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      void loadList();
      if (selectedRef.current) void loadDetail(selectedRef.current);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, loadList, loadDetail]);

  const handleSelect = useCallback((item: DocumentListItem) => {
    selectedRef.current = item.jobId;
    setSelectedId(item.jobId);
  }, []);

  const handleQueued = useCallback(
    (jobId: string) => {
      selectedRef.current = jobId;
      setSelectedId(jobId);
      void loadList();
    },
    [loadList],
  );

  const handleRetry = useCallback(async () => {
    if (!selectedId) return;
    setRetrying(true);
    try {
      await fetch(`/api/documents/${selectedId}`, { method: "POST" });
      await loadList();
    } finally {
      setRetrying(false);
    }
  }, [selectedId, loadList]);

  const selectedItem = useMemo(
    () => items.find((item) => item.jobId === selectedId) ?? null,
    [items, selectedId],
  );

  const totalQuestions = useMemo(
    () => items.reduce((sum, item) => sum + item.counts.questions, 0),
    [items],
  );

  const stage = (() => {
    if (loading) return <StateCard message="Loading documents..." />;
    if (error) return <StateCard message={error} tone="error" />;
    if (!selectedId) {
      return (
        <StateCard message="Paste a PDF link on the left to download, parse and categorise a question paper." />
      );
    }
    if (detailLoading && !detail) return <StateCard message="Loading document..." />;
    if (!detail) return <StateCard message="This document has no parsed content yet." />;
    return (
      <div className="panel scroll-region">
        <div className="p-4">
          <DocumentDetail detail={detail} onRetry={handleRetry} retrying={retrying} />
        </div>
      </div>
    );
  })();

  return (
    <AppShell
      wide
      railLabel="Documents"
      contextLabel="Document details"
      topbar={
        <>
          <div className="topbar-brand">
            <h1 className="topbar-title">Question Bank Library</h1>
            <p className="topbar-sub">Download a PDF · parse it with AI · store it by category</p>
          </div>
          <div className="topbar-actions">
            <LangToggle lang={lang} onLangChange={setLang} />
          </div>
        </>
      }
      rail={
        <>
          <section className="panel">
            <h2 className="panel-title">Add a document</h2>
            <div className="p-3">
              <IngestForm onQueued={handleQueued} />
            </div>
          </section>
          <section className="panel panel-flush flex-1">
            <h2 className="panel-title">
              Documents
              <span className="panel-title-count">{items.length}</span>
            </h2>
            <div className="scroll-region min-h-0 flex-1">
              <DocumentList items={items} selectedId={selectedId} onSelect={handleSelect} />
            </div>
          </section>
        </>
      }
      stage={stage}
      context={<DocumentFacts item={selectedItem} detail={detail} />}
      status={
        <>
          <span className="min-w-0 flex-1 truncate">
            {items.length} documents · {totalQuestions} questions parsed
          </span>
          <span className="hidden shrink-0 whitespace-nowrap sm:inline">storage/raw</span>
          <span className="hidden shrink-0 whitespace-nowrap md:inline">
            {busy ? "processing..." : "idle"}
          </span>
        </>
      }
    />
  );
}
