import { NestedStack } from 'aws-cdk-lib';
import { createInventoryFunctions } from './lambdas.mjs';

export class InventoryFunctions extends NestedStack {
  constructor(scope, id, props) {
    super(scope, id);

    Object.assign(this, createInventoryFunctions(this, props.database));
  }
}
