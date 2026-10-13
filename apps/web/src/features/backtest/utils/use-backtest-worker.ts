'use client';

import type { PipelineConfig } from '@stock-checker/core/src/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BacktestDataPayload,
  BacktestWorkerRequest,
  BacktestWorkerResponse,
  RunResultDTO,
} from '@/features/backtest/types/protocol';

export interface BacktestWorkerState {
  status: 'idle' | 'running';
  result: RunResultDTO | null;
  error: string | null;
}

export function useBacktestWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<BacktestWorkerState>({
    status: 'idle',
    result: null,
    error: null,
  });

  const terminate = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => terminate, [terminate]);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../worker/backtest-worker.ts', import.meta.url));
      workerRef.current.onmessage = (event: MessageEvent<BacktestWorkerResponse>) => {
        const msg = event.data;
        setState((prev) => {
          switch (msg.type) {
            case 'run-result':
              return { ...prev, status: 'idle', result: msg.result, error: null };
            case 'error':
              return { ...prev, status: 'idle', error: msg.message };
            default:
              return prev;
          }
        });
      };
      workerRef.current.onerror = (event) => {
        setState((prev) => ({
          ...prev,
          status: 'idle',
          error: event.message || 'Worker crashed',
        }));
      };
    }
    return workerRef.current;
  }, []);

  const run = useCallback(
    (data: BacktestDataPayload, config: PipelineConfig) => {
      setState((prev) => ({ ...prev, status: 'running', error: null }));
      const request: BacktestWorkerRequest = { type: 'run', data, config };
      getWorker().postMessage(request);
    },
    [getWorker]
  );

  const cancel = useCallback(() => {
    terminate();
    setState((prev) => ({ ...prev, status: 'idle' }));
  }, [terminate]);

  return { state, run, cancel };
}
