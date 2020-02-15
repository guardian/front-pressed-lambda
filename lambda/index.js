import AWS from "aws-sdk";
import { mapLimit } from "async";
import { post as postUtil } from "simple-get-promise";
import errorParser from "./util/errorParser";

const config =
  process.env.NODE_ENV === "test"
    ? require("../test/test-config.json")
    : require("../tmp/config.json");

AWS.config.region = config.AWS.region;

export const ERROR_THRESHOLD = 3;
const NUMBER_OF_PARALLEL_JOBS = 4;
const STAGE = (process.env.AWS_LAMBDA_FUNCTION_NAME || "CODE")
  .split("-")
  .filter(token => /(CODE?|PROD?)/.test(token))
  .pop();
const ROLE_TO_ASSUME = config.AWS.roleToAssume[STAGE];
const TABLE_NAME = config.dynamo[STAGE].tableName;
const ERRORS_TABLE_NAME = config.dynamo[STAGE].errorsTableName;
const STALE_ERROR_THRESHOLD_MINUTES = 30;
const TIME_TO_LIVE_HOURS = 24;
const MAX_INCIDENT_LENGTH = 250;

export async function handler(event) {
  const today = new Date();
  const sts = new AWS.STS();

  const data = await sts
    .assumeRole({
      RoleArn: ROLE_TO_ASSUME,
      RoleSessionName: "lambda-assume-role",
      DurationSeconds: 900
    })
    .promise()
    .catch(err => {
      console.error("Error assuming cross account role", err);
    });

  const stsCredentials = data.Credentials;
  const assumedCredentials = new AWS.Credentials(
    stsCredentials.AccessKeyId,
    stsCredentials.SecretAccessKey,
    stsCredentials.SessionToken
  );
  const dynamo = new AWS.DynamoDB({ credentials: assumedCredentials });
  const lambda = new AWS.Lambda({ credentials: assumedCredentials });

  await storeEvents({
    event,
    dynamo,
    lambda,
    isoDate: today.toISOString(),
    logger: console,
    isProd: STAGE === "PROD",
    post: postUtil,
    today: today
  }).catch(err => console.error("storeEvents error:", err));
}

export async function storeEvents({
  event,
  dynamo,
  isoDate,
  logger,
  post,
  isProd,
  today
}) {
  const jobs = { started: 0, completed: 0, total: event.Records.length };
  await mapLimit(
    event.Records,
    NUMBER_OF_PARALLEL_JOBS,
    async (record, jobCallback) => {
      await putRecordToDynamo({
        jobs,
        record,
        dynamo,
        isoDate,
        logger,
        isProd,
        callback: jobCallback ? jobCallback : () => {},
        post,
        today
      }).catch(err => {
        logger.error("Error processing records", err);
        throw err;
      });
    }
  );
  logger.log("DONE");
  logger.log("Processed " + event.Records.length + " records.");
}

async function putRecordToDynamo({
  jobs,
  record,
  dynamo,
  isoDate,
  isProd,
  callback,
  logger,
  post,
  today
}) {
  const jobId = ++jobs.started;

  logger.log("Process job " + jobId + " in " + record.kinesis.sequenceNumber);

  const buffer = new Buffer.from(record.kinesis.data, "base64");
  const data = JSON.parse(buffer.toString("utf8"));
  const action = {
    SET: ["actionTime=:time", "statusCode=:status", "messageText=:message"]
  };
  if (data.status === "ok") {
    action.SET.push("pressedTime=:time", "errorCount=:count");
  } else {
    action.ADD = ["errorCount :count"];
  }
  const updateExpression = Object.keys(action)
    .map(key => `${key} ${action[key].join(", ")}`)
    .join(" ");

  const updatedItem = await dynamo
    .updateItem({
      TableName: TABLE_NAME,
      Key: {
        stageName: { S: data.isLive ? "live" : "draft" },
        frontId: { S: data.front }
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: {
        ":count": { N: data.status === "ok" ? "0" : "1" },
        ":time": { S: isoDate },
        ":status": { S: data.status },
        ":message": { S: data.message || data.status }
      },
      ReturnValues: "ALL_NEW"
    })
    .promise()
    .catch(err => {
      logger.error("Error while processing " + jobId, err);
      callback(err);
    });

  await maybeNotifyPressBroken({
    item: updatedItem,
    logger,
    isProd,
    post,
    dynamo,
    today,
    callback
  });
}

async function maybeNotifyPressBroken({
  item,
  logger,
  isProd,
  post,
  dynamo,
  today,
  callback
}) {
  const attributes = item ? item.Attributes : {};
  const errorCount = attributes.errorCount
    ? parseInt(item.Attributes.errorCount.N, 10)
    : 0;
  const error = errorParser.parse(
    attributes.messageText ? attributes.messageText.S : "unknown error"
  );
  const frontId = attributes.frontId ? attributes.frontId.S : "unknown";

  const isLive = attributes.stageName
    ? attributes.stageName.S === "live"
    : false;

  if (isLive && errorCount >= ERROR_THRESHOLD) {
    const data = await dynamo
      .getItem({
        TableName: ERRORS_TABLE_NAME,
        Key: { error: { S: error } }
      })
      .promise()
      .catch(err => {
        logger.error("Error while fetching error item with message ", err);
        callback();
      });
    if (data && data.Item) {
      const lastSeen = new Date(parseInt(data.Item.lastSeen.N));
      const lastSeenThreshold = new Date().setMinutes(
        today.getMinutes() - STALE_ERROR_THRESHOLD_MINUTES
      );
      const errorIsStale = lastSeen.valueOf() < lastSeenThreshold;

      let affectedFronts = new Set(data.Item.affectedFronts.SS);

      if (errorIsStale) {
        affectedFronts = [frontId];
      } else {
        const frontSet = new Set(data.Item.affectedFronts.SS);
        affectedFronts = Array.from(frontSet.add(frontId));
      }

      const updateErrorData = getErrorUpdateData(error, affectedFronts, today);

      await dynamo
        .updateItem(updateErrorData)
        .promise()
        .catch(err => {
          logger.error("Error while fetching error item with message ", err);
          callback();
        });
      if (errorIsStale && isProd) {
        return await sendAlert(
          attributes,
          frontId,
          errorCount,
          error,
          dynamo,
          post,
          logger
        );
      }
      callback();
    } else {
      const newErrorData = getErrorCreateData(error, today, frontId);

      await dynamo
        .putItem(newErrorData)
        .promise()
        .catch(async err => {
          logger.error("Error while fetching error item with message ", err);
          callback();
          if (isProd) {
            return await sendAlert(
              attributes,
              frontId,
              errorCount,
              error,
              dynamo,
              post,
              logger,
              "trigger"
            );
          }
          callback();
        });
    }
  } else {
    callback();
  }
}

function getErrorUpdateData(error, affectedFronts, today) {
  return {
    TableName: ERRORS_TABLE_NAME,
    Key: { error: { S: error } },
    AttributeUpdates: {
      lastSeen: {
        Value: { N: today.valueOf().toString() },
        Action: "PUT"
      },
      affectedFronts: {
        Value: { SS: affectedFronts },
        Action: "PUT"
      }
    }
  };
}

function getErrorCreateData(error, today, frontId) {
  const timeToLive = Math.floor(
    new Date().setHours(today.getHours() + TIME_TO_LIVE_HOURS).valueOf() / 1000
  );
  return {
    TableName: ERRORS_TABLE_NAME,
    Item: {
      error: { S: error },
      ttl: { N: timeToLive.toString() },
      lastSeen: { N: today.valueOf().toString() },
      affectedFronts: { SS: [frontId] }
    }
  };
}

export async function sendAlert(
  attributes,
  frontId,
  errorCount,
  error,
  dynamo,
  post,
  logger
) {
  logger.log("Notifying PagerDuty");
  return await post({
    url: "https://events.pagerduty.com/generic/2010-04-15/create_event.json",
    body: JSON.stringify({
      // eslint-disable-next-line camelcase
      service_key: config.pagerduty.key,
      // eslint-disable-next-line camelcase
      event_type: "trigger",
      // eslint-disable-next-line camelcase
      incident_key: error.substring(0, MAX_INCIDENT_LENGTH),
      description: `Front ${frontId} failed pressing`,
      details: {
        front: frontId,
        stage: attributes.stageName ? attributes.stageName.S : "unknown",
        count: errorCount,
        error: error
      },
      client: "Press monitor",
      // eslint-disable-next-line camelcase
      client_url: `${config.facia[STAGE].path}/troubleshoot/stale/${frontId}`
    })
  });
}
