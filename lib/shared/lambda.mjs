import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

export function createFunction(scope, id, folder, database, user) {
  const path = fileURLToPath(new URL(`../../function/${folder}/`, import.meta.url));

  if (
    !existsSync(`${path}/node_modules/pg/package.json`) ||
    !existsSync(`${path}/node_modules/@aws/aurora-dsql-node-postgres-connector/package.json`)
  ) {
    throw new Error(`Install Lambda dependencies before synthesis: ${folder}`);
  }

  const logGroup = new LogGroup(scope, `${id}Logs`, {
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  const role = new Role(scope, `${id}Role`, {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com')
  });

  logGroup.grantWrite(role);

  const fn = new Function(scope, id, {
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    handler: 'index.handler',
    code: Code.fromAsset(path, {
      exclude: ['.DS_Store']
    }),
    timeout: Duration.seconds(user === 'admin' ? 300 : 25),
    memorySize: 512,
    logGroup,
    role,

    environment: {
      DB_ENDPOINT: database.attrEndpoint,
      DB_USER: user
    },
  });

  fn.addToRolePolicy(
    new PolicyStatement({
      actions: [user === 'admin' ? 'dsql:DbConnectAdmin' : 'dsql:DbConnect'],
      resources: [database.attrResourceArn],
    })
  );

  return fn;
}
