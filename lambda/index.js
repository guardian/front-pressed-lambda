import config from '../tmp/config.json';
import AWS from 'aws-sdk';
import mapLimit from 'async-es/mapLimit';
import emailTemplate from './email-template';

AWS.config.region = config.AWS.region;

const PARALLEL_JOBS = 4;
const STAGE = (process.env.AWS_LAMBDA_FUNCTION_NAME || 'CODE')
    .split('-')
    .filter(token => /(CODE?|PROD?)/.test(token))
    .pop();
const ROLE_TO_ASSUME = config.AWS.roleToAssume[STAGE];
const TABLE_NAME = config.dynamo[STAGE].tableName;

export function handler (event, context, callback) {
    const today = new Date();
    const sts = new AWS.STS();

    sts.assumeRole({
        RoleArn: ROLE_TO_ASSUME,
        RoleSessionName: 'lambda-assume-role',
        DurationSeconds: 900
    }, (err, data) => {
        if (err) {
            console.error('Error assuming cross account role', err);
            callback(err);
        } else {
            const stsCredentials = data.Credentials;
            const assumedCredentials = new AWS.Credentials(
                stsCredentials.AccessKeyId,
                stsCredentials.SecretAccessKey,
                stsCredentials.SessionToken
            );
            const dynamo = new AWS.DynamoDB({
                credentials: assumedCredentials
            });
            const lambda = new AWS.Lambda({
                credentials: assumedCredentials
            });
            storeEvents({event, dynamo, lambda, isoDate: today.toISOString(), logger: console, callback});
        }
    });
}

export function storeEvents ({event, callback, dynamo, isoDate, logger, lambda}) {
    const jobs = { started: 0, completed: 0, total: event.Records.length };

    mapLimit(
        event.Records,
        PARALLEL_JOBS,
        (record, jobCallback) => putRecordToDynamo({jobs, record, dynamo, isoDate, logger, callback: jobCallback, lambda}),
        err => {
            if (err) {
                logger.error('Error processing records', err);
                callback(new Error('Error when processing records: ' + err.message));
            } else {
                logger.log('DONE');
                callback(null, 'Processed ' + event.Records.length + ' records.');
            }
        }
    );
}

function putRecordToDynamo ({jobs, record, dynamo, isoDate, callback, logger, lambda}) {
    const jobId = ++jobs.started;

    logger.log('Process job ' + jobId + ' in ' + record.kinesis.sequenceNumber);

    const buffer = new Buffer(record.kinesis.data, 'base64');
    const data = JSON.parse(buffer.toString('utf8'));
    const updateExpression = 'SET pressedTime=:time, statusCode=:status, messageText=:message' +
        (data.status === 'ok' ? ', errorCount=:count' : ' ADD errorCount :count');

    return dynamo.updateItem({
        TableName: TABLE_NAME,
        Key: {
            stageName: {
                S: data.isLive ? 'live' : 'draft'
            },
            frontId: {
                S: data.front
            }
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: {
            ':count': {
                N: data.status === 'ok' ? '0' : '1'
            },
            ':time': {
                S: isoDate
            },
            ':status': {
                S: data.status
            },
            ':message': {
                S: data.message || data.status
            }
        },
        ReturnValues: 'ALL_NEW'
    }, (err, updatedItem) => {
        if (err) {
            logger.error('Error while processing ' + jobId, err);
            callback(err);
        } else {
            maybeNotifyPressBroken({item: updatedItem, logger, callback, lambda});
        }
    });
}

function maybeNotifyPressBroken ({item, logger, callback, lambda}) {
    logger.log('about to send email', item);
    if (item && item.thisIsNeverHappening) {
        logger.log('Sending email');
        lambda.invoke({
            FunctionName: config.email.lambda,
            InvocationType: 'Event',
            Payload: JSON.stringify({
                from: config.email.from,
                to: config.email.to,
                subject: 'Front press error',
                template: emailTemplate,
                env: {
                    front: item.front,
                    count: item.errorCount,
                    faciaPath: config.facia[STAGE].path
                }
            })
        }, (err) => {
            if (err) {
                logger.error(err);
            }
            callback();
        });
    } else {
        process.nextTick(() => callback());
    }
}
