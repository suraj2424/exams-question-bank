"use client";

import type { DocumentDetail as Detail, DocumentListItem } from "@/lib/document-types";
import { formatBytes, statusStamp } from "@/lib/document-types";

type DocumentFactsProps = {
  item: DocumentListItem | null;
  detail: Detail | null;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="fact-row">
      <dt className="fact-label">{label}</dt>
      <dd className="fact-value">{value}</dd>
    </div>
  );
}

export function DocumentFacts({ item, detail }: DocumentFactsProps) {
  if (!item) {
    return (
      <section className="panel">
        <h2 className="panel-title">Document</h2>
        <p className="empty">Select a document to see its download, storage and parse details.</p>
      </section>
    );
  }

  const percent = item.progress?.percent ?? null;
  const busy = item.status === "running" || item.status === "queued";
  const storage = detail?.document?.storage ?? item.storage;
  const stamp = statusStamp(item.status);

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Document</h2>
        <dl className="fact-list">
          <Row
            label="Status"
            value={<span className={`stamp ${stamp.tone}`}>{stamp.label}</span>}
          />
          {busy ? (
            <div className="doc-progress">
              <div className="doc-progress-meter">
                <div className="doc-progress-fill" style={{ width: `${percent ?? 5}%` }} />
              </div>
              <p className="doc-progress-note">
                {item.progress?.message ?? "working"}
                {percent !== null ? ` · ${percent}%` : ""}
              </p>
            </div>
          ) : null}
          <Row label="Pages" value={item.pages ?? "-"} />
          <Row label="Size" value={formatBytes(storage.bytes ?? item.storage.bytes)} />
          <Row
            label="Downloaded"
            value={
              item.progress?.downloadedBytes !== null && item.progress?.downloadedBytes !== undefined
                ? `${formatBytes(item.progress.downloadedBytes)} / ${formatBytes(item.progress.totalBytes)}`
                : "-"
            }
          />
          <Row label="Parse method" value={item.parseMethod ?? "-"} />
          <Row label="Questions" value={item.counts.questions} />
          <Row label="Answered" value={item.counts.answered} />
          <Row label="Published" value={item.counts.published} />
          <Row label="Sets" value={item.counts.sets} />
          <Row label="Warnings" value={item.counts.warnings} />
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel-title">Local storage</h2>
        <dl className="fact-list">
          <Row label="Folder" value="storage/raw" />
          <Row label="Relative" value={storage.relativePath ?? "-"} />
          <Row label="Absolute" value={storage.absolutePath ?? "-"} />
          <Row label="On disk" value={storage.exists ? "yes" : "not yet"} />
          <Row label="SHA-256" value={item.sha256 ?? "-"} />
        </dl>
      </section>

      {item.sourceUrl ? (
        <section className="panel">
          <h2 className="panel-title">Source</h2>
          <p className="empty break-anywhere">{item.sourceUrl}</p>
        </section>
      ) : null}
    </>
  );
}
