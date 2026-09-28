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
      } else {
        console.error('[singleInstance] unexpected error', err);
        process.exit(1);
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolve());
    });
    tester.listen(port);
  });
}