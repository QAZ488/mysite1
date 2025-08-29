import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { Distribution,  } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import type { Construct } from "constructs";

export class Test111Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // フロントエンドホスティング (S3 + CloudFront)
    
    const frontendBucket = new Bucket(this, "FrontendBucket", {
      bucketName: "11-plmkoibqazws",
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
    });

     
   
       const distribution = new Distribution(this, "Distribution", {
         defaultRootObject: "index.html",
         defaultBehavior: {
           origin: S3BucketOrigin.withOriginAccessControl(frontendBucket),
         },
       });

      new BucketDeployment(this, "DeployWebsite", {
      sources: [Source.asset(path.join(__dirname, '../website'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    //  Cognitoユーザープール (認証・認可)
    
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: "11user-pool",
      selfSignUpEnabled: true,
      signInAliases: { username: true },
      autoVerify: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    
    // 管理者と一般ユーザーのグループを定義
   
    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: userPool.userPoolId,
      groupName: '11Admins',
      description: 'Administrators with full access',
    });
    new cognito.CfnUserPoolGroup(this, 'UsersGroup', {
      userPoolId: userPool.userPoolId,
      groupName: '11Users',
      description: 'General users with limited access',
    });

    const client = userPool.addClient('UserPoolClient', {
      userPoolClientName: '11client',
      generateSecret: false,
      oAuth: {
        callbackUrls: [`https://d1wjhpo1wxjae.cloudfront.net/index.html`],
        logoutUrls: [`https://d1wjhpo1wxjae.cloudfront.net/index.html`],
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE, cognito.OAuthScope.COGNITO_ADMIN],
      },
    });

     const COGNITO_DOMAIN_PREFIX = 'test-1111';
    
         //  ドメイン
          userPool.addDomain('UserPoolDomain', {
          cognitoDomain: { domainPrefix: COGNITO_DOMAIN_PREFIX },
          
          managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        });



         // マネージドログイン
         new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
           userPoolId: userPool.userPoolId,
           clientId: client.userPoolClientId,
           useCognitoProvidedValues: true,
         });


    
    // DynamoDBテーブル 

    const historyTable = new dynamodb.Table(this, 'HistoryTable', {
      tableName: '11table',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // S3バケット (ファイルアップロード用)

    const uploadBucket = new Bucket(this, "UploadBucket", {
      bucketName: "11plmkoibqazq-upload",
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Lambda関数 

    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda/')),
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: historyTable.tableName,
        UPLOAD_BUCKET_NAME: uploadBucket.bucketName,
        USER_POOL_ID: userPool.userPoolId,
      },
    });

    const fileProcessor = new lambda.Function(this, 'FileProcessor', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda2/')),
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: historyTable.tableName,
      },
    });

    
    // DynamoDB読み書き、S3へのアップロード権限、Cognitoユーザー管理権限

    historyTable.grantReadWriteData(apiHandler);
    uploadBucket.grantPut(apiHandler);
    uploadBucket.grantRead(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
      ],
      resources: [userPool.userPoolArn],
    }));

    //  S3からファイルを取得し、DynamoDBに書き込む権限

    historyTable.grantReadWriteData(fileProcessor);
    uploadBucket.grantRead(fileProcessor);
    uploadBucket.grantWrite(fileProcessor);

    //  API Gateway 
    
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLog', {
      logGroupName: '11access-log',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

     const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: '11_API',
     deployOptions: {
     stageName: '11prod', 
     tracingEnabled: true, 
     dataTraceEnabled: true,
     loggingLevel: apigateway.MethodLoggingLevel.ERROR,
     accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
     accessLogFormat: apigateway.AccessLogFormat.clf()
          },
        });


    // Cognito Authorizer

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: '11authorizer',
    });

    // API Gatewayリソースとメソッド

    const usersResource = api.root.addResource('users');
    usersResource.addMethod('POST', new apigateway.LambdaIntegration(apiHandler), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(apiHandler), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });

    const historyResource = api.root.addResource('history');
    historyResource.addMethod('GET', new apigateway.LambdaIntegration(apiHandler), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });

    // S3イベント通知 

    uploadBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(fileProcessor),
    );
  }
}
