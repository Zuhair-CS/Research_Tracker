import { api } from '../api/client';
import { CountChart } from '../components/CountChart';
import { AlertCircleIcon, BookOpenIcon, BuildingIcon, DownloadIcon, UsersIcon } from '../components/Icons';
import { LoadingState } from '../components/LoadingState';
import { useAsync } from '../hooks';
import { typeLabel, type Stats } from '../types';

export function DashboardPage() {
  const { data, error, loading } = useAsync(() => api<Stats>('/admin/stats'), []);
  const publishingDepts = data ? data.byDepartment.filter((d) => d.count > 0).length : 0;

  return (
    <section>
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">Institutional Analytics</span>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Overview of scholarly output across departments, publication types, and years.</p>
        </div>
        <div className="actions">
          <a className="btn" href="/api/reports/summary.csv" download>
            <DownloadIcon size={15} />
            <span>Export summary CSV</span>
          </a>
          <a className="btn primary" href="/api/reports/publications.csv" download>
            <DownloadIcon size={15} />
            <span>Export all publications CSV</span>
          </a>
        </div>
      </div>

      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}
      {loading && <LoadingState />}
      {data && (
        <>
          <div className="tiles">
            <div className="card tile">
              <div className="tile-head">
                <span className="tile-label">Publications</span>
                <span className="tile-icon" aria-hidden="true">
                  <BookOpenIcon size={15} />
                </span>
              </div>
              <span className="tile-value">{data.totals.publications.toLocaleString()}</span>
            </div>
            <div className="card tile">
              <div className="tile-head">
                <span className="tile-label">Active researchers</span>
                <span className="tile-icon" aria-hidden="true">
                  <UsersIcon size={15} />
                </span>
              </div>
              <span className="tile-value">{data.totals.researchers.toLocaleString()}</span>
            </div>
            <div className="card tile">
              <div className="tile-head">
                <span className="tile-label">Departments publishing</span>
                <span className="tile-icon" aria-hidden="true">
                  <BuildingIcon size={15} />
                </span>
              </div>
              <span className="tile-value">
                {publishingDepts}
                <span className="tile-of"> of {data.byDepartment.length}</span>
              </span>
              {data.byDepartment.length > 0 && (
                <progress className="tile-progress" value={publishingDepts} max={data.byDepartment.length} aria-label="Departments publishing ratio" />
              )}
            </div>
          </div>

          <div className="chart-grid">
            <CountChart
              title="Publications by department"
              orientation="horizontal"
              labelHeader="Department"
              data={[...data.byDepartment].sort((a, b) => b.count - a.count).map((d) => ({ label: d.name, count: d.count }))}
            />
            <CountChart
              title="Publications by type"
              orientation="horizontal"
              labelHeader="Type"
              data={data.byType.map((t) => ({ label: typeLabel(t.type), count: t.count }))}
            />
            <div className="span-2">
              <CountChart
                title="Publications by year"
                orientation="vertical"
                labelHeader="Year"
                data={data.byYear.map((y) => ({ label: String(y.year), count: y.count }))}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
