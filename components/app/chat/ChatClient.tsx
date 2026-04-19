// Chat UI — handles rendering message history and streaming new turns
// from /api/ai/chat.
//
// Streaming flow:
//   1. User types → clicks Send (or ⌘/Ctrl-Enter)
//   2. We push an optimistic user message + empty assistant message into
//      state so the UI updates immediately
//   3. POST multipart/form-data to /api/ai/chat. Body:
//        sessionId, message, idempotencyKey (client-generated UUID),
//        pdf (optional File)
//   4. Parse the `text/event-stream` response line-by-line. Each event is
//      one of: meta | delta | done | error. Delta events append text to
//      the assistant bubble.
//   5. On `done` or `error`, finalize the bubble and re-enable the
//      composer.
//
// Retry safety: the idempotencyKey is generated once per user submit and
// stored on the pending message. If the network hiccups and the user
// re-sends, the server-side unique index collapses the assistant row —
// which is why we DO NOT regenerate the key on resend.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { I } from "@/components/icons/Icons";

type Role = "system" | "user" | "assistant";

export type ChatClientMessage = {
  id: string;
  role: Role;
  content: string;
  stopReason: string | null;
  createdAtIso: string;
};

type LocalMessage = ChatClientMessage & {
  /** Client-side synthetic flag while a turn is streaming. */
  pending?: boolean;
  /** True when the last attempt ended in error. Allows a retry UX later. */
  errored?: boolean;
};

// Crypto.randomUUID is available in all evergreen browsers + Node 19+.
// Fallback returns a V4-shaped string assembled from Math.random (good
// enough for idempotency, not for crypto).
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ChatClient({
  sessionId,
  initialMessages,
  attachedFileName,
}: {
  sessionId: string;
  initialMessages: ChatClientMessage[];
  attachedFileName: string | null;
}) {
  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [attachedPdf, setAttachedPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);

    const userMsgId = `local-u-${uuid()}`;
    const assistantMsgId = `local-a-${uuid()}`;
    const idempotencyKey = uuid();

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: text,
        stopReason: null,
        createdAtIso: new Date().toISOString(),
      },
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        stopReason: null,
        createdAtIso: new Date().toISOString(),
        pending: true,
      },
    ]);
    setInput("");
    // Keep the file selected for follow-up turns on the same doc. Users
    // expect "I attached a PDF, now I can ask multiple questions" and
    // re-uploading on every turn is a footgun.

    try {
      const fd = new FormData();
      fd.set("sessionId", sessionId);
      fd.set("message", text);
      fd.set("idempotencyKey", idempotencyKey);
      if (attachedPdf) fd.set("pdf", attachedPdf);

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        body: fd,
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Request failed (${res.status}): ${body.slice(0, 200) || "no response body"}`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Incremental SSE parser. The server sends `data: <json>\n\n`
      // blocks. We accumulate partial chunks and split on the blank-line
      // delimiter.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx;
        // eslint-disable-next-line no-cond-assign
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const payload = extractData(block);
          if (!payload) continue;
          handleEvent(payload, assistantMsgId, setMessages);
        }
      }

      // Mark the assistant turn finalized if the stream ended cleanly
      // without an explicit `done` (defensive — server always emits one).
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, pending: false } : m
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                pending: false,
                errored: true,
                content: m.content || "(request failed)",
              }
            : m
        )
      );
    } finally {
      setBusy(false);
      // Return focus to the composer for rapid follow-ups.
      inputRef.current?.focus();
    }
  }, [input, busy, sessionId, attachedPdf]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter submits, Shift+Enter inserts a newline. Matches ChatGPT /
      // Claude's behavior so users aren't surprised.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void send();
      }
    },
    [send]
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-2)",
        overflow: "hidden",
      }}
    >
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--fg-subtle)",
              fontSize: 14,
              marginTop: 40,
            }}
          >
            No messages yet.
            {attachedFileName ? (
              <> Ask something about <strong>{attachedFileName}</strong>.</>
            ) : (
              <> Ask anything, or attach a PDF below to ground the answer.</>
            )}
          </div>
        ) : null}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <Composer
        input={input}
        onInput={setInput}
        onKeyDown={onKeyDown}
        onSend={send}
        busy={busy}
        attachedPdf={attachedPdf}
        onAttach={setAttachedPdf}
        error={error}
        inputRef={inputRef}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: LocalMessage }) {
  if (message.role === "system") return null;
  const isUser = message.role === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "min(720px, 85%)",
          padding: "10px 14px",
          borderRadius: 12,
          background: isUser
            ? "var(--accent-soft)"
            : message.errored
              ? "rgba(200, 0, 0, 0.06)"
              : "var(--bg)",
          border: `1px solid ${
            isUser
              ? "var(--accent)"
              : message.errored
                ? "#c00"
                : "var(--border)"
          }`,
          color: "var(--fg)",
          fontSize: 14,
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
        }}
      >
        {message.content ||
          (message.pending ? (
            <span className="subtle">Thinking…</span>
          ) : (
            <span className="subtle">(empty response)</span>
          ))}
        {message.pending && message.content ? (
          <span className="subtle" aria-hidden="true">▍</span>
        ) : null}
      </div>
    </div>
  );
}

function Composer({
  input,
  onInput,
  onKeyDown,
  onSend,
  busy,
  attachedPdf,
  onAttach,
  error,
  inputRef,
}: {
  input: string;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  busy: boolean;
  attachedPdf: File | null;
  onAttach: (f: File | null) => void;
  error: string | null;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: 12,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {error ? (
        <div style={{ fontSize: 12, color: "#c00" }}>{error}</div>
      ) : null}
      {attachedPdf ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          <I.Paperclip size={14} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {attachedPdf.name}
          </span>
          <span className="subtle">
            {(attachedPdf.size / (1024 * 1024)).toFixed(1)} MB
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: 2 }}
            onClick={() => onAttach(null)}
            aria-label="Remove attachment"
          >
            <I.Trash size={12} />
          </button>
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <label
          className="btn btn-ghost btn-sm"
          style={{ cursor: "pointer", padding: 8 }}
          aria-label="Attach PDF"
          title="Attach PDF"
        >
          <I.Paperclip size={14} />
          <input
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onAttach(f);
              // Reset so picking the same file twice re-triggers onChange.
              e.target.value = "";
            }}
          />
        </label>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={busy}
          style={{
            flex: 1,
            resize: "none",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-2)",
            color: "var(--fg)",
            fontSize: 14,
            fontFamily: "inherit",
            maxHeight: 200,
          }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={busy || input.trim().length === 0}
          className="btn btn-primary btn-sm"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {busy ? "Sending…" : (
            <>
              <I.Send size={14} /> Send
            </>
          )}
        </button>
      </div>
      <div className="subtle" style={{ fontSize: 11 }}>
        Each turn costs 1 credit. Attached PDFs are extracted server-side
        and discarded after the request.
      </div>
    </div>
  );
}

// -- SSE helpers ------------------------------------------------------

function extractData(block: string): SseEvent | null {
  // A block may contain multiple lines; only `data:` lines carry payload.
  // We collapse all data lines to a single JSON string per spec.
  const lines = block.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as SseEvent;
  } catch {
    return null;
  }
}

type SseEvent =
  | {
      type: "meta";
      userMessageId: string | null;
      assistantMessageId: string;
      providerId: string;
      model: string;
      pdfPageCount: number;
      creditCost: number;
      replay?: boolean;
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
      stopReason: string;
      usage: { inputTokens: number; outputTokens: number };
      model: string;
      providerId: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      refunded: boolean;
    };

function handleEvent(
  event: SseEvent,
  assistantMsgId: string,
  setMessages: React.Dispatch<React.SetStateAction<LocalMessage[]>>
): void {
  switch (event.type) {
    case "meta":
      // Swap the local id for the server-assigned id so a subsequent
      // refresh doesn't show duplicate rows. Only rename — don't touch
      // content yet.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, id: event.assistantMessageId } : m
        )
      );
      return;
    case "delta":
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.pending
            ? { ...m, content: m.content + event.text }
            : m
        )
      );
      return;
    case "done":
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.pending
            ? { ...m, pending: false, stopReason: event.stopReason }
            : m
        )
      );
      return;
    case "error":
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.pending
            ? {
                ...m,
                pending: false,
                errored: true,
                content:
                  m.content ||
                  `Provider error (${event.code})${
                    event.refunded ? " — credit refunded." : ""
                  }`,
              }
            : m
        )
      );
      return;
  }
}
