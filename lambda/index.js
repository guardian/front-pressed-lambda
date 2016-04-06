import mapLimit from 'async-es/mapLimit';
// import fs from 'fs';
import config from '../tmp/config.json';
// import nunjucks from 'nunjucks';
// import path from 'path';
import AWS from 'aws-sdk';
AWS.config.region = config.AWS.region;

const PARALLEL_JOBS = 3;
const STAGE = (process.env.AWS_LAMBDA_FUNCTION_NAME || 'CODE')
    .split('-')
    .filter(token => /(CODE?|PROD?)/.test(token))
    .pop();
const TABLE_NAME = config.dynamo[STAGE].tableName;

export function handler (event, context) {
    const today = new Date();
    const ses = new AWS.SES({apiVersion: '2010-12-01'});
    const dynamodb = new AWS.DynamoDB();
    processEvents(event, context, dynamodb, today.toISOString(), ses);
}

export function processEvents (event, context, dynamo, isoDate, emailService) {
    const job = { started: 0, completed: 0, total: event.Records.length };

    mapLimit(
        event.Records,
        PARALLEL_JOBS,
        (record, callback) => putItemToDynamo(job, dynamo, isoDate, emailService, record, callback),
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

function putItemToDynamo (job, dynamo, isoDate, emailService, record, callback) {
    const jobId = ++job.started;

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
        },
        ReturnValues: 'ALL_OLD'
    }, (err, response) => {
        if (err) {
            console.error('Error while processing ' + jobId, err);
            callback(err);
        } else {
            notifyInCaseOfErrors(response, data, job, jobId, emailService, callback);
        }
    });
}

function notifyInCaseOfErrors (response, data, job, jobId, emailService, callback) {
    if (response.Attributes.statusCode.S === 'success' && data.status === 'error') {
        sendEmail(response.Attributes.frontId.S, emailService, function (err) {
            job.completed += 1;
            if (err) {
                callback(err);
            } else {
                callback(null);
            }
        });
    } else {
        job.completed += 1;
        callback(null);
    }
}

function sendEmail (frontId, emailService, callback) {
    return callback();
    const filePath = path.join(__dirname, 'email_template.txt');

    fs.readFile(filePath, {encoding: 'utf-8'}, function(err, data) {

        if (err) {
            callback(err);
        } else {

            const emailFields = data.split('\n');
            const emailMessage = nunjucks.renderString(emailFields[4], {frontId: frontId});
            const toAddresses = [emailFields[1].split(' ')[1]];
            const email ={
                Source: emailFields[0].split(' ')[1],
                Destination: { ToAddresses: toAddresses },
                Message: {
                    Subject: {
                        Data: emailFields[2]
                    },
                    Body: {
                        Html: {
                            Data: '<html><body>' + emailMessage + '</body></html>'
                        }
                    }
                }
            };

            emailService.sendEmail(email, function(err, data) {
                if (err) {
                    callback(err);
                } else {
                    callback(null);
                }
            });
        }
    });
}


