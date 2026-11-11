import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { toDrizzleSql } from './transaction-db.js';

const render = (text: string, values?: unknown[]) => {
  const { sql, params } = new PgDialect().sqlToQuery(toDrizzleSql(text, values));

  return { sql, params };
};

describe('toDrizzleSql', () => {
  it('passes a statement without parameters through unchanged', () => {
    expect(render('SELECT 1')).toEqual({ sql: 'SELECT 1', params: [] });
  });

  it('binds each positional parameter to its value, keeping casts', () => {
    expect(render('SELECT $1::jsonb, $2', ['{"a":1}', 'b'])).toEqual({
      sql: 'SELECT $1::jsonb, $2',
      params: ['{"a":1}', 'b'],
    });
  });

  it('binds by position number, not by order of appearance', () => {
    expect(render('SELECT $2, $1, $2', ['first', 'second'])).toEqual({
      sql: 'SELECT $1, $2, $3',
      params: ['second', 'first', 'second'],
    });
  });

  it('reads multi-digit positions whole', () => {
    const values = Array.from({ length: 11 }, (_, index) => `v${index + 1}`);

    expect(render('SELECT $11', values).params).toEqual(['v11']);
  });
});
