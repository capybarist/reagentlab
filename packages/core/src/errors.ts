import type { ApiErrorBody, ErrorCode } from "@reagentlab/contracts";

/** Error de dominio. Los adaptadores (REST, MCP) lo traducen a su formato. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }

  toBody(): ApiErrorBody {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}
