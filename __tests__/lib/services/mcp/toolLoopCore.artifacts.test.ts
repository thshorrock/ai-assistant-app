import {
  AssembledRound,
  ToolLoopProviderStrategy,
  runToolLoopCore,
} from '@/lib/services/mcp/toolLoopCore';

import { ResolvedMcpServer } from '@/config/mcpCatalog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnectMcp = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/mcp/McpClientService', () => ({
  connectMcp: mockConnectMcp,
  isMcpAuthError: () => false,
}));

/**
 * Phase 3, proved end to end: a file an MCP tool returns is persisted through
 * the caller's own session and reaches BOTH the client (as generated_files on
 * the tool record) and the model (as a handle line, never bytes).
 *
 * This test exists because of the warning phase 1 left behind: "a partly
 * wired path that silently persists nothing would look exactly like a working
 * one". Unit tests of the extractor and the marker cannot see that gap — only
 * running the loop can.
 */

const server: ResolvedMcpServer = {
  id: 'msfTranslate',
  label: 'MSF Document translation',
  url: 'https://mcp.example.invalid/translate',
  transport: 'streamable-http',
  auth: { style: 'bearer' },
  trusted: true,
  authToken: 'token',
};

const TOOL = 'translate_document';
const candidate = {
  filename: 'manual-fr.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('%PDF-1.4 pretend'),
};
const persistedFile = {
  url: '/api/file/abc.pdf',
  filename: 'manual-fr.pdf',
  mime_type: 'application/pdf',
  is_image: false,
};

function connection(result: Record<string, unknown>) {
  return {
    listTools: vi
      .fn()
      .mockResolvedValue([{ name: TOOL, inputSchema: { type: 'object' } }]),
    getInstructions: vi.fn().mockReturnValue(undefined),
    callTool: vi.fn().mockResolvedValue(result),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Tools execute on the APPROVAL-RESUME path — the loop is stateless, so a
 * call arrives as `pendingToolCalls` plus its `approvalResponses` on a fresh
 * request rather than being executed inline. The strategy therefore only has
 * to answer in text; the tool has already been approved.
 */
function strategy(toolMessages: string[][]): ToolLoopProviderStrategy<string> {
  return {
    reconstructTranscript: (messages) => messages,
    appendToolResults: (messages, results) => {
      toolMessages.push(results.map((r) => r.text));
      return messages;
    },
    runModelRound: async (): Promise<AssembledRound> => ({
      finishedWithToolUse: false,
      calls: [],
      usage: null,
    }),
  };
}

const pendingCall = {
  id: 'call_1',
  serverId: server.id,
  toolName: TOOL,
  argumentsJson: '{}',
};

const base = {
  preparedMessages: ['hi'],
  servers: [server],
  loopRound: 0,
  userId: 'user-1',
  pendingToolCalls: [pendingCall],
  approvalResponses: [{ approval_request_id: 'call_1', approve: true }],
  usage: { modelId: 'gpt-test', region: null as null, onUsage: vi.fn() },
};

describe('runToolLoopCore artifact persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists a returned file and gives the model a handle, not bytes', async () => {
    mockConnectMcp.mockResolvedValue(
      connection({
        content: [],
        text: 'Translated.',
        isError: false,
        artifacts: [candidate],
      }),
    );
    const persistArtifacts = vi.fn().mockResolvedValue({
      files: [persistedFile],
      handleLines: [
        '[file: manual-fr.pdf · application/pdf · 1.2 MB · available to the user as a download]',
      ],
      rejected: [],
    });
    const toolMessages: string[][] = [];

    const response = await runToolLoopCore({
      ...base,
      strategy: strategy(toolMessages),
      persistArtifacts,
    });
    const body = await response.text();

    // 1. The candidates reached the persister.
    expect(persistArtifacts).toHaveBeenCalledWith([candidate]);

    // 2. The client gets the file on the tool record.
    expect(body).toContain('generated_files');
    expect(body).toContain('/api/file/abc.pdf');

    // 3. The model gets a handle line appended to the tool result — and no
    //    base64 anywhere near it.
    const seen = toolMessages.flat().join('\n');
    expect(seen).toContain('Translated.');
    expect(seen).toContain('manual-fr.pdf');
    expect(seen).not.toContain('JVBER');
  });

  it('still returns the tool result when persistence throws', async () => {
    // A storage failure must not sink a result that is otherwise good.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockConnectMcp.mockResolvedValue(
      connection({
        content: [],
        text: 'Translated.',
        isError: false,
        artifacts: [candidate],
      }),
    );
    const toolMessages: string[][] = [];

    const response = await runToolLoopCore({
      ...base,
      strategy: strategy(toolMessages),
      persistArtifacts: vi.fn().mockRejectedValue(new Error('blob down')),
    });
    const body = await response.text();

    expect(body).not.toContain('generated_files');
    expect(toolMessages.flat().join('\n')).toContain('Translated.');
  });

  it('does not call the persister for a tool that returned no files', async () => {
    mockConnectMcp.mockResolvedValue(
      connection({ content: [], text: 'Just text.', isError: false }),
    );
    const persistArtifacts = vi.fn();

    await (
      await runToolLoopCore({
        ...base,
        strategy: strategy([]),
        persistArtifacts,
      })
    ).text();

    expect(persistArtifacts).not.toHaveBeenCalled();
  });
});
