import { pool } from './dbClient.js';

export async function handler(event = {}) {
  if (event.action === 'reset') return reset();

  await query('CREATE SCHEMA IF NOT EXISTS inventory');

  await query(`CREATE TABLE IF NOT EXISTS inventory.buckets (
    product_id TEXT NOT NULL,
    bucket_id INTEGER NOT NULL,
    remaining INTEGER NOT NULL CHECK (remaining >= 0),
    PRIMARY KEY (product_id, bucket_id)
  )`);

  for (const [user, privileges, arns] of [
    [
      'inventory_reader',
      'SELECT',
      [process.env.READER_ROLE_ARN]
    ],
    [
      'inventory_writer',
      'SELECT, UPDATE',
      process.env.WRITER_ROLE_ARNS.split(',')
    ],
  ]) {
    const role = await query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [user]
    );

    if (!role.rows.length) await query(`CREATE ROLE ${user} WITH LOGIN`);

    await query(`GRANT USAGE ON SCHEMA inventory TO ${user}`);
    await query(`GRANT ${privileges} ON TABLE inventory.buckets TO ${user}`);

    const mapping = await query(
      'SELECT arn FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1',
      [user]
    );

    for (const arn of arns) {
      if (!mapping.rows.some((row) => row.arn === arn)) {
        await query(`AWS IAM GRANT ${user} TO '${arn}'`);
      }
    }
  }

  await pool.transaction(async (client) => {
    for (let bucketId = 0; bucketId < 4; bucketId++) {
      await client.query(
        'INSERT INTO inventory.buckets VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        ['bucketed', bucketId, 10]
      );
    }
  });

  return {
    message: 'Schema and initial stock ready'
  };
}

function query(sql, values) {
  return pool.transaction((client) => client.query(sql, values));
}

async function reset() {
  await pool.transaction(async (client) => {
    await client.query(
      "UPDATE inventory.buckets SET remaining = 10 WHERE product_id = 'bucketed'"
    );
  });

  return {
    message: 'Inventory reset to 40 units across four buckets; do not reset during a run'
  };
}
