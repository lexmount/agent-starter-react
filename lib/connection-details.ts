export async function readOptionalJsonBody<T = unknown>(
  request: Request
): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}
