'use client';

import type { PipelineConfig } from '@stock-checker/core/src/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BacktestDataPayload,
  BacktestWorkerRequest,
  BacktestWorkerResponse,
  RunResultDTO,
} from '@/features/backtest/types/protocol';

interface OptimizeState {
  trial: number;
  nTrials: number;
  bestValue: number;
}

export interface BacktestWorkerState {
  status: 'idle' | 'running' | 'optimizing';
  result: RunResultDTO | null;
  optimizeProgress: OptimizeState | null;
  bestParams: PipelineConfig | null;
  error: string | null;
}

export function useBacktestWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<BacktestWorkerState>({
    status: 'idle',
    result: null,
    optimizeProgress: null,
    bestParams: null,
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
            case 'progress':
              return {
                ...prev,
                optimizeProgress: {
                  trial: msg.trial,
                  nTrials: msg.nTrials,
                  bestValue: msg.bestValue,
                },
              };
            case 'optimize-result':
              return {
                ...prev,
                status: 'idle',
                bestParams: msg.bestParams,
                optimizeProgress: null,
                error: null,
              };
            case 'error':
              return { ...prev, status: 'idle', optimizeProgress: null, error: msg.message };
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

  const optimize = useCallback(
    (data: BacktestDataPayload, nTrials: number) => {
      setState((prev) => ({
        ...prev,
        status: 'optimizing',
        optimizeProgress: { trial: 0, nTrials, bestValue: Number.NEGATIVE_INFINITY },
        error: null,
      }));
      const request: BacktestWorkerRequest = { type: 'optimize', data, nTrials };
      getWorker().postMessage(request);
    },
    [getWorker]
  );

  const cancel = useCallback(() => {
    terminate();
    setState((prev) => ({ ...prev, status: 'idle', optimizeProgress: null }));
  }, [terminate]);

  return { state, run, optimize, cancel };
}
