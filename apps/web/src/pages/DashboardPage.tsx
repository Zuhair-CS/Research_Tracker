import { api } from '../api/client';
import { CountChart } from '../components/CountChart';
import { useAsync } from '../hooks';
import { typeLabel, type Stats } from '../types';

export function DashboardPage() {
  const { data, error, loading } = useAsync(() => api<Stats>('/admin/stats'), []);

  return (
    <section>
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="actions">
          <a className="btn" href="/api/reports/summary.csv" download>
            Export summary CSV
          </a>
          <a className="btn" href="/api/reports/publications.csv" download>
            Export all publications CSV
          </a>
        </div>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="tiles">
            <div className="card tile">
              <span className="tile-label">Publications</span>
              <span className="tile-value">{data.totals.publications}</span>
            </div>
            <div className="card tile">
              <span className="tile-label">Active researchers</span>
              <span className="tile-value">{data.totals.researchers}</span>
            </div>
            <div className="card tile">
              <span className="tile-label">Departments publishing</span>
              <span className="tile-value">
                {data.byDepartment.filter((d) => d.count > 0).length}
                <span className="tile-of"> of {data.byDepartment.length}</span>
              </span>
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
