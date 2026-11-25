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
    <NavLink to="/notifications" className="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} title="Notifications">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
    </NavLink>
  );
}
