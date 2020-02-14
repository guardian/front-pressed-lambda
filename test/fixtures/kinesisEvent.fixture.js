const messageWithoutError = {
  status: "success",
  front: "myFront",
  isLive: false,
  message: "message"
};

const messageWithError = {
  status: "error",
  front: "myFront",
  isLive: false,
  message: "message"
};

function encode(message) {
  const buffer = new Buffer.from(JSON.stringify(message), "utf8");
  return buffer.toString("base64");
}

module.exports = {
  withoutError: {
    Records: [
      {
        kinesis: {
          data: encode(messageWithoutError),
          sequenceNumber: 0
        }
      }
    ]
  },
  withError: {
    Records: [
      {
        kinesis: {
          data: encode(messageWithError),
          sequenceNumber: 0
        }
      }
    ]
  }
};
