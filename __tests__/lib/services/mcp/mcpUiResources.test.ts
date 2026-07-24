import { toolResultToRecordMarker } from '@/lib/services/mcp/mcpEventMappers';

import { scanStreamEvents } from '@/lib/streamMarkers';
import { describe, expect, it } from 'vitest';

/**
 * MCP-UI resources (ui:// embedded resources, https://mcpui.dev) ride the
 * TOOL_CALL_RECORD marker so the chat can render interactive tool UIs.
 * These tests pin the wire contract: resources survive the marker roundtrip
 * verbatim, and never leak into records that have none.
 */

const call = {
  id: 'call_ui',
  serverId: 'msfDemoApp',
  toolName: 'show_caller_card',
  argumentsJson: '{}',
};

const uiResource = {
  uri: 'ui://demo-app/caller-card/1',
  mimeType: 'text/html',
  text: '<p>hello</p>',
};

describe('toolResultToRecordMarker with MCP-UI resources', () => {
  it('carries ui_resources through the marker roundtrip verbatim', () => {
    const marker = toolResultToRecordMarker(
      call,
      'MSF Demo App',
      { text: '[resource content]', isError: false, uiResources: [uiResource] },
      42,
    );
    const { events } = scanStreamEvents(marker, 0);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call_record');
    const payload = events[0].payload as {
      ui_resources?: unknown;
      output: string | null;
    };
    expect(payload.ui_resources).toEqual([uiResource]);
    // The flattened text stays the model-facing output, untouched.
    expect(payload.output).toBe('[resource content]');
  });

  it('omits ui_resources when the result has none', () => {
    const marker = toolResultToRecordMarker(
      call,
      'MSF Demo App',
      { text: 'plain', isError: false },
      1,
    );
    const { events } = scanStreamEvents(marker, 0);
    expect(
      'ui_resources' in (events[0].payload as Record<string, unknown>),
    ).toBe(false);
  });

  it('omits ui_resources on error results (errorMessage shape)', () => {
    const marker = toolResultToRecordMarker(
      call,
      'MSF Demo App',
      { errorMessage: 'boom' },
      1,
    );
    const { events } = scanStreamEvents(marker, 0);
    expect(
      'ui_resources' in (events[0].payload as Record<string, unknown>),
    ).toBe(false);
  });

  it('keeps ui_resources when the tool reported isError with a UI attached', () => {
    const marker = toolResultToRecordMarker(
      call,
      'MSF Demo App',
      { text: 'failed', isError: true, uiResources: [uiResource] },
      1,
    );
    const { events } = scanStreamEvents(marker, 0);
    const payload = events[0].payload as {
      status: string;
      ui_resources?: unknown[];
    };
    expect(payload.status).toBe('failed');
    expect(payload.ui_resources).toHaveLength(1);
  });
});
