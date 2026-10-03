import { startStdioServer } from '@mcp/stdio.ts';

try {
  await startStdioServer();
} catch {
  process.stderr.write('Unable to start the stock-checker MCP server.\n');
  process.exitCode = 1;
}
