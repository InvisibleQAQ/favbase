import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseRetryCountdownReturn {
  countdown: number;
  startCountdown: (seconds: number) => void;
  resetCountdown: () => void;
}

export function useRetryCountdown(): UseRetryCountdownReturn {
  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetCountdown = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setCountdown(0);
  }, []);

  const startCountdown = useCallback((seconds: number) => {
    resetCountdown();
    let remaining = seconds;
    setCountdown(remaining);
    intervalRef.current = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setCountdown(0);
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [resetCountdown]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { countdown, startCountdown, resetCountdown };
}
