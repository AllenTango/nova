/**
 * Lightweight event bus.
 *
 * The signature element of Nova is that every action you take
 * — saving, creating, upgrading, deleting — produces a moment
 * of astronomical response. To keep the wiring simple we use
 * a tiny pub/sub rather than Context or props drilling.
 */

export type NovaEvent =
  | { type: "create"; x: number; y: number }
  | { type: "save"; projectId: string }
  | { type: "delete"; x: number; y: number }
  | { type: "upgrade"; x: number; y: number }
  | { type: "milestone"; threshold: number };

type Listener = (e: NovaEvent) => void;
const listeners = new Set<Listener>();

export function emit(e: NovaEvent) {
  listeners.forEach((l) => l(e));
}

export function on(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
