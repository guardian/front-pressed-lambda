import config from '../tmp/config.json';
import AWS from 'aws-sdk';
import mapLimit from 'async-es/mapLimit';

AWS.config.region = config.AWS.region;

const PARALLEL_JOBS = 4;
const STAGE = (process.env.AWS_LAMBDA_FUNCTION_NAME || 'CODE')
    .split('-')
    .filter(token => /(CODE?|PROD?)/.test(token))
    .pop();
const ROLE_TO_ASSUME = config.AWS.roleToAssume[STAGE];
const TABLE_NAME = config.dynamo[STAGE].tableName;

export function handler (event, context) {
    const today = new Date();
    const sts = new AWS.STS();

    sts.assumeRole({
        RoleArn: ROLE_TO_ASSUME,
        RoleSessionName: 'lambda-assume-role',
        DurationSeconds: 900
    }, (err, data) => {
        if (err) {
            console.error(err.message);
            context.fail('Error assuming cross account role');
        } else {
            const stsCredentials = data.Credentials;
            const dynamo = new AWS.DynamoDB({
                credentials: new AWS.Credentials(
                    stsCredentials.AccessKeyId,
                    stsCredentials.SecretAccessKey,
                    stsCredentials.SessionToken
                )
            });
            storeEvents({event, context, dynamo, isoDate: today.toISOString()});
        }
    });
}

export function storeEvents ({event, context, dynamo, isoDate}) {
    const jobs = { started: 0, completed: 0, total: event.Records.length };

    mapLimit(
        event.Records,
        PARALLEL_JOBS,
        (record, callback) => putRecordToDynamo({jobs, record, dynamo, isoDate, callback}),
        err => {
            if (err) {
                console.error('Error processing records', err);
                context.fail('Error when processing records');
            } else {
                console.log('DONE');
                context.succeed('Processed ' + event.Records.length + ' records.');
            }
        }
    );
}

function putRecordToDynamo ({jobs, record, dynamo, isoDate, callback}) {
    const jobId = ++jobs.started;

    console.log('Process job ' + jobId + ' in ' + record.kinesis.sequenceNumber);

    const buffer = new Buffer(record.kinesis.data, 'base64');
    const data = JSON.parse(buffer.toString('utf8'));
    const updateExpression = 'SET pressedTime=:time, statusCode=:status, messageText=:message' +
        (data.status === 'ok' ? ', errorCount=:count' : ' ADD errorCount :count');

    return dynamo.updateItem({

        TableName: TABLE_NAME,
        Key: {
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
        }
    }, (err) => {
        if (err) {
            console.error('Error while processing ' + jobId, err);
            callback(err);
        } else {
            callback();
        }
    });
}
