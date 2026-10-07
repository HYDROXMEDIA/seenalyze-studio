export function abortable<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs = 60000): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const finish = (error: unknown, value?: T) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(value as T); };
    const cancel = () => finish(new Error('Canceled'));
    const timer = setTimeout(() => finish(new Error('Speech recognition timed out. Try again.')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    operation.then(value => finish(null, value), error => finish(error));
  });
}
