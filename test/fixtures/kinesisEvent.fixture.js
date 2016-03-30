var messageWithoutError = {
    status: "success",
    front: "myFront",
    isLive: false,
    message: "message"
}

var messageWithError = {
    status: "error",
    front: "myFront",
    isLive: false,
    message: "message"
}

module.exports = {
    withoutError: {
        Records: [{
            kinesis: {
                data: JSON.stringify(messageWithoutError).toString('base64'),
                sequenceNumber: 0
            }
        }]
    },
    withError: {
        Records: [{
            kinesis: {
                data: JSON.stringify(messageWithError).toString('base64'),
                sequenceNumber: 0
            }
        }]
    }
};
