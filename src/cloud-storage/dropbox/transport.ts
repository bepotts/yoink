// Applies request deadlines and redirect protection to the Dropbox SDK's fetch transport.

// Wraps fetch without duplicating the SDK's API routes, payload encoding, or response handling.
export function dropboxFetch(
  timeout: number,
  signal?: AbortSignal,
): typeof fetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(timeout),
        ...(signal ? [signal] : []),
        ...(init?.signal ? [init.signal] : []),
      ]),
      redirect: 'error',
    });
}
