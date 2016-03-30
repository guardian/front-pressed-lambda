var async = require('async');
var config = require('./config');
var fs = require('fs');
var nunjucks = require('nunjucks');
var path = require('path');

var AWS = require('aws-sdk');
AWS.config.region = config.AWS.region;

var ses = new AWS.SES({apiVersion: '2010-12-01'});

var dynamodb = new AWS.DynamoDB();

var TABLE_NAME = config.dynamo.tableName;

exports.handler = function (event, context) {
    var today = new Date();
    this.processEvents(event, context, dynamodb, today, ses);
}

exports.processEvents = function (event, context, dynamo, date, emailService) {
    var job = { started: 0, completed: 0, total: event.Records.length };

    var mapLimit = async.mapLimit;

    mapLimit(event.Records, 3, putItemToDynamo.bind(job, dynamo, date, emailService), function(err) {
        if (err) {
            console.error('Error processing records', err);
            context.fail('Error when processing records');
        } else {
            console.log('DONE');
            context.succeed('Processed ' + event.Records.length + ' records.');
        }
    });
}

function putItemToDynamo(dynamo, date, emailService, record, callback) {

    var job = this;
    var jobId = ++job.started;

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
        ReturnValues: 'ALL_OLD'

    }, function (err, response) {

        job.completed += 1;

        if (err) {
            console.error('Error while processing ' + jobId + ' in ' + record.kinesis.sequenceNumber, err);
            callback(err);
        } else {

            if (response.Attributes.status.S === 'success' && data.status === 'error') {
                sendEmail(response.Attributes.id.S, emailService, function (err, data) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            } else {
                callback(null);
            }

        }
    });
};

function sendEmail(frontId, emailService, callback) {

    var filePath = path.join(__dirname, 'email_template.txt');

    fs.readFile(filePath, {encoding: 'utf-8'}, function(err, data) {

        if (err) {
            callback(err);
        } else {

            var emailFields = data.split('\n');
            var emailMessage = nunjucks.renderString(emailFields[4], {frontId: frontId});
            var toAddresses = [emailFields[1].split(' ')[1]];
            var email ={
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


