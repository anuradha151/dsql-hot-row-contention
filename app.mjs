import { App } from 'aws-cdk-lib';
import { InventoryStack } from './lib/root-stack.mjs';

const app = new App({
  outdir: 'cdk.out'
});

new InventoryStack(app, 'DsqlInventoryDemo');

app.synth();
