import config from '../tmp/config.json';
import AWS from 'aws-sdk';
import mapLimit from 'async-es/mapLimit';
import { post as postUtil } from 'simple-get-promise';

AWS.config.region = config.AWS.region;

const ERROR_THRESHOLD = 3;
const TOTAL_ERRORS_THRESHOLD = 10; //TODO: Validate & change this value
const PARALLEL_JOBS = 4;
const STAGE = (process.env.AWS_LAMBDA_FUNCTION_NAME || 'CODE')
    .split('-')
    .filter(token => /(CODE?|PROD?)/.test(token))
    .pop();
const ROLE_TO_ASSUME = config.AWS.roleToAssume[STAGE];
const TABLE_NAME = config.dynamo[STAGE].tableName;
const ERRORS_TABLE_NAME = config.dynamo[STAGE].errorsTableName;

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
            storeEvents({event, dynamo, lambda, isoDate: today.toISOString(), logger: console, callback, isProd: STAGE === 'PROD', post: postUtil});
        }
    });
}

export function storeEvents ({event, callback, dynamo, isoDate, logger, post, isProd}) {
    const jobs = { started: 0, completed: 0, total: event.Records.length };

    mapLimit(
        event.Records,
        PARALLEL_JOBS,
        (record, jobCallback) => putRecordToDynamo({jobs, record, dynamo, isoDate, logger, isProd, callback: jobCallback, post}),
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

function putRecordToDynamo ({jobs, record, dynamo, isoDate, isProd, callback, logger, post}) {
    const jobId = ++jobs.started;

    logger.log('Process job ' + jobId + ' in ' + record.kinesis.sequenceNumber);

    const buffer = new Buffer(record.kinesis.data, 'base64');
    const data = JSON.parse(buffer.toString('utf8'));
    const action = {
        SET: ['actionTime=:time', 'statusCode=:status', 'messageText=:message']
    };
    if (data.status === 'ok') {
        action.SET.push('pressedTime=:time', 'errorCount=:count');
    } else {
        action.ADD = ['errorCount :count'];
    }
    const updateExpression = Object.keys(action).map(key => `${key} ${action[key].join(', ')}`).join(' ');

    dynamo.updateItem({
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
          //TODO: Is this in the right place?
            var currentTime = new Date().getTime;
            var expireTime = currentTime + 900000; // Adds 15 mins
            logError(data.frontId, currentTime, expireTime, logger, dynamo, function () {
              maybeNotifyPressBroken({item: updatedItem, logger, isProd, post, dynamo})
              .then(() => callback())
              .catch(callback);
            });
        }
    });
}

function maybeNotifyPressBroken ({item, logger, isProd, post, dynamo}) {
    const attributes = item ? item.Attributes : {};
    const errorCount = attributes.errorCount
        ? parseInt(item.Attributes.errorCount.N, 10) : 0;
    const frontId = attributes.frontId ? attributes.frontId.S : 'unknown';
    const error = attributes.messageText ? attributes.messageText.S : 'unknown error';
    const isLive = attributes.stageName ? attributes.stageName.S === 'live' : false;

    if (isProd && isLive && errorCount >= ERROR_THRESHOLD) {
        var timeRange = new Date().getTime - 900000;
        var params = {
          TableName: ERRORS_TABLE_NAME,
          KeyConditionExpression: 'time > :maxTime',
          ExpressionAttributeValues: {
            'maxTime':timeRange
            }
          };
        dynamo.query(params, function (err, data) {
          if (err) {
            logger.error('Unable to retrieve total errors from Dynamo');
          }
          else {
            if (data.Count <= TOTAL_ERRORS_THRESHOLD) {
              logger.log('Notifying pagerduty');
              return post({
                  url: 'https://events.pagerduty.com/generic/2010-04-15/create_event.json',
                  body: JSON.stringify({
                      // eslint-disable-next-line camelcase
                      service_key: config.pagerduty.key,
                      // eslint-disable-next-line camelcase
                      event_type: 'trigger',
                      // eslint-disable-next-line camelcase
                      incident_key: frontId,
                      description: `Front ${frontId} failed pressing`,
                      details: {
                          front: frontId,
                          stage: attributes.stageName ? attributes.stageName.S : 'unknown',
                          count: errorCount,
                          error: error
                      },
                      client: 'Press monitor',
                      // eslint-disable-next-line camelcase
                      client_url: `${config.facia[STAGE].path}/troubleshoot/stale/${frontId}`
                  })
              });
            }
          }
        });
    } else {
        return Promise.resolve();
    }
}

function logError (frontId, time, expirationTime, logger, dynamo, callback) {
  var params = {
    Item: {
     'errorId': {
       S: uuidv4()
      },
     'time': {
       I: time
       },
     'expirationTime': {
       I: expirationTime
       },
     'frontId': {
       S: frontId
       }
    },
    TableName: ERRORS_TABLE_NAME
  };
  dynamo.putItem(params, function (err) {
    if (err) logger.error('Unable to write item to table. Item = ${params.Item}');
    else callback;
  });
}

function uuidv4 () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
