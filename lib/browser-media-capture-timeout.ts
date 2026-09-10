export class BrowserMediaCaptureTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} capture did not become ready within ${timeoutMs}ms`);
    this.name = 'BrowserMediaCaptureTimeoutError';
  }
}

type BrowserMediaCaptureOptions<T> = {
  timeoutMs: number;
  label: string;
  disposeLateResult: (result: T) => void;
};

export async function awaitBrowserMediaCapture<T>(
  capture: Promise<T>,
  options: BrowserMediaCaptureOptions<T>
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  void capture.then(
    (result) => {
      if (timedOut) options.disposeLateResult(result);
    },
    () => undefined
  );

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new BrowserMediaCaptureTimeoutError(options.label, options.timeoutMs));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([capture, timeout]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}
