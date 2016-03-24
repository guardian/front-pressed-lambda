var message = {
    status: "error",
    front: "myFront",
    isLive: false,
    message: "message"
}

module.exports = {
    Records: [{
        kinesis: {
            data: JSON.stringify(message).toString('base64'),
            sequenceNumber: 0
        }
    }]
};
