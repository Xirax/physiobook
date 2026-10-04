import { EventEmitter } from 'node:events';

import Fastify from 'fastify';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { runWorker, type Worker } from './worker.js';

function fakeWorker(close: () => Promise<void> = async () => {}): Worker {
  return {
    boss: {} as PgBoss,
    health: Fastify({ logger: false }),
    close: vi.fn(close),
  };
}

describe('runWorker', () => {
  it('drains and exits 0 on SIGTERM once running', async () => {
    const signals = new EventEmitter();
    const worker = fakeWorker();

    const exit = runWorker(async () => worker, signals);
    await vi.waitFor(() => {
      expect(signals.listenerCount('SIGTERM')).toBe(1);
    });
    signals.emit('SIGTERM');

    await expect(exit).resolves.toBe(0);
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it('still drains when the signal arrives while the worker is booting', async () => {
    const signals = new EventEmitter();
    const worker = fakeWorker();
    let finishBoot!: (worker: Worker) => void;
    const booting = new Promise<Worker>((resolve) => {
      finishBoot = resolve;
    });

    const exit = runWorker(() => booting, signals);
    signals.emit('SIGINT');
    expect(worker.close).not.toHaveBeenCalled();
    finishBoot(worker);

    await expect(exit).resolves.toBe(0);
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when draining fails', async () => {
    const signals = new EventEmitter();
    const worker = fakeWorker(async () => {
      throw new Error('stop failed');
    });

    const exit = runWorker(async () => worker, signals);
    signals.emit('SIGTERM');

    await expect(exit).resolves.toBe(1);
  });

  it('propagates a failed boot instead of waiting for a signal', async () => {
    await expect(
      runWorker(() => Promise.reject(new Error('boot failed')), new EventEmitter()),
    ).rejects.toThrow('boot failed');
  });
});
