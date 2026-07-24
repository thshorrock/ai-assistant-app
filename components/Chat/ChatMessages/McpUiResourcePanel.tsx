'use client';

import { FC } from 'react';

import type { ToolCallRecord } from '@/types/chat';

import type { UiResourceRef } from '@/lib/streamMarkers';
import { type UIActionResult, UIResourceRenderer } from '@mcp-ui/client';

interface McpUiResourcePanelProps {
  toolCalls: ToolCallRecord[];
}

/**
 * DOM event carrying a prompt out of an MCP-UI iframe action. Chat.tsx
 * listens for it and sends the prompt as a user message — the same
 * document-event bridge the keyboard shortcuts use ('keyboard-toggle-sidebar'),
 * chosen over prop drilling because this panel sits many layers below the
 * component that owns handleSend.
 */
export const MCP_UI_PROMPT_EVENT = 'mcp-ui-prompt';

export interface McpUiPromptEventDetail {
  prompt: string;
}

function dispatchPrompt(prompt: string): void {
  document.dispatchEvent(
    new CustomEvent<McpUiPromptEventDetail>(MCP_UI_PROMPT_EVENT, {
      detail: { prompt },
    }),
  );
}

/**
 * Maps MCP-UI actions (postMessage from the sandboxed iframe) onto what this
 * app can do. There is no browser-side MCP connection — tools execute
 * server-side inside the chat tool loop — so both 'prompt' and 'tool'
 * actions become chat messages; a requested tool call then runs through the
 * normal loop with its consent flow intact rather than bypassing it.
 */
async function handleUiAction(action: UIActionResult): Promise<unknown> {
  switch (action.type) {
    case 'prompt':
      dispatchPrompt(action.payload.prompt);
      break;
    case 'tool': {
      const params = JSON.stringify(action.payload.params ?? {});
      dispatchPrompt(
        `Please call the MCP tool "${action.payload.toolName}" with arguments: ${params}`,
      );
      break;
    }
    case 'link':
      window.open(action.payload.url, '_blank', 'noopener,noreferrer');
      break;
    default:
      // 'intent' / 'notify' have no host mapping here yet.
      console.debug('[mcp-ui] unhandled action', action.type);
  }
  return { status: 'handled' };
}

/**
 * Renders MCP-UI resources (https://mcpui.dev) a tool call returned —
 * interactive HTML in a sandboxed iframe (allow-scripts only, no
 * same-origin for raw HTML). Like GeneratedFilesPanel, these are the
 * deliverable of the call, so they render on the message itself rather
 * than inside the collapsed tool strip. remoteDom resources are excluded:
 * they need a host component library this app does not ship.
 */
export const McpUiResourcePanel: FC<McpUiResourcePanelProps> = ({
  toolCalls,
}) => {
  const resources: Array<{ key: string; resource: UiResourceRef }> =
    toolCalls.flatMap((call) =>
      (call.ui_resources ?? []).map((resource) => ({
        key: `${call.id}:${resource.uri}`,
        resource,
      })),
    );
  if (resources.length === 0) return null;

  return (
    <div className="not-prose my-3 flex flex-col gap-3">
      {resources.map(({ key, resource }) => (
        <div
          key={key}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
        >
          <UIResourceRenderer
            resource={resource}
            onUIAction={handleUiAction}
            supportedContentTypes={['rawHtml', 'externalUrl']}
            htmlProps={{
              style: { width: '100%', height: 320, border: 'none' },
              autoResizeIframe: { height: true },
            }}
          />
        </div>
      ))}
    </div>
  );
};
