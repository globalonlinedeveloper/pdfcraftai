// Anthropic adapter — the first implementation of `AIProvider`.
//
// Design notes:
//   - Never leak `RawMessageStreamEvent`, `Message`, or any SDK type
//     out of the module. All shapes normalize to `ChatChunk` /
//     `ChatResult` at the yield / return boundary. Callers import from
//     `lib/ai/types.ts` only.
//   - `"server-only"` at the top so webpack refuses to bundle the key
//     into any client component that accidentally imports this.
//   - `streamChat()` is the single source of truth. `chat()` consumes
//     the same AsyncIterable and joins the text deltas. Anthropic's SDK
//     streams natively, so there's no "native chat + build stream"
//     asymmetry to maintain.
//   - Errors from the SDK (RateLimitError, AuthenticationError, etc.)
//     are caught and emitted as terminal `chunk.error` with a classified
//     `code`. The route handler decides refund policy from the code.
//   - Usage accounting: input tokens arrive on `message_start` and are
//     cumulative-as-of-start. Output tokens accumulate on `message_delta`.
//     We emit the cumulative tally on the terminal `done` chunk.

import "server-only";

import Anthropic, {
  APIError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import { AIProviderError, type AIProvider } from "../provider";
import type {
  AICapabilities,
  AIProviderId,
  ChatChunk,
  ChatInput,
  ChatResult,
  ContentBlock,
  StopReason,
  TokenUsage,
} from "../types";

/**
 * Anthropic's message content shape. A string collapses to a single
 * text block; an array is already the block form. We keep our own local
 * type alias so the SDK's exact type name doesn't leak outward.
 */
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
        data: string;
      };
    }
  | {
      type: "document";
      source: {
        type: "base64";
        media_type: "application/pdf";
        data: string;
      };
      title?: string;
    };

function toAnthropicContent(
  content: string | ContentBlock[]
): string | AnthropicContentBlock[] {
  if (typeof content === "string") return content;
  return content.map((b): AnthropicContentBlock => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image") {
      return {
        type: "image",
        source: { type: "base64", media_type: b.mediaType, data: b.data },
      };
    }
    // DocumentBlock — Anthropic accepts base64 PDFs as a first-class
    // content block and runs vision internally. `title` is optional
    // and surfaces the original filename in Anthropic's logs.
    return {
      type: "document",
      source: { type: "base64", media_type: b.mediaType, data: b.data },
      ...(b.name ? { title: b.name } : {}),
    };
  });
}

/** Constructor options. Registry passes these; don't construct manually. */
export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel: string;
}

export class AnthropicProvider implements AIProvider {
  readonly id: AIProviderId = "anthropic";
  readonly displayName = "Anthropic";
  readonly capabilities: AICapabilities = {
    streaming: true,
    // Tool use is supported by the SDK but not by our adapter yet — flip
    // this when we wire it up end-to-end so callers can trust the flag.
    toolUse: false,
    imageInput: true,
    // Anthropic accepts PDFs as document blocks; we'll enable this once
    // the UI path passes raw bytes through instead of pre-extracting.
    pdfInput: true,
  };
  readonly defaultModel: string;

  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey) {
      throw new AIProviderError(
        "anthropic",
        "configuration",
        "ANTHROPIC_API_KEY is empty"
      );
    }
    this.defaultModel = opts.defaultModel;
    // The SDK reads timeouts, proxies, etc. from env. Passing the key
    // explicitly so we control which env var drives which adapter
    // instance (makes per-env testing possible).
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }

  /**
   * Non-streaming chat. Implemented as a consumer of `streamChat()` so
   * we have exactly one code path through provider retries and error
   * normalization.
   */
  async chat(input: ChatInput): Promise<ChatResult> {
    let text = "";
    let stopReason: StopReason = "end_turn";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let model = input.model ?? this.defaultModel;
    for await (const chunk of this.streamChat(input)) {
      switch (chunk.kind) {
        case "text_delta":
          text += chunk.text;
          break;
        case "done":
          stopReason = chunk.stopReason;
          if (chunk.usage) usage = chunk.usage;
          model = chunk.model;
          break;
        case "error":
          throw new AIProviderError(
            "anthropic",
            chunk.code === "auth" ? "configuration" : "unknown",
            chunk.message
          );
      }
    }
    return { text, stopReason, usage, model, providerId: this.id };
  }

  /**
   * Streaming chat. Yields `text_delta` per character-ish burst and
   * exactly one terminal `done` or `error` chunk.
   */
  async *streamChat(input: ChatInput): AsyncIterable<ChatChunk> {
    const model = input.model ?? this.defaultModel;
    // Anthropic requires max_tokens — a sensible cap keeps runaway
    // responses from eating a user's credit balance.
    const maxTokens = input.maxTokens ?? 1024;
    // Map our `ChatMessage[]` to Anthropic's shape. Anthropic takes
    // `system` as a top-level string (not a message role), so we
    // collapse any "system" messages into it.
    const systemMessages: string[] = [];
    if (input.systemPrompt) systemMessages.push(input.systemPrompt);
    const messages: Array<{
      role: "user" | "assistant";
      content: string | AnthropicContentBlock[];
    }> = [];
    for (const m of input.messages) {
      if (m.role === "system") {
        // A system message with image blocks is an app-layer bug — the
        // Anthropic API only accepts a string for the top-level system
        // field, and images don't belong there anyway. Flatten to text
        // and drop image blocks silently rather than erroring mid-stream.
        if (typeof m.content === "string") {
          systemMessages.push(m.content);
        } else {
          const textOnly = m.content
            .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
            .join("\n\n");
          if (textOnly) systemMessages.push(textOnly);
        }
      } else {
        messages.push({ role: m.role, content: toAnthropicContent(m.content) });
      }
    }
    const system = systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;

    // Running counters. Anthropic reports input once on message_start
    // and output incrementally on message_delta; we emit the final tally
    // on `done`.
    let inputTokens = 0;
    let outputTokens = 0;
    // `message_delta.delta.stop_reason` lands before `message_stop`.
    let stopReason: StopReason = "end_turn";

    try {
      const stream = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        ...(input.temperature != null ? { temperature: input.temperature } : {}),
        messages,
        stream: true,
      });

      for await (const event of stream) {
        switch (event.type) {
          case "message_start": {
            // Input tokens arrive here; capture and move on.
            const u = event.message.usage;
            if (u) {
              inputTokens = u.input_tokens ?? 0;
              outputTokens = u.output_tokens ?? 0;
            }
            break;
          }
          case "content_block_delta": {
            // Only text deltas are relevant for Chat with PDF today.
            // Thinking / tool-use deltas come through here too; ignore
            // them until `capabilities.toolUse` flips true.
            const delta = event.delta;
            if (delta.type === "text_delta" && delta.text) {
              yield { kind: "text_delta", text: delta.text };
            }
            break;
          }
          case "message_delta": {
            // `stop_reason` and cumulative `output_tokens` land here.
            if (event.delta.stop_reason) {
              stopReason = mapStopReason(event.delta.stop_reason);
            }
            if (event.usage?.output_tokens != null) {
              outputTokens = event.usage.output_tokens;
            }
            break;
          }
          // message_stop / content_block_start / content_block_stop:
          // no data we need for the portability surface. Swallow.
        }
      }

      yield {
        kind: "done",
        stopReason,
        usage: { inputTokens, outputTokens },
        model,
        providerId: this.id,
      };
    } catch (err) {
      yield normalizeError(err);
    }
  }
}

// -- helpers ----------------------------------------------------------

function mapStopReason(r: string | null | undefined): StopReason {
  switch (r) {
    case "end_turn":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "tool_use":
      return "tool_use";
    default:
      return "end_turn";
  }
}

function normalizeError(err: unknown): ChatChunk {
  // Anthropic SDK throws typed errors. Map to our portable codes so
  // the route handler can decide refund policy and log severity
  // without importing the SDK.
  if (err instanceof RateLimitError) {
    return { kind: "error", code: "rate_limit", message: err.message };
  }
  if (err instanceof AuthenticationError) {
    return { kind: "error", code: "auth", message: err.message };
  }
  if (err instanceof BadRequestError) {
    // Context-length errors are BadRequestError at the HTTP layer; the
    // body text is the only reliable signal.
    if (/context|prompt is too long|max.*tokens/i.test(err.message)) {
      return { kind: "error", code: "context_length", message: err.message };
    }
    return { kind: "error", code: "bad_request", message: err.message };
  }
  if (err instanceof APIError) {
    // Overloaded responses land as 529 in newer SDKs; 5xx otherwise.
    if (err.status === 529) {
      return { kind: "error", code: "overloaded", message: err.message };
    }
    return { kind: "error", code: "unknown", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "error", code: "unknown", message };
}
