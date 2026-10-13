import { afterEach, describe, expect, it } from 'vitest';
import { parsePositionsArguments, runPositionsCommand } from '@/commands/positions';
import {
  cleanupRoots,
  JOB_A,
  temporaryRoot,
  writeFixtureJob,
} from '@/positions/fixtures.test-helpers';

const NOW = new Date('2026-10-06T22:00:00Z');

afterEach(cleanupRoots);

describe('parsePositionsArguments', () => {
  it('accepts the five subcommands with their required options', () => {
    expect(parsePositionsArguments(['list'])).toEqual({ command: 'list', json: false });
    expect(parsePositionsArguments(['digest', '--json'])).toEqual({
      command: 'digest',
      json: true,
    });
    expect(
      parsePositionsArguments([
        'record-fill',
        '--ticker=AAPL',
        '--session=2026-10-02',
        '--price=123.45',
        '--size=10',
        '--note=broker A',
      ])
    ).toEqual({
      command: 'record-fill',
      json: false,
      ticker: 'AAPL',
      session: '2026-10-02',
      price: 123.45,
      size: 10,
      note: 'broker A',
    });
    expect(
      parsePositionsArguments(['close', '--ticker=AAPL', '--session=2026-10-02', '--price=1'])
    ).toMatchObject({
      command: 'close',
      price: 1,
    });
  });

  it('rejects unknown commands, missing or duplicate options, and non-positive numbers', () => {
    for (const arguments_ of [
      [],
      ['send'],
      ['record-fill', '--ticker=AAPL', '--session=2026-10-02', '--price=1'],
      ['close', '--ticker=AAPL', '--price=1'],
      ['close', '--ticker=AAPL', '--ticker=MSFT', '--session=2026-10-02', '--price=1'],
      ['close', '--ticker=AAPL', '--session=2026-10-02', '--price=-1'],
      ['list', '--ticker=AAPL'],
      ['list', '--force'],
    ]) {
      expect(() => parsePositionsArguments(arguments_)).toThrow(TypeError);
    }
  });
});

describe('runPositionsCommand', () => {
  it('syncs, lists, records fills and closes against an isolated ledger root', async () => {
    const { market, positions } = await temporaryRoot();
    await writeFixtureJob(market, {
      id: JOB_A,
      createdAt: '2026-10-03T22:05:00Z',
      notification: { status: 'accepted' },
      matches: [{ index: 0, ticker: 'AAPL', dataAsOf: '2026-10-02' }],
    });
    const dependencies = {
      marketRootDirectory: market,
      positionsRootDirectory: positions,
      environment: {},
      now: () => NOW,
    };
    expect(await runPositionsCommand({ command: 'list', json: false }, dependencies)).toBe(
      '기록된 포지션 없음.'
    );
    expect(await runPositionsCommand({ command: 'sync', json: false }, dependencies)).toContain(
      '새 포지션 1개'
    );
    expect(await runPositionsCommand({ command: 'list', json: false }, dependencies)).toContain(
      'AAPL 2026-10-02 · 보유 중 2/5일차 · 진입 10-05(월) 시가 (시드니 10-06 00:30) · 청산 10-09(금) 종가 (시드니 10-10 07:00) · 아침 보고'
    );
    expect(
      await runPositionsCommand(
        {
          command: 'record-fill',
          json: false,
          ticker: 'AAPL',
          session: '2026-10-02',
          price: 100,
          size: 3,
        },
        dependencies
      )
    ).toContain('체결 100.00 × 3주');
    const digest = await runPositionsCommand({ command: 'digest', json: false }, dependencies);
    expect(digest).toContain('*AAPL · 보유 중*');
    expect(digest).toContain('체결 100.00 × 3주');
    expect(
      await runPositionsCommand(
        { command: 'close', json: false, ticker: 'AAPL', session: '2026-10-02', price: 102 },
        dependencies
      )
    ).toContain('청산 완료 102.00');
    const listed = JSON.parse(
      await runPositionsCommand({ command: 'list', json: true }, dependencies)
    );
    expect(listed.entries[0].close.price).toBe(102);
  });
});
