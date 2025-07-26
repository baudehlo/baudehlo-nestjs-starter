import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.tags?.Environment;
    const name = props?.tags?.Project;

    // What we need:
    // 1. VPC
    // 2. ECS Cluster
    // 3. Aurora Serverless Postgresql Database
    // 4. Route53 Hosted Zone
    // 5. Redis
    // 6. Docker build of app and deploy to ECS
    // 7. Load Balancer for ECS Service
    // 8. Logging and Monitoring in CloudWatch
    // All with failover and redundancy in mind

    const vpc = new ec2.Vpc(this, `${name}/${env}/VPC`, {
      maxAzs: 2, // Default is all AZs in region
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });

    // ECS Cluster

    const ecsCluster = new ecs.Cluster(this, `${name}/${env}/ECSCluster`, {
      vpc,
      clusterName: `${name}-${env}-cluster`,
    });

    // Aurora Serverless PostgreSQL Database
    const dbCredentials = rds.Credentials.fromGeneratedSecret('postgres', {
      secretName: `${name}/${env}/aurora-postgres-credentials`,
    });
    const _dbCluster = new rds.ServerlessCluster(this, `${name}/${env}/AuroraPostgres`, {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      vpc,
      credentials: dbCredentials,
      scaling: { autoPause: cdk.Duration.minutes(10), minCapacity: rds.AuroraCapacityUnit.ACU_2, maxCapacity: rds.AuroraCapacityUnit.ACU_8 },
      defaultDatabaseName: `${name}_${env}_db`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      clusterIdentifier: `${name}-${env}-aurora`,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Route53 Hosted Zone
    new r53.HostedZone(this, `${name}/${env}/HostedZone`, {
      zoneName: `${name}-${env}.internal`,
    });

    // Redis (Elasticache)
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, `${name}/${env}/RedisSubnetGroup`, {
      description: 'Subnet group for Redis',
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: `${name}-${env}-redis-subnet-group`,
    });
    const redis = new elasticache.CfnCacheCluster(this, `${name}/${env}/Redis`, {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      clusterName: `${name}-${env}-redis`,
      vpcSecurityGroupIds: [vpc.vpcDefaultSecurityGroup],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName!,
    });

    // ECS Task Definition and Service (Docker build and deploy)
    const taskDef = new ecs.FargateTaskDefinition(this, `${name}/${env}/TaskDef`, {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    // Build and use the Dockerfile from the repo root for the ECS container
    // Import all env vars from Secrets Manager (assume one secret for app env, and one for DB)
    // App env secret
    const appEnvSecret = secretsmanager.Secret.fromSecretNameV2(this, `${name}/${env}/AppEnvSecret`, `${name}/${env}/app-env`);
    // Use the generated DB secret from the Aurora cluster
    const dbSecret = _dbCluster.secret!;

    taskDef.addContainer(`${name}-${env}-app`, {
      image: ecs.ContainerImage.fromAsset('..', {
        file: 'Dockerfile',
      }),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: `${name}-${env}` }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        REDIS_HOST: redis.attrRedisEndpointAddress,
        REDIS_PORT: redis.attrRedisEndpointPort,
      },
      secrets: {
        REDIS_MEMORY_THRESHOLD: ecs.Secret.fromSecretsManager(appEnvSecret, 'REDIS_MEMORY_THRESHOLD'),
        SESSION_SECRET: ecs.Secret.fromSecretsManager(appEnvSecret, 'SESSION_SECRET'),
        DATABASE_URL: ecs.Secret.fromSecretsManager(appEnvSecret, 'DATABASE_URL'),
        JWT_SECRET: ecs.Secret.fromSecretsManager(appEnvSecret, 'JWT_SECRET'),
        JWT_EXPIRATION: ecs.Secret.fromSecretsManager(appEnvSecret, 'JWT_EXPIRATION'),
        CSRF_SECRET: ecs.Secret.fromSecretsManager(appEnvSecret, 'CSRF_SECRET'),
        CSRF_COOKIE_NAME: ecs.Secret.fromSecretsManager(appEnvSecret, 'CSRF_COOKIE_NAME'),
        STATSD_HOST: ecs.Secret.fromSecretsManager(appEnvSecret, 'STATSD_HOST'),
        STATSD_MOCK: ecs.Secret.fromSecretsManager(appEnvSecret, 'STATSD_MOCK'),
        SENTRY_DSN: ecs.Secret.fromSecretsManager(appEnvSecret, 'SENTRY_DSN'),
        // Postgres login details from the generated secret
        POSTGRES_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        POSTGRES_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
        POSTGRES_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
        POSTGRES_DB: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
      },
    });
    const fargateService = new ecs.FargateService(this, `${name}/${env}/Service`, {
      cluster: ecsCluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Load Balancer for ECS Service
    const lb = new elb.ApplicationLoadBalancer(this, `${name}/${env}/ALB`, {
      vpc,
      internetFacing: true,
      loadBalancerName: `${name}-${env}-alb`,
    });
    const listener = lb.addListener(`${name}/${env}/Listener`, {
      port: 80,
      open: true,
    });
    listener.addTargets(`${name}/${env}/ECS`, {
      port: 80,
      targets: [fargateService],
      healthCheck: { path: '/' },
    });

    // Logging and Monitoring in CloudWatch is handled by ECS awsLogs above
    // Additional CloudWatch Alarms/metrics can be added as needed
  }
}
