import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useAccessToken } from './auth';
import { useCallback } from 'react';

export function useTmsQuery<T>(
  key: readonly unknown[],
  fetcher: (token: string) => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>,
) {
  const getToken = useAccessToken();
  const queryFn = useCallback(async () => {
    const token = await getToken();
    return fetcher(token);
  }, [getToken, fetcher]);

  return useQuery<T, Error>({
    queryKey: key,
    queryFn,
    ...options,
  });
}
