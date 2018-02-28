import ava from 'ava';
import sinon from 'sinon';
import {storeEvents} from '../tmp/lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';
import errorParser from '../lambda/util/errorParser';

const date = new Date('2016-03-24').toISOString();
const dynamoWithGenericPutAndGet = {
    getItem: function (record, callback) {
        callback(null, {data: null});
    },
    putItem: function (recod, callback) {
        callback(null, null);
    }
};

function dynamoUpdateForErrors (record, callback) {
    if (record.Key.frontId) {
        callback(null, {
            Attributes: {
                stageName: { S: 'live' },
                statusCode: { S: 'success' },
                frontId: { S: record.Key.frontId.S },
                errorCount: { N: '4' },
                messageText: { S: 'error' }
            }
        });

    } else {
      callback(null, null);
    }
}

const today = new Date();

function invoke (event, dynamo, post, prod, today) {

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

ava.test('error with parenthesis is parsed correctly', function (test) {
    const topLevelError = 'Some(my.test.error: error)';
    const error = topLevelError + ' There was an error';
    const parsedError = errorParser.parse(error);
    test.is(parsedError, topLevelError);
});

ava.test('error without parenthesis gets parsed correctly', function (test) {
    const error = ' There was an error';
    const parsedError = errorParser.parse(error);
    test.is(parsedError, error);
});

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

    invoke(kinesisEvent.withoutError, dynamo, false, today);
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

    invoke(kinesisEvent.withError, dynamo, false, today);
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
    return invoke(kinesisEvent.withoutError, dynamo, false, today)
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
    invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

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

    invoke(kinesisEvent.withoutError, dynamo, postSpy, false, today);

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

    invoke(kinesisEvent.withoutError, dynamo, postSpy, false, today);

    test.true(dynamoSpy.calledOnce);
    test.false(postSpy.called);

    return invoke(kinesisEvent.withoutError, dynamo, post, false, today);
});

ava.test('send email when seeing a new error', function (test) {
    test.plan(5);

    const dynamo = Object.assign(dynamoWithGenericPutAndGet, {
        updateItem: function (record, callback) {
            callback(null, {
                Attributes: {
                    stageName: { S: 'live' },
                    statusCode: { S: 'success' },
                    frontId: { S: record.Key.frontId.S },
                    errorCount: { N: '4' },
                    messageText: { S: 'error' }
                }
            });
        }
    });

    const post = function () {
        return Promise.resolve();
    };

    const dynamoGetSpy = sinon.spy(dynamo, 'getItem');
    const dynamoPutSpy = sinon.spy(dynamo, 'putItem');
    const dynamoUpdateSpy = sinon.spy(dynamo, 'updateItem');

    const postSpy = sinon.spy(post);
    invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

    test.true(dynamoUpdateSpy.calledOnce);
    test.true(dynamoGetSpy.calledOnce);

    test.true(postSpy.calledWith(sinon.match(function (value) {
      const body = JSON.parse(value.body);
      return body.event_type === 'trigger' &&
        body.description.match(/myFront/i) &&
        value.url.match(/pagerduty/);
    })));

    test.true(dynamoPutSpy.calledWith(
        sinon.match.has(
            'Item', sinon.match.has(
                'error', sinon.match.has('S', 'error')
            )
        )
    ));
    test.true(dynamoPutSpy.calledWith(
        sinon.match.has(
            'Item', sinon.match.has(
                'lastSeen', sinon.match.has('N', today.valueOf())
            )
        )
    ));
});

ava.test('send email when seeing an old error', function (test) {
    test.plan(4);

    const dynamo = {

        updateItem: dynamoUpdateForErrors,

        getItem: function (record, callback) {
            callback(null, {
                Item: {
                    error: { S: 'error'},
                    lastSeen: { N: new Date().setMinutes(today.getMinutes() - 120) }
                }
            });
        }
    };

    const post = function () {
        return Promise.resolve();
    };

    const dynamoGetSpy = sinon.spy(dynamo, 'getItem');
    const dynamoUpdateSpy = sinon.spy(dynamo, 'updateItem');

    const postSpy = sinon.spy(post);
    invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

    test.true(dynamoGetSpy.calledOnce);

    test.true(postSpy.calledWith(sinon.match(function (value) {
      const body = JSON.parse(value.body);
      return body.event_type === 'trigger' &&
        body.description.match(/myFront/i) &&
        value.url.match(/pagerduty/);
    })));

    test.true(dynamoUpdateSpy.calledWith(
        sinon.match.has(
            'Key', sinon.match.has(
                'error', sinon.match.has('S', 'error')
            )
        )
    ));

    test.true(dynamoUpdateSpy.calledWith(
        sinon.match.has(
            'AttributeUpdates', sinon.match.has(
                'lastSeen', sinon.match.has(
                    'Value', sinon.match.has('N', today.valueOf())
                  )
            )
        )
    ));

});

ava.test('do not send an email if error has been seen recently', function (test) {
    test.plan(4);

    const dynamo = {
        updateItem: dynamoUpdateForErrors,

        getItem: function (record, callback) {
            callback(null, {
                Item: {
                    error: { S: 'error'},
                    lastSeen: { N: today.valueOf() }
                }
            });
        }
    };

    const post = function () {
        return Promise.resolve();
    };

    const dynamoGetSpy = sinon.spy(dynamo, 'getItem');
    const dynamoUpdateSpy = sinon.spy(dynamo, 'updateItem');

    const postSpy = sinon.spy(post);
    invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

    test.true(dynamoGetSpy.calledOnce);

    test.true(postSpy.notCalled);

    test.true(dynamoUpdateSpy.calledWith(
        sinon.match.has(
            'Key', sinon.match.has(
                'error', sinon.match.has('S', 'error')
            )
        )
    ));

    test.true(dynamoUpdateSpy.calledWith(
        sinon.match.has(
            'AttributeUpdates', sinon.match.has(
                'lastSeen', sinon.match.has(
                    'Value', sinon.match.has('N', today.valueOf())
                  )
            )
        )
    ));
});

