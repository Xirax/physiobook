import type { WorkHandler } from 'pg-boss';

/** Proves the enqueue → consume path end to end; real handlers arrive in 4.3/4.4. */
export const noopHandler: WorkHandler<unknown> = async () => {};
