"use client";

import { useMemo } from "react";
import type { DocumentDetail as Detail, DocumentQuestion } from "@/lib/document-types";
import { formatBytes, statusStamp } from "@/lib/document-types";

type DocumentDetailProps = {
  detail: Detail;
  onRetry: () => void;
  retrying: boolean;
};

function QuestionRow({
  question,
  setLabel,
}: {
  question: DocumentQuestion;
  setLabel: string | null;
}) {
  const answered = !!question.answerKey;
  return (
    <details className="doc-question">
      <summary className="doc-question-summary">
        <span className="doc-question-num">Q{question.number ?? "-"}</span>
        <span className="doc-question-prompt">{question.prompt || "(no text extracted)"}</span>
        {setLabel ? <span className="chip chip-ink">{setLabel}</span> : null}
        {answered ? (
          <span className="chip chip-jade">Ans {question.answerKey}</span>
        ) : (
          <span className="chip chip-vermilion">No answer</span>
        )}
      </summary>

      <div className="doc-question-body">
        <dl className="doc-meta-grid">
          <div>
            <dt>Section</dt>
            <dd>{question.section}</dd>
          </div>
          <div>
            <dt>Topic</dt>
            <dd>{question.topic}</dd>
          </div>
          <div>
            <dt>Subtopic</dt>
            <dd>{question.subtopic}</dd>
          </div>
          <div>
            <dt>Page</dt>
            <dd>{question.page ?? "-"}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{question.difficulty}/5</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{question.status}</dd>
          </div>
        </dl>

        {question.options.length > 0 ? (
          <ul className="doc-options">
            {question.options.map((option) => (
              <li
                key={option.key}
                className="doc-option"
                data-correct={option.isCorrect || undefined}
              >
                <span className="doc-option-key">{option.key}</span>
                <span className="break-anywhere flex-1">{option.text}</span>
                {option.isCorrect ? <span className="doc-option-mark">correct</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="doc-section-note">No options were extracted for this question. It needs a manual check.</p>
        )}

        {question.explanation ? (
          <p className="doc-explanation">
            <span className="doc-explanation-label">Explanation: </span>
            {question.explanation}
          </p>
        ) : null}

        {setLabel ? (
          <p className="doc-section-note">
            This question belongs to a connected set. The shared directions / passage are stored once in the
            &ldquo;Connected sets&rdquo; section above.
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function DocumentDetail({ detail, onRetry, retrying }: DocumentDetailProps) {
  const setByQuestionNumber = useMemo(() => {
    const map = new Map<number, { groupId: string; label: string }>();
    for (const set of detail.sets) {
      if (set.questionNumbers.length === 0) continue;
      const numbers = [...set.questionNumbers].sort((a, b) => a - b);
      const label = `Set Q${numbers[0]}-${numbers[numbers.length - 1]}`;
      for (const number of numbers) map.set(number, { groupId: set.groupId, label });
    }
    return map;
  }, [detail.sets]);

  const paper = detail.paper;
  const progress = detail.job?.progress ?? null;
  const percent = progress?.percent ?? null;
  const stamp = detail.job ? statusStamp(detail.job.status) : null;

  if (!paper) {
    return (
      <div className="doc-detail">
        <header className="doc-detail-head">
          <div className="min-w-0">
            <h2 className="doc-detail-title break-anywhere">{detail.document?.url ?? "Document"}</h2>
            <p className="doc-detail-sub">
              {detail.job?.status ?? "queued"} · {detail.job?.stage ?? ""}
            </p>
          </div>
          {detail.job?.status === "failed" ? (
            <button type="button" className="doc-retry" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying..." : "Retry parse"}
            </button>
          ) : null}
        </header>

        <div className="doc-progress mt-4">
          <div className="doc-progress-meter">
            <div className="doc-progress-fill" style={{ width: `${percent ?? 5}%` }} />
          </div>
          <p className="doc-progress-note">
            {progress?.message ?? "Waiting for the worker to start"}
            {percent !== null ? ` · ${percent}%` : ""}
          </p>
        </div>

        {detail.job?.error ? (
          <p className="doc-error" role="alert">
            {detail.job.error}
          </p>
        ) : null}

        {detail.document ? (
          <section className="doc-section">
            <h3 className="doc-section-title">Local copy</h3>
            <dl className="doc-meta-grid mt-2">
              <div>
                <dt>Stored at</dt>
                <dd className="break-anywhere">{detail.document.storage.absolutePath ?? "-"}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(detail.document.storage.bytes)}</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </div>
    );
  }

  const answered = paper.answeredQuestions;
  const total = paper.totalQuestions;
  const failed = detail.job?.status === "failed";

  return (
    <div className="doc-detail">
      <header className="doc-detail-head">
        <div className="min-w-0">
          <h2 className="doc-detail-title break-anywhere">
            {paper.title ?? detail.document?.url ?? "Untitled document"}
          </h2>
          <p className="doc-detail-sub">
            {paper.paperKey}
            {detail.document?.parseMethod ? ` · parsed with ${detail.document.parseMethod}` : ""}
          </p>
        </div>
        <div className="doc-chips">
          {stamp ? <span className={`stamp ${stamp.tone}`}>{stamp.label}</span> : null}
          <span className="chip">{paper.pageCount ?? detail.document?.pageCount ?? 0} pages</span>
          <span className="chip">{total} questions</span>
          <span className={`chip ${answered === total && total > 0 ? "chip-jade" : ""}`}>{answered} answered</span>
          <span className={`chip ${detail.sets.length ? "chip-ink" : ""}`}>{detail.sets.length} connected sets</span>
          {failed ? (
            <button type="button" className="doc-retry" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying..." : "Retry parse"}
            </button>
          ) : null}
        </div>
      </header>

      {detail.job?.error ? (
        <p className="doc-error mt-3" role="alert">
          {detail.job.error}
        </p>
      ) : null}

      {detail.sets.length > 0 ? (
        <section className="doc-section">
          <h3 className="doc-section-title">Connected sets</h3>
          <p className="doc-section-note">
            Questions that share directions, a passage or a puzzle. The shared context is stored once and reused.
          </p>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {detail.sets.map((set) => {
              const numbers = [...set.questionNumbers].sort((a, b) => a - b);
              return (
                <li key={set.id} className="doc-set">
                  <div className="doc-set-head">
                    <span className="doc-set-id">{set.groupId}</span>
                    <span className="doc-set-range">
                      Q{numbers[0] ?? "?"}-{numbers[numbers.length - 1] ?? "?"} · {numbers.length} questions
                    </span>
                  </div>
                  {set.sharedContext ? (
                    <p className="doc-set-context break-anywhere">{set.sharedContext}</p>
                  ) : (
                    <p className="doc-section-note">No shared context captured for this set.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {detail.categories.length === 0 ? (
        <p className="doc-section-note mt-4">
          Nothing has been parsed yet. The questions will appear here once the model finishes reading the PDF.
        </p>
      ) : null}

      {detail.categories.map((category) => (
        <section key={category.section} className="doc-section">
          <h3 className="doc-section-title">
            {category.section}
            <span className="chip">{category.questions}</span>
          </h3>
          {category.topics.map((topic) => (
            <div key={topic.topic} className="doc-topic">
              <h4 className="doc-topic-title">
                {topic.topic}
                <span className="chip">{topic.questions}</span>
              </h4>
              <ul className="doc-questions">
                {topic.items.map((question) => {
                  const set = question.number !== null ? setByQuestionNumber.get(question.number) : undefined;
                  return (
                    <li key={question.id}>
                      <QuestionRow question={question} setLabel={set ? set.label : null} />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}

      {detail.document ? (
        <section className="doc-section">
          <h3 className="doc-section-title">Local copy</h3>
          <dl className="doc-meta-grid mt-2">
            <div>
              <dt>Stored at</dt>
              <dd className="break-anywhere">{detail.document.storage.absolutePath ?? "-"}</dd>
            </div>
            <div>
              <dt>Relative path</dt>
              <dd className="break-anywhere">{detail.document.storage.relativePath ?? "-"}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(detail.document.storage.bytes)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd className="break-anywhere">{detail.document.url}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
