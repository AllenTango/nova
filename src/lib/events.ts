/**
 * 轻量事件总线。
 *
 * Nova 嘅签名元素就是你嘅每个动作——保存、创建、升级、删除——
 * 都产生一个天文响应瞬间。为保持接线简单，我们用一个小 pub/sub
 * 而非 Context 或 props 透传。
 */

export type NovaEvent =
  | { type: "create"; x: number; y: number }
  | { type: "save"; projectId: string; x?: number; y?: number }
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
