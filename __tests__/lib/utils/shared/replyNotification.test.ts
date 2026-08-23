import {
  isAway,
  replyNotificationDecision,
} from '@/lib/utils/shared/replyNotification';

import { describe, expect, it } from 'vitest';

/**
 * The decision is pure and returns a REASON, not a boolean.
 *
 * Every one of these branches is a silent no-op in the browser — a
 * notification that does not appear looks identical whether the user denied
 * permission, the tab was focused, or the feature was off. A reason string is
 * what makes that difference visible to a test and to a log line.
 */
describe('replyNotificationDecision', () => {
  const away = {
    enabled: true,
    supported: true,
    permission: 'granted' as const,
    away: true,
  };

  it('notifies when enabled, permitted, supported and the user is away', () => {
    expect(replyNotificationDecision(away)).toBe('notify');
  });

  it('says nothing when the user is already looking at the reply', () => {
    expect(replyNotificationDecision({ ...away, away: false })).toBe('focused');
  });

  it('does not notify when the setting is off', () => {
    expect(replyNotificationDecision({ ...away, enabled: false })).toBe(
      'disabled',
    );
  });

  it.each(['default', 'denied'] as const)(
    'does not notify on permission %s',
    (permission) => {
      expect(replyNotificationDecision({ ...away, permission })).toBe(
        'not-permitted',
      );
    },
  );

  it('reports lack of support ahead of every other reason', () => {
    // Support is checked FIRST so the reason is the actionable one: on a
    // browser with no Notification API, "disabled" would send someone to a
    // settings toggle that cannot help them.
    expect(
      replyNotificationDecision({
        enabled: false,
        supported: false,
        permission: 'denied',
        away: false,
      }),
    ).toBe('unsupported');
  });
});

/**
 * `document.hidden` alone is not "away". A tab can be the active tab of a
 * window that is behind the user's editor: visibilityState is 'visible' and
 * the person cannot see it. Both signals are needed.
 */
describe('isAway', () => {
  const doc = (visibilityState: string, focused: boolean) =>
    ({ visibilityState, hasFocus: () => focused }) as unknown as Document;

  it('is away when the tab is hidden', () => {
    expect(isAway(doc('hidden', false))).toBe(true);
  });

  it('is away when the tab is visible but the window is not focused', () => {
    expect(isAway(doc('visible', false))).toBe(true);
  });

  it('is not away when the tab is visible and focused', () => {
    expect(isAway(doc('visible', true))).toBe(false);
  });

  it('treats a document without hasFocus as away only when hidden', () => {
    expect(isAway({ visibilityState: 'visible' } as Document)).toBe(false);
    expect(isAway({ visibilityState: 'hidden' } as Document)).toBe(true);
  });
});
