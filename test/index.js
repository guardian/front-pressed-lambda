import ava from 'ava';
import index from '../lambda/index';
import kinesisEvent from './fixtures/kinesisEvent.fixture';

function failAfter (time, test) {
    return setTimeout(() => {
        test.fail('timed out after  ', time + ' ms');
        test.end()
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

ava.test.cb('item to dynamo from kinesis', test => {
    const timeout = failAfter(1000, test);
    const context = createContext(() => {
        test.is(context.spies.succeed.length, 1, 'Expecting succeed calls');
        test.is(context.spies.fail.length, 0, 'Expecting fail calls');
        clearTimeout(timeout);
        test.end();
    });

    var date = new Date('2016-03-24')

    index.processEvents(kinesisEvent, context, {
        putItem(record, callback) {
            test.same(record.Item.id.S, 'myFront');
            test.same(record.Item.pressedTime.S, date.toISOString());
            callback(null);
        }
    }, date);
});

