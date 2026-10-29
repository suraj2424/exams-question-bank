"use client";

import type { DocumentListItem } from "@/lib/document-types";
import { formatBytes, statusStamp } from "@/lib/document-types";

type DocumentListProps = {
  items: DocumentListItem[];
  selectedId: string | null;
  onSelect: (item: DocumentListItem) => void;
};

function phaseLabel(item: DocumentListItem): string {
  if (item.status === "failed") return "failed";
  if (item.status === "completed") return "ready";
  if (item.status === "queued") return "queued";
  return item.progress?.phase ?? item.stage ?? "working";
}

export function DocumentList({ items, selectedId, onSelect }: DocumentListProps) {
  if (items.length === 0) {
    return <p className="empty">No documents yet. Paste a PDF link to start.</p>;
  }

  return (
    <ul className="doc-list" aria-label="Documents">
      {items.map((item) => {
        const percent = item.progress?.percent ?? null;
        const active = item.jobId === selectedId;
        const stamp = statusStamp(item.status);
        const busy = item.status === "running" || item.status === "queued";
        return (
          <li key={item.jobId}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              aria-current={active ? "true" : undefined}
              data-active={active || undefined}
              className="doc-item"
            >
              <div className="doc-item-head">
                <span className="doc-item-title">{item.title}</span>
                <span className={`stamp ${stamp.tone}`}>{stamp.label}</span>
              </div>

              {busy ? (
                <div className="doc-item-progress">
                  <div className="doc-item-meter">
                    <div className="doc-item-meter-fill" style={{ width: `${percent ?? 5}%` }} />
                  </div>
                  <p className="doc-item-phase">
                    {item.progress?.message ?? phaseLabel(item)}
                    {percent !== null ? ` · ${percent}%` : ""}
                  </p>
                </div>
              ) : null}

              <dl className="doc-item-grid">
                <div>
                  <dt>Pages</dt>
                  <dd>{item.pages ?? "-"}</dd>
                </div>
                <div>
                  <dt>Q</dt>
                  <dd>{item.counts.questions}</dd>
                </div>
                <div>
                  <dt>Ans</dt>
                  <dd>{item.counts.answered}</dd>
                </div>
                <div>
                  <dt>Sets</dt>
                  <dd>{item.counts.sets}</dd>
                </div>
              </dl>

              <p className="doc-item-path" title={item.storage.absolutePath ?? ""}>
                {item.storage.relativePath ?? "not stored yet"}
                {item.storage.bytes ? ` · ${formatBytes(item.storage.bytes)}` : ""}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
