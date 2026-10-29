import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import type { Lang, UiStrings } from "@/lib/i18n";
import type { Question } from "@/lib/practice-types";
import { OptionList } from "@/components/option-list";

type QuestionStageProps = {
  t: UiStrings;
  lang: Lang;
  question: Question;
  questionNumber: number;
  prompt: string;
  difficultyLabel: string;
  options: Question["options"];
  selectedId: string | null;
  correctId: string | null;
  revealed: boolean;
  isCorrect: boolean;
  explanation: string;
  submitting: boolean;
  nextLabel: string;
  onSelect: (id: string) => void;
  onSubmit: () => void;
  onNext: () => void;
};

function answerText(question: Question, id: string | null, lang: Lang): string {
  if (!id) return "-";
  const opt = question.options.find((o) => o.id === id);
  if (!opt) return "-";
  return lang === "hi" ? opt.hi_text : opt.en_text;
}

export function QuestionStage({
  t,
  lang,
  question,
  questionNumber,
  prompt,
  difficultyLabel,
  options,
  selectedId,
  correctId,
  revealed,
  isCorrect,
  explanation,
  submitting,
  nextLabel,
  onSelect,
  onSubmit,
  onNext,
}: QuestionStageProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const sharedContext = question.sharedContext || question.questionSet?.sharedContext || "";
  const media = question.questionSet?.media ?? [];
  const verdict = isCorrect ? "correct" : "wrong";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) setDirectionsOpen(true);
  }, []);

  useEffect(() => {
    if (!revealed) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [revealed]);

  return (
    <article className="question-card">
      <div className="card-header scroll-region">
        <div className="card-meta">
          <span className="card-qnum">
            <span className="card-qnum-label">{t.questionLabel}</span>
            {String(questionNumber).padStart(2, "0")}
          </span>
          <span className="chip">{question.section}</span>
          <span className="chip">{question.topic}</span>
          <span className="chip">{difficultyLabel}</span>
        </div>

        {sharedContext || media.length > 0 ? (
          <div className="card-directions">
            <button
              type="button"
              onClick={() => setDirectionsOpen((open) => !open)}
              aria-expanded={directionsOpen}
              className="card-directions-toggle"
            >
              <span className="tri" aria-hidden="true">
                {directionsOpen ? <ChevronDown size={11} strokeWidth={2.5} /> : <ChevronRight size={11} strokeWidth={2.5} />}
              </span>
              {t.sharedContext}
            </button>
            {directionsOpen ? (
              <div className="card-directions-body">
                {sharedContext ? (
                  <p
                    className="directions-text scroll-region break-anywhere"
                    lang={lang === "hi" ? "hi" : "en"}
                  >
                    {sharedContext}
                  </p>
                ) : null}
                {media.length > 0 ? (
                  <div className="card-media">
                    {media.map((asset) => (
                      <Image
                        key={asset.id}
                        src={`/api/media/${asset.id}`}
                        alt={asset.description ?? "figure"}
                        width={720}
                        height={480}
                        unoptimized
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="card-prompt">
          <p className="break-anywhere" lang={lang === "hi" ? "hi" : "en"}>
            {prompt}
          </p>
        </div>
      </div>

      <div className="card-body scroll-region" ref={bodyRef}>
        <OptionList
          t={t}
          lang={lang}
          options={options}
          selectedId={selectedId}
          correctId={correctId}
          revealed={revealed}
          onSelect={onSelect}
        />

        {revealed ? (
          <div className="card-feedback" data-verdict={verdict} aria-live="polite">
            <span className="verdict-stamp" data-verdict={verdict}>
              {isCorrect ? <Check size={13} strokeWidth={2.5} /> : <X size={13} strokeWidth={2.5} />}
              {isCorrect ? t.correct : t.wrong}
            </span>
            <dl className="feedback-grid">
              <div className="break-anywhere">
                <dt>{t.yourAnswer}</dt>
                <dd>{answerText(question, selectedId, lang)}</dd>
              </div>
              <div className="break-anywhere">
                <dt>{t.correctAnswer}</dt>
                <dd>{answerText(question, correctId, lang)}</dd>
              </div>
              <div className="break-anywhere feedback-explanation">
                <dt>{t.explanation}</dt>
                <dd>{explanation || "-"}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="card-actions">
        {revealed ? (
          <button type="button" onClick={onNext} className="btn w-full">
            {nextLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!selectedId || submitting}
            className="btn w-full"
          >
            {t.submit}
          </button>
        )}
      </div>
    </article>
  );
}
