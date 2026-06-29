/**
 * Bedrock client wrapper + JSON-safe agent helper.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SERVER-SIDE ONLY. Never import this module from a client component, hook,
 * or anything that ships to the browser. AWS credentials and prompts must
 * never leave the server. Agent routes (`app/api/agents/*`) are the only
 * callers.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Required environment variables (see `.env.example`):
 * - AWS_REGION
 * - AWS_ACCESS_KEY_ID
 * - AWS_SECRET_ACCESS_KEY
 * - BEDROCK_MODEL_ID (default: anthropic.claude-3-5-sonnet-20240620-v1:0)
 *
 * The default model is Anthropic Claude on Bedrock, invoked using the
 * Anthropic Messages API format (`anthropic_version: "bedrock-2023-05-31"`).
 *
 * `runAgent<T>()` enforces a JSON-only contract:
 *   1. Appends a strict "reply with ONLY valid JSON" instruction to the
 *      caller's system prompt.
 *   2. Strips optional markdown code fences from the model output.
 *   3. Parses the result as JSON.
 *   4. Retries ONCE with a corrective instruction if the first parse fails.
 *   5. Returns a discriminated union — never throws on expected failures.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

// ─── Public types ─────────────────────────────────────────────────────────

export interface AgentSuccess<T> {
  ok: true;
  data: T;
}

export interface AgentFailure {
  ok: false;
  error: string;
  retryable: boolean;
}

export type AgentResult<T> = AgentSuccess<T> | AgentFailure;

export interface RunAgentArgs {
  systemPrompt: string;
  userPrompt: string;
  /** Defaults to 2000. */
  maxTokens?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const DEFAULT_MODEL_ID = "anthropic.claude-3-5-sonnet-20240620-v1:0";
const DEFAULT_MAX_TOKENS = 2000;
const TEMPERATURE = 0.4;
const ANTHROPIC_VERSION = "bedrock-2023-05-31";

const JSON_CONTRACT_SUFFIX =
  "Reply with ONLY valid JSON matching the requested shape. " +
  "No preamble, no explanations outside the JSON, no markdown fences.";

const RETRY_CORRECTION =
  "Your previous response was not valid JSON. " +
  "Reply with ONLY valid JSON, no preamble, no markdown fences.";

// ─── Client singleton ─────────────────────────────────────────────────────

let cachedClient: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (cachedClient) return cachedClient;

  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region) {
    throw new Error("Missing required environment variable: AWS_REGION");
  }
  if (!accessKeyId) {
    throw new Error("Missing required environment variable: AWS_ACCESS_KEY_ID");
  }
  if (!secretAccessKey) {
    throw new Error(
      "Missing required environment variable: AWS_SECRET_ACCESS_KEY",
    );
  }

  cachedClient = new BedrockRuntimeClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return cachedClient;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Appends the JSON-only contract suffix to a caller-provided system prompt.
 * Idempotent: if the suffix is already present, returns the prompt unchanged.
 */
function withJsonContract(systemPrompt: string): string {
  const trimmed = systemPrompt.trimEnd();
  if (trimmed.endsWith(JSON_CONTRACT_SUFFIX)) {
    return trimmed;
  }
  return `${trimmed}\n\n${JSON_CONTRACT_SUFFIX}`;
}

/**
 * Strips markdown code fences from the model output, if present.
 * Handles ```json ... ``` and ``` ... ``` variants. Leaves bare JSON alone.
 */
function stripCodeFences(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1] !== undefined) {
    return fenced[1].trim();
  }
  return text;
}

/**
 * Classifies a Bedrock SDK error as retryable or not. Credential and
 * permission errors are not retryable; throttling, timeouts and transient
 * server errors are.
 */
function classifyError(err: unknown): {
  message: string;
  retryable: boolean;
} {
  const message = err instanceof Error ? err.message : String(err);
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name)
      : "";

  const nonRetryableNames = new Set([
    "AccessDeniedException",
    "UnrecognizedClientException",
    "InvalidSignatureException",
    "ValidationException",
    "ResourceNotFoundException",
    "CredentialsProviderError",
  ]);

  if (nonRetryableNames.has(name)) {
    return { message, retryable: false };
  }

  return { message, retryable: true };
}

/**
 * Invokes the configured Bedrock model with an Anthropic Messages payload
 * and returns the concatenated text content from the assistant reply.
 */
async function invokeModel(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const client = getClient();
  const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;

  const body = {
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: maxTokens,
    temperature: TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(body)),
  });

  const response = await client.send(command);
  const raw = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(raw) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const text = (parsed.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");

  return text;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Run a JSON-only agent against the configured Bedrock model.
 *
 * The caller's `systemPrompt` is augmented with a strict "JSON only, no
 * preamble, no markdown fences" instruction so every agent inherits the
 * universal JSON contract by default.
 *
 * On JSON parse failure, this helper retries the call exactly once with a
 * corrective instruction appended to the user prompt. If the retry also
 * fails, it returns `{ ok: false, error: "Agent returned invalid JSON",
 * retryable: true }`.
 *
 * Bedrock API errors are caught and surfaced as `{ ok: false, error,
 * retryable }`. Credential / permission errors are flagged
 * `retryable: false`; transient errors (throttling, timeouts, network) are
 * flagged `retryable: true`.
 *
 * The generic parameter `T` is the expected JSON shape; this helper does
 * NOT validate the shape — callers are responsible for shape validation
 * (e.g. via a Zod schema or hand-written guard) before trusting `data`.
 *
 * @example
 * ```ts
 * const result = await runAgent<{ summary: string }>({
 *   systemPrompt: "You are a travel advisor.",
 *   userPrompt: "Summarise the group in 2 sentences.",
 * });
 * if (!result.ok) {
 *   return Response.json({ error: result.error, retryable: result.retryable }, { status: 500 });
 * }
 * return Response.json(result.data);
 * ```
 */
export async function runAgent<T>(
  args: RunAgentArgs,
): Promise<AgentResult<T>> {
  const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
  const systemPrompt = withJsonContract(args.systemPrompt);

  let rawText: string;
  try {
    rawText = await invokeModel(systemPrompt, args.userPrompt, maxTokens);
  } catch (err) {
    const { message, retryable } = classifyError(err);
    return { ok: false, error: message, retryable };
  }

  try {
    return { ok: true, data: JSON.parse(stripCodeFences(rawText)) as T };
  } catch {
    // First parse failed — retry once with a corrective instruction.
  }

  const correctedUserPrompt = `${args.userPrompt}\n\n${RETRY_CORRECTION}`;

  let retryText: string;
  try {
    retryText = await invokeModel(systemPrompt, correctedUserPrompt, maxTokens);
  } catch (err) {
    const { message, retryable } = classifyError(err);
    return { ok: false, error: message, retryable };
  }

  try {
    return { ok: true, data: JSON.parse(stripCodeFences(retryText)) as T };
  } catch {
    return {
      ok: false,
      error: "Agent returned invalid JSON",
      retryable: true,
    };
  }
}
