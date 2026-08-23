import { FC, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { NotificationPermissionState } from '@/lib/utils/shared/replyNotification';

import { useSettingsStore } from '@/client/stores/settingsStore';

/**
 * Opt-in for the reply-finished desktop notification.
 *
 * Store-driven and applied immediately, matching `AutoFetchLinksToggle` — the
 * legacy ChatSettings reducer/save plumbing is not extended for new settings.
 *
 * The permission prompt lives HERE rather than in the hook that notifies,
 * because browsers only grant permission from a user gesture. Asking at the
 * moment somebody ticks the box is both the only reliable time and the only
 * honest one.
 *
 * The setting is never left ON when the browser will not deliver: a control
 * that reads enabled while nothing can ever appear is a fault the user has no
 * way to diagnose.
 */
export const ReplyNotificationSetting: FC = () => {
  const t = useTranslations('notifications');
  const enabled = useSettingsStore((s) => s.notifyOnReplyComplete);
  const setEnabled = useSettingsStore((s) => s.setNotifyOnReplyComplete);

  // Resolved after mount: `Notification` does not exist during SSR, and
  // reading it in render would make the markup differ between server and
  // client.
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] =
    useState<NotificationPermissionState>('default');

  useEffect(() => {
    const api = window.Notification;
    setSupported(typeof api === 'function' || typeof api === 'object');
    if (api) setPermission(api.permission as NotificationPermissionState);
  }, []);

  const blocked = supported && permission === 'denied';

  const onChange = async (next: boolean) => {
    if (!next) {
      setEnabled(false);
      return;
    }
    const api = window.Notification;
    if (!api) return;

    let granted = api.permission as NotificationPermissionState;
    if (granted === 'default') {
      granted = (await api.requestPermission()) as NotificationPermissionState;
      setPermission(granted);
    }
    // Only follow through if the browser will actually deliver.
    if (granted === 'granted') setEnabled(true);
  };

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-black dark:text-white">
        {t('settingsTitle')}
      </h4>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-gray-600 dark:accent-gray-400"
          checked={enabled}
          disabled={!supported}
          onChange={(e) => void onChange(e.target.checked)}
        />
        <span>
          <span className="block text-sm text-black dark:text-gray-200">
            {t('settingsToggle')}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            {t('settingsDescription')}
          </span>
          {!supported && (
            <span className="mt-1 block text-xs text-amber-700 dark:text-amber-500">
              {t('unsupported')}
            </span>
          )}
          {blocked && (
            <span className="mt-1 block text-xs text-amber-700 dark:text-amber-500">
              {t('permissionBlocked')}
            </span>
          )}
        </span>
      </label>
    </div>
  );
};
