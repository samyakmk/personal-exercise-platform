import { AsyncLocalStorage } from 'node:async_hooks';

class Rollback {
  constructor(value) { this.value = value; }
}

function transactionScope({ begin, acquire, release, close }) {
  const context = new AsyncLocalStorage();

  return {
    async query(operation) {
      const outer = context.getStore();
      if (outer) return operation(outer.connection);
      const connection = await acquire();
      try { return await operation(connection); }
      finally { release(connection); }
    },
    async transaction(write, operation) {
      const outer = context.getStore();
      if (outer) {
        if (write && !outer.write) throw new Error('Cannot write in a read transaction.');
        return operation();
      }
      const connection = await acquire();
      const scope = { connection, write, rollbackJobs: [] };
      try {
        await begin(connection, write);
        let result;
        try {
          result = await context.run(scope, operation);
        } catch (error) {
          await connection.exec('ROLLBACK');
          await Promise.allSettled(scope.rollbackJobs.map((job) => job()));
          if (error instanceof Rollback) return error.value;
          throw error;
        }
        await connection.exec('COMMIT');
        return result;
      } finally {
        release(connection);
      }
    },
    rollback(value) { throw new Rollback(value); },
    onRollback(job) {
      const scope = context.getStore();
      if (!scope?.write) throw new Error('External writes require a write transaction.');
      scope.rollbackJobs.push(job);
    },
    close,
  };
}

export function sqliteQueries(database) {
  let turn = Promise.resolve();
  const scope = transactionScope({
    async acquire() {
      const previous = turn;
      let release;
      turn = new Promise((resolve) => { release = resolve; });
      await previous;
      return { exec: (sql) => database.exec(sql), release };
    },
    release: (connection) => connection.release(),
    begin: (connection, write) => connection.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN'),
    async close() { await turn; database.close(); },
  });
  return {
    ...scope,
    dialect: 'sqlite',
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        get: (...params) => scope.query(() => statement.get(...params)),
        all: (...params) => scope.query(() => statement.all(...params)),
        run: (...params) => scope.query(() => statement.run(...params)),
      };
    },
  };
}

export function postgresQueries(pool) {
  const scope = transactionScope({
    async acquire() {
      const client = await pool.connect();
      return { exec: (sql, params) => client.query(sql, params), release: () => client.release() };
    },
    release: (connection) => connection.release(),
    async begin(connection, write) {
      await connection.exec(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // Serialize compound writes, matching SQLite's writer lock across app instances.
      if (write) {
        try { await connection.exec('SELECT pg_advisory_xact_lock(980113421)'); }
        catch (error) { await connection.exec('ROLLBACK'); throw error; }
      }
    },
    close: () => pool.end(),
  });
  return {
    ...scope,
    dialect: 'postgres',
    prepare(sql, alternate) {
      let parameter = 0;
      const query = (alternate ?? sql).replace(/\?(\d*)/g, (_, index) => '$' + (index || ++parameter));
      return {
        get: (...params) => scope.query(async (connection) => (await connection.exec(query, params)).rows[0]),
        all: (...params) => scope.query(async (connection) => (await connection.exec(query, params)).rows),
        run: (...params) => scope.transaction(true, () => scope.query(async (connection) => ({
          changes: (await connection.exec(query, params)).rowCount,
        }))),
      };
    },
  };
}
