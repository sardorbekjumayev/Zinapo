'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, StatusResponse, status as fetchStatus } from '@/lib/auth-api';

const FAST_INTERVAL = 2000;
const SLOW_INTERVAL = 5000;

/**
 * Polls /auth/telegram/status every 2 s until the code is out, then every 5 s
 * so a new code or a cancel from the bot still lands. Stops on any terminal
 * status. Swap for SSE later without touching the callers.
 */
export function useLoginStatus(requestId: string | null): {
  data: StatusResponse | null;
  error: ApiError | null;
} {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!requestId) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const tick = async (): Promise<void> => {
      try {
        const next = await fetchStatus(requestId);
        if (cancelled) return;
        setData(next);
        setError(null);
        if (next.terminal) return;
        timer.current = setTimeout(
          tick,
          next.status === 'CODE_SENT' ? SLOW_INTERVAL : FAST_INTERVAL,
        );
      } catch (err) {
        if (cancelled) return;
        const apiError = err instanceof ApiError ? err : new ApiError('NETWORK', 0);
        setError(apiError);
        // A transient network blip should not kill the flow; auth failures should.
        if (apiError.code === 'NETWORK') {
          timer.current = setTimeout(tick, SLOW_INTERVAL);
        }
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [requestId]);

  return { data, error };
}
