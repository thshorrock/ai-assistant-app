import { assertPublicHost, guardedFetch } from './mcpUrlGuard';
import { McpToolDefinition } from './toolSchemaCache';

import { ResolvedMcpServer } from '@/config/mcpCatalog';

/**
 * Thin wrapper over @modelcontextprotocol/sdk — the ONLY file that ever
 * touches an MCP auth token. Tokens live in local variables scoped to one
 * HTTP request; they are never logged, cached raw, echoed into markers or
 * error messages, or persisted.
 *
 * Connection lifecycle is per-HTTP-request (connect → work → close): no
 * cross-request connection pooling, so the app stays multi-replica safe.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export interface McpToolCallResult {
  /** Flattened text content of the tool result. */
  text: string;
  isError: boolean;
  /**
   * MCP-UI resources (ui:// embedded resources, https://mcpui.dev) found in
   * the result content, size-capped. Carried alongside the flattened text so
   * the chat UI can render them interactively; absent when the tool returned
   * none.
   */
  uiResources?: McpUiResource[];
}

/** Wire-shape of one MCP-UI embedded resource (mirrors UiResourceRef). */
export interface McpUiResource {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

export interface McpConnection {
  listTools(): Promise<McpToolDefinition[]>;
  /**
   * The server's `instructions` from the initialize result — spec-intended
   * system-prompt guidance. Available synchronously once connected. Optional
   * so test doubles that never touch it stay minimal.
   */
  getInstructions?(): string | undefined;
  callTool(
    name: string,
    args: unknown,
    timeoutMs?: number,
  ): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

function authHeaders(server: ResolvedMcpServer): Record<string, string> {
  if (server.auth.style === 'none') return {};
  if (!server.authToken) return {};
  if (server.auth.style === 'header') {
    return { [server.auth.headerName]: server.authToken };
  }
  // 'bearer' and 'oauth' both relay the (opaque) token as a Bearer credential.
  return { Authorization: `Bearer ${server.authToken}` };
}

/**
 * Whether an error from connect/listTools/callTool indicates the SERVER
 * rejected our credential (expired/revoked token) rather than being down.
 * Used to surface "reconnect this connector" instead of a generic failure.
 */
export function isMcpAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bHTTP (401|403)\b|\b(401|403)\b.*unauthoriz|unauthorized/i.test(
    message,
  );
}

/** Flattens MCP content blocks into plain text for the model transcript. */
function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') return b.text;
        // Non-text content (images, resources): describe rather than drop.
        if (typeof b.type === 'string') return `[${b.type} content]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// UI resources ride the tool-call record marker and are persisted with the
// conversation, so cap them: enough for a real embedded app, small enough
// that a hostile/buggy server can't balloon the transcript.
const MAX_UI_RESOURCES_PER_CALL = 4;
const MAX_UI_RESOURCE_CHARS = 150_000;

/**
 * Picks out MCP-UI embedded resources (type 'resource', uri ui://…) from a
 * tool result's content array. Oversized or malformed blocks are dropped
 * silently — the flattened text (with its `[resource content]` placeholder)
 * remains the source of truth for the model either way.
 */
function extractUiResources(content: unknown): McpUiResource[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const out: McpUiResource[] = [];
  for (const block of content) {
    if (out.length >= MAX_UI_RESOURCES_PER_CALL) break;
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'resource' || !b.resource || typeof b.resource !== 'object')
      continue;
    const r = b.resource as Record<string, unknown>;
    if (typeof r.uri !== 'string' || !r.uri.startsWith('ui://')) continue;
    if (typeof r.mimeType !== 'string') continue;
    const text = typeof r.text === 'string' ? r.text : undefined;
    const blob = typeof r.blob === 'string' ? r.blob : undefined;
    const payload = text ?? blob;
    if (payload === undefined || payload.length > MAX_UI_RESOURCE_CHARS)
      continue;
    out.push({
      uri: r.uri,
      mimeType: r.mimeType,
      ...(text !== undefined ? { text } : { blob }),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Connects to an MCP server. Tries the preferred transport first, then the
 * other one — remote servers commonly support only one of Streamable HTTP /
 * SSE, and the failure mode of a mismatch is an immediate 4xx/405.
 */
export async function connectMcp(
  server: ResolvedMcpServer,
): Promise<McpConnection> {
  // Untrusted (arbitrary) servers get the per-request SSRF-guarded fetch;
  // catalog hosts skip DNS-level checks but still ride normal fetch.
  if (!server.trusted) {
    await assertPublicHost(server.url);
  }
  const fetchImpl = server.trusted ? undefined : guardedFetch();

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

  const client = new Client({
    name: 'msf-ai-assistant',
    version: '1.0.0',
  });

  const makeTransport = async (kind: 'streamable-http' | 'sse') => {
    const url = new URL(server.url);
    const requestInit = { headers: authHeaders(server) };
    if (kind === 'streamable-http') {
      const { StreamableHTTPClientTransport } =
        await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      return new StreamableHTTPClientTransport(url, {
        requestInit,
        fetch: fetchImpl,
      });
    }
    const { SSEClientTransport } =
      await import('@modelcontextprotocol/sdk/client/sse.js');
    return new SSEClientTransport(url, { requestInit, fetch: fetchImpl });
  };

  const order: Array<'streamable-http' | 'sse'> =
    server.transport === 'sse'
      ? ['sse', 'streamable-http']
      : ['streamable-http', 'sse'];

  let lastError: unknown;
  for (const kind of order) {
    try {
      const transport = await makeTransport(kind);
      await withTimeout(
        client.connect(transport),
        CONNECT_TIMEOUT_MS,
        'MCP connect timed out',
      );
      return wrapClient(client);
    } catch (error) {
      lastError = error;
      // Fall through to the alternate transport.
    }
  }
  throw sanitizeError(lastError, server.label);
}

function wrapClient(client: {
  listTools: () => Promise<{ tools: unknown[] }>;
  getInstructions?: () => string | undefined;
  callTool: (
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: undefined,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  close: () => Promise<void>;
}): McpConnection {
  return {
    getInstructions() {
      try {
        const instructions = client.getInstructions?.();
        return typeof instructions === 'string' && instructions.trim()
          ? instructions
          : undefined;
      } catch {
        // The SDK throws if called before initialize completes; a missing
        // instructions field must never break a connection.
        return undefined;
      }
    },

    async listTools() {
      const result = await withTimeout(
        client.listTools(),
        DEFAULT_CALL_TIMEOUT_MS,
        'MCP listTools timed out',
      );
      return (result.tools ?? []).map((tool) => {
        const t = tool as Record<string, unknown>;
        return {
          name: String(t.name ?? ''),
          description:
            typeof t.description === 'string' ? t.description : undefined,
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object'
              ? (t.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
        };
      });
    },

    async callTool(name, args, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
      const result = (await client.callTool(
        {
          name,
          arguments: (args ?? {}) as Record<string, unknown>,
        },
        undefined,
        { timeout: timeoutMs },
      )) as Record<string, unknown>;
      const uiResources = extractUiResources(result.content);
      return {
        text: contentToText(result.content),
        isError: result.isError === true,
        ...(uiResources ? { uiResources } : {}),
      };
    },

    async close() {
      try {
        await client.close();
      } catch {
        // Closing failures are irrelevant — the request is done either way.
      }
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Errors from the SDK can embed request details; rethrow with a message that
 * is safe to log and to surface to the client (never includes headers/token).
 */
function sanitizeError(error: unknown, serverLabel: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const status = raw.match(/\b(401|403|404|405|429|5\d\d)\b/)?.[1];
  const kind = raw.toLowerCase().includes('timed out')
    ? 'timeout'
    : status
      ? `HTTP ${status}`
      : 'connection error';
  return new Error(`MCP server "${serverLabel}" unreachable (${kind})`);
}
