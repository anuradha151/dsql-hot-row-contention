import { pool } from './dbClient.js';

const ERROR_MESSAGES = {
  INTERNAL: 'Internal error',
  NOT_FOUND: 'Bucket not found',
  DUPLICATE: 'Duplicate bucket IDs'
};

export async function handler(event) {
  const body = JSON.parse(event.body);

  const response = await setStock(body.buckets);

  if (response.message) {
    let statusCode = 500;

    if (response.message === ERROR_MESSAGES.NOT_FOUND) {
      statusCode = 404;
    } else if (response.message === ERROR_MESSAGES.DUPLICATE) {
      statusCode = 400;
    }

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ message: response.message })
    };
  }

  let statusCode = 200;

  if (response.result.outcome === 'conflict') {
    statusCode = 503;
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(response.result)
  };
}

async function setStock(buckets) {
  try {
    if (new Set(buckets.map(bucket => bucket.bucketId)).size !== buckets.length) {
      throw new Error(ERROR_MESSAGES.DUPLICATE);
    }

    const result = await pool.transaction(async (client) => {
      const updatedBuckets = [];

      for (const bucket of buckets) {
        const updated = await client.query(
          `UPDATE inventory.buckets
           SET remaining = $1
           WHERE product_id = $2 AND bucket_id = $3
           RETURNING bucket_id AS "bucketId", remaining`,
          [bucket.remaining, 'bucketed', bucket.bucketId]
        );

        if (!updated.rows.length) throw new Error(ERROR_MESSAGES.NOT_FOUND);

        updatedBuckets.push(updated.rows[0]);
      }

      return {
        outcome: 'stock_set',
        buckets: updatedBuckets
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

    if (error.message === ERROR_MESSAGES.NOT_FOUND || error.message === ERROR_MESSAGES.DUPLICATE) {
      return {
        message: error.message,
        result: null
      };
    }

    console.error({
      message: 'setStock failed',
      code: error.code
    });

    return {
      message: ERROR_MESSAGES.INTERNAL,
      result: null
    };
  }
}
