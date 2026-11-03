import {
  AuthorizationType,
  JsonSchemaType,
  LambdaIntegration,
  RequestValidator
} from 'aws-cdk-lib/aws-apigateway';

export function createInventoryRoutes(api, functions) {
  const model = api.addModel('DecrementBody', {
    schema: {
      type: JsonSchemaType.OBJECT,
      required: ['product'],
      additionalProperties: false,
      properties: {
        product: {
          type: JsonSchemaType.STRING,
          enum: ['bucketed']
        }
      },
    }
  });

  const stockModel = api.addModel('SetStockBody', {
    schema: {
      type: JsonSchemaType.OBJECT,
      required: ['buckets'],
      additionalProperties: false,
      properties: {
        buckets: {
          type: JsonSchemaType.ARRAY,
          minItems: 1,
          maxItems: 4,
          items: {
            type: JsonSchemaType.OBJECT,
            required: ['bucketId', 'remaining'],
            additionalProperties: false,
            properties: {
              bucketId: {
                type: JsonSchemaType.INTEGER,
                minimum: 0,
                maximum: 3
              },
              remaining: {
                type: JsonSchemaType.INTEGER,
                minimum: 0,
                maximum: 2147483647
              }
            }
          }
        }
      }
    }
  });

  const validator = new RequestValidator(api, 'Validator', {
    restApi: api,
    validateRequestBody: true
  });

  api.root
    .addResource('decrement')
    .addMethod('POST', new LambdaIntegration(functions.decrementFn), {
      authorizationType: AuthorizationType.NONE,
      requestValidator: validator,
      requestModels: {
        'application/json': model,
        '$default': model
      },
    });

  api.root
    .addResource('decrement-single-query')
    .addMethod('POST', new LambdaIntegration(functions.decrementSingleQueryFn), {
      authorizationType: AuthorizationType.NONE,
      requestValidator: validator,
      requestModels: {
        'application/json': model,
        '$default': model
      },
    });

  const stock = api.root
    .addResource('stock')
    .addResource('bucketed');

  stock.addMethod('GET', new LambdaIntegration(functions.getStockFn), {
    authorizationType: AuthorizationType.NONE,
  });

  stock.addMethod('POST', new LambdaIntegration(functions.setStockFn), {
    authorizationType: AuthorizationType.NONE,
    requestValidator: validator,
    requestModels: {
      'application/json': stockModel,
      '$default': stockModel
    },
  });
}
