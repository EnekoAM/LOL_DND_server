export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Quita la cadena de conexión si el driver la mete en el mensaje. */
export function safeError(error: unknown): string {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  return text.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, 'mongodb://***');
}

export function logError(error: unknown): void {
  if (error instanceof HttpError) {
    console.error(error.message);
    return;
  }
  console.error(safeError(error));
}
