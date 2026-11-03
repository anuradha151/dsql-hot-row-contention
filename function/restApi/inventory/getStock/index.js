import { pool } from './dbClient.js';

const ERROR_MESSAGES = {
  INTERNAL: 'Internal error'
};

export async function handler(event) {
  const response = await getStock(event.resource.split('/').at(-1));

  return {
    statusCode: response.message ? 500 : 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(
      response.message
        ? { message: ERROR_MESSAGES.INTERNAL }
        : response.result
    ),
  };
}

async function getStock(product) {
  try {
    const { rows } = await pool.query(
      'SELECT bucket_id AS "bucketId", remaining FROM inventory.buckets WHERE product_id = $1 ORDER BY bucket_id',
      [product],
    );
    return {
      message: null,
      result: {
        product,
        remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
        buckets: rows
      }
    };

  } catch (error) {
    console.error({
      message: 'getStock failed',
      code: error.code
    });

    return {
      message: ERROR_MESSAGES.INTERNAL,
      result: null
    };
  }
}
