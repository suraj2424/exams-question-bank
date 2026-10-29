import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { UiStrings } from "@/lib/i18n";
import type { AnswerRow } from "@/lib/practice-types";
import { SessionReview } from "@/components/session-review";

type SessionSummaryProps = {
  t: UiStrings;
  score: number;
  total: number;
  answers: AnswerRow[];
  onRestart: () => void;
};

export function SessionSummary({ t, score, total, answers, onRestart }: SessionSummaryProps) {
  const accuracyPct = total > 0 ? Math.round((score / total) * 100) : 0;

  return (
    <div className="summary">
      <section className="summary-main">
        <span className="summary-eyebrow">{t.sessionComplete}</span>
        <h2 className="summary-title">{t.finalScore}</h2>
        <p className="summary-score">
          {score}
          <small> / {total}</small>
        </p>
        <p className="summary-accuracy">
          {t.accuracy} {accuracyPct}%
        </p>
        <div className="summary-actions">
          <button type="button" onClick={onRestart} className="btn">
            {t.restart}
          </button>
          <Link href="/practice" className="btn btn-ghost">
            <ArrowLeft size={14} strokeWidth={2} />
            {t.backToPractice}
          </Link>
        </div>
      </section>
      <section className="panel summary-review">
        <h2 className="panel-title">
          {t.reviewTitle}
          <span className="panel-title-count">
            {answers.length}/{total}
          </span>
        </h2>
        <div className="scroll-region min-h-0 flex-1">
          <SessionReview t={t} total={total} answers={answers} showPending />
        </div>
      </section>
    </div>
  );
}
