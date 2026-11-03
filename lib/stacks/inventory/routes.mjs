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

  api.root
    .addResource('stock')
    .addResource('bucketed')
    .addMethod('GET', new LambdaIntegration(functions.getStockFn), {
      authorizationType: AuthorizationType.NONE,
    });
}
