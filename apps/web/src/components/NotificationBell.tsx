import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { api } from '../api/client';

const EVENT = 'pubtrack:notifications-changed';

/** Call after marking notifications read so the bell updates immediately. */
export function notifyUnreadChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** Bell with the unread count; refreshes on navigation, on a timer and when notifications change. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  const location = useLocation();

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(EVENT, bump);
    const timer = window.setInterval(bump, 60_000);
    return () => {
      window.removeEventListener(EVENT, bump);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ unread: number }>('/notifications/unread-count').then(
      (r) => !cancelled && setUnread(r.unread),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [location.pathname, tick]);

  return (
    <NavLink
      to="/notifications"
      className="bell icon-btn"
      aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      title="Notifications"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
    </NavLink>
  );
}
