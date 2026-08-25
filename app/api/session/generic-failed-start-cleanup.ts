const failedStartCleanupRequests = new WeakSet<Request>();

export function markGenericFailedStartCleanupRequest(request: Request): Request {
  failedStartCleanupRequests.add(request);
  return request;
}

export function consumeGenericFailedStartCleanupRequest(request: Request): boolean {
  const marked = failedStartCleanupRequests.has(request);
  failedStartCleanupRequests.delete(request);
  return marked;
}
