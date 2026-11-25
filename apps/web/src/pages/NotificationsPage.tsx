import { Link } from 'react-router';
import { api } from '../api/client';
import { notifyUnreadChanged } from '../components/NotificationBell';
import { useAsync } from '../hooks';
import type { AppNotification } from '../types';

export function NotificationsPage() {
  const { data, error, loading, reload } = useAsync(() => api<{ items: AppNotification[]; unread: number }>('/notifications'), []);

  const markRead = async (n: AppNotification) => {
    if (n.readAt) return;
    await api(`/notifications/${n.id}/read`, { method: 'POST' });
    notifyUnreadChanged();
  };
  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    notifyUnreadChanged();
    reload();
  };

  return (
    <section className="narrow-page">
      <div className="page-head">
        <h1>Notifications</h1>
        {data && data.unread > 0 && (
          <button className="btn" type="button" onClick={() => void markAll()}>
            Mark all as read
          </button>
        )}
      </div>
      {error && <p className="alert error">{error}</p>}
      <div className="card table-card">
        {loading && !data && <p className="muted pad">Loading…</p>}
        {data && data.items.length === 0 && <p className="muted pad">You have no notifications.</p>}
        <ul className="notice-list">
          {data?.items.map((n) => (
            <li key={n.id} className={n.readAt ? '' : 'unread'}>
              <span className="notice-dot" aria-label={n.readAt ? 'Read' : 'Unread'} />
              <div className="grow">
                <p>{n.message}</p>
                <span className="muted small">{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              {n.link ? (
                <Link className="btn small" to={n.link} onClick={() => void markRead(n)}>
                  Open
                </Link>
              ) : (
                !n.readAt && (
                  <button className="btn small ghost" type="button" onClick={() => void markRead(n).then(reload)}>
                    Mark read
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
