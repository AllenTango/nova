/**
 * 调校过的中英文混排字数计数器。
 *
 * CJK 字符逐个计；Latin 字母数字段每个段计作 1 个词。
 * Nova 全平台（Dashboard、Observatory、编辑器）"star mass"
 * （字数）指标的唯一来源。
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

/** 把大字数格式化成紧凑的 star-mass 读数。 */
export function formatWordMass(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** 由 word mass 派生的阶段标签，匹配 game-design §3.2。 */
export function massStageLabel(n: number): StarStage {
  if (n >= 1000) return "新星";
  if (n >= 1) return "星胚";
  return "星尘";
}

export type StarStage = "星尘" | "星胚" | "新星" | "恒星" | "星港";

/**
 * 组合 payload：项目嘅 word mass 和对应嘅阶段。
 * 布局代码 import 本类型，免去重复算 label。
 */
export type WordMass = { count: number; stage: StarStage };

/** 从原始字数构造 WordMass payload。 */
export function wordMass(n: number): WordMass {
  return { count: n, stage: massStageLabel(n) };
}
