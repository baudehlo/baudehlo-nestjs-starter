/**
 * Executes a promise in the given timeout. If the promise does not finish in the given timeout, it will throw an Error.
 *
 * @param ms - The timeout in milliseconds
 * @param promise - The promise which should get executed
 */
export const promiseTimeout = async (ms: number, promise: Promise<unknown>): Promise<unknown> => {
  let timer: NodeJS.Timeout;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operations timed out after ${String(ms)}.`)), ms);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
};
