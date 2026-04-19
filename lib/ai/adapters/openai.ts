// OpenAI adapter — second implementation of `AIProvider`.
//
// Follows the same rules as the Anthropic adapter:
//   - No SDK types leak past the module boundary. Everything normalizes
//     to `ChatChunk` / `ChatResult`.
//   - `"server-only"` at the top to keep the API key off the client.
//   - `streamChat()` is the single source of truth. `chat()` consumes
//     the iterable.
//   - Errors are emitted inline as terminal `chunk.error` with a
//     classified code. Don't throw for rate / auth / overload.
//
// OpenAI-specific notes:
//   - `system` is a regular role in the messages array (unlike Anthropic
//     which has a top-level `system` field), so `systemPrompt` is
//     prepended as a system-role message.
//   - Usage only arrives at the end of a stream, and ONLY if we set
//     `stream_options.include_usage = true`. We always set it — our
//     ledger needs the counts to trim or (in future) refund partially.
//   - `finish_reason` comes through per-choice; we take it from choice[0].

import "server-only";

import OpenAI, {
  APIError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from "openai";

import { AIProviderError, UnsupportedCapabilityError, type AIProvider } from "../provider";
import type {
  AICapabilities,
  AIProviderId,
  ChatChunk,
  ChatInput,
  ChatResult,
  ChatRole,
  ContentBlock,
  StopReason,
  TokenUsage,
} from "../types";

/**
 * OpenAI's per-message content shape. A `string` is the back-compat
 * form; an array is the multimodal form where text lives in a
 * `{ type: "text", text }` block and images live in a
 * `{ type: "image_url", image_url: { url } }` block — and the URL is a
 * `data:<mediaType>;base64,<data>` string.
 *
 * We keep a local alias to avoid leaking OpenAI's SDK type names.
 */
type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function toOpenAIContent(
  content: string | ContentBlock[]
): string | OpenAIContentPart[] {
  if (typeof content === "string") return content;
  return content.map((b): OpenAIContentPart => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image") {
      return {
        type: "image_url",
        image_url: { url: `data:${b.mediaType};base64,${b.data}` },
      };
    }
    // DocumentBlock — OpenAI's public Chat Completions API doesn't accept
    // raw PDFs as a message part today (you must upload via the Files API
    // and reference a file_id, which is a different surface than we expose
    // here). Reject loudly so the registry can route to Anthropic instead.
    throw new UnsupportedCapabilityError("openai", "pdfInput");
  });
}

export interface OpenAIProviderOptions {
  apiKey: string;
  defaultModel: string;
}

export class OpenAIProvider implements AIProvider {
  readonly id: AIProviderId = "openai";
  readonly displayName = "OpenAI";
  readonly capabilities: AICapabilities = {
    streaming: true,
    // Same rule as Anthropic: supported by the SDK, not yet wired end-
    // to-end, so the flag stays off.
    toolUse: false,
    imageInput: true,
    // GPT-4o accepts PDF via the file API; our adapter path only feeds
    // text today, so we advertise false until we wire the upload.
    pdfInput: false,
  };
  readonly defaultModel: string;

  private readonly client: OpenAI;

  constructor(opts: OpenAIProviderOptions) {
    if (!opts.apiKey) {
      throw new AIProviderError(
        "openai",
        "configuration",
        "OPENAI_API_KEY is empty"
      );
    }
    this.defaultModel = opts.defaultModel;
    this.client = new OpenAI({ apiKey: opts.apiKey });
  }

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
            "openai",
            chunk.code === "auth" ? "configuration" : "unknown",
            chunk.message
          );
      }
    }
    return { text, stopReason, usage, model, providerId: this.id };
  }

  async *streamChat(input: ChatInput): AsyncIterable<ChatChunk> {
    const model = input.model ?? this.defaultModel;
    // OpenAI doesn't require max_tokens but we clamp for the same
    // credit-protection reason as Anthropic.
    const maxTokens = input.maxTokens ?? 1024;
    // Build the messages array. OpenAI accepts "system" as a first-class
    // role, so `systemPrompt` becomes the first system message and any
    // "system" role messages in history stay as-is.
    const messages: Array<{
      role: ChatRole;
      content: string | OpenAIContentPart[];
    }> = [];
    if (input.systemPrompt) {
      messages.push({ role: "system", content: input.systemPrompt });
    }
    for (const m of input.messages) {
      if (m.role === "system" && typeof m.content !== "string") {
        // Same guardrail as the Anthropic adapter: images don't belong
        // in a system message. Flatten to text-only.
        const textOnly = m.content
          .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n\n");
        if (textOnly) messages.push({ role: "system", content: textOnly });
      } else {
        messages.push({ role: m.role, content: toOpenAIContent(m.content) });
      }
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: StopReason = "end_turn";

    try {
      const stream = await this.client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        ...(input.temperature != null ? { temperature: input.temperature } : {}),
        // Cast: the OpenAI SDK's ChatCompletionMessageParam is a discriminated
        // union by `role`, and the assistant-role variant forbids image parts
        // (only user accepts them). Our local messages array keeps `role` as
        // ChatRole so we can enforce our own invariants; this cast bridges
        // the two without duplicating the SDK union into our code. At runtime
        // we only emit image parts for user-role messages (OCR callers only
        // ever send images in user turns), so the shape is always valid.
        messages: messages as Parameters<
          typeof this.client.chat.completions.create
        >[0]["messages"],
        stream: true,
        // Force usage to arrive on the terminal chunk. Without this
        // we'd charge credits without knowing how many tokens ran —
        // which breaks refund math.
        stream_options: { include_usage: true },
      });

      for await (const event of stream) {
        // Usage lands in the LAST chunk (one where usage != null AND
        // choices is []). Handle that first because the choices check
        // below would otherwise skip it.
        if (event.usage) {
          inputTokens = event.usage.prompt_tokens ?? 0;
          outputTokens = event.usage.completion_tokens ?? 0;
        }
        const choice = event.choices[0];
        if (!choice) continue;
        const delta = choice.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { kind: "text_delta", text: delta };
        }
        if (choice.finish_reason) {
          stopReason = mapStopReason(choice.finish_reason);
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
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "content_filter":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

function normalizeError(err: unknown): ChatChunk {
  if (err instanceof RateLimitError) {
    return { kind: "error", code: "rate_limit", message: err.message };
  }
  if (err instanceof AuthenticationError) {
    return { kind: "error", code: "auth", message: err.message };
  }
  if (err instanceof BadRequestError) {
    // OpenAI surfaces context-length as an error code in the response
    // body ("context_length_exceeded"); the SDK bubbles it via the
    // `code` field on the error object.
    const code = (err as APIError & { code?: string }).code;
    if (code === "context_length_exceeded" || /context.*length|maximum.*tokens/i.test(err.message)) {
      return { kind: "error", code: "context_length", message: err.message };
    }
    return { kind: "error", code: "bad_request", message: err.message };
  }
  if (err instanceof APIError) {
    // 503 / 502 / overloaded gateway-ish errors — treat as transient.
    if (err.status && err.status >= 500 && err.status !== 500) {
      return { kind: "error", code: "overloaded", message: err.message };
    }
    return { kind: "error", code: "unknown", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "error", code: "unknown", message };
}
