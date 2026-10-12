import { useCallback, useEffect, useRef, useState } from 'react';

/** Each request owns a signal; cancel also prevents late responses from entering UI state. */
export default function useCancelableAI() {
  const request = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const cancel = useCallback(() => {
    const active = Boolean(request.current);
    request.current?.abort(); request.current = null;
    setLoading(false); if (active) setNotice('Request cancelled. You can review the inputs and try again.');
  }, []);
  const run = useCallback(async (operation) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null); setResult(null); setNotice('');
    try {
      const value = await operation({ signal: controller.signal });
      if (controller.signal.aborted || request.current !== controller) return undefined;
      setResult(value); return value;
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller) setError(failure?.response?.data?.error || failure?.message || 'The AI request failed. Please try again.');
      return undefined;
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }, []);
  return { run, cancel, result, setResult, loading, error, setError, notice };
}
