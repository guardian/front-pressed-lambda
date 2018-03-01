import config from '../tmp/config.json';
import AWS from 'aws-sdk';
import mapLimit from 'async-es/mapLimit';
import { post as postUtil } from 'simple-get-promise';
import errorParser from './util/errorParser';

AWS.config.region = config.AWS.region;

const ERROR_THRESHOLD = 3;
const PARALLEL_JOBS = 4;
const STAGE = (process.env.AWS_LAMBDA_FUNCTION_NAME || 'CODE')
    .split('-')
    .filter(token => /(CODE?|PROD?)/.test(token))
    .pop();
const ROLE_TO_ASSUME = config.AWS.roleToAssume[STAGE];
const TABLE_NAME = config.dynamo[STAGE].tableName;
const ERRORS_TABLE_NAME = config.dynamo[STAGE].errorsTableName;
const STALE_ERROR_THRESHOLD_MINUTES = 30;
const TIME_TO_LIVE_HOURS = 24;

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
            storeEvents({event, dynamo, lambda, isoDate: today.toISOString(), logger: console, callback, isProd: STAGE === 'PROD', post: postUtil, today: today});
        }
    });
}

export function storeEvents ({event, callback, dynamo, isoDate, logger, post, isProd, today}) {
    const jobs = { started: 0, completed: 0, total: event.Records.length };

    mapLimit(
        event.Records,
        PARALLEL_JOBS,
        (record, jobCallback) => putRecordToDynamo({jobs, record, dynamo, isoDate, logger, isProd, callback: jobCallback, post, today}),
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

function putRecordToDynamo ({jobs, record, dynamo, isoDate, isProd, callback, logger, post, today}) {
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
            maybeNotifyPressBroken({item: updatedItem, logger, isProd, post, dynamo, today, callback});
        }
    });
}

function maybeNotifyPressBroken ({item, logger, isProd, post, dynamo, today, callback}) {
    const attributes = item ? item.Attributes : {};
    const errorCount = attributes.errorCount
        ? parseInt(item.Attributes.errorCount.N, 10) : 0;
    const error = errorParser.parse(attributes.messageText ? attributes.messageText.S : 'unknown error');
    const frontId = attributes.frontId ? attributes.frontId.S : 'unknown';

    const isLive = attributes.stageName ? attributes.stageName.S === 'live' : false;
    if (isLive && errorCount >= ERROR_THRESHOLD) {

        dynamo.getItem({
            TableName: ERRORS_TABLE_NAME,
            Key: {
                error: {
                    S: error
                }
            }
        }, (err, data) => {

            if (err) {
                logger.error('Error while fetching error item with message ', err);
                callback();
            }

            if (data && data.Item) {

                const affectedFronts = new Set(data.Item.affectedFronts.SS);
                affectedFronts.add(frontId);


                const updateErrorData = {
                    TableName: ERRORS_TABLE_NAME,
                    Key: {
                        error: {
                            S: error
                        }
                    },
                    AttributeUpdates: {
                        lastSeen: {
                            Value: {
                                N: today.valueOf().toString()
                            },
                            Action: 'PUT'
                        },
                        affectedFronts: {
                            Value: {
                                SS: Array.fromSet(affectedFronts)
                            },
                            Action: 'PUT'
                        }
                    }
                };

                dynamo.updateItem(updateErrorData, (err) => {
                    if (err) {
                        logger.error('Error while fetching error item with message ', err);
                        callback();
                    } else {
                        const lastSeen = new Date(parseInt(data.Item.lastSeen.N));
                        const lastSeenThreshold = new Date().setMinutes(today.getMinutes() - STALE_ERROR_THRESHOLD_MINUTES);
                        if (lastSeen.valueOf() > lastSeenThreshold) {
                          logger.info('RECENT ERROR - don\'t alert');
                        }
                        if (lastSeen.valueOf() < lastSeenThreshold) {
                          logger.info('ALERT!!');
                        }
                        if (lastSeen.valueOf() < lastSeenThreshold && isProd) {
                            return sendAlert(attributes, frontId, errorCount, error, dynamo, post, logger)
                            .then(callback)
                            .catch(callback);
                        } else {
                            callback();
                        }
                    }
                });
          } else {

              const newErrorData = {
                  TableName: ERRORS_TABLE_NAME,
                  Item: {
                      error: {
                          S: error
                      },
                      ttl: {
                          N: new Date().setHours(today.getHours() + TIME_TO_LIVE_HOURS).valueOf().toString()
                      },
                      lastSeen: {
                          N: today.valueOf().toString()
                      },
                      affectedFronts: {
                          SS: [frontId]
                      }
                  }
              };

              dynamo.putItem(newErrorData, (err) => {
                  if (err) {
                      logger.error('Error while fetching error item with message ', err);
                      callback();
                  } else {
                      if (isProd) {
                          return sendAlert(attributes, frontId, errorCount, error, dynamo, post, logger)
                          .then(callback)
                          .catch(callback);
                      } else {
                          callback();
                      }
                  }
              });
          }
        });
    } else {
      callback();
    }
}

function sendAlert (attributes, frontId, errorCount, error, dynamo, post, logger) {

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

