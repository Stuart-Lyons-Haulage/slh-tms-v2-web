export type ProgressRefreshEnvelope = {
  warning?: string;
  degraded?: boolean;
  source?: string;
  [key: string]: unknown;
};

export function isDegradedProgressRefresh(value: ProgressRefreshEnvelope): boolean {
  return value?.degraded === true || typeof value?.warning === 'string' && value.warning.length > 0 && value?.source === 'fallback';
}
