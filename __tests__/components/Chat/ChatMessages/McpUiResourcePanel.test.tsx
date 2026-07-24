import { render } from '@testing-library/react';

import type { ToolCallRecord } from '@/types/chat';

import { McpUiResourcePanel } from '@/components/Chat/ChatMessages/McpUiResourcePanel';

import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

function record(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'call_1',
    name: 'show_caller_card',
    server_label: 'MSF Demo App',
    arguments: '{}',
    status: 'completed',
    output: '[resource content]',
    error: null,
    ...overrides,
  };
}

describe('McpUiResourcePanel', () => {
  it('renders nothing when no tool call carries ui_resources', () => {
    const { container } = render(<McpUiResourcePanel toolCalls={[record()]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a sandboxed iframe for a rawHtml ui:// resource', () => {
    const { container } = render(
      <McpUiResourcePanel
        toolCalls={[
          record({
            ui_resources: [
              {
                uri: 'ui://demo-app/caller-card/1',
                mimeType: 'text/html',
                text: '<p>hello from mcp-ui</p>',
              },
            ],
          }),
        ]}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    // Raw HTML must go through srcDoc under a scripts-only sandbox — no
    // same-origin, so the iframe cannot reach the app's cookies or storage.
    expect(iframe).toHaveAttribute('srcDoc');
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe?.getAttribute('sandbox') ?? '').not.toContain(
      'allow-same-origin',
    );
  });

  it('renders one iframe per resource across tool calls', () => {
    const { container } = render(
      <McpUiResourcePanel
        toolCalls={[
          record({
            id: 'a',
            ui_resources: [
              { uri: 'ui://x/1', mimeType: 'text/html', text: '<p>1</p>' },
            ],
          }),
          record({
            id: 'b',
            ui_resources: [
              { uri: 'ui://x/2', mimeType: 'text/html', text: '<p>2</p>' },
            ],
          }),
        ]}
      />,
    );
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
  });
});
