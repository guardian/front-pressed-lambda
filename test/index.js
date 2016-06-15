import ava from 'ava';
import {storeEvents} from '../tmp/lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';

const date = new Date('2016-03-24').toISOString();
function invoke (event, dynamo, lambda, prod) {
    return new Promise((resolve, reject) => {
        storeEvents({
            event, dynamo, lambda, isoDate: date, isProd: !!prod, logger: {
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

ava.test('send email when error count is above threshold on PROD', function (test) {
    test.plan(4);

    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    };
    const lambda = {
        invoke (invocation, callback) {
            const payload = JSON.parse(invocation.Payload);
            test.is(payload.env.front, 'myFront');
            test.is(payload.env.count, 4);
            callback();
        }
    };

    return invoke(kinesisEvent.withoutError, dynamo, lambda, true);
});

ava.test('does not send email on code even when error count is above threshold', function (test) {
    test.plan(2);

    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    };
    const lambda = {
        invoke (invocation, callback) {
            test.fail('Lambda should not be invoked');
            callback(new Error('Lambda should not be invoked'));
        }
    };

    return invoke(kinesisEvent.withoutError, dynamo, lambda, false);
});
