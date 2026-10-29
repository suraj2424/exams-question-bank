import type { Lang } from "@/lib/i18n";

type LangToggleProps = {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
};

export function LangToggle({ lang, onLangChange }: LangToggleProps) {
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        type="button"
        className="lang-btn"
        onClick={() => onLangChange("en")}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
      <button
        type="button"
        className="lang-btn"
        onClick={() => onLangChange("hi")}
        aria-pressed={lang === "hi"}
      >
        हिं
      </button>
    </div>
  );
}
