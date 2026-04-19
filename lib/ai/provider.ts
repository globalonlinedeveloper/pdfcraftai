// AIProvider — the portability contract every AI adapter implements.
//
// Mirrors the payments `PaymentProvider` pattern. Rules of engagement for
// adapter authors:
//
//   - Do NOT leak provider-specific types (Anthropic `Message`, OpenAI
//     `ChatCompletion`, etc.) out of this interface. All shapes are
//     declared in ./types.ts and normalized before return.
//   - Adapters are `"server-only"` so webpack refuses to bundle API keys
//     to the client. Import that guard at the top of every adapter file.
//   - `streamChat()` must emit exactly one terminal chunk (`done` | `error`).
//     Callers rely on the `for await` loop terminating after that.
//   - On provider auth / rate-limit / overload errors, emit a `chunk.error`
//     with the appropriate `code` instead of throwing. Callers use the
//     code to decide refund policy. Adapter throws only for truly
//     unrecoverable bugs (misconfiguration, broken JSON parse).
//   - `chat()` is implemented as a thin wrapper around `streamChat()`
//     for adapters that stream natively. One code path — one place to
//     fix bugs.

import type {
  AICapabilities,
  AIProviderId,
  ChatChunk,
  ChatInput,
  ChatResult,
} from "./types";

export interface AIProvider {
  /**
   * Stable id. Stored against every `chat_messages` row; never change
   * after an adapter has written data.
   */
  readonly id: AIProviderId;

  /** Human-readable name for UI ("Anthropic", "OpenAI"). */
  readonly displayName: string;

  /** What this adapter, in the current configuration, can do. */
  readonly capabilities: AICapabilities;

  /**
   * The model string the adapter will use when `ChatInput.model` is
   * omitted. Exposed for audit + UI display ("Powered by claude-haiku-4-5").
   */
  readonly defaultModel: string;

  /**
   * Request / response chat. Returns the full assembled text and
   * terminal metadata. Implemented by consuming `streamChat()` and
   * joining text_delta chunks — adapters should not duplicate the stream
   * logic.
   */
  chat(input: ChatInput): Promise<ChatResult>;

  /**
   * Streaming chat. Yields incremental chunks until a terminal
   * `done` or `error` chunk is emitted. Consumers `for await` and rely
   * on exactly-one terminal chunk per stream.
   *
   * Cancellation: the adapter must pass an `AbortSignal` through to the
   * provider SDK when the caller breaks out of the loop early. Node 20+
   * `ReadableStream` integration handles this automatically via
   * `ReadableStream.from(asyncIterable)`.
   */
  streamChat(input: ChatInput): AsyncIterable<ChatChunk>;
}

/**
 * Thrown when a caller asks for a capability the adapter doesn't offer
 * in its current configuration. The registry checks `capabilities`
 * before dispatching, so end users never see this — it's defensive
 * programming inside adapters.
 */
export class UnsupportedCapabilityError extends Error {
  constructor(providerId: AIProviderId, capability: keyof AICapabilities) {
    super(`AI provider "${providerId}" does not support capability "${capability}"`);
    this.name = "UnsupportedCapabilityError";
  }
}

/**
 * Thrown when an adapter can't recover from a provider-side failure and
 * the caller needs to know (as opposed to a stream error, which is
 * emitted inline). Most commonly: malformed environment configuration,
 * broken response JSON. Route handlers catch and 500; credits refund.
 */
export class AIProviderError extends Error {
  constructor(
    public readonly providerId: AIProviderId,
    public readonly code:
      | "configuration"
      | "bad_response"
      | "unknown",
    message: string
  ) {
    super(`[${providerId}/${code}] ${message}`);
    this.name = "AIProviderError";
  }
}
