/**
 * StarMap layout algorithm.
 *
 * Deterministic scatter: each project's position is derived from its
 * `id` hash → (angle, radius), so the same project always lands on the
 * same spot, but projects added later don't make old ones jump.
 *
 * `nudge` resolves overlaps by walking forward through sorted projects
 * and pushing colliding pairs apart, keeping the cloud organic rather
 * than grid-like.
 */

import { massStageLabel, type WordMass } from "./words";

export interface StarPosition {
  /** Polar angle (radians) */
  angle: number;
  /** Distance from origin (px) */
  radius: number;
}

/** djb2 string hash → stable integer. */
export function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Compute a stable polar position for a project.
 *
 * The radius is keyed off the project's "mass" (stage), so higher-stage
 * projects drift toward the center (the inner solar system) while
 * dust-stage projects scatter into the outer ring.
 *
 * Stage → band:
 *   星尘 (0)   → 320–460 px
 *   星胚 (1+)  → 240–340 px
 *   新星 (1k+) → 140–240 px
 *   恒星       → 80–160 px  (site)
 *   星港       → 0–90 px    (site + 1000+ words)
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
 * Resolve overlapping positions by nudging colliding points outward
 * along their bisector. Runs at most `MAX_PASSES` iterations to keep
 * the layout stable on large project counts.
 *
 * @returns a map from project.id → {x, y} in SVG user-space coords
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

/**
 * Compute a star's mass from a numeric word count, wrapping the
 * existing `massStageLabel` helper so callers don't need to import
 * the words module twice.
 */
export function massFromWordCount(n: number): WordMass {
  return { count: n, stage: massStageLabel(n) };
}
