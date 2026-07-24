import { StreamParser } from '@/lib/utils/shared/chat/streamParser';

import { emitToolCallRecord } from '@/lib/streamMarkers';
import { describe, expect, it } from 'vitest';

/**
 * Regression: getToolCallRecords() rebuilds records through an explicit
 * field list, so any additive payload field must be carried there too —
 * ui_resources was parsed off the wire correctly and then dropped by that
 * mapping, which is exactly the layer scanStreamEvents-level tests miss.
 * This exercises the full client chain: bytes → processChunk → records.
 */

const uiResource = {
  uri: 'ui://demo-app/countdown/1',
  mimeType: 'text/html',
  text: '<div>countdown</div>',
};

function feed(parser: StreamParser, text: string) {
  parser.processChunk(new TextEncoder().encode(text));
}

describe('StreamParser ui_resources', () => {
  it('surfaces ui_resources from a TOOL_CALL_RECORD marker in getToolCallRecords()', () => {
    const parser = new StreamParser();
    feed(
      parser,
      emitToolCallRecord({
        id: 'call_1',
        name: 'show_countdown',
        server_label: 'MSF Demo App (MCP-UI)',
        server_id: 'msfDemoApp',
        arguments: '{"seconds":60}',
        status: 'completed',
        output: '[resource content]',
        error: null,
        ui_resources: [uiResource],
        duration_ms: 659,
        approval_request_id: 'call_1',
      }),
    );

    const records = parser.getToolCallRecords();
    expect(records).toHaveLength(1);
    expect(records[0].ui_resources).toEqual([uiResource]);
  });

  it('omits ui_resources for records that have none', () => {
    const parser = new StreamParser();
    feed(
      parser,
      emitToolCallRecord({
        id: 'call_2',
        name: 'ping',
        server_label: 'Demo',
        arguments: '{}',
        status: 'completed',
        output: 'pong',
        error: null,
      }),
    );
    expect('ui_resources' in parser.getToolCallRecords()[0]).toBe(false);
  });

  it('keeps ui_resources when the marker arrives split across chunks', () => {
    const parser = new StreamParser();
    const marker = emitToolCallRecord({
      id: 'call_3',
      name: 'show_countdown',
      server_label: 'MSF Demo App (MCP-UI)',
      arguments: '{}',
      status: 'completed',
      output: '[resource content]',
      error: null,
      ui_resources: [uiResource],
    });
    const mid = Math.floor(marker.length / 2);
    feed(parser, marker.slice(0, mid));
    feed(parser, marker.slice(mid));

    const records = parser.getToolCallRecords();
    expect(records).toHaveLength(1);
    expect(records[0].ui_resources).toEqual([uiResource]);
  });
});
