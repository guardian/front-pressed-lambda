import ava from 'ava';
import {storeEvents as lambda} from '../tmp/lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';

function createContext (callback) {
    const succeed = [];
    const fail = [];
    return {
        succeed: function (...args) {
            succeed.push(args);
            callback();
        },
        fail: function (...args) {
            fail.push(args);
            callback();
        },
        spies: {
            succeed,
            fail
        }
    };
}


const date = new Date('2016-03-24').toISOString();
function invoke (event, context, dynamo) {
    lambda({
        event, context, dynamo, isoDate: date, logger: {
            error () {}, log () {}
        }
    });
}

ava.test.cb.serial('front pressed correctly', function (test) {
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 1, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 0, 'Expecting fail calls');
        test.end();
    });
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

    invoke(kinesisEvent.withoutError, context, dynamo);
});

ava.test.cb.serial('front pressed error', function (test) {
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 1, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 0, 'Expecting fail calls');
        test.end();
    });
    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' },
                    id: { S: record.Key.frontId.S }
                }
            });
        }
    };

    invoke(kinesisEvent.withError, context, dynamo);
});

ava.test.cb.serial('dynamo DB error', function (test) {
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 0, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 1, 'Expecting fail calls');
        test.end();
    });
    const dynamo = {
        updateItem: function (record, callback) {
            test.deepEqual(record.Key.frontId.S, 'myFront');
            test.deepEqual(record.ExpressionAttributeValues[':time'].S, date);
            callback(new Error('some error'));
        }
    };

    invoke(kinesisEvent.withoutError, context, dynamo);
});
