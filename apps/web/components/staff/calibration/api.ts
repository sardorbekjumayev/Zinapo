'use client';

import type { CalibrationRun } from '@/lib/report-types';

export type CalibrationMethod = CalibrationRun['method'];

/** `code` is the API's `error` (METHOD_NOT_AVAILABLE, NO_SEASON, NOT_FOUND…). */
export class CalibrationApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CalibrationApiError';
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CalibrationApiError('NETWORK');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new CalibrationApiError(
      typeof json.error === 'string' ? json.error : res.status === 403 ? 'FORBIDDEN' : 'UNKNOWN',
    );
  }
  return json as T;
}

export const calibrationApi = {
  trigger: (method: CalibrationMethod, grade?: number) =>
    post<{ runs: string[] }>('/api/staff/calibration-runs', grade === undefined ? { method } : { method, grade }),
  makeCurrent: (id: string) => post<CalibrationRun[]>(`/api/staff/calibration-runs/${encodeURIComponent(id)}/current`),
};
