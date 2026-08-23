import { fireEvent, render, screen } from '@testing-library/react';

import { ReplyNotificationSetting } from '@/components/Settings/ReplyNotificationSetting';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = {
  notifyOnReplyComplete: false,
  setNotifyOnReplyComplete: vi.fn(),
};

vi.mock('@/client/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: typeof settings) => unknown) =>
    selector(settings),
}));

let requestPermission: ReturnType<typeof vi.fn>;

function stubNotification(permission: NotificationPermission | null) {
  if (permission === null) {
    vi.stubGlobal('Notification', undefined);
    return;
  }
  requestPermission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('Notification', { permission, requestPermission });
}

describe('ReplyNotificationSetting', () => {
  beforeEach(() => {
    settings.notifyOnReplyComplete = false;
    settings.setNotifyOnReplyComplete = vi.fn();
    stubNotification('default');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks the browser for permission when switched on', async () => {
    render(<ReplyNotificationSetting />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(requestPermission).toHaveBeenCalled();
    // Permission is granted, so the setting follows.
    await vi.waitFor(() =>
      expect(settings.setNotifyOnReplyComplete).toHaveBeenCalledWith(true),
    );
  });

  it('does not enable the setting when permission is refused', async () => {
    stubNotification('default');
    requestPermission.mockResolvedValue('denied');

    render(<ReplyNotificationSetting />);
    fireEvent.click(screen.getByRole('checkbox'));

    // The whole point: a setting that reads ON while the browser will never
    // deliver anything is a lie the user cannot debug.
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalled());
    expect(settings.setNotifyOnReplyComplete).not.toHaveBeenCalledWith(true);
    expect(await screen.findByText(/blocking notifications/i)).toBeTruthy();
  });

  it('switches off without asking for anything', () => {
    settings.notifyOnReplyComplete = true;
    render(<ReplyNotificationSetting />);
    fireEvent.click(screen.getByRole('checkbox'));

    expect(settings.setNotifyOnReplyComplete).toHaveBeenCalledWith(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('does not ask again when permission is already granted', async () => {
    stubNotification('granted');
    render(<ReplyNotificationSetting />);
    fireEvent.click(screen.getByRole('checkbox'));

    await vi.waitFor(() =>
      expect(settings.setNotifyOnReplyComplete).toHaveBeenCalledWith(true),
    );
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('disables itself and says so where the browser has no Notification API', () => {
    stubNotification(null);
    render(<ReplyNotificationSetting />);

    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
    expect(screen.getByText(/does not support/i)).toBeTruthy();
  });
});
