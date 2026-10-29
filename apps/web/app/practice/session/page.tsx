"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useCatalog } from "@/components/catalog-provider";
import { LangToggle } from "@/components/lang-toggle";
import { useLang } from "@/components/lang-provider";
import { QuestionStage } from "@/components/question-stage";
import { SessionReview } from "@/components/session-review";
import { SessionSummary } from "@/components/session-summary";
import { StateCard } from "@/components/state-card";
import { ui } from "@/lib/i18n";
import {
  difficultyLabel,
  optionKey,
  type AnswerRow,
  type Revealed,
  type SessionState,
} from "@/lib/practice-types";

const SIZES = [10, 20, 50];

function clampSize(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(50, Math.round(value)));
}

function PracticeSession() {
  const params = useSearchParams();
  const router = useRouter();
  const { lang, setLang } = useLang();
  const t = ui[lang];
  const { catalog } = useCatalog();

  const section = params.get("section") ?? "";
  const topic = params.get("topic") ?? "";
  const paperKey = params.get("paperKey") ?? "";
  const size = clampSize(Number(params.get("size") ?? "10"));

  const [session, setSession] = useState<SessionState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [qNumber, setQNumber] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paperTitle = useMemo(
    () => catalog?.papers.find((paper) => paper.paperKey === paperKey)?.title ?? null,
    [catalog, paperKey],
  );

  const loadSession = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/sessions/${id}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setSession({
        id: data.id,
        total: data.total,
        currentIndex: data.currentIndex,
        score: data.score,
        completed: data.completed,
        currentQuestion: data.currentQuestion,
        revealed: data.revealed,
        answers: (data.answers ?? []) as AnswerRow[],
      });
      setQNumber(data.currentIndex + 1);
      setSelected(data.revealed ? data.revealed.selected_option_id : null);
      setRevealed(data.revealed);
    } catch {
      setError(t.error);
    } finally {
      setLoading(false);
    }
  }, [t.error]);

  const createSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setRevealed(null);
    setFinished(false);
    setAllDone(false);
    setQNumber(1);
    try {
      const res = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size,
          ...(paperKey ? { paperKey } : {}),
          ...(section ? { section } : {}),
          ...(topic ? { topic } : {}),
        }),
      });
      if (!res.ok) throw new Error("create failed");
      const { sessionId } = await res.json();
      await loadSession(sessionId);
    } catch {
      setError(t.error);
      setLoading(false);
    }
  }, [t.error, size, paperKey, section, topic, loadSession]);

  useEffect(() => {
    void createSession();
  }, [createSession]);

  const question = session?.currentQuestion ?? null;
  const variant =
    question?.variants.find((v) => v.language === lang) || question?.variants[0] || null;

  const options = useMemo(
    () => (question ? question.options.slice().sort((a, b) => a.display_order - b.display_order) : []),
    [question],
  );

  const answers = session?.answers ?? [];

  const handleSubmit = useCallback(async () => {
    if (!session || !session.currentQuestion || !selected || revealed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice/sessions/${session.id}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: session.currentQuestion.id,
          selected_option_id: selected,
          language: lang,
        }),
      });
      if (!res.ok) throw new Error("submit failed");
      const data = await res.json();
      setRevealed({
        selected_option_id: selected,
        correct_option_id: data.correct_option_id,
        is_correct: data.is_correct,
        explanations: { [lang]: data.explanation },
      });
      setSession((s) => {
        if (!s) return s;
        const row: AnswerRow = {
          index: s.currentIndex,
          questionId: s.currentQuestion?.id ?? "",
          selectedKey: optionKey(options, selected),
          correctKey: optionKey(options, data.correct_option_id),
          isCorrect: data.is_correct,
        };
        return { ...s, score: data.score, answers: [...s.answers, row] };
      });
      if (data.completed) setAllDone(true);
    } catch {
      setError(t.error);
    } finally {
      setSubmitting(false);
    }
  }, [session, selected, revealed, lang, t.error, options]);

  const handleNext = useCallback(async () => {
    if (!session) return;
    if (allDone || qNumber >= session.total) {
      setFinished(true);
      return;
    }
    await loadSession(session.id);
    setSelected(null);
    setRevealed(null);
    setAllDone(false);
  }, [session, allDone, qNumber, loadSession]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (loading || error || finished || !question) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (revealed) {
          void handleNext();
        } else if (selected) {
          void handleSubmit();
        }
        return;
      }
      const index = "12345".indexOf(event.key);
      if (index >= 0 && !revealed) {
        const option = options[index];
        if (option) setSelected(option.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, error, finished, question, revealed, selected, options, handleNext, handleSubmit]);

  const total = session?.total ?? 0;
  const score = session?.score ?? 0;
  const progressPct = total > 0 ? Math.min(100, (qNumber / total) * 100) : 0;
  const isRevealed = !!revealed;
  const correctId = revealed?.correct_option_id ?? null;
  const selectedId = revealed?.selected_option_id ?? selected;
  const explanation = revealed?.explanations?.[lang] || variant?.explanation || "";
  const nextLabel = allDone || qNumber >= total ? t.finish : t.next;
  const sectionName = question?.section ?? section;
  const topicName = question?.topic ?? topic;
  const diffLabel = question
    ? difficultyLabel(question.difficulty, {
        easy: t.difficultyEasy,
        medium: t.difficultyMedium,
        hard: t.difficultyHard,
      })
    : "";

  const title = topic || section || paperTitle || t.mixedPractice;
  const subtitleParts = [sectionName, topicName].filter(Boolean).join(" · ");
  const subtitle = subtitleParts || paperTitle || t.sessionTitle;

  const accuracyPct = answers.length > 0 ? Math.round((answers.filter((a) => a.isCorrect).length / answers.length) * 100) : 0;

  const changeSize = (next: number) => {
    const query = new URLSearchParams();
    if (section) query.set("section", section);
    if (topic) query.set("topic", topic);
    if (paperKey) query.set("paperKey", paperKey);
    query.set("size", String(next));
    router.push(`/practice/session?${query.toString()}`);
  };

  let stage;
  if (loading) {
    stage = <StateCard message={t.loading} />;
  } else if (error) {
    stage = (
      <div className="flex min-h-0 w-full flex-col items-center justify-center gap-3">
        <StateCard message={error} tone="error" />
        <Link href="/practice" className="btn btn-ghost">
          <ArrowLeft size={14} strokeWidth={2} />
          {t.backToPractice}
        </Link>
      </div>
    );
  } else if (finished) {
    stage = (
      <SessionSummary t={t} score={score} total={total} answers={answers} onRestart={createSession} />
    );
  } else if (question) {
    stage = (
      <QuestionStage
        t={t}
        lang={lang}
        question={question}
        questionNumber={qNumber}
        prompt={variant?.prompt ?? ""}
        difficultyLabel={diffLabel}
        options={options}
        selectedId={selectedId}
        correctId={correctId}
        revealed={isRevealed}
        isCorrect={!!revealed?.is_correct}
        explanation={explanation}
        submitting={submitting}
        nextLabel={nextLabel}
        onSelect={setSelected}
        onSubmit={handleSubmit}
        onNext={handleNext}
      />
    );
  } else {
    stage = <StateCard message={t.loading} />;
  }

  return (
    <div className="session">
      <header className="session-head">
        <Link href="/practice" className="session-back">
          <ArrowLeft size={12} strokeWidth={2} />
          {t.backToPractice}
        </Link>
        <div className="session-id">
          <span className="session-id-main">{title}</span>
          <span className="session-id-sub">{subtitle}</span>
        </div>
        <div className="session-head-spacer" />
        <div className="session-progress">
          <span className="session-progress-label">
            {t.progress} {qNumber}/{total}
          </span>
          <div
            className="session-meter"
            role="progressbar"
            aria-valuenow={qNumber}
            aria-valuemin={1}
            aria-valuemax={total}
          >
            <div className="session-meter-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <select
          className="size-select"
          value={size}
          onChange={(event) => changeSize(Number(event.target.value))}
          aria-label={t.length}
        >
          {SIZES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className="score-tag">
          {t.score} {score}
        </span>
        <LangToggle lang={lang} onLangChange={setLang} />
      </header>

      <div className="session-grid" data-layout="full">
        <main className="session-stage">{stage}</main>
        <aside className="session-side" aria-label={t.insights}>
          <section className="panel">
            <h2 className="panel-title">{t.insights}</h2>
            <dl className="insight-list">
              <div className="insight-row">
                <dt className="insight-label">{t.answered}</dt>
                <dd className="insight-value">{answers.length}</dd>
              </div>
              <div className="insight-row">
                <dt className="insight-label">{t.remaining}</dt>
                <dd className="insight-value">{Math.max(0, total - answers.length)}</dd>
              </div>
              <div className="insight-row">
                <dt className="insight-label">{t.accuracy}</dt>
                <dd className="insight-value">{accuracyPct}%</dd>
              </div>
            </dl>
            <p className="insight-note">{t.langNote}</p>
          </section>
          <section className="panel panel-flush session-review-panel">
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
          <section className="panel">
            <h2 className="panel-title">{t.shortcuts}</h2>
            <div className="shortcut-list">
              <div className="shortcut-row">
                <kbd className="shortcut-key">1–5</kbd>
                <span>{t.shortcutSelect}</span>
              </div>
              <div className="shortcut-row">
                <kbd className="shortcut-key">↵</kbd>
                <span>{t.shortcutSubmit}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <footer className="session-foot">
        <span className="min-w-0 flex-1 truncate">{subtitle}</span>
        <span className="hidden shrink-0 whitespace-nowrap sm:inline">
          {t.shortcutSelect} · {t.shortcutSubmit}
        </span>
      </footer>
    </div>
  );
}

export default function PracticeSessionPage() {
  return (
    <Suspense fallback={<div className="session" />}>
      <PracticeSession />
    </Suspense>
  );
}
