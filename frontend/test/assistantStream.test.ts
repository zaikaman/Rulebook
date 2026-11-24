import { describe, expect, it } from 'vitest';

import { createAssistantEventParser, parseAssistantFrame } from '../src/lib/assistant.js';

const conversationId = '2c1f8a6e-4f3b-4d0a-9b1c-2f8a6e4f3b4d';

describe('Bookkeeper stream parser', () => {
  it('holds an incomplete frame until the next chunk completes it', () => {
    const parser = createAssistantEventParser();
    expect(
      parser.push(
        'data: {"type":"status","label":"Reading your workflows"}\r\n\r\ndata: {"type":"delta","text":"You have "}\r\n',
      ),
    ).toEqual([{ type: 'status', label: 'Reading your workflows' }]);
    expect(parser.push('\r\n')).toEqual([{ type: 'delta', text: 'You have ' }]);
  });

  it('returns tool, completion, and reference events in order', () => {
    const parser = createAssistantEventParser();
    const events = parser.push(
      [
        'data: {"type":"tool","name":"list_runs","label":"Reading your run history","state":"start"}',
        '',
        'data: {"type":"tool","name":"list_runs","label":"Reading your run history","state":"done","detail":"3 runs"}',
        '',
        `data: {"type":"done","conversationId":"${conversationId}","references":[{"kind":"run","id":"0x1","label":"Open run","href":"/runs/0x1"}]}`,
        '',
        '',
      ].join('\n'),
    );
    expect(events.map((event) => event.type)).toEqual(['tool', 'tool', 'done']);
    expect(events[1]).toMatchObject({ state: 'done', detail: '3 runs' });
    expect(events[2]).toMatchObject({ conversationId });
  });

  it('ignores empty frames and rejects unknown event shapes', () => {
    expect(parseAssistantFrame(': keep-alive')).toBeNull();
    expect(() => parseAssistantFrame('data: {"type":"unknown"}')).toThrow(
      'Bookkeeper returned an unreadable stream.',
    );
    expect(() => parseAssistantFrame('data: not-json')).toThrow(
      'Bookkeeper returned an unreadable stream.',
    );
  });

  it('flushes a final frame without a trailing blank line', () => {
    const parser = createAssistantEventParser();
    expect(parser.push('data: {"type":"delta","text":"Done"}')).toEqual([]);
    expect(parser.flush()).toEqual([{ type: 'delta', text: 'Done' }]);
    expect(parser.flush()).toEqual([]);
  });
});
