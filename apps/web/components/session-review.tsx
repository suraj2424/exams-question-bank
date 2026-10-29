import type { UiStrings } from "@/lib/i18n";
import type { AnswerRow } from "@/lib/practice-types";

type SessionReviewProps = {
  t: UiStrings;
  total: number;
  answers: AnswerRow[];
  showPending?: boolean;
};

export function SessionReview({ t, total, answers, showPending = false }: SessionReviewProps) {
  const byIndex = new Map<number, AnswerRow>();
  for (const row of answers) byIndex.set(row.index, row);

  const count = showPending ? total : answers.length;

  if (count === 0) {
    return <p className="empty">{t.reviewEmpty}</p>;
  }

  return (
    <ol className="review" aria-label={t.reviewTitle}>
      {Array.from({ length: count }, (_, index) => {
        const row = byIndex.get(index);
        if (!row) {
          return (
            <li key={index} className="review-row" data-state="pending">
              <span className="review-num">Q{String(index + 1).padStart(2, "0")}</span>
              <span className="review-pick">{t.notAnswered}</span>
              <span className="review-verdict" aria-hidden="true">
                –
              </span>
            </li>
          );
        }
        return (
          <li key={index} className="review-row" data-state={row.isCorrect ? "correct" : "wrong"}>
            <span className="review-num">Q{String(index + 1).padStart(2, "0")}</span>
            <span className="review-pick">
              <span className="review-key" data-tone="pick">
                {row.selectedKey ?? "–"}
              </span>
              <span className="review-key" data-tone="key">
                {row.correctKey ?? "–"}
              </span>
            </span>
            <span className="review-verdict">
              {row.isCorrect ? t.correct : t.wrong}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
