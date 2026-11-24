import { randomUUID } from 'node:crypto';

import type { AssistantReference } from '@rulebook/shared';
import { z } from 'zod';

import type { GeminiConfig } from '../config.js';
import type { AssistantToolDefinition, AssistantToolResult } from './tools.js';

export const assistantRoundTimeoutMs = 45_000;
export const assistantMaxRounds = 4;
export const assistantMaxToolCalls = 8;

export interface ProviderToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
  readonly tool_calls?: readonly ProviderToolCall[];
  readonly tool_call_id?: string;
}

export interface AssistantToolTrace {
  name: string;
  label: string;
  state: 'start' | 'done' | 'error';
  detail?: string;
}

export type AssistantProviderFailure = 'timeout' | 'unavailable' | 'invalid' | 'empty' | 'loop';

export class AssistantProviderError extends Error {
  constructor(readonly failure: AssistantProviderFailure) {
    super(failure);
    this.name = 'AssistantProviderError';
  }
}

export function assistantFailureMessage(error: unknown) {
  if (!(error instanceof AssistantProviderError))
    return 'Bookkeeper could not answer that. Try again shortly.';
  switch (error.failure) {
    case 'timeout':
      return 'Bookkeeper took too long to answer. Try a shorter question.';
    case 'unavailable':
      return 'Bookkeeper could not reach its model provider. Try again shortly.';
    case 'invalid':
      return 'Bookkeeper returned an unreadable answer. Try again.';
    case 'empty':
      return 'Bookkeeper did not produce an answer. Try again.';
    case 'loop':
      return 'Bookkeeper could not finish that request. Try asking again with fewer details.';
  }
}

const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().nonnegative(),
                  id: z.string().optional(),
                  function: z
                    .object({
                      name: z.string().optional(),
                      arguments: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

interface RoundResult {
  readonly content: string;
  readonly toolCalls: readonly ProviderToolCall[];
}

/**
 * Streams one completion and reports each text delta as it arrives. Tool calls arrive as
 * fragments, so their id, name, and JSON arguments are accumulated per index before execution.
 */
async function streamRound(
  provider: GeminiConfig,
  messages: readonly ProviderMessage[],
  tools: readonly AssistantToolDefinition[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<RoundResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(assistantRoundTimeoutMs)]);
  let response: Response;
  try {
    response = await fetch(provider.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: deadline,
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        stream: true,
        max_completion_tokens: 2048,
        messages,
        ...(tools.length
          ? {
              tools: tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: 'auto',
            }
          : {}),
      }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AssistantProviderError(deadline.aborted ? 'timeout' : 'unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AssistantProviderError('unavailable');
  }
  if (!response.body) throw new AssistantProviderError('unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = '';
  let content = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            throw new AssistantProviderError('invalid');
          }
          const chunk = chunkSchema.safeParse(parsed);
          if (!chunk.success) throw new AssistantProviderError('invalid');
          for (const choice of chunk.data.choices ?? []) {
            const delta = choice.delta;
            if (delta?.content) {
              content += delta.content;
              onDelta(delta.content);
            }
            for (const call of delta?.tool_calls ?? []) {
              const current = calls.get(call.index) ?? { id: '', name: '', arguments: '' };
              if (call.id) current.id = call.id;
              if (call.function?.name) current.name += call.function.name;
              if (call.function?.arguments) current.arguments += call.function.arguments;
              calls.set(call.index, current);
            }
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (error instanceof AssistantProviderError) throw error;
    if (signal.aborted) throw error;
    if (deadline.aborted) throw new AssistantProviderError('timeout');
    throw new AssistantProviderError('invalid');
  } finally {
    reader.releaseLock();
  }

  return {
    content,
    toolCalls: [...calls.values()]
      .filter((call) => call.name)
      .map((call) => ({
        id: call.id || `call_${randomUUID()}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments || '{}' },
      })),
  };
}

export interface AssistantTurnInput {
  readonly provider: GeminiConfig;
  readonly messages: readonly ProviderMessage[];
  readonly tools: readonly AssistantToolDefinition[];
  readonly execute: (name: string, argumentsValue: unknown) => Promise<AssistantToolResult>;
  readonly onStatus?: (label: string) => void;
  readonly onDelta: (text: string) => void;
  readonly onTool: (trace: AssistantToolTrace) => void;
  readonly signal: AbortSignal;
}

export interface AssistantTurnResult {
  readonly text: string;
  readonly references: readonly AssistantReference[];
  readonly tools: readonly AssistantToolTrace[];
}

function dedupeReferences(references: readonly AssistantReference[]) {
  const unique = new Map<string, AssistantReference>();
  for (const reference of references) {
    const key = `${reference.kind}:${reference.id}:${reference.href}`;
    if (!unique.has(key))
      unique.set(key, {
        ...reference,
        label:
          reference.label.length > 120 ? `${reference.label.slice(0, 117)}...` : reference.label,
      });
  }
  return [...unique.values()].slice(0, 6);
}

/**
 * Runs at most four model rounds and eight tool calls. The final round is sent without tools, so
 * the model always has one chance to explain what it found instead of ending on a tool request.
 */
export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const { provider, tools, execute, onStatus, onDelta, onTool, signal } = input;
  const messages: ProviderMessage[] = [...input.messages];
  const references: AssistantReference[] = [];
  const trace: AssistantToolTrace[] = [];
  let text = '';
  let calls = 0;

  for (let round = 0; round < assistantMaxRounds; round += 1) {
    if (round > 0) onStatus?.('Putting the answer together');
    const allowTools = round < assistantMaxRounds - 1 && calls < assistantMaxToolCalls;
    const result = await streamRound(provider, messages, allowTools ? tools : [], onDelta, signal);
    text += result.content;

    if (!result.toolCalls.length) {
      if (!result.content.trim() || !text.trim()) throw new AssistantProviderError('empty');
      return { text, references: dedupeReferences(references), tools: trace };
    }
    if (!allowTools) throw new AssistantProviderError('loop');

    const selected = result.toolCalls.slice(0, assistantMaxToolCalls - calls);
    if (!selected.length) throw new AssistantProviderError('loop');
    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: selected,
    });

    for (const call of selected) {
      calls += 1;
      const definition = tools.find((tool) => tool.name === call.function.name);
      const label = definition?.label ?? 'Reading your account';
      const record: AssistantToolTrace = {
        name: call.function.name,
        label,
        state: 'start',
      };
      trace.push(record);
      onTool({ ...record });
      try {
        let argumentsValue: unknown = {};
        if (call.function.arguments.trim()) {
          try {
            argumentsValue = JSON.parse(call.function.arguments);
          } catch {
            throw new Error('The read request was malformed.');
          }
        }
        const resultValue = await execute(call.function.name, argumentsValue);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: resultValue.content,
        });
        record.state = 'done';
        record.detail = resultValue.detail.slice(0, 160);
        references.push(...resultValue.references);
        onTool({ ...record });
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 300) : 'That read did not complete.';
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: message }),
        });
        record.state = 'error';
        record.detail = message.slice(0, 160);
        onTool({ ...record });
      }
    }
    onStatus?.('Reviewing what it found');
  }

  throw new AssistantProviderError('loop');
}
