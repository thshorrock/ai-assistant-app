/**
 * Whether to raise a desktop notification when a reply finishes.
 *
 * Split out from the hook and kept pure so the rules are testable without a
 * browser. The rules themselves are the whole feature: a notification that
 * fires while the user is reading the reply is noise, and one that never
 * fires is indistinguishable from a bug.
 */

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

/** Why a reply did or did not notify. `notify` is the only acting value. */
export type ReplyNotificationDecision =
  | 'notify'
  | 'unsupported'
  | 'disabled'
  | 'not-permitted'
  | 'focused';

export interface ReplyNotificationInput {
  /** The user's setting. Off by default: this is opt-in. */
  enabled: boolean;
  /** Whether the Notification API exists at all. */
  supported: boolean;
  permission: NotificationPermissionState;
  /** Whether the user is looking somewhere else — see `isAway`. */
  away: boolean;
}

export function replyNotificationDecision({
  enabled,
  supported,
  permission,
  away,
}: ReplyNotificationInput): ReplyNotificationDecision {
  // Support first, so the reason is the actionable one. Reporting "disabled"
  // on a browser with no Notification API sends someone to a settings toggle
  // that cannot help them.
  if (!supported) return 'unsupported';
  if (!enabled) return 'disabled';
  if (permission !== 'granted') return 'not-permitted';
  // Do not interrupt someone who is already reading the answer.
  if (!away) return 'focused';
  return 'notify';
}

/**
 * Is the user looking somewhere else?
 *
 * `document.hidden` alone is not enough: a tab can be the active tab of a
 * window sitting behind the user's editor, where visibilityState is 'visible'
 * and the person still cannot see the reply. That is precisely the case this
 * feature exists for, so window focus is checked too.
 *
 * `hasFocus` is guarded because jsdom and some embedded webviews do not
 * implement it; without it, visibility is the only signal available.
 */
export function isAway(doc: Document): boolean {
  if (doc.visibilityState === 'hidden') return true;
  return typeof doc.hasFocus === 'function' ? !doc.hasFocus() : false;
}
