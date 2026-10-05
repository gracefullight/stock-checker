import { Console } from 'node:console';
import { format } from 'node:util';
import type { MarketScreenService } from '@mcp/market-screen.ts';
import type {
  DashboardGenerator,
  DashboardLauncher,
  ReportGenerator,
  ScreenGenerator,
} from '@mcp/server.ts';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

export async function startStdioServer(
  generator?: ReportGenerator,
  dashboardLauncher?: DashboardLauncher,
  dashboardGenerator?: DashboardGenerator,
  screenGenerator?: ScreenGenerator,
  marketScreenService?: MarketScreenService
): Promise<StdioServerHandle> {
  process.env.MCP_LOG_STDERR = '1';
  Object.assign(
    globalThis.console,
    new Console({ stdout: process.stderr, stderr: process.stderr }),
    { write: (...args: unknown[]) => process.stderr.write(format(...args)) }
  );

  const [{ serveStdio }, { createStockAnalystServer }] = await Promise.all([
    import('@modelcontextprotocol/server/stdio'),
    import('@mcp/server.ts'),
  ]);

  return serveStdio(
    () =>
      createStockAnalystServer(
        generator,
        dashboardLauncher,
        dashboardGenerator,
        screenGenerator,
        marketScreenService
      ),
    {
      legacy: 'serve',
      onerror: () => {
        process.stderr.write('stock-checker MCP transport error.\n');
      },
    }
  );
}
