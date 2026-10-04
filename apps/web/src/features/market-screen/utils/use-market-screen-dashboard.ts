'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getMarketScreen,
  getMarketScreens,
  type MarketScreenJobSnapshot,
  type MarketScreenJobsResponse,
  type MarketScreenResultKind,
  pauseMarketScreen,
  resumeMarketScreen,
} from '@/lib/api';

export const MARKET_SCREEN_POLL_MS = 5_000;
const JOB_LIST_POLL_MS = 15_000;
export const MARKET_SCREEN_PAGE_SIZE = 20;
const terminal = (status: string) => ['completed', 'partial', 'unavailable'].includes(status);
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Retry to refresh.';

export function useMarketScreenDashboard() {
  const [jobsRead, setJobsRead] = useState<{ key: string; data: MarketScreenJobsResponse } | null>(
    null
  );
  const [jobsOffset, setJobsOffset] = useState(0);
  const [jobsFailure, setJobsFailure] = useState<{ key: string; message: string } | null>(null);
  const [listReload, setListReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<MarketScreenJobSnapshot | null>(null);
  const [kind, setKind] = useState<MarketScreenResultKind>('matches');
  const [offset, setOffset] = useState(0);
  const [jobFailure, setJobFailure] = useState<{ key: string; message: string } | null>(null);
  const [jobReload, setJobReload] = useState(0);
  const [settledJobKey, setSettledJobKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const jobController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const listKey = [jobsOffset, listReload].join(':');
  const jobKey = [selectedId, kind, offset, jobReload].join(':');
  const jobs = jobsRead?.key === listKey ? jobsRead.data : null;
  const jobsError = jobsFailure?.key === listKey ? jobsFailure.message : null;
  const jobError = jobFailure?.key === jobKey ? jobFailure.message : null;
  const jobLoading = selectedId !== null && settledJobKey !== jobKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actionController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await getMarketScreens({
          offset: jobsOffset,
          limit: MARKET_SCREEN_PAGE_SIZE,
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;
        setJobsRead({ key: listKey, data: result });
        setJobsFailure(null);
        if (selectedRef.current === null && result.jobs.length) {
          selectedRef.current = result.jobs[0].id;
          setSelectedId(result.jobs[0].id);
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted)
          setJobsFailure({ key: listKey, message: message(error) });
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), JOB_LIST_POLL_MS);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobsOffset, listKey]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    jobController.current = controller;
    let finished = false;
    async function poll() {
      try {
        const result = await getMarketScreen(selectedId as string, {
          kind,
          offset,
          limit: MARKET_SCREEN_PAGE_SIZE,
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted || selectedRef.current !== selectedId) return;
        setSnapshot(result);
        setJobFailure(null);
        finished = terminal(result.job.status);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted)
          setJobFailure({ key: jobKey, message: message(error) });
      } finally {
        if (!cancelled) {
          setSettledJobKey(jobKey);
          if (!finished && !controller.signal.aborted)
            timer = setTimeout(() => void poll(), MARKET_SCREEN_POLL_MS);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedId, kind, offset, jobKey]);

  function selectJob(id: string) {
    if (id === selectedRef.current) return;
    actionController.current?.abort();
    jobController.current?.abort();
    selectedRef.current = id;
    setSelectedId(id);
    setSnapshot(null);
    setKind('matches');
    setOffset(0);
    setPendingAction(null);
    setActionError(null);
    setJobFailure(null);
  }

  function selectKind(next: MarketScreenResultKind) {
    setKind(next);
    setOffset(0);
  }

  async function control(action: 'pause' | 'resume') {
    if (!selectedId || pendingAction) return;
    const id = selectedId;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    // A pre-control GET must not restore an older status after this mutation.
    jobController.current?.abort();
    setPendingAction(action);
    setActionError(null);
    try {
      const result = await (action === 'pause' ? pauseMarketScreen : resumeMarketScreen)(
        id,
        controller.signal
      );
      if (!mounted.current || controller.signal.aborted || selectedRef.current !== id) return;
      setSnapshot((previous) =>
        previous?.job.id === id ? { ...previous, job: result.job } : result
      );
      setListReload((value) => value + 1);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && selectedRef.current === id)
        setActionError(message(error));
    } finally {
      if (mounted.current && actionController.current === controller) {
        setPendingAction(null);
        setJobReload((value) => value + 1);
      }
    }
  }

  return {
    jobs,
    jobsOffset,
    jobsError,
    selectedId,
    snapshot,
    kind,
    offset,
    jobError,
    jobLoading,
    pendingAction,
    actionError,
    selectJob,
    selectKind,
    setOffset,
    setJobsOffset,
    control,
    retryList: () => setListReload((value) => value + 1),
    retryJob: () => setJobReload((value) => value + 1),
  };
}
