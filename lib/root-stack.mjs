import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { CfnCluster } from 'aws-cdk-lib/aws-dsql';
import { Cors, EndpointType, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Trigger } from 'aws-cdk-lib/triggers';
import { createFunction } from './shared/lambda.mjs';
import { InventoryFunctions } from './stacks/inventory/stack.mjs';
import { createInventoryRoutes } from './stacks/inventory/routes.mjs';

export class InventoryStack extends Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const database = new CfnCluster(this, 'Database', {
      deletionProtectionEnabled: false
    });

    const api = new RestApi(this, 'Api', {
      endpointTypes: [EndpointType.REGIONAL],
      cloudWatchRole: false,

      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS']
      },

      deployOptions: {
        stageName: 'demo',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200
      },
    });

    const functions = new InventoryFunctions(this, 'Inventory', {
      database
    });

    const setup = createFunction(
      this,
      'Setup',
      'database/setup',
      database,
      'admin'
    );

    setup.addEnvironment(
      'READER_ROLE_ARN',
      functions.getStockFn.role.roleArn
    );

    setup.addEnvironment(
      'WRITER_ROLE_ARNS',
      [
        functions.decrementFn.role.roleArn,
        functions.decrementSingleQueryFn.role.roleArn
      ].join(',')
    );

    const trigger = new Trigger(this, 'InitializeDatabase', {
      handler: setup,
      executeAfter: [database, functions],
      executeOnHandlerChange: true,
      timeout: Duration.minutes(5),
    });

    createInventoryRoutes(api, functions);

    api.latestDeployment.node.addDependency(trigger);

    new CfnOutput(this, 'ApiUrl', {
      value: api.url
    });

    new CfnOutput(this, 'SetupFunction', {
      value: setup.functionName
    });

    new CfnOutput(this, 'ClusterEndpoint', {
      value: database.attrEndpoint
    });
  }
}
