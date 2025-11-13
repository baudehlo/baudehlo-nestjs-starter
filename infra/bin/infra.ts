#!/opt/homebrew/opt/node/bin/node
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';
import { readFile } from 'node:fs/promises';

async function main() {
  const app = new cdk.App();
  const env = (app.node.tryGetContext('ENVIRONMENT') || 'Dev') as string;
  console.log(`Deploying to ${env}`);
  const { name } = JSON.parse(await readFile('../package.json', 'utf-8')) as { version: string; name: string; description: string };
  const strippedName = name
    .toLowerCase()
    .replace(/.*\//, '') // remove `baudehlo/` prefix
    .replace(/[^a-z0-9.-]/g, '');

  const envName = `${strippedName}-Infrastructure-${env.charAt(0).toUpperCase()}${env.slice(1)}`;
  const stack = new InfraStack(app, envName, {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */

    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    // env: { account: '123456789012', region: 'us-east-1' },

    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
    tags: {
      Environment: env,
      Project: strippedName,
      DNSName: process.env.DNS_NAME || `${strippedName}.${env.toLowerCase()}.sergeant.org`,
    },
  });

  await stack.build();
}

void main();
