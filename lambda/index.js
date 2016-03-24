var AWS = require('aws-sdk');
var async = require('async');
var config = require('./config');

var dynamodb = new AWS.DynamoDB({
    region: config.dynamo.region
});

const TABLE_NAME = config.dynamo.tableName;

exports.handler = function (event, context) {
    const today = new Date();
    this.processEvents(event, context, dynamodb, today);
}

exports.processEvents = function (event, context, dynamo, date) {
    const job = { started: 0, completed: 0, total: event.Records.length };

    var mapLimit = async.mapLimit;

    mapLimit(event.Records, 3, putItemToDynamo.bind(job, dynamo, date), function(err) {
        if (err) {
            console.error('Error processing records', err);
            context.fail('Error when processing records');
        } else {
            console.log('DONE');
            context.succeed('Processed ' + event.Records.length + ' records.');
        }
    });
}

function putItemToDynamo(dynamo, date, record, callback) {

    const job = this;
    const jobId = ++job.started;

    console.log('Process job ' + jobId + ' in ' + record.kinesis.sequenceNumber);

    var data = JSON.parse(record.kinesis.data);
    return dynamo.putItem({
        TableName: TABLE_NAME,
        Item: {
            id: {
                S: data.front
            },
            pressedTime: {
                S: date.toISOString()
            },
            status: {
                S: data.status
            },
            message: {
                S: data.message
            }
        },
        }, function (err, data) {
            job.completed += 1;
            if (err) {
                console.error('Error while processing ' + jobId + ' in ' + record.kinesis.sequenceNumber, err);
            }
        callback(err);
    });
};
