import { renderHook } from '@testing-library/react';

import { useReplyCompleteNotification } from '@/client/hooks/ui/useReplyCompleteNotification';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = { notifyOnReplyComplete: true };

vi.mock('@/client/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: typeof settings) => unknown) =>
    selector(settings),
}));

interface FakeOptions {
  body?: string;
  tag?: string;
}

let created: FakeNotification[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: FakeOptions,
  ) {
    created.push(this);
  }
}

function setAway(away: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (away ? 'hidden' : 'visible'),
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(!away);
}

describe('useReplyCompleteNotification', () => {
  beforeEach(() => {
    created = [];
    settings.notifyOnReplyComplete = true;
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
    setAway(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The transition is the event, not the value. */
  it('notifies when streaming stops', () => {
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    expect(created).toHaveLength(0);

    rerender({ streaming: false });
    expect(created).toHaveLength(1);
  });

  it('does not notify on mount, when nothing was streaming', () => {
    // The guard that matters most: without it, every page load and every
    // unrelated re-render of the chat would raise a notification for a reply
    // that finished long ago.
    renderHook(() => useReplyCompleteNotification(false));
    expect(created).toHaveLength(0);
  });

  it('does not notify while the reply is still streaming', () => {
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: true });
    expect(created).toHaveLength(0);
  });

  it('notifies once per reply, not on every later render', () => {
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: false });
    rerender({ streaming: false });
    expect(created).toHaveLength(1);
  });

  it('stays silent when the user is looking at the reply', () => {
    setAway(false);
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: false });
    expect(created).toHaveLength(0);
  });

  it('stays silent when the setting is off', () => {
    settings.notifyOnReplyComplete = false;
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: false });
    expect(created).toHaveLength(0);
  });

  it('stays silent when permission was not granted', () => {
    FakeNotification.permission = 'denied';
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: false });
    expect(created).toHaveLength(0);
  });

  it('does not throw where the Notification API does not exist', () => {
    // Safari on iOS has no Notification in a normal tab. A feature nobody
    // asked for must not break the chat on the browser that lacks it.
    vi.stubGlobal('Notification', undefined);
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    expect(() => rerender({ streaming: false })).not.toThrow();
  });

  it('focuses this window and dismisses itself when clicked', () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: false });

    created[0].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(created[0].close).toHaveBeenCalled();
  });

  it('replaces the previous notification rather than stacking them', () => {
    // A `tag` means a second finished reply supersedes the first instead of
    // leaving a pile of identical banners in the notification centre.
    const { rerender } = renderHook(
      ({ streaming }) => useReplyCompleteNotification(streaming),
      { initialProps: { streaming: true } },
    );
    rerender({ streaming: false });
    expect(created[0].options?.tag).toBeTruthy();
  });
});
