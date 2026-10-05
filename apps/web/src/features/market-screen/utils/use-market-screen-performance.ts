'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getMarketScreenPerformance,
  type MarketScreenPerformanceSnapshot,
  refreshMarketScreenPerformance,
} from '@/lib/api';

export const PAPER_OUTCOMES_PAGE_SIZE = 20;
export const PAPER_OUTCOMES_POLL_MS = 15_000;
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not read saved paper outcomes.';

export function useMarketScreenPerformance(jobId: string) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<{
    key: string;
    snapshot: MarketScreenPerformanceSnapshot;
  } | null>(null);
  const [readFailure, setReadFailure] = useState<{ key: string; message: string } | null>(null);
  const [refreshFailure, setRefreshFailure] = useState<{ jobId: string; message: string } | null>(
    null
  );
  const [refreshingJob, setRefreshingJob] = useState<string | null>(null);
  const readController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const activeJob = useRef<string | null>(null);
  const requestKey = [jobId, offset, revision].join(':');
  const snapshot = read?.snapshot.jobId === jobId ? read.snapshot : null;
  const readError = readFailure?.key === requestKey ? readFailure.message : null;
  const refreshError = refreshFailure?.jobId === jobId ? refreshFailure.message : null;
  const loading = read?.key !== requestKey && readFailure?.key !== requestKey;
  const refreshing = refreshingJob === jobId;

  useEffect(() => {
    activeJob.current = jobId;
    return () => {
      activeJob.current = null;
      readController.current?.abort();
      refreshController.current?.abort();
      refreshController.current = null;
    };
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    readController.current = controller;
    async function poll() {
      if (cancelled || controller.signal.aborted) return;
      try {
        const result = await getMarketScreenPerformance(jobId, {
          offset,
          limit: PAPER_OUTCOMES_PAGE_SIZE,
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted || activeJob.current !== jobId) return;
        setRead({ key: requestKey, snapshot: result });
        setReadFailure(null);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted && activeJob.current === jobId) {
          setReadFailure({ key: requestKey, message: message(error) });
        }
      } finally {
        if (!cancelled && !controller.signal.aborted)
          timer = setTimeout(() => void poll(), PAPER_OUTCOMES_POLL_MS);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, offset, requestKey]);

  async function refresh() {
    if (
      refreshController.current ||
      activeJob.current !== jobId ||
      snapshot?.refresh.status === 'running'
    )
      return;
    const controller = new AbortController();
    refreshController.current = controller;
    readController.current?.abort();
    setRefreshingJob(jobId);
    setRefreshFailure(null);
    try {
      const result = await refreshMarketScreenPerformance(jobId, {
        limit: PAPER_OUTCOMES_PAGE_SIZE,
        signal: controller.signal,
      });
      if (!controller.signal.aborted && activeJob.current === jobId) {
        setRead({ key: requestKey, snapshot: result });
        setReadFailure(null);
      }
    } catch (error) {
      if (!controller.signal.aborted && activeJob.current === jobId) {
        setRefreshFailure({ jobId, message: message(error) });
      }
    } finally {
      if (
        !controller.signal.aborted &&
        activeJob.current === jobId &&
        refreshController.current === controller
      ) {
        refreshController.current = null;
        setRefreshingJob(null);
        setRevision((value) => value + 1);
      }
    }
  }

  return {
    snapshot,
    offset,
    loading,
    refreshing,
    readError,
    refreshError,
    setOffset,
    refresh,
    retryRead: () => setRevision((value) => value + 1),
  };
}
