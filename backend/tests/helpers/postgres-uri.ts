/**
 * Retargets a Postgres connection URI at a different database on the same
 * server, keeping credentials, host, port and query parameters intact.
 *
 * Needed in both directions of the harness: the global setup builds the
 * template's URI from the container's, and each test file builds its clone's.
 */
export function withDatabase(connectionUri: string, database: string): string {
  const url = new URL(connectionUri);
  // Encoded, because the path is a URL component here — the database name only
  // becomes an SQL identifier once the driver parses this back out.
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}
