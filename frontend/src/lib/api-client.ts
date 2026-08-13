import { errorCodes, errorResponseSchema, refreshResponseSchema } from '@physiobook/shared';
import type { ErrorResponse } from '@physiobook/shared';
import type { z } from 'zod';

import type { TokenStore } from './auth';

export const REFRESH_PATH = '/auth/refresh';

export type FieldError = NonNullable<ErrorResponse['details']>[number];

/** A refusal the API named. Callers branch on `code`, never on `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly FieldError[];

  constructor(status: number, body: ErrorResponse) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? [];
  }
}

export interface RequestOptions<Output> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Parses the response, so a contract drift is caught here, not three components later. */
  schema?: z.ZodType<Output>;
  signal?: AbortSignal;
}

export interface ApiClient {
  request: <Output = void>(path: string, options?: RequestOptions<Output>) => Promise<Output>;
  /** The same single-flight refresh the 401 path uses — the AuthProvider's on-load rehydration. */
  refresh: () => Promise<string | null>;
}

export interface ApiClientOptions {
  tokens: TokenStore;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient({
  tokens,
  fetch = (...args) => globalThis.fetch(...args),
}: ApiClientOptions): ApiClient {
  let inFlightRefresh: Promise<string | null> | null = null;

  // Paths are relative because the API is served from this origin
  // (PROJECT_STRUCTURE.md §3), which is also why the refresh cookie rides along
  // under fetch's default `same-origin` credentials with nothing configured.
  const send = (
    path: string,
    options: RequestOptions<unknown>,
    token: string | null,
  ): Promise<Response> => {
    const headers = new Headers();

    if (token !== null) headers.set('authorization', `Bearer ${token}`);
    if (options.body !== undefined) headers.set('content-type', 'application/json');

    return fetch(path, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  };

  const readError = async (response: Response): Promise<ApiError> => {
    const body: unknown = await response.json().catch(() => null);
    const named = errorResponseSchema.safeParse(body);

    // Anything that is not the contract's error body came from something other
    // than the API answering — a proxy's own 502 page, say. It gets the code
    // that means "we cannot name this", so callers branching on `code` see one
    // shape whatever went wrong.
    return named.success
      ? new ApiError(response.status, named.data)
      : new ApiError(response.status, {
          code: errorCodes.INTERNAL_ERROR,
          message: `Request failed with status ${String(response.status)}`,
        });
  };

  const decode = async <Output>(
    response: Response,
    schema: z.ZodType<Output> | undefined,
  ): Promise<Output> => {
    if (!response.ok) throw await readError(response);

    // No schema means the caller expects no body (a 204). `Output` defaults to
    // `void` for exactly that, so the cast is the type of nothing, not a lie.
    if (schema === undefined) return undefined as Output;

    // Deliberately `parse`, not `safeParse`: a response that does not match the
    // shared contract is a bug on one side or the other, and swallowing it here
    // would move the failure to whichever component read the missing field.
    return schema.parse(await response.json());
  };

  const runRefresh = async (): Promise<string | null> => {
    const response = await fetch(REFRESH_PATH, { method: 'POST' });

    // Cleared only on an answer, never on a thrown error: a network blip is not
    // a refusal, and treating it as one would log a user out for a dropped
    // packet. The backend narrows its own cookie-clearing the same way (§4).
    if (!response.ok) {
      tokens.clear();

      return null;
    }

    const { token } = refreshResponseSchema.parse(await response.json());
    tokens.set(token);

    return token;
  };

  const refresh = (): Promise<string | null> => {
    if (inFlightRefresh !== null) return inFlightRefresh;

    const attempt = runRefresh();
    inFlightRefresh = attempt;

    // Bookkeeping on its own chain, with the rejection swallowed there rather
    // than here: `attempt` is what callers receive and handle, and a second
    // unhandled branch off it would be reported as an unhandled rejection.
    void attempt
      .catch(() => null)
      .finally(() => {
        if (inFlightRefresh === attempt) inFlightRefresh = null;
      });

    return attempt;
  };

  const request = async <Output = void>(
    path: string,
    options: RequestOptions<Output> = {},
  ): Promise<Output> => {
    const token = tokens.get();
    const response = await send(path, options, token);

    // A request that carried no token cannot have been refused because one
    // expired, so a refresh has nothing to fix. That is what keeps the retry
    // off /auth/login and /auth/register — whose 401 is INVALID_CREDENTIALS, an
    // answer about a password — and off /auth/refresh itself, without any list
    // of exempt paths to keep in agreement with the routes.
    if (response.status !== 401 || token === null) return decode(response, options.schema);

    const renewed = await refresh();

    // The refresh was refused, so the session is over and `tokens` is already
    // cleared. The caller is told what its own request was told, not what the
    // retry it never asked for was.
    if (renewed === null) throw await readError(response);

    return decode(await send(path, options, renewed), options.schema);
  };

  return { request, refresh };
}
