import type { Logger } from './logger.ts';

export interface ShutdownHook {
  name: string;
  close: () => Promise<void> | void;
}

export class ShutdownCoordinator {
  private readonly hooks: ShutdownHook[] = [];
  private readonly logger?: Logger;
  private readonly timeoutMs: number;
  private shuttingDown: Promise<boolean> | null = null;
  private installed = false;

  constructor(options: { logger?: Logger; timeoutMs?: number } = {}) {
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  register(name: string, close: () => Promise<void> | void): void {
    this.hooks.push({ name, close });
  }

  /** Execute registered shutdown hooks in LIFO order with a bounded grace period. */
  async shutdown(reason: string): Promise<boolean> {
    if (this.shuttingDown) return this.shuttingDown;

    this.shuttingDown = (async () => {
      this.logger?.info('Graceful shutdown initiated', { reason, hooks: this.hooks.length });
      let failed = false;

      const drain = async () => {
        for (let index = this.hooks.length - 1; index >= 0; index -= 1) {
          const hook = this.hooks[index];
          try {
            await hook.close();
            this.logger?.info('Shutdown hook completed', { hook: hook.name });
          } catch (error) {
            failed = true;
            this.logger?.error('Shutdown hook failed', { hook: hook.name, error });
          }
        }
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        drain().then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), this.timeoutMs);
          timer.unref();
        }),
      ]);
      if (timer) clearTimeout(timer);

      if (timedOut) {
        this.logger?.error('Graceful shutdown timed out', { reason, timeoutMs: this.timeoutMs });
        return false;
      }
      return !failed;
    })();

    return this.shuttingDown;
  }

  installSignalHandlers(onComplete?: (clean: boolean) => void): void {
    if (this.installed) return;
    this.installed = true;
    const handle = (signal: NodeJS.Signals) => {
      void this.shutdown(signal).then((clean) => {
        if (onComplete) {
          onComplete(clean);
        } else {
          process.exit(clean ? 0 : 1);
        }
      });
    };
    process.once('SIGTERM', handle);
    process.once('SIGINT', handle);
  }
}
