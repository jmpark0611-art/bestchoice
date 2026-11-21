import { AppError } from './errors';

/** Bounds the whole operation, including auth and response-body reads. */
export async function withDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AppError('TIMEOUT'));
          controller.abort();
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
