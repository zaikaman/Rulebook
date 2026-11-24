import {
  apiErrorSchema,
  assistantStreamEventSchema,
  type AssistantPage,
  type AssistantStreamEvent,
} from '@rulebook/shared';

import { ApiError, apiBaseUrl } from './api.js';

/** Parses the `data:` lines of one SSE frame. Exported for the stream contract test. */
export function parseAssistantFrame(frame: string): AssistantStreamEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (!data) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error('Bookkeeper returned an unreadable stream.');
  }
  const parsed = assistantStreamEventSchema.safeParse(value);
  if (!parsed.success) throw new Error('Bookkeeper returned an unreadable stream.');
  return parsed.data;
}

/**
 * Buffers arbitrary fetch chunks and emits only complete frames. A frame boundary can split
 * across chunks, so the parser owns the buffer for the whole response.
 */
export function createAssistantEventParser() {
  let buffer = '';
  function drain() {
    const events: AssistantStreamEvent[] = [];
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseAssistantFrame(frame);
      if (event) events.push(event);
      boundary = buffer.indexOf('\n\n');
    }
    return events;
  }
  return {
    push(chunk: string) {
      buffer += chunk.replaceAll('\r\n', '\n');
      return drain();
    },
    flush() {
      const remaining = buffer.trim();
      buffer = '';
      if (!remaining) return [];
      const event = parseAssistantFrame(remaining);
      return event ? [event] : [];
    },
  };
}

export interface AssistantStreamInput {
  readonly message: string;
  readonly conversationId?: string;
  readonly page?: AssistantPage;
}

/** Opens the SSE chat response and forwards each parsed event until the stream closes. */
export async function streamAssistant(
  input: AssistantStreamInput,
  token: string,
  onEvent: (event: AssistantStreamEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${apiBaseUrl}/v2/assistant/chat`, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-assistant-origin': window.location.origin,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.error.code : 'assistant_http',
      parsed.success ? parsed.data.error.message : `Request failed with ${response.status}`,
      parsed.success ? (parsed.data.error.detail ?? null) : null,
      response.status,
    );
  }
  if (!response.body) throw new Error('Bookkeeper did not return a response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createAssistantEventParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
    for (const event of parser.push(decoder.decode())) onEvent(event);
    for (const event of parser.flush()) onEvent(event);
  } finally {
    reader.releaseLock();
  }
}
