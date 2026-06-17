import { useState, useCallback, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatOverrides } from "../api/client";

/**
 * 通过 Tauri IPC + Channel 的流式 chat。
 *
 * 历史：本 hook 之前通过 `http://localhost:{nova_port}/v1/chat/completions`
 * 与 Rust 通信。这要求 Rust 端跑一个 axum server、webview 经 loopback
 * 走一圈、前端手动解析 SSE wire 格式。全部已废弃——Rust 的 `ai_chat`
 * command 现在走 in-process Channel 流式推送。HTTP server 仍保留给
 * *外部* 客户端（MCP / curl / OpenAI SDK），内部流量全在 Tauri IPC
 * 桥内部。
 */
export interface UseLocalAIOptions {
  overrides?: ChatOverrides;
}

interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatDelta {
  type: "delta";
  text: string;
}
interface ChatDone {
  type: "done";
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
interface ChatError {
  type: "error";
  message: string;
  /**
   * Stage 4 fallback 元数据。`Some` 表示 Rust 端已自动切换 default model
   * （或 fallback 失败），前端用此字段显示「⚠ 已自动切换到 XXX」chip。
   */
  fallback?: {
    old_provider_id: string;
    old_model_id: string;
    new_provider_id: string;
    new_model_id: string;
  };
}
/**
 * Stage 4 fallback notice：非终止事件。Rust 端在 fallback 成功时
 * 会先发一条 Notice（前端 chip 显示），再继续流式推 delta。
 */
interface ChatNotice {
  type: "notice";
  kind: "fallback_switched";
  message: string;
  old_provider_id: string;
  old_model_id: string;
  new_provider_id?: string | null;
  new_model_id: string;
}
type ChatEvent = ChatDelta | ChatDone | ChatError | ChatNotice;

/**
 * 当前 stream 嘅 fallback 状态。提供给消费方（如 AIChatPanel）显示 chip。
 * - `pending` = fallback notice 已收到但 stream 未结束
 * - `final` = stream 已结束（success 时 Done / fail 时 Error 带 fallback）
 */
export interface FallbackState {
  oldModelId: string;
  newModelId: string;
  newProviderId: string;
  success: boolean;
}

export function useLocalAI({ overrides }: UseLocalAIOptions = {}) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // ADR 0003 Stage 4：当前 stream 嘅 fallback 状态。`null` = 无 fallback。
  // 消费方用此字段显示「⚠ 已自动切换到 XXX」chip。
  const [fallback, setFallback] = useState<FallbackState | null>(null);
  // 追踪进行中的流调用。JS 端没法 `abort()` Tauri invoke，
  // 但我们持有这个句柄，让 `stop()` 翻个 flag，Channel 回调
  // 在追加文本前会检查。
  const streamEpochRef = useRef(0);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: AIMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);
      setError(null);
      // 新一轮 stream：清旧 fallback chip
      setFallback(null);

      // 递增 epoch——上一次 sendMessage 的 in-flight channel 回调
      // 会看到新 epoch 然后 bail out，把它持有的 delta 扔地上。
      // 廉价的"软取消"，不依赖 abort IPC。
      const epoch = ++streamEpochRef.current;

      // 先追加一个空的 assistant 气泡，等 delta 来填。
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const channel = new Channel<ChatEvent>();
      let assistantContent = "";

      channel.onmessage = (event) => {
        if (epoch !== streamEpochRef.current) return; // 过期流，丢弃
        if (event.type === "delta") {
          assistantContent += event.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: assistantContent,
            };
            return updated;
          });
        } else if (event.type === "notice" && event.kind === "fallback_switched") {
          // Stage 4 fallback notice：记录 fallback 状态供 chip 显示。
          setFallback({
            oldModelId: event.old_model_id,
            newModelId: event.new_model_id,
            newProviderId: event.new_provider_id ?? "",
            success: true,
          });
        } else if (event.type === "error") {
          setError(new Error(event.message));
          // Stage 4：error 附带 fallback 表示已自动切换，但 stream 仍失败
          if (event.fallback) {
            setFallback({
              oldModelId: event.fallback.old_model_id,
              newModelId: event.fallback.new_model_id,
              newProviderId: event.fallback.new_provider_id,
              success: !!event.fallback.new_model_id,
            });
          }
          // 移除空/半截 assistant 气泡。
          setMessages((prev) => prev.slice(0, -1));
          setIsLoading(false);
        } else if (event.type === "done") {
          setIsLoading(false);
        }
      };

      try {
        await invoke("ai_chat", {
          prompt: text,
          systemPrompt: null,
          overrides: overrides ?? null,
          onEvent: channel,
        });
      } catch (e) {
        if (epoch !== streamEpochRef.current) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setMessages((prev) => prev.slice(0, -1));
        setIsLoading(false);
      }
    },
    [isLoading, overrides]
  );

  const handleSubmit = useCallback(
    (text: string, e?: React.FormEvent) => {
      e?.preventDefault();
      sendMessage(text);
    },
    [sendMessage]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  const stop = useCallback(() => {
    // 软取消：递增 epoch 让 in-flight 的 channel 回调全部丢弃 delta。
    // 真正的 Tauri 端 abort 需要服务端取消 token，目前没有。
    streamEpochRef.current++;
    setIsLoading(false);
  }, []);

  return {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    sendMessage,
    isLoading,
    setMessages,
    error,
    stop,
    // ADR 0003 Stage 4：当前 stream 嘅 fallback 状态（消费方 chip 用）
    fallback,
    // 清 fallback chip（例如用户主动 dismiss 时）
    clearFallback: () => setFallback(null),
  };
}
