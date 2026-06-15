/**
 * StarMap 布局算法。
 *
 * 确定性散点：每个项目的位置由其 `id` 哈希 → (角度, 半径) 推出，
 * 所以同一个项目总落在同一位置，但后来加的项目不会让旧项目跳位。
 *
 * `nudge` 通过按 id 排序后前向遍历并把碰撞对推开解决重叠，
 * 让星云保持自然态而不是网格态。
 */

import { massStageLabel, type WordMass } from "./words";

export interface StarPosition {
  /** 极角（弧度） */
  angle: number;
  /** 到原点的距离（px） */
  radius: number;
}

/** djb2 字符串哈希 → 稳定整数。 */
export function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 计算一个项目嘅稳定极坐标位置。
 *
 * 半径由项目嘅"mass"（阶段）决定——高阶段项目偏向中心
 * （内太阳系），星尘阶段项目散到外环。
 *
 * 阶段 → 半径带：
 *   星尘 (0)    → 320–460 px
 *   星胚 (1+)   → 240–340 px
 *   新星 (1k+)  → 140–240 px
 *   恒星        → 80–160 px  （site）
 *   星港        → 0–90 px    （site + 1000+ 字）
 */
export function positionFor(id: string, mass: WordMass): StarPosition {
  const h = hashId(id);
  const angle = ((h % 360) / 360) * Math.PI * 2;
  // Re-roll angle using a second hash so it isn't correlated with radius.
  const rHash = hashId(id + "r") % 1000;
  const band = massBand(mass);
  const r = band[0] + (rHash / 1000) * (band[1] - band[0]);
  return { angle, radius: r };
}

function massBand(m: WordMass): [number, number] {
  switch (m.stage) {
    case "星港":
      return [0, 90];
    case "恒星":
      return [80, 160];
    case "新星":
      return [140, 240];
    case "星胚":
      return [240, 340];
    case "星尘":
    default:
      return [320, 460];
  }
}

/**
 * 通过把碰撞点沿角平分线向外推来解重叠。
 * 最多跑 `MAX_PASSES` 轮迭代，保证项目数量大时也稳定。
 *
 * @returns project.id → {x, y}，SVG user-space 坐标
 */
export function layoutStars(
  items: ReadonlyArray<{ id: string; mass: WordMass }>,
): Map<string, { x: number; y: number }> {
  const MIN_DIST = 36; // px between star centers
  const MAX_PASSES = 8;

  // Initial positions.
  const positions = new Map<string, { x: number; y: number }>();
  for (const it of items) {
    const p = positionFor(it.id, it.mass);
    positions.set(it.id, {
      x: Math.cos(p.angle) * p.radius,
      y: Math.sin(p.angle) * p.radius,
    });
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = positions.get(items[i].id)!;
        const b = positions.get(items[j].id)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= MIN_DIST || d === 0) continue;
        // Push apart along the bisector.
        const push = (MIN_DIST - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return positions;
}

/** 由字数计算 star mass，包装 `massStageLabel`，调用方免去二次 import words 模块。 */
export function massFromWordCount(n: number): WordMass {
  return { count: n, stage: massStageLabel(n) };
}
