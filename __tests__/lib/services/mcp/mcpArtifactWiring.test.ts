import { artifactNoticeText } from '@/lib/services/mcp/mcpArtifacts';
import { toolResultToRecordMarker } from '@/lib/services/mcp/mcpEventMappers';

import { scanStreamEvents } from '@/lib/streamMarkers';
import { describe, expect, it } from 'vitest';

/**
 * Phase 3 of the tool-artifacts plan: a file an MCP tool returns reaches the
 * user's own blob storage, and the MODEL sees a handle rather than bytes.
 *
 * The handle text is the load-bearing half. The standing no-fabrication rule
 * means the model must be able to say it attached a file and must NOT be able
 * to describe contents it never read — so the notice names the file, its type
 * and its size, and stops there.
 */

const call = {
  id: 'call_artifact',
  serverId: 'msfTranslate',
  toolName: 'translate_document',
  argumentsJson: '{}',
};

const file = {
  url: '/api/file/abc123.pdf',
  filename: 'manual-fr.pdf',
  mime_type: 'application/pdf',
  is_image: false,
};

describe('artifactNoticeText', () => {
  it('is empty when a call produced no files and rejected nothing', () => {
    // Empty means "append nothing at all" — a tool that returns only text
    // must read to the model exactly as it did before this feature existed.
    expect(
      artifactNoticeText({ files: [], handleLines: [], rejected: [] }),
    ).toBe('');
  });

  it('lists the handles it saved', () => {
    const text = artifactNoticeText({
      files: [file],
      handleLines: [
        '[file: manual-fr.pdf · application/pdf · 1.2 MB · available to the user as a download]',
      ],
      rejected: [],
    });
    expect(text).toContain('manual-fr.pdf');
    expect(text).toContain('application/pdf');
  });

  it('reports a rejection rather than dropping it silently', () => {
    // "The tool produced a .zip, which this app does not retain" is a usable
    // answer. A silent drop is the failure mode the module exists to remove.
    const text = artifactNoticeText({
      files: [],
      handleLines: [],
      rejected: ['out.zip: .zip files are not retained by this app'],
    });
    expect(text).toContain('out.zip');
    expect(text).toContain('not retained');
  });

  it('reports both when some files saved and others did not', () => {
    const text = artifactNoticeText({
      files: [file],
      handleLines: [
        '[file: manual-fr.pdf · application/pdf · 1.2 MB · available to the user as a download]',
      ],
      rejected: ['out.zip: .zip files are not retained by this app'],
    });
    expect(text).toContain('manual-fr.pdf');
    expect(text).toContain('out.zip');
  });

  it('never instructs the model to do anything', () => {
    // An imperative in tool output is an instruction the model may satisfy by
    // inventing a result — that is exactly what produced the fabricated
    // Unifield stock list. The notice states what happened and stops.
    const text = artifactNoticeText({
      files: [file],
      handleLines: [
        '[file: manual-fr.pdf · application/pdf · 1.2 MB · available to the user as a download]',
      ],
      rejected: ['out.zip: .zip files are not retained by this app'],
    });
    expect(text).not.toMatch(/\b(call|retry|try again|do not report)\b/i);
  });
});

describe('toolResultToRecordMarker with generated files', () => {
  it('carries generated_files through the marker roundtrip verbatim', () => {
    const marker = toolResultToRecordMarker(
      call,
      'MSF Document translation',
      { text: 'Translated.', isError: false },
      42,
      [file],
    );
    const { events } = scanStreamEvents(marker, 0);
    const record = events.find((e) => e.type === 'tool_call_record');
    expect(record).toBeTruthy();
    expect(
      (record as { payload: { generated_files?: unknown[] } }).payload
        .generated_files,
    ).toEqual([file]);
  });

  it('omits the key entirely for a tool that produced no files', () => {
    const marker = toolResultToRecordMarker(
      call,
      'MSF Document translation',
      { text: 'Translated.', isError: false },
      42,
    );
    const { events } = scanStreamEvents(marker, 0);
    const record = events.find((e) => e.type === 'tool_call_record');
    expect(
      (record as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('generated_files');
  });

  it('still attaches files when the tool flagged an error', () => {
    // A tool may return a partial artifact alongside an error flag, exactly
    // as MCP-UI resources already do.
    const marker = toolResultToRecordMarker(
      call,
      'MSF Document translation',
      { text: 'Partially translated.', isError: true },
      42,
      [file],
    );
    const { events } = scanStreamEvents(marker, 0);
    const record = events.find((e) => e.type === 'tool_call_record');
    expect(
      (record as { payload: { generated_files?: unknown[] } }).payload
        .generated_files,
    ).toEqual([file]);
  });
});
