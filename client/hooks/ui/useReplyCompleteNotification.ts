'use client';

import { useEffect, useRef } from 'react';

import { useTranslations } from 'next-intl';

import {
  NotificationPermissionState,
  isAway,
  replyNotificationDecision,
} from '@/lib/utils/shared/replyNotification';

import { useSettingsStore } from '@/client/stores/settingsStore';

/**
 * One notification replaces the last. Without a tag, someone who steps away
 * for an hour returns to a stack of identical banners.
 */
const TAG = 'msf-assistant-reply-complete';

/**
 * Raise a desktop notification when a reply finishes and the user is not
 * looking.
 *
 * SCOPE, because the gap is easy to mistake for a bug: this fires when the
 * assistant's TURN ends. It says nothing about work that outlives the turn —
 * a `/translate` job runs for minutes after the reply is complete, and
 * nothing here (or anywhere else in the app) will announce that it finished.
 *
 * The transition is the event, not the value: `isStreaming` is false for the
 * whole life of an idle tab, so notifying on the value would fire on every
 * page load and every unrelated re-render.
 */
export function useReplyCompleteNotification(isStreaming: boolean): void {
  const enabled = useSettingsStore((s) => s.notifyOnReplyComplete);
  const t = useTranslations('notifications');
  const wasStreaming = useRef(false);

  useEffect(() => {
    const finished = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;
    if (!finished) return;

    // Read through the global rather than closing over it: tests stub it, and
    // a browser without the API leaves it undefined entirely.
    const api = typeof window === 'undefined' ? undefined : window.Notification;
    const decision = replyNotificationDecision({
      enabled,
      supported: typeof api === 'function',
      permission: (api?.permission ?? 'denied') as NotificationPermissionState,
      away: isAway(document),
    });
    if (decision !== 'notify') return;

    try {
      const notification = new api!(t('replyCompleteTitle'), {
        body: t('replyCompleteBody'),
        tag: TAG,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Constructing a Notification throws on browsers that expose the API
      // but only permit it from a service worker (Chrome on Android). There
      // is nothing to recover, and a finished reply must not become an error.
    }
  }, [isStreaming, enabled, t]);
}
