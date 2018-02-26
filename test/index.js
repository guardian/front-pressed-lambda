import ava from 'ava';
import {storeEvents} from '../tmp/lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';
import sinon from 'sinon';

const date = new Date('2016-03-24').toISOString();
const dynamoWithGenericPutAndGet = {
    getItem: function (record, callback) {
        callback(null, {data: null});
    },
    putItem: function (recod, callback) {
        callback(null, null);
    }
};

function invoke (event, dynamo, post, prod) {

    const today = new Date();
    return new Promise((resolve, reject) => {
        storeEvents({
            event, dynamo, post, isoDate: date, isProd: !!prod, today: today, logger: {
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
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' }
                }
            });
        }
    };

    const spy = sinon.spy(dynamo, 'updateItem');

    invoke(kinesisEvent.withoutError, dynamo);
    test.true(spy.calledOnce);
    test.true(spy.calledWith(
        sinon.match.has(
            'Key', sinon.match.has(
                'frontId', sinon.match.has('S', 'myFront')
            )
        )
    ));

    test.true(spy.calledWith(
        sinon.match.has(
            'ExpressionAttributeValues', sinon.match.has(
                ':time', sinon.match.has('S', date)
              )
        )
    ));

});

ava.test('front pressed error is stored correctly', function (test) {
    const dynamo = {
        updateItem: function (record, callback) {
            callback(null, {
                Attributes: {
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S }
                }
            });
        }
    };

    const spy = sinon.spy(dynamo, 'updateItem');

    invoke(kinesisEvent.withError, dynamo);
    test.true(spy.calledOnce);
    test.true(spy.calledWith(
        sinon.match.has(
            'Key', sinon.match.has(
                'frontId', sinon.match.has('S', 'myFront')
            )
        )
    ));

    test.true(spy.calledWith(
        sinon.match.has(
            'ExpressionAttributeValues', sinon.match.has(
                ':time', sinon.match.has('S', date)
              )
        )
    ));
});

ava.test('dynamo DB error makes the lambda fail', function (test) {

    test.plan(3);
    const dynamo = {
        updateItem: function (record, callback) {

            callback(new Error('some error'));
        }
    };

    const spy = sinon.spy(dynamo, 'updateItem');
    spy;
    return invoke(kinesisEvent.withoutError, dynamo)
    .catch(err => {
        test.true(spy.calledWith(
            sinon.match.has(
                'Key', sinon.match.has(
                    'frontId', sinon.match.has('S', 'myFront')
                )
            )
        ));

        test.true(spy.calledWith(
            sinon.match.has(
                'ExpressionAttributeValues', sinon.match.has(
                    ':time', sinon.match.has('S', date)
                  )
            )
        ));
        test.regex(err.message, /some error/);
    });
});

ava.test('send email when error count is above threshold on PROD and live', function (test) {
    test.plan(3);

    const dynamo = Object.assign(dynamoWithGenericPutAndGet, {
        updateItem: function (record, callback) {
            callback(null, {
                Attributes: {
                    stageName: { S: 'live' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    });

    const post = function () {
        return Promise.resolve();
    };

    const dynamoSpy = sinon.spy(dynamo, 'updateItem');

    const postSpy = sinon.spy(post);
    invoke(kinesisEvent.withoutError, dynamo, postSpy, true);

    test.true(dynamoSpy.calledWith(
        sinon.match.has(
            'Key', sinon.match.has(
                'frontId', sinon.match.has('S', 'myFront')
            )
        )
    ));

    test.true(dynamoSpy.calledWith(
        sinon.match.has(
            'ExpressionAttributeValues', sinon.match.has(
                ':time', sinon.match.has('S', date)
              )
        )
    ));

    test.true(postSpy.calledWith(sinon.match(function (value) {
      const body = JSON.parse(value.body);
      return body.event_type === 'trigger' &&
        body.description.match(/myFront/i) &&
        value.url.match(/pagerduty/);
    })));

});

ava.test('does not send email on CODE even when error count is above threshold', function (test) {
    test.plan(2);

    const dynamo = Object.assign(dynamoWithGenericPutAndGet, {
        updateItem: function (record, callback) {
            callback(null, {
                Attributes: {
                    stageName: { S: 'live' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    });

    const post = function () {
        return Promise.resolve;
    };
    const dynamoSpy = sinon.spy(dynamo, 'updateItem');
    const postSpy = sinon.spy(post);

    invoke(kinesisEvent.withoutError, dynamo, postSpy, false);

    test.true(dynamoSpy.calledOnce);
    test.false(postSpy.called);
});

ava.test('does not send email on DRAFT even when error count is above threshold', function (test) {
    test.plan(2);

    const dynamo = Object.assign(dynamoWithGenericPutAndGet, {
        updateItem: function (record, callback) {
            callback(null, {
                Attributes: {
                    stageName: { S: 'draft' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' }
                }
            });
        }
    });

    const post = function () {
        return Promise.resolve;
    };

    const dynamoSpy = sinon.spy(dynamo, 'updateItem');
    const postSpy = sinon.spy(post);

    invoke(kinesisEvent.withoutError, dynamo, postSpy, false);

    test.true(dynamoSpy.calledOnce);
    test.false(postSpy.called);

    return invoke(kinesisEvent.withoutError, dynamo, post, false);
});
