// How a button label's hover swap is split: on hover or keyboard focus each piece slides up while an
// identical copy rises in behind it, one after another. Pure, so it can be tested.

/** Delay between pieces; long labels use a shorter one so the whole swap stays quick. */
export const SWAP_STEP_MS = 16;
export const SWAP_TOTAL_MS = 420;

/**
 * Scripts whose letters join or change shape next to each other. Splitting them into separate boxes
 * would break the shaping, so their words move as whole pieces instead.
 */
const SHAPED_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;

export interface SwapWord {
  /** Pieces that move on their own: user-perceived characters, or the whole word for joined scripts. */
  pieces: string[];
  /** Position of the word's first piece in the whole label (sets its delay). */
  start: number;
}

export interface SwapLayout {
  words: SwapWord[];
  stepMs: number;
}

function characters(word: string): string[] {
  if (typeof Intl.Segmenter !== "function") return Array.from(word);
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word), (part) => part.segment);
}

export function swapLabelLayout(text: string): SwapLayout {
  const words: SwapWord[] = [];
  let count = 0;
  for (const word of text.split(/\s+/u)) {
    if (!word) continue;
    const pieces = SHAPED_SCRIPT.test(word) ? [word] : characters(word);
    words.push({ pieces, start: count });
    count += pieces.length;
  }
  return { words, stepMs: Math.min(SWAP_STEP_MS, Math.round(SWAP_TOTAL_MS / Math.max(count, 1))) };
}
