import { useState, useCallback, useRef } from "react";
import type { ChatOverrides, Settings } from "../api/client";

export interface UseLocalAIOptions {
  settings: Settings | null;
  sessionToken: string;
  overrides?: ChatOverrides;
}

interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export function useLocalAI({ settings, sessionToken, overrides }: UseLocalAIOptions) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const baseUrl = `http://localhost:${settings?.nova_port ?? 18999}`;
  // `model` here is the per-session override coming from the chat UI.
  // When null, the Rust HTTP server falls back to the boot-time default
  // (the model marked is_default in ~/.nova/config.json).
  const model = overrides?.model || "";

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: AIMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);
      setError(null);

      // Abort any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        // Forward overrides as-is — the Rust HTTP server pulls
        // credentials from config.json when `provider_id` is present.
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          signal: abortRef.current.signal,
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [...messages, userMsg].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
            // The provider_id, base_url and family come from the
            // switcher in AIChatPanel and are already in overrides.
            provider_id: overrides?.provider_id,
            provider: overrides?.provider,
            base_url: overrides?.base_url,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let assistantContent = "";

        // Append assistant message placeholder
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  assistantContent += delta;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantContent,
                    };
                    return updated;
                  });
                }
              } catch {
                // Skip malformed JSON (common in SSE edge cases)
              }
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        // Remove failed assistant message
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setIsLoading(false);
      }
    },
    [baseUrl, model, messages, sessionToken, isLoading]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages,
    error,
    stop,
  };
}
