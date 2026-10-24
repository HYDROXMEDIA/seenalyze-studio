// A button label whose characters slide up one after another while the button is hovered or keyboard
// focused, each replaced by a copy rising in behind it (styles: `.swap-label` in styles.css). Screen
// readers get the plain text once; the moving copies are hidden from them. Words never split, so a long
// label still wraps by word.
import { Fragment, useMemo, type CSSProperties } from "react";
import { swapLabelLayout } from "@/lib/swap-label";

export function SwapLabel({ text }: { text: string }) {
  const layout = useMemo(() => swapLabelLayout(text), [text]);
  return (
    <span className="swap-label">
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {layout.words.map((word, wordIndex) => (
          <Fragment key={`${word.start}-${word.pieces.join("")}`}>
            {wordIndex > 0 ? " " : null}
            {/* Each word keeps its own direction, so a Latin word inside a right-to-left label keeps its letter order. */}
            <span className="swap-word" dir="auto">
              {word.pieces.map((piece, index) => (
                // Pieces repeat ("ee") and their order never changes, so the position is their identity.
                <span key={index} className="swap-piece" style={{ "--swap-delay": `${(word.start + index) * layout.stepMs}ms` } as CSSProperties}>
                  <span>{piece}</span>
                  <span>{piece}</span>
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
