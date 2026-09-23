import { useCallback, useEffect, useRef, useState } from 'react';
import { DataIntegrityError } from '../api/apiClient';
import { isDegradedProgressRefresh, type ProgressRefreshEnvelope } from '../liveProgressStabilityPatch';

export interface UseApiResult<T> {
  data: T | undefined;
  error: string | undefined;
  dataProblem: DataIntegrityError | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
}

const warmApiCache = new Map<string, unknown>();
export const SILENT_API_REFRESH_EVENT = 'slh:silent-api-refresh';

function warmCacheKey(load: () => Promise<unknown>) {
  const source = Function.prototype.toString.call(load);
  if (source.includes('tv-display/planned-runs') && source.includes('driver-assignments')) return 'operations-wallboard-base';
  return undefined;
}

export function useApi<T>(load: () => Promise<T>): UseApiResult<T> {
  const cacheKey = useRef<string | undefined>(warmCacheKey(load as () => Promise<unknown>));
  const initialData = cacheKey.current ? warmApiCache.get(cacheKey.current) as T | undefined : undefined;
  const [data, setData] = useState<T | undefined>(() => initialData);
  const [error, setError] = useState<string>();
  const [dataProblem, setDataProblem] = useState<DataIntegrityError>();
  const [loading, setLoading] = useState(!initialData);
  const requestNumber = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const hasData = useRef(Boolean(initialData));
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const request = ++requestNumber.current;
    const operation = (async () => {
      // Once data is already rendered, refresh it in place. This avoids replacing an
      // operational screen with a loading shell during normal background reconciliation.
      if (!hasData.current) setLoading(true);
      setError(undefined);
      setDataProblem(undefined);
      try {
        const result = await load();
        if (mounted.current && request === requestNumber.current) {
          const progressEnvelope = result as unknown as ProgressRefreshEnvelope;
          if (isDegradedProgressRefresh(progressEnvelope)) {
            setData(current => current ?? result);
            if (!hasData.current) hasData.current = true;
            setError(progressEnvelope.warning || 'Live progression refresh degraded; the last confirmed progression remains on screen.');
          } else {
            setData(result);
            hasData.current = true;
            if (cacheKey.current) warmApiCache.set(cacheKey.current, result);
          }
        }
      } catch (exception: unknown) {
        if (mounted.current && request === requestNumber.current) {
          if (exception instanceof DataIntegrityError) {
            setDataProblem(exception);
            setError(`Data problem: ${exception.summary || exception.message}`);
          } else {
            setError(exception instanceof Error ? exception.message : 'Unable to load this view.');
          }
        }
      } finally {
        if (mounted.current && request === requestNumber.current) setLoading(false);
      }
    })();
    inFlight.current = operation;
    try { await operation; }
    finally { if (inFlight.current === operation) inFlight.current = null; }
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    const onSilentRefresh = () => { void refresh(); };
    window.addEventListener(SILENT_API_REFRESH_EVENT, onSilentRefresh);
    void refresh();
    return () => {
      mounted.current = false;
      window.removeEventListener(SILENT_API_REFRESH_EVENT, onSilentRefresh);
    };
  }, [refresh]);
  return { data, error, dataProblem, loading, refresh };
}