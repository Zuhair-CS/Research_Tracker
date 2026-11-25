import { useCallback, useEffect, useState, type DependencyList } from 'react';
import { api, errorMessage } from './api/client';
import type { Department } from './types';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Loads data with an async function, re-running when `deps` change or reload() is called. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fn().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (err: unknown) => !cancelled && setState((s) => ({ ...s, error: errorMessage(err), loading: false })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setVersion((v) => v + 1);
  }, []);

  return { ...state, reload };
}

export function useDepartments(): Department[] {
  const { data } = useAsync(() => api<{ items: Department[] }>('/departments'), []);
  return data?.items ?? [];
}
