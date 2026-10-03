import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  deserializeMessage,
  type JSONRPCMessage,
  type JSONRPCResponse,
} from '@modelcontextprotocol/server';

const fixturePath = fileURLToPath(new URL('./test-fixtures/stdio-server.ts', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('MCP stdio', () => {
  test('SDK client discovers and calls the tool while console logs stay on stderr', async () => {
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixturePath],
      cwd: repositoryRoot,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (data) => {
      stderr += String(data);
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools[0]?.name).toBe('analyze_stock');
      expect(tools[1]?.name).toBe('open_stock_dashboard');
      const result = await client.callTool({
        name: 'analyze_stock',
        arguments: { ticker: 'AAPL' },
      });
      expect(result).toMatchObject({
        isError: false,
        structuredContent: { report: { ticker: 'AAPL', status: 'available', valuation: null } },
      });
      expect(JSON.stringify(result)).not.toContain('fixture-secret');
      expect(
        await client.callTool({ name: 'open_stock_dashboard', arguments: { ticker: '^gspc' } })
      ).toMatchObject({
        isError: false,
        structuredContent: {
          ticker: '^GSPC',
          url: 'http://localhost:5100/%5EGSPC',
          opened: true,
          readiness: 'listening',
        },
      });
      expect(
        await client.callTool({ name: 'analyze_stock', arguments: { ticker: 'FAIL' } })
      ).toMatchObject({ isError: true });
      for (
        let retry = 0;
        retry < 100 && !stderr.includes('Failed to fetch historical prices from Yahoo');
        retry++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await client.close();
    }
    expect(stderr).toContain('fixture report log on stderr');
    expect(stderr).toContain('fixture Bun console.write on stderr');
    expect(stderr).toContain('fixture Yahoo logger on stderr');
    expect(stderr).toContain('Failed to fetch historical prices from Yahoo');
    expect(stderr).not.toContain('fixture-secret');
  });

  test.each(['2024-11-05', '2025-11-25'])(
    'supports local clients using protocol %s with only JSON-RPC on stdout',
    async (protocolVersion) => {
      const child = spawn(process.execPath, [fixturePath], {
        cwd: repositoryRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const lines = createInterface({ input: child.stdout });
      const stdout: JSONRPCMessage[] = [];
      const invalidLines: string[] = [];
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr += String(data);
      });
      const pending = new Map<number, (message: JSONRPCResponse) => void>();
      lines.on('line', (line) => {
        try {
          const message = deserializeMessage(line);
          stdout.push(message);
          if (
            'id' in message &&
            typeof message.id === 'number' &&
            ('result' in message || 'error' in message)
          ) {
            pending.get(message.id)?.(message);
          }
        } catch {
          invalidLines.push(line);
        }
      });
      function request(id: number, method: string, params?: object): Promise<JSONRPCResponse> {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Timed out awaiting ${method}`)), 5000);
          pending.set(id, (message) => {
            clearTimeout(timeout);
            pending.delete(id);
            resolve(message);
          });
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
      }
      try {
        const initialized = await request(1, 'initialize', {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'legacy-client-test', version: '1.0.0' },
        });
        expect(initialized).toMatchObject({
          result: {
            protocolVersion,
            instructions: expect.stringContaining('not success probabilities'),
          },
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
        );
        expect(await request(2, 'tools/list')).toMatchObject({
          result: {
            tools: [
              { name: 'analyze_stock' },
              { name: 'open_stock_dashboard' },
              { name: 'show_stock_dashboard' },
            ],
          },
        });
        const result = await request(3, 'tools/call', {
          name: 'analyze_stock',
          arguments: { ticker: 'aapl' },
        });
        expect(result).toMatchObject({
          result: {
            isError: false,
            structuredContent: { report: { ticker: 'AAPL', status: 'available', valuation: null } },
          },
        });
        expect(JSON.stringify(result)).not.toContain('fixture-secret');
        expect(
          await request(4, 'tools/call', { name: 'analyze_stock', arguments: { ticker: 'FAIL' } })
        ).toMatchObject({ result: { isError: true } });
        expect(
          await request(5, 'tools/call', {
            name: 'open_stock_dashboard',
            arguments: { ticker: '^gspc' },
          })
        ).toMatchObject({
          result: {
            isError: false,
            structuredContent: {
              ticker: '^GSPC',
              url: 'http://localhost:5100/%5EGSPC',
              opened: true,
              readiness: 'listening',
            },
          },
        });
        expect(
          await request(6, 'tools/call', {
            name: 'show_stock_dashboard',
            arguments: { ticker: 'spcx' },
          })
        ).toMatchObject({
          result: {
            isError: false,
            structuredContent: { report: { ticker: 'SPCX' }, chart: { status: 'available' } },
          },
        });
        expect(
          await request(7, 'resources/read', { uri: 'ui://stock-checker/dashboard' })
        ).toMatchObject({
          result: {
            contents: [
              {
                mimeType: 'text/html;profile=mcp-app',
                text: expect.stringContaining('ui/initialize'),
              },
            ],
          },
        });
        expect(invalidLines).toEqual([]);
        expect(stdout.length).toBeGreaterThanOrEqual(3);
      } finally {
        lines.close();
        child.stdin.end();
        child.kill();
      }
      expect(stderr).toContain('fixture report log on stderr');
      expect(stderr).not.toContain('fixture-secret');
    }
  );
});
