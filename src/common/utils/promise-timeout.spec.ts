import { describe, expect, it, vi } from 'vitest';
import { promiseTimeout } from './promise-timeout';

describe('promiseTimeout', () => {
  it('resolves with the value when the promise completes before the timeout', async () => {
    const result = await promiseTimeout(1000, Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('rejects when the promise rejects before the timeout', async () => {
    await expect(promiseTimeout(1000, Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('rejects with a timeout error when the promise takes too long', async () => {
    vi.useFakeTimers();

    const slowPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    const race = promiseTimeout(100, slowPromise);

    vi.advanceTimersByTime(200);

    await expect(race).rejects.toThrow('Operations timed out after 100.');

    vi.useRealTimers();
  });

  it('clears the timer when the inner promise resolves first', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await promiseTimeout(5000, Promise.resolve('done'));
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
