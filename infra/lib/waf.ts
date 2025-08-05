import * as cdk from 'aws-cdk-lib/core';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';

// This extends the base cdk stack properties to include a tag name input.
export interface StackProps extends cdk.StackProps {
  tag: string;
  applicationName?: string;
}

export function wafService(stack: cdk.Stack, env: string, name: string, alb: ApplicationLoadBalancer): void {
  const waf = new WAF(stack, `${name}/${env}/WAFv2`, env, name);
  // Create an association with the prod alb
  new WebACLAssociation(stack, `${name}/${env}/WAF-Association`, {
    resourceArn: alb.loadBalancerArn,
    webAclArn: waf.attrArn,
  });
}

interface WafRule {
  name: string;
  rule: wafv2.CfnWebACL.RuleProperty;
}

const awsManagedRules: WafRule[] = [
  // AWS IP Reputation list includes known malicious actors/bots and is regularly updated
  {
    name: 'AWS-AWSManagedRulesAmazonIpReputationList',
    rule: {
      name: 'AWS-AWSManagedRulesAmazonIpReputationList',
      priority: 10,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesAmazonIpReputationList',
        },
      },
      overrideAction: {
        none: {},
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'AWSManagedRulesAmazonIpReputationList',
      },
    },
  },
  // Common Rule Set aligns with major portions of OWASP Core Rule Set
  {
    name: 'AWS-AWSManagedRulesCommonRuleSet',
    rule: {
      name: 'AWS-AWSManagedRulesCommonRuleSet',
      priority: 20,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
          // Excluding generic RFI body rule for sns notifications
          // https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-list.html
          excludedRules: [{ name: 'GenericRFI_BODY' }, { name: 'SizeRestrictions_BODY' }],
        },
      },
      overrideAction: {
        none: {},
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'AWS-AWSManagedRulesCommonRuleSet',
      },
    },
  },
  // Blocks common SQL Injection
  {
    name: 'AWSManagedRulesSQLiRuleSet',
    rule: {
      name: 'AWSManagedRulesSQLiRuleSet',
      priority: 30,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'AWSManagedRulesSQLiRuleSet',
      },
      overrideAction: {
        none: {},
      },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesSQLiRuleSet',
          excludedRules: [],
        },
      },
    },
  },
  // Blocks common PHP attacks such as using high risk variables and methods in the body or queries
  {
    name: 'AWSManagedRulePHP',
    rule: {
      name: 'AWSManagedRulePHP',
      priority: 40,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'AWSManagedRulePHP',
      },
      overrideAction: {
        none: {},
      },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesPHPRuleSet',
          excludedRules: [],
        },
      },
    },
  },
  // Blocks attacks targeting LFI(Local File Injection) for linux systems
  {
    name: 'AWSManagedRuleLinux',
    rule: {
      name: 'AWSManagedRuleLinux',
      priority: 50,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'AWSManagedRuleLinux',
      },
      overrideAction: {
        none: {},
      },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesLinuxRuleSet',
          excludedRules: [],
        },
      },
    },
  },
];

export class WAF extends wafv2.CfnWebACL {
  constructor(scope: Construct, id: string, env: string, name: string) {
    super(scope, id, {
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${name}/${env}/waf`,
        sampledRequestsEnabled: false,
      },
      scope: 'REGIONAL',
      name: `${name}-${env}-WAF`,
      rules: awsManagedRules.map((wafRule) => wafRule.rule),
    });
  }
}

export class WebACLAssociation extends wafv2.CfnWebACLAssociation {
  constructor(scope: Construct, id: string, props: wafv2.CfnWebACLAssociationProps) {
    super(scope, id, {
      resourceArn: props.resourceArn,
      webAclArn: props.webAclArn,
    });
  }
}
