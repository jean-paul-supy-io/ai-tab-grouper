export class GroupingError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limit' | 'network' | 'refusal' | 'truncated' | 'invalid' | 'api' | 'setup',
  ) {
    super(message);
  }
}
