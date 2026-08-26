import {
  createPool,
  type Pool as DriverPool,
  type PoolConnection,
  type ResultSetHeader,
} from 'mysql2/promise';

export type QueryResult<Row> = {
  rows: Row[];
  rowCount: number;
};

export type MysqlPoolOptions = {
  connectionString: string;
  connectionTimeoutMillis?: number;
  max?: number;
};

type Queryable = DriverPool | PoolConnection;

const serializeValue = (value: unknown): unknown => {
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
  ) {
    return new Date(value);
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return JSON.stringify(value);
  }

  return value;
};

const compileQuery = (
  source: string,
  values: readonly unknown[],
): { sql: string; values: unknown[] } => {
  const boundValues: unknown[] = [];
  let sql = source
    .replace(/::(?:[a-z_][a-z0-9_]*)(?:\[\])?/giu, '')
    .replace(/\bILIKE\b/giu, 'LIKE')
    .replace(/\bnow\(\)/giu, 'UTC_TIMESTAMP(3)')
    .replace(/\s+FOR\s+UPDATE\s+OF\s+[a-z_][a-z0-9_]*/giu, ' FOR UPDATE');

  sql = sql.replace(
    /=\s*ANY\(\$(\d+)\)/giu,
    (_match: string, rawIndex: string) =>
      `IN (__ARRAY_PARAMETER_${rawIndex}__)`,
  );

  sql = sql.replace(
    /__ARRAY_PARAMETER_(\d+)__|\$(\d+)/gu,
    (
      _match: string,
      arrayIndex: string | undefined,
      scalarIndex: string | undefined,
    ) => {
      const rawIndex = arrayIndex ?? scalarIndex;
      if (!rawIndex) throw new Error('Invalid database query parameter');
      const value = values[Number(rawIndex) - 1];

      if (arrayIndex) {
        if (!Array.isArray(value) || value.length === 0) {
          return 'NULL';
        }
        boundValues.push(...value.map(serializeValue));
        return value.map(() => '?').join(', ');
      }

      boundValues.push(serializeValue(value));
      return '?';
    },
  );

  return { sql, values: boundValues };
};

const query = async <Row>(
  connection: Queryable,
  sql: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> => {
  const compiled = compileQuery(sql, values);
  const [result] = await connection.query(compiled.sql, compiled.values);

  if (Array.isArray(result)) {
    return { rows: result as Row[], rowCount: result.length };
  }

  const header = result as ResultSetHeader;
  return { rows: [], rowCount: header.affectedRows };
};

export class PoolClient {
  public constructor(private readonly connection: PoolConnection) {}

  public query<Row>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return query<Row>(this.connection, sql, values);
  }

  public release(): void {
    this.connection.release();
  }
}

export class Pool {
  private readonly pool: DriverPool;

  public constructor(options: MysqlPoolOptions) {
    const url = new URL(options.connectionString);

    if (url.protocol !== 'mysql:') {
      throw new Error('DATABASE_URL must use the mysql protocol');
    }

    this.pool = createPool({
      uri: options.connectionString,
      connectionLimit: options.max ?? 10,
      connectTimeout: options.connectionTimeoutMillis ?? 5_000,
      decimalNumbers: false,
      timezone: 'Z',
      supportBigNumbers: true,
      bigNumberStrings: true,
      typeCast: (field, next) => {
        if (field.type === 'TINY' && field.length === 1) {
          return field.string() === '1';
        }
        return next();
      },
    });
  }

  public async connect(): Promise<PoolClient> {
    const connection = await this.pool.getConnection();
    return new PoolClient(connection);
  }

  public query<Row>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return query<Row>(this.pool, sql, values);
  }

  public async end(): Promise<void> {
    await this.pool.end();
  }
}
