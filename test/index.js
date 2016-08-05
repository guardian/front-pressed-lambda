import ava from 'ava';
import {storeEvents} from '../tmp/lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';

const date = new Date('2016-03-24').toISOString();
function invoke (event, dynamo, post, prod) {
    return new Promise((resolve, reject) => {
        storeEvents({
            event, dynamo, post, isoDate: date, isProd: !!prod, logger: {
                error () {}, log () {}
            }, callback (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            }
        });
    });
}

ava.test('front pressed correctly is stored correctly', function (test) {
    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' }
                }
            });
        }
    };

    return invoke(kinesisEvent.withoutError, dynamo);
});

ava.test('front pressed error is stored correctly', function (test) {
    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S }
                }
            });
        }
    };

    return invoke(kinesisEvent.withError, dynamo);
});

ava.test('dynamo DB error makes the lambda fail', function (test) {
    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(new Error('some error'));
        }
    };

    return invoke(kinesisEvent.withoutError, dynamo)
        .catch(err => {
            test.regex(err.message, /some error/);
        });
});

ava.test('send email when error count is above threshold on PROD and live', function (test) {
    test.plan(5);

    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    stageName: { S: 'live' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    };
    const post = function (request) {
        const body = JSON.parse(request.body);
        test.regex(request.url, /pagerduty/);
        test.is(body.event_type, 'trigger');
        test.regex(body.description, /myFront.*failed.*live.*4 times.*/i);
        return Promise.resolve();
    };

    return invoke(kinesisEvent.withoutError, dynamo, post, true);
});

ava.test('does not send email on CODE even when error count is above threshold', function (test) {
    test.plan(2);

    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    stageName: { S: 'live' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    };
    const post = function () {
        test.fail('Pagerduty should not be called');
        return Promise.reject();
    };

    return invoke(kinesisEvent.withoutError, dynamo, post, false);
});

ava.test('does not send email on DRAFT even when error count is above threshold', function (test) {
    test.plan(2);

    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    stageName: { S: 'draft' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    };
    const post = function () {
        test.fail('Lambda should not be invoked');
        return Promise.reject();
    };

    return invoke(kinesisEvent.withoutError, dynamo, post, false);
});
