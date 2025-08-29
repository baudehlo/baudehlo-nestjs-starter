import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { wafService } from './waf';
import path from 'node:path';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.tags?.Environment || 'Dev';
    const name = props?.tags?.Project || 'Unknown';
    const zoneName = props?.tags?.DNSName;

    if (!zoneName) {
      throw new Error('DNSName tag is required for the hosted zone');
    }

    const hostedZone = new r53.HostedZone(this, `${name}/${env}/HostedZone`, {
      zoneName,
      comment: `Hosted zone for ${name}/${env} environment: ${zoneName}`,
    });

    const vpc = new ec2.Vpc(this, `${name}/${env}/VPC`, {
      maxAzs: 2, // Default is all AZs in region
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });

    const namespace = new servicediscovery.PrivateDnsNamespace(this, `${name}/${env}/ServiceDiscoveryNamespace`, {
      name: 'disco',
      vpc,
    });

    const sgPublic = new ec2.SecurityGroup(this, `${name}/${env}/SG-Public-LB`, {
      vpc,
      description: `SG for the load balancer (80 and 443 from the internet, and anything else it needs)`,
      allowAllOutbound: true,
      securityGroupName: `${name}/${env}/SG-Public-LB`,
    });
    sgPublic.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), `allow http access from the world`);
    sgPublic.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(80), `allow http access from the world`);

    const sgPrivate = new ec2.SecurityGroup(this, `${name}/${env}/SG-Private`, {
      vpc,
      description: `SG for the worker instances (ECS) - allow inbound from the load balancer`,
      securityGroupName: `${name}/${env}/SG-Private`,
      allowAllOutbound: true,
    });
    sgPrivate.connections.allowInternally(ec2.Port.allTraffic());
    sgPrivate.addIngressRule(ec2.Peer.securityGroupId(sgPublic.securityGroupId), ec2.Port.tcp(3000), 'LB to API');

    const sgRedis = new ec2.SecurityGroup(this, `${name}/${env}/SG-Redis`, {
      vpc,
      securityGroupName: `${name}/${env}/SG-Redis`,
    });

    const sgPostgres = new ec2.SecurityGroup(this, `${name}/${env}/SG-Postgres`, {
      vpc,
      securityGroupName: `${name}/${env}/SG-Postgres`,
    });

    const sgStatsd = new ec2.SecurityGroup(this, `${name}/${env}/SG-Statsd`, {
      vpc,
      securityGroupName: `${name}/${env}/SG-Statsd`,
    });

    sgStatsd.addIngressRule(ec2.Peer.securityGroupId(sgPrivate.securityGroupId), ec2.Port.tcp(8125), `access statsd on tcp from ecs instances`);
    sgStatsd.addIngressRule(ec2.Peer.securityGroupId(sgPrivate.securityGroupId), ec2.Port.udp(8125), `access statsd on udp from ecs instances`);

    const cluster = new ecs.Cluster(this, `${name}/${env}/ECS-Cluster`, {
      vpc,
      clusterName: `${name}-${env}-cluster`,
      executeCommandConfiguration: {
        logging: ecs.ExecuteCommandLogging.DEFAULT,
      },
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    statsdService(this, env, name, cluster, sgStatsd, namespace);

    // Aurora Serverless PostgreSQL Database
    const dbCredentials = rds.Credentials.fromGeneratedSecret('postgres', {
      secretName: `${name}/${env}/aurora-postgres-credentials`,
    });
    const dbCluster = new rds.DatabaseCluster(this, `${name}/${env}/Aurora-Postgres`, {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_17_5,
      }),
      vpc,
      writer: rds.ClusterInstance.serverlessV2(`${name}/${env}/Aurora-Postgres-Writer`, {
        instanceIdentifier: `${name}-${env}-aurora-writer`,
      }),
      readers: [
        rds.ClusterInstance.serverlessV2(`${name}/${env}/Aurora-Postgres-Reader`, {
          instanceIdentifier: `${name}-${env}-aurora-reader-1`,
          scaleWithWriter: true,
        }),
      ],
      serverlessV2MinCapacity: 0.5, // Minimum ACU (0.5 is the lowest for PostgreSQL)
      serverlessV2MaxCapacity: 32, // Maximum ACU (adjust based on your needs)
      credentials: dbCredentials,
      defaultDatabaseName: `postgres`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      copyTagsToSnapshot: true,
      enableDataApi: true,
      deletionProtection: false,
      autoMinorVersionUpgrade: true,
      clusterIdentifier: `${name}-${env}-aurora`,
      securityGroups: [sgPostgres],
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: RetentionDays.SIX_MONTHS,
      storageEncrypted: true,
    });

    sgPostgres.addIngressRule(
      ec2.Peer.securityGroupId(sgPrivate.securityGroupId),
      ec2.Port.tcp(dbCluster.clusterEndpoint.port),
      `access postgres from ecs instances`,
    );

    // Route53 Hosted Zone
    const internalZone = new r53.HostedZone(this, `${name}/${env}/InternalZone`, {
      zoneName: `${name}-${env}.internal`,
      vpcs: [vpc],
    });

    new r53.CnameRecord(this, `${name}/${env}/Postgres-Alias`, {
      zone: internalZone,
      recordName: `postgres`,
      domainName: dbCluster.clusterEndpoint.hostname,
      deleteExisting: true,
    });

    new r53.CnameRecord(this, `${name}/${env}/Postgres-RO-Alias`, {
      zone: internalZone,
      recordName: `postgres-ro`,
      domainName: dbCluster.clusterReadEndpoint.hostname,
      deleteExisting: true,
    });

    // Redis (Elasticache)
    const redis = new elasticache.CfnServerlessCache(this, `${name}/${env}/Redis`, {
      serverlessCacheName: `${name}-${env}-redis`,
      securityGroupIds: [sgRedis.securityGroupId],
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      engine: 'redis',
    });

    sgRedis.addIngressRule(ec2.Peer.securityGroupId(sgPrivate.securityGroupId), ec2.Port.tcp(6379), `access redis from ecs instances`);

    // ECS Task Definition and Service (Docker build and deploy)
    const taskDef = new ecs.FargateTaskDefinition(this, `${name}/${env}/TaskDef`, {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    // Build and use the Dockerfile from the repo root for the ECS container
    // Import all env vars from Secrets Manager (assume one secret for app env, and one for DB)
    // App env secret
    const appEnvSecret = secretsmanager.Secret.fromSecretNameV2(this, `${name}/${env}/AppEnvSecret`, `${name}/${env}/app-env`);
    const sessionSecret = new secretsmanager.Secret(this, `${name}/${env}/SessionSecret`, {
      secretName: `${name}/${env}/API-Session-Secret`,
      generateSecretString: {
        passwordLength: 32,
      },
    });
    const jwtSecret = new secretsmanager.Secret(this, `${name}/${env}/JwtSecret`, {
      secretName: `${name}/${env}/API-Jwt-Secret`,
      generateSecretString: {
        passwordLength: 32,
      },
    });
    const csrfSecret = new secretsmanager.Secret(this, `${name}/${env}/CSRF-Secret`, {
      secretName: `${name}/${env}/API-CSRF-Secret`,
      generateSecretString: {
        passwordLength: 32,
      },
    });

    // Use the generated DB secret from the Aurora cluster
    const dbSecret = dbCluster.secret!;
    const db_username = dbSecret.secretValueFromJson('username').unsafeUnwrap();
    const db_password = dbSecret.secretValueFromJson('password').unsafeUnwrap();
    const db_host = dbCluster.clusterEndpoint.hostname;
    const db_port = dbSecret.secretValueFromJson('port').unsafeUnwrap();
    const db_url = `postgres://${db_username}:${db_password}@${db_host}:${db_port}/api`;
    const dbUrlSecret = new secretsmanager.Secret(this, `${name}/${env}/DbUrlSecret`, {
      secretName: `${name}/${env}/API-DB-URL`,
      secretStringValue: cdk.SecretValue.unsafePlainText(db_url),
    });

    taskDef.addContainer(`${name}-${env}-app`, {
      containerName: 'app',
      image: ecs.ContainerImage.fromAsset(path.resolve('..'), {
        file: 'Dockerfile',
        platform: Platform.LINUX_AMD64,
      }),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: `${name}-${env}` }),
      portMappings: [{ containerPort: 3000, name: 'http' }],
      environment: {
        REDIS_HOST: redis.attrEndpointAddress,
        REDIS_PORT: redis.attrEndpointPort,
      },
      secrets: {
        REDIS_MEMORY_THRESHOLD: ecs.Secret.fromSecretsManager(appEnvSecret, 'REDIS_MEMORY_THRESHOLD'),
        SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
        DATABASE_URL: ecs.Secret.fromSecretsManager(dbUrlSecret),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        JWT_EXPIRATION: ecs.Secret.fromSecretsManager(appEnvSecret, 'JWT_EXPIRATION'),
        CSRF_SECRET: ecs.Secret.fromSecretsManager(csrfSecret),
        CSRF_COOKIE_NAME: ecs.Secret.fromSecretsManager(appEnvSecret, 'CSRF_COOKIE_NAME'),
        STATSD_HOST: ecs.Secret.fromSecretsManager(appEnvSecret, 'STATSD_HOST'),
        SENTRY_DSN: ecs.Secret.fromSecretsManager(appEnvSecret, 'SENTRY_DSN'),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          // Wait for Postgres to be available before reporting healthy
          `pg_isready -h ${db_host} -p ${db_port} -U ${db_username} || exit 1`,
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 5,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    taskDef.defaultContainer = taskDef.findContainer(`app`);
    const fargateService = new ecs.FargateService(this, `${name}/${env}/API-Service`, {
      serviceName: 'api',
      cluster: cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      assignPublicIp: false,
      securityGroups: [sgPrivate],
      enableExecuteCommand: true,
      circuitBreaker: { rollback: true },
      serviceConnectConfiguration: {
        namespace: namespace.namespaceArn,
        services: [
          {
            portMappingName: 'http',
            discoveryName: 'api',
            port: 3000,
          },
        ],
      },
      enableECSManagedTags: true,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
    });

    const certificate = new Certificate(this, `${name}/${env}/TLS-Certificate`, {
      domainName: `*.${zoneName}`,
      validation: CertificateValidation.fromDns(hostedZone),
    });

    // Load Balancer for ECS Service
    const lb = new elb.ApplicationLoadBalancer(this, `${name}/${env}/ALB`, {
      vpc,
      internetFacing: true,
      loadBalancerName: `${name}-${env}-alb`,
    });
    const listener = lb.addListener(`${name}/${env}/PublicListener`, {
      protocol: elb.ApplicationProtocol.HTTPS,
      port: 443,
      open: true,
      sslPolicy: elb.SslPolicy.RECOMMENDED_TLS,
    });
    listener.addCertificates(`${name}/${env}/ListenerCertificate`, [
      {
        certificateArn: certificate.certificateArn,
      },
    ]);

    lb.addListener(`${name}/${env}/PublicRedirectListener`, {
      protocol: elb.ApplicationProtocol.HTTP,
      port: 80,
      open: true,
      defaultAction: elb.ListenerAction.redirect({
        port: `443`,
        protocol: elb.ApplicationProtocol.HTTPS,
        permanent: true,
      }),
    });

    listener.addTargets(`${name}/${env}/ECS`, {
      protocol: elb.ApplicationProtocol.HTTP,
      port: 3000,
      targets: [fargateService],
      healthCheck: { path: '/health' },
    });

    wafService(this, env, name, lb);
  }
}

export function statsdService(
  stack: cdk.Stack,
  env: string,
  name: string,
  cluster: ecs.Cluster,
  sgPrivate: ec2.SecurityGroup,
  namespace: servicediscovery.IPrivateDnsNamespace,
): ecs.FargateService {
  const taskDefinition = new ecs.FargateTaskDefinition(stack, `${name}/${env}/Yukon-Statsd-TaskDef`, {
    memoryLimitMiB: 2048,
    cpu: 512,
  });

  const logDriver = ecs.LogDrivers.awsLogs({
    logGroup: new logs.LogGroup(stack, `${name}/${env}/StatsdLogGroup`, {
      logGroupName: `/aws/ecs/containerinsights/${cluster.clusterName}/statsd`,
      removalPolicy: env == 'Prod' ? cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE : cdk.RemovalPolicy.DESTROY,
    }),
    streamPrefix: 'statsd',
  });

  const iamUser = new iam.User(stack, `${name}/${env}/Statsd-IAM-User`, {
    userName: `${name}-${env}-statsd-iam-user`,
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    ],
  });

  const accessKey = new iam.AccessKey(stack, `${name}/${env}/Statsd-IAM-User-AccessKey`, {
    user: iamUser,
  });

  const accessSecrets = new secretsmanager.Secret(stack, `${name}/${env}/Statsd-IAM-User-Secret`, {
    secretName: `${name}/${env}/statsd-iam-user-secret`,
    secretObjectValue: {
      namespace: cdk.SecretValue.unsafePlainText(`${name}.${env.toLocaleLowerCase()}`),
      region: cdk.SecretValue.unsafePlainText(stack.region),
      accessKeyId: cdk.SecretValue.unsafePlainText(accessKey.accessKeyId),
      secretAccessKey: accessKey.secretAccessKey,
    },
    description: 'Access keys for the statsd iam user',
  });

  const container = (taskDefinition.defaultContainer = taskDefinition.addContainer(`statsd`, {
    image: ecs.ContainerImage.fromRegistry('leamarty/statsd-cloudwatch-docker'),
    logging: logDriver,
    secrets: {
      CLOUDWATCH_NAMESPACE: ecs.Secret.fromSecretsManager(accessSecrets, 'namespace'),
      AWS_REGION: ecs.Secret.fromSecretsManager(accessSecrets, 'region'),
      AWS_KEY_ID: ecs.Secret.fromSecretsManager(accessSecrets, 'accessKeyId'),
      AWS_KEY: ecs.Secret.fromSecretsManager(accessSecrets, 'secretAccessKey'),
    },
    containerName: 'statsd',
  }));

  container.addPortMappings({
    name: 'statsd',
    containerPort: 8125,
    protocol: ecs.Protocol.TCP,
  });

  container.addPortMappings({
    containerPort: 8125,
    protocol: ecs.Protocol.UDP,
  });

  const service = new ecs.FargateService(stack, `${name}/${env}/Statsd-Yukon`, {
    cluster: cluster,
    desiredCount: 2,
    serviceName: 'statsd',
    taskDefinition: taskDefinition,
    assignPublicIp: false,
    enableECSManagedTags: true,
    securityGroups: [sgPrivate],
    enableExecuteCommand: true,
    circuitBreaker: { rollback: true },
    serviceConnectConfiguration: {
      namespace: namespace.namespaceArn,
      services: [
        {
          portMappingName: 'statsd',
          discoveryName: 'statsd',
          port: 8125,
        },
      ],
    },
  });

  const scalableTarget = service.autoScaleTaskCount({
    minCapacity: 1,
    maxCapacity: 20,
  });

  scalableTarget.scaleOnCpuUtilization('CpuScaling', {
    targetUtilizationPercent: 50,
  });

  return service;
}
