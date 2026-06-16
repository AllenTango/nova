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
}
type ChatEvent = ChatDelta | ChatDone | ChatError;

export function useLocalAI({ overrides }: UseLocalAIOptions = {}) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
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
        } else if (event.type === "error") {
          setError(new Error(event.message));
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
  };
}
