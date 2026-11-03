import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';

export const pool = new AuroraDSQLPool({
  host: process.env.DB_ENDPOINT,
  user: process.env.DB_USER,
  database: 'postgres',
  max: 1,
});

pool.on('error', (error) => console.error({
  message: 'Idle database connection error',
  code: error.code
}));
