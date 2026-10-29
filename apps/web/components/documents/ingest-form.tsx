"use client";

import { useState } from "react";

type IngestFormProps = {
  onQueued: (jobId: string) => void;
};

export function IngestForm({ onQueued }: IngestFormProps) {
  const [url, setUrl] = useState("");
  const [paperKey, setPaperKey] = useState("");
  const [translate, setTranslate] = useState(false);
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const link = url.trim();
    if (!link) {
      setError("Paste the PDF link first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link, paperKey: paperKey.trim() || undefined, translate, explain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "could not queue the document");
      onQueued(data.jobId);
      setUrl("");
      setPaperKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="doc-ingest" onSubmit={handleSubmit}>
      <label className="doc-label" htmlFor="doc-url">
        PDF link
      </label>
      <input
        id="doc-url"
        className="doc-input"
        type="url"
        inputMode="url"
        placeholder="https://example.com/ibps-po-2020.pdf"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />

      <label className="doc-label" htmlFor="doc-paper-key">
        Paper key <span className="doc-label-optional">(optional)</span>
      </label>
      <input
        id="doc-paper-key"
        className="doc-input"
        type="text"
        placeholder="ibps-po-prelims-2020"
        value={paperKey}
        onChange={(event) => setPaperKey(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="doc-switches">
        <label className="doc-switch">
          <input type="checkbox" checked={explain} onChange={(event) => setExplain(event.target.checked)} />
          <span>Write explanations</span>
        </label>
        <label className="doc-switch">
          <input type="checkbox" checked={translate} onChange={(event) => setTranslate(event.target.checked)} />
          <span>Hindi translation</span>
        </label>
      </div>

      {error ? (
        <p className="doc-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn doc-submit" disabled={busy}>
        {busy ? "Queueing..." : "Download & parse"}
      </button>
      <p className="doc-hint">
        The PDF is downloaded to <code>storage/raw</code>, parsed by the AI model, then stored by section, topic
        and connected question set.
      </p>
    </form>
  );
}
