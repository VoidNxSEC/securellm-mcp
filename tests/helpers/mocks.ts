/**
 * Mock factories for testing
 */

export interface MockSSHClient {
  connect: (config: any) => void;
  end: () => void;
  exec: (cmd: string, cb: (err: Error | null, stream: any) => void) => void;
  on: (event: string, cb: (...args: any[]) => void) => MockSSHClient;
  once: (event: string, cb: (...args: any[]) => void) => MockSSHClient;
  removeListener: (event: string, cb: (...args: any[]) => void) => MockSSHClient;
}

export function createMockSSHClient(options?: {
  connectError?: Error;
  execOutput?: string;
  execError?: Error;
}): MockSSHClient {
  const listeners = new Map<string, Set<Function>>();

  const client: MockSSHClient = {
    connect: (config: any) => {
      setTimeout(() => {
        if (options?.connectError) {
          const errorHandlers = listeners.get('error');
          errorHandlers?.forEach(h => h(options.connectError));
        } else {
          const readyHandlers = listeners.get('ready');
          readyHandlers?.forEach(h => h());
        }
      }, 0);
    },
    end: () => {},
    exec: (cmd: string, cb: (err: Error | null, stream: any) => void) => {
      if (options?.execError) {
        cb(options.execError, null);
        return;
      }
      const stream = {
        on: (event: string, handler: Function) => {
          if (event === 'data') {
            handler(Buffer.from(options?.execOutput || ''));
          }
          if (event === 'close') {
            setTimeout(() => handler(0), 0);
          }
          return stream;
        },
      };
      cb(null, stream);
    },
    on: (event: string, cb: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return client;
    },
    once: (event: string, cb: (...args: any[]) => void) => {
      return client.on(event, cb);
    },
    removeListener: (event: string, cb: (...args: any[]) => void) => {
      listeners.get(event)?.delete(cb);
      return client;
    },
  };

  return client;
}

export function createMockExecResult(options?: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  failed?: boolean;
  timedOut?: boolean;
}) {
  return {
    stdout: options?.stdout || '',
    stderr: options?.stderr || '',
    exitCode: options?.exitCode ?? 0,
    failed: options?.failed ?? false,
    timedOut: options?.timedOut ?? false,
    command: 'mock-command',
  };
}
