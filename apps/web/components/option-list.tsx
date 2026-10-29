import { Check, X } from "lucide-react";
import type { Lang, UiStrings } from "@/lib/i18n";
import type { Option } from "@/lib/practice-types";

type OptionListProps = {
  t: UiStrings;
  lang: Lang;
  options: Option[];
  selectedId: string | null;
  correctId: string | null;
  revealed: boolean;
  onSelect: (id: string) => void;
};

export function OptionList({ t, lang, options, selectedId, correctId, revealed, onSelect }: OptionListProps) {
  return (
    <div className="options" role="radiogroup" aria-label={t.selectOption}>
      {options.map((opt, idx) => {
        const key = String.fromCharCode(65 + idx);
        const text = lang === "hi" ? opt.hi_text : opt.en_text;
        const isSelected = selectedId === opt.id;
        const isCorrect = revealed && correctId === opt.id;
        const isWrong = revealed && isSelected && correctId !== opt.id;
        const verdict = isCorrect ? "correct" : isWrong ? "wrong" : null;
        const dim = revealed && !isCorrect && !isWrong;

        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={revealed}
            onClick={() => onSelect(opt.id)}
            data-selected={isSelected || undefined}
            data-verdict={verdict ?? undefined}
            data-dim={dim || undefined}
            className="option-row"
          >
            <span className="option-key" aria-hidden="true">
              {key}
            </span>
            <span className="option-text break-anywhere" lang={lang === "hi" ? "hi" : "en"}>
              {text}
            </span>
            {isCorrect ? (
              <span className="option-mark" aria-hidden="true">
                <Check size={12} strokeWidth={2.5} />
              </span>
            ) : null}
            {isWrong ? (
              <span className="option-mark" aria-hidden="true">
                <X size={12} strokeWidth={2.5} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
