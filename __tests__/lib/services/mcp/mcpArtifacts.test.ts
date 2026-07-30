import {
  MAX_ARTIFACTS_PER_CALL,
  extractArtifactCandidates,
} from '@/lib/services/mcp/mcpArtifacts';

import { describe, expect, it } from 'vitest';

const b64 = (s: string) => Buffer.from(s).toString('base64');

const resourceBlock = (uri: string, mimeType: string, body = 'PKdata') => ({
  type: 'resource',
  resource: { uri, mimeType, blob: b64(body) },
});

describe('extractArtifactCandidates', () => {
  it('pulls a blob resource out as a candidate', () => {
    const { candidates, links } = extractArtifactCandidates([
      { type: 'text', text: 'Built the sheet.' },
      resourceBlock(
        'file:///Latest-Green-List.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ]);
    expect(links).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].filename).toBe('Latest-Green-List.xlsx');
    expect(candidates[0].mimeType).toContain('spreadsheetml');
    expect(candidates[0].data.toString()).toContain('data');
  });

  it('leaves ui:// resources alone — they are a rendering channel, not files', () => {
    // The two extractors partition the content array by URI scheme. If this
    // ever fails, an MCP-UI card would be persisted as a download AND
    // rendered, or worse, silently become one instead of the other.
    const { candidates } = extractArtifactCandidates([
      resourceBlock('ui://demo-app/caller-card/1', 'text/html'),
    ]);
    expect(candidates).toEqual([]);
  });

  it('ignores a text resource, which stays text', () => {
    const { candidates } = extractArtifactCandidates([
      {
        type: 'resource',
        resource: { uri: 'file:///a.txt', mimeType: 'text/plain', text: 'hi' },
      },
    ]);
    expect(candidates).toEqual([]);
  });

  it('collects an image block, which used to be dropped as [image content]', () => {
    const { candidates } = extractArtifactCandidates([
      { type: 'image', data: b64('PNG\r\n'), mimeType: 'image/png' },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].filename).toBe('image.png');
    expect(candidates[0].mimeType).toBe('image/png');
  });

  it('reports a resource_link for a later resources/read rather than following it', () => {
    const { candidates, links } = extractArtifactCandidates([
      {
        type: 'resource_link',
        uri: 'file:///big.xlsx',
        name: 'big.xlsx',
        mimeType: 'x/y',
      },
    ]);
    expect(candidates).toEqual([]);
    expect(links).toEqual([
      { uri: 'file:///big.xlsx', name: 'big.xlsx', mimeType: 'x/y' },
    ]);
  });

  it('reduces a server-supplied name to a basename', () => {
    // A filename from a tool result is attacker-controlled in the general
    // case, and it is used to build a storage path.
    const { candidates } = extractArtifactCandidates([
      resourceBlock('file:///../../etc/passwd', 'text/plain'),
    ]);
    expect(candidates[0].filename).toBe('passwd');
    expect(candidates[0].filename).not.toContain('/');
    expect(candidates[0].filename).not.toContain('..');
  });

  it('survives malformed content instead of throwing', () => {
    for (const bad of [
      null,
      undefined,
      'nope',
      42,
      [null],
      [{}],
      [{ type: 'resource' }],
    ]) {
      expect(() => extractArtifactCandidates(bad)).not.toThrow();
    }
    expect(extractArtifactCandidates(null).candidates).toEqual([]);
  });

  it('extracts every candidate; the per-call cap is applied when persisting', () => {
    const many = Array.from({ length: MAX_ARTIFACTS_PER_CALL + 3 }, (_, i) =>
      resourceBlock(`file:///f${i}.xlsx`, 'application/octet-stream'),
    );
    // Extraction stays pure and total so the persist step can REPORT what it
    // dropped; truncating here would lose the count.
    expect(extractArtifactCandidates(many).candidates).toHaveLength(
      MAX_ARTIFACTS_PER_CALL + 3,
    );
  });
});
