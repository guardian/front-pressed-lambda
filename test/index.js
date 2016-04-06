import ava from 'ava';
import sinon from 'sinon';
import index from '../tmp/lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';

function failAfter (time, test) {
    return setTimeout(() => {
        test.fail('timed out after  ', time + ' ms');
        test.end();
    }, time);
}

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

const emailService = {
    sendEmail: function (email, callback) {
        callback(null);
    }
};

ava.test.beforeEach(() => {
    sinon.spy(emailService, 'sendEmail');
});

ava.test.afterEach(() => {
    emailService.sendEmail.restore();
});

ava.test.cb.serial('item to dynamo from kinesis when no error', function (test) {
    const timeout = failAfter(1000, test);
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 1, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 0, 'Expecting fail calls');
        test.false(emailService.sendEmail.called);
        clearTimeout(timeout);
        test.end();
    });

    index.processEvents(kinesisEvent.withoutError, context, {
        updateItem: function (record, callback) {
            test.same(record.Key.frontId.S, 'myFront');
            test.same(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' }
                }
            });
        }
    }, date);
});

ava.test.cb.serial.skip('item to dynamo from kinesis when error', function (test) {
    const timeout = failAfter(1000, test);
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 1, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 0, 'Expecting fail calls');
        test.true(emailService.sendEmail.calledOnce);
        clearTimeout(timeout);
        test.end();
    });

    index.processEvents(kinesisEvent.withError, context, {
        updateItem: function (record, callback) {
            test.same(record.Key.frontId.S, 'myFront');
            test.same(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' },
                    id: { S: record.Key.frontId.S }
                }
            });
        }
    }, date, emailService);
});

ava.test.cb.serial('update item but don\'t send an email if status already error', function (test) {
    const timeout = failAfter(1000, test);
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 1, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 0, 'Expecting fail calls');
        test.false(emailService.sendEmail.called);
        clearTimeout(timeout);
        test.end();
    });

    index.processEvents(kinesisEvent.withError, context, {
        updateItem: function (record, callback) {
            test.same(record.Key.frontId.S, 'myFront');
            test.same(record.ExpressionAttributeValues[':time'].S, date);
            callback(null, {
                Attributes: {
                    statusCode: { S: 'error' },
                    id: { S: record.Key.frontId.S }
                }
            });
        }
    }, date, emailService);
});
