import { randomInt } from 'node:crypto';
import { pool } from './dbClient.js';

const ERROR_MESSAGES = {
  INTERNAL: 'Internal error'
};

export async function handler(event) {

  const body = JSON.parse(event.body);

  const response = await decrement(body.product);

  if (response.message) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: ERROR_MESSAGES.INTERNAL }),
    };
  }

  let statusCode = 200;

  if (response.result.outcome === 'out_of_stock') {
    statusCode = 409;
  } else if (response.result.outcome === 'conflict') {
    statusCode = 503;
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(response.result),
  };
}

async function decrement(product) {
  try {
    const result = await pool.transaction(async (client) => {
      const candidates = await client.query(
        'SELECT bucket_id FROM inventory.buckets WHERE product_id = $1 AND remaining > 0 ORDER BY bucket_id',
        [product],
      );

      if (!candidates.rows.length) return {
        outcome: 'out_of_stock'
      };

      const bucketId = candidates.rows[randomInt(candidates.rows.length)].bucket_id;

      const updated = await client.query(
        'UPDATE inventory.buckets SET remaining = remaining - 1 WHERE product_id = $1 AND bucket_id = $2 AND remaining > 0 RETURNING remaining',
        [product, bucketId],
      );

      if (updated.rowCount !== 1) throw Object.assign(
        new Error('Candidate changed'),
        { code: '40001' }
      );

      return {
        outcome: 'decremented',
        bucketId,
        bucketRemaining: updated.rows[0].remaining
      };
    });

    return {
      message: null,
      result
    };

  } catch (error) {
    if (['40001', 'OC000', 'OC001'].includes(error.code)) {
      return {
        message: null,
        result: {
          outcome: 'conflict'
        }
      };
    }

    console.error({
      message: 'decrement failed',
      code: error.code
    });

    return {
      message: ERROR_MESSAGES.INTERNAL,
      result: null
    };
  }
}
