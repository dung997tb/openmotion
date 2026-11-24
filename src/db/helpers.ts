import type { SQL } from 'drizzle-orm';
import type { PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';

type TableColumns<TTable extends PgTable> = TTable['_']['columns'];
type ColumnData<TColumn> = TColumn extends { _: { data: infer TData } } ? TData : unknown;

export type TypedInsertValues<TTable extends PgTable> = {
  [K in keyof TableColumns<TTable>]?: ColumnData<TableColumns<TTable>[K]> | SQL | null;
};

export type TypedUpdateValues<TTable extends PgTable> = {
  [K in keyof TableColumns<TTable>]?:
    | ColumnData<TableColumns<TTable>[K]>
    | SQL
    | TableColumns<TTable>[K]
    | null;
};

/**
 * Type-safe Drizzle insert payload helper that preserves exact column name and value checking
 * under both `strictNullChecks: true` (`tsconfig.cloud.json`) and `strictNullChecks: false`
 * (`tsconfig.backend.json`, where Drizzle's `OptionalKeyOnly` otherwise collapses default/nullable keys).
 */
export function asInsert<TTable extends PgTable>(
  _table: TTable,
  values: TypedInsertValues<TTable>,
): TTable['$inferInsert'] {
  return values as unknown as TTable['$inferInsert'];
}

/**
 * Type-safe Drizzle update payload helper compatible with both `tsconfig.cloud.json`
 * and `tsconfig.backend.json`.
 */
export function asUpdate<TTable extends PgTable>(
  _table: TTable,
  values: TypedUpdateValues<TTable>,
): PgUpdateSetSource<TTable> {
  return values as unknown as PgUpdateSetSource<TTable>;
}
