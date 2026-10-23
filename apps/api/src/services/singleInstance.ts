import { createServer } from 'node:net';

export async function ensureSingleInstance(port: number): Promise<void> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `[singleInstance] port ${port} already in use. ` +
            `Kill the old process or set PORT to another value. Exiting.`,
        );
        process.exit(1);
      }
      if (err.code === 'EACCES') {
        console.error(
          `[singleInstance] port ${port} permission denied (EACCES). ` +
            `On Windows this often means Hyper-V reserved the port range — ` +
            `run: netsh interface ipv4 show excludedportrange protocol=tcp ` +
            `then set PORT outside those ranges. Exiting.`,
        );
        process.exit(1);
      }
      console.error('[singleInstance] unexpected error', err);
      process.exit(1);
    });
    tester.once('listening', () => {
      tester.close(() => resolve());
    });
    tester.listen(port);
  });
}