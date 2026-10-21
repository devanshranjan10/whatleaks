/** A user-facing failure: printed without a stack trace, exits with `exitCode` (2 = usage or input error). */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
