import { pool } from './dbClient.js';

const ERROR_MESSAGES = {
  INTERNAL: 'Internal error'
};

export async function handler(event) {
  const body = JSON.parse(event.body);

  const response = await decrementSingleQuery(body.product);

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

async function decrementSingleQuery(product) {
  try {
    const result = await pool.transaction(async (client) => {
      const updated = await client.query(
        `UPDATE inventory.buckets
         SET remaining = remaining - 1
         WHERE product_id = $1
           AND remaining > 0
           AND bucket_id = (
             SELECT bucket_id
             FROM inventory.buckets
             WHERE product_id = $1 AND remaining > 0
             ORDER BY random()
             LIMIT 1
           )
         RETURNING bucket_id AS "bucketId", remaining AS "bucketRemaining"`,
        [product],
      );

      if (!updated.rows.length) return {
        outcome: 'out_of_stock'
      };

      return {
        outcome: 'decremented',
        bucketId: updated.rows[0].bucketId,
        bucketRemaining: updated.rows[0].bucketRemaining,
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
      message: 'decrementSingleQuery failed',
      code: error.code
    });

    return {
      message: ERROR_MESSAGES.INTERNAL,
      result: null
    };
  }
}
