/**
 * Word counter tuned for mixed CJK / Latin text.
 *
 * CJK characters are counted individually; Latin alphanumeric runs
 * are counted as one word each. This is the single source of truth
 * for Nova's "star mass" (word count) metrics across Dashboard,
 * Observatory and the editor.
 */
export function countWords(s: string): number {
  if (!s) return 0;
  let n = 0;
  let inLatin = false;
  for (const ch of s) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
      if (inLatin) inLatin = false;
      n += 1;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      if (!inLatin) {
        inLatin = true;
        n += 1;
      }
    } else {
      inLatin = false;
    }
  }
  return n;
}

/**
 * Format a large word count into a compact star-mass reading.
 */
export function formatWordMass(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/**
 * Stage label derived from word mass, matching game-design §3.2.
 */
export function massStageLabel(n: number): string {
  if (n >= 1000) return "新星";
  if (n >= 1) return "星胚";
  return "星尘";
}
