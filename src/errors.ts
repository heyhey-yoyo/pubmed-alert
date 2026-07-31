export class AppError extends Error {
  readonly status: number;
  readonly expose: boolean;

  constructor(message: string, status = 500, expose = true) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.expose = expose;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.status : 500;
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof AppError && !error.expose) return "服务暂时不可用，请稍后重试。";
  return errorMessage(error);
}
