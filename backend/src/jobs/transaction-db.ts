import type { Database } from '@physiobook/db';
import { type SQL, sql } from 'drizzle-orm';
import type { Db } from 'pg-boss';

const POSITIONAL_PARAMETER = /\$(\d+)/;

export function toDrizzleSql(text: string, values: readonly unknown[] = []): SQL {
  const parts = text.split(POSITIONAL_PARAMETER);

  return sql.join(
    parts.map((part, index) =>
      index % 2 === 0 ? sql.raw(part) : sql.param(values[Number(part) - 1]),
    ),
  );
}

/**
 * Lets pg-boss write through a Drizzle transaction (`send(..., { db })`), so the
 * job commits or rolls back together with the change that caused it.
 */
export function transactionDb(executor: Pick<Database, 'execute'>): Db {
  return {
    executeSql: async (text, values) => executor.execute(toDrizzleSql(text, values)),
  };
}
