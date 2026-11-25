import { Link } from 'react-router';
import { api } from '../api/client';
import { AlertCircleIcon, CheckIcon } from '../components/Icons';
import { LoadingState } from '../components/LoadingState';
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
        <div className="page-title-group">
          <span className="eyebrow">Inbox</span>
          <h1>Notifications</h1>
          <p className="page-subtitle">Updates on claim requests, researcher access approvals, and system notices.</p>
        </div>
        {data && data.unread > 0 && (
          <button className="btn" type="button" onClick={() => void markAll()}>
            <CheckIcon size={15} />
            <span>Mark all as read</span>
          </button>
        )}
      </div>
      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}
      <div className="card table-card">
        {loading && !data && <LoadingState />}
        {data && data.items.length === 0 && <p className="muted empty-state">You have no notifications.</p>}
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
