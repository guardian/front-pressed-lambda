import kinesisEvent from "./fixtures/kinesisEvent.fixture";
import errorParser from "../lambda/util/errorParser";
import { ERROR_THRESHOLD, storeEvents } from "../lambda/index";
import {jest} from "@jest/globals";
// import { get } from "simple-get-promise";

const SHOW_LOGS = false;

const date = new Date("2016-03-24").toISOString();

import config from "../test/test-config.json";

async function invoke(event, dynamo, post, prod, today) {
  const logger = SHOW_LOGS
    ? {
        error: console.error,
        log: console.log
      }
    : {
        error: console.error,
        log: () => {}
      };

  return await storeEvents({
    config,
    event,
    dynamo,
    post,
    isoDate: date,
    isProd: !!prod,
    today,
    logger
  });
}

const today = new Date();

const updateItemParams = (success, stageName) => ({
  ExpressionAttributeValues: {
    ":count": { N: "1" },
    ":message": { S: "message" },
    ":status": { S: success ? "success" : "error" },
    ":time": { S: date }
  },
  Key: { frontId: { S: "myFront" }, stageName: { S: stageName } },
  ReturnValues: "ALL_NEW",
  TableName: "codeTableName",
  UpdateExpression:
    "SET actionTime=:time, statusCode=:status, messageText=:message ADD errorCount :count"
});

const updateItemResponse = (overThreshold, stageName) => ({
  Attributes: {
    errorCount: {
      N: overThreshold ? ERROR_THRESHOLD + 1 : ERROR_THRESHOLD - 1
    },
    messageText: { S: "someMessage" },
    frontId: { S: "someFrontId" },
    stageName: { S: stageName }
  }
});

const getItemResponse = (
  affectedFronts,
  lastSeen = today.valueOf().toString(),
  error = false
) => {
  let response = {
    Item: {
      lastSeen: { N: lastSeen },
      affectedFronts: { SS: affectedFronts }
    }
  };
  if (error) response.error = { S: "error" };
  return response;
};

const promisify = (returnedValue, success = true) => ({
  promise: () =>
    new Promise((resolve, reject) => {
      const resolution = success ? resolve : reject;
      resolution(returnedValue);
    })
});

const mockedDynamoClient = (overThreshold = true, stageName) => ({
  updateItem: () => promisify(updateItemResponse(overThreshold, stageName)),
  getItem: () => promisify(getItemResponse()),
  putItem: () => promisify({ putItemResponse: true })
});

const dynamoUpdateForErrors = frontId => ({
  Attributes: {
    stageName: { S: "live" },
    statusCode: { S: "success" },
    frontId: { S: frontId },
    errorCount: { N: "4" },
    messageText: { S: "error" }
  }
});

describe("handler", () => {
  it("error with parenthesis is parsed correctly", () => {
    const topLevelError = "Some(my.test.error: error)";
    const error = topLevelError + " There was an error";
    const parsedError = errorParser.parse(error);
    expect(parsedError).toEqual(topLevelError);
  });

  it("error without parenthesis gets parsed correctly", () => {
    const error = " There was an error";
    const parsedError = errorParser.parse(error);
    expect(parsedError).toEqual(error);
  });

  describe("storeEvents", () => {
    let updateItemSpy;
    let getItemSpy;
    let putItemSpy;
    let postSpy;
    let dynamo;

    beforeEach(() => {
      dynamo = mockedDynamoClient(true, "live");
      updateItemSpy = jest.spyOn(dynamo, "updateItem");
      getItemSpy = jest.spyOn(dynamo, "getItem");
      postSpy = jest.fn();
    });

    it("front pressed correctly is stored correctly", async () => {
      await invoke(kinesisEvent.withoutError, dynamo, jest.fn(), false, today);
      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(true, "draft")
      );
    });

    it("front pressed error is stored correctly", async () => {
      await invoke(kinesisEvent.withError, dynamo, jest.fn(), false, today);

      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(false, "draft")
      );
    });

    it("alert PagerDuty when error count is above threshold on PROD and live", async () => {
      dynamo = mockedDynamoClient(true, "live");
      dynamo.getItem = jest.fn(() =>
        promisify(
          getItemResponse(
            ["someFront"],
            new Date().setMinutes(today.getMinutes() - 60).toString()
          )
        )
      );
      getItemSpy = jest.spyOn(dynamo, "getItem");
      updateItemSpy = jest.spyOn(dynamo, "updateItem");
      getItemSpy = jest.spyOn(dynamo, "getItem");

      await invoke(
        kinesisEvent.withoutError,
        dynamo,
        postSpy,
        true,
        today
      ).catch(err => console.error(err));

      expect(getItemSpy).toHaveBeenCalledWith({
        Key: { error: { S: "someMessage" } },
        TableName: "codeErrTableName"
      });

      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(true, "draft")
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
      const postParamsBody = JSON.parse(postSpy.mock.calls[0][0].body);
      expect(postParamsBody.event_type).toEqual("trigger");
      expect(postSpy.mock.calls[0][0].url).toEqual(
        "https://events.pagerduty.com/generic/2010-04-15/create_event.json"
      );
    });

    it("does not alert PagerDuty on CODE even when error count is above threshold", () => {
      invoke(kinesisEvent.withoutError, dynamo, postSpy, false, today);

      expect(getItemSpy).not.toHaveBeenCalled();
      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(true, "draft")
      );
      expect(postSpy).not.toHaveBeenCalled();
    });

    it("does not get items if error count is below threshold", () => {
      invoke(kinesisEvent.withoutError, dynamo, postSpy, false, today);

      expect(getItemSpy).not.toHaveBeenCalled();

      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(true, "draft")
      );

      expect(postSpy).not.toHaveBeenCalled();
    });

    it("does not alert PagerDuty on DRAFT even when error count is above threshold", () => {
      invoke(kinesisEvent.withoutError, dynamo, postSpy, false, today);

      expect(postSpy).not.toHaveBeenCalled();
      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(true, "draft")
      );
    });

    it("alert PagerDuty when seeing a new error", async () => {
      dynamo.getItem = jest.fn(() => promisify({}, true));
      dynamo.putItem = jest.fn(() => promisify({}, false));
      getItemSpy = jest.spyOn(dynamo, "getItem");
      putItemSpy = jest.spyOn(dynamo, "putItem");

      await invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

      expect(updateItemSpy).toHaveBeenCalledTimes(1);
      expect(updateItemSpy).toHaveBeenCalledWith(
        updateItemParams(true, "draft")
      );
      expect(getItemSpy).toHaveBeenCalled();
      expect(putItemSpy).toHaveBeenCalledTimes(1);
      expect(putItemSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            affectedFronts: { SS: ["someFrontId"] },
            error: { S: "someMessage" },
            lastSeen: { N: today.valueOf().toString() }
          }),
          TableName: "codeErrTableName"
        })
      );

      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url:
            "https://events.pagerduty.com/generic/2010-04-15/create_event.json"
        })
      );
      expect(JSON.parse(postSpy.mock.calls[0][0].body)).toEqual(
        expect.objectContaining({
          service_key: "pagerdutyKey",
          event_type: "trigger",
          incident_key: "someMessage",
          description: "Front someFrontId failed pressing"
        })
      );
    });

    it("alert PagerDuty when seeing an old error", async () => {
      dynamo.getItem = jest.fn(() =>
        promisify({
          Item: {
            error: { S: "error" },
            lastSeen: { N: new Date().setMinutes(today.getMinutes() - 120) },
            affectedFronts: { SS: [] }
          }
        })
      );
      getItemSpy = jest.spyOn(dynamo, "getItem");

      dynamo.updateItem = jest.fn(() =>
        promisify(dynamoUpdateForErrors("someFront1"))
      );
      updateItemSpy = jest.spyOn(dynamo, "updateItem");

      await invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

      expect(getItemSpy).toHaveBeenCalledTimes(1);
      expect(postSpy).toHaveBeenCalledTimes(1);
      const postSpyCallBody = JSON.parse(postSpy.mock.calls[0][0].body);

      expect(postSpyCallBody).toEqual(
        expect.objectContaining({
          event_type: "trigger",
          description: "Front someFront1 failed pressing"
        })
      );

      expect(updateItemSpy).toHaveBeenCalledTimes(2);
      expect(updateItemSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          TableName: "codeTableName"
        })
      );
      expect(updateItemSpy.mock.calls[1][0].AttributeUpdates.lastSeen).toEqual(
        expect.objectContaining({
          Action: "PUT",
          Value: { N: today.valueOf().toString() }
        })
      );
      expect(updateItemSpy.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          Key: { error: { S: "error" } }
        })
      );
    });

    xit("Alerts to PagerDuty if error has been seen recently", async () => {
      dynamo.getItem = jest.fn(() =>
        promisify(getItemResponse([], today.valueOf().toString(), true))
      );
      getItemSpy = jest.spyOn(dynamo, "getItem");
      dynamo.updateItem = jest.fn(() =>
        promisify(dynamoUpdateForErrors("someFront2"))
      );
      updateItemSpy = jest.spyOn(dynamo, "updateItem");

      await invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

      expect(getItemSpy).toHaveBeenCalledTimes(1);
      expect(postSpy).toHaveBeenCalledTimes(1);

      expect(updateItemSpy).toHaveBeenCalledTimes(2);
      expect(updateItemSpy.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          Key: expect.objectContaining({ error: { S: "error" } })
        })
      );
      expect(updateItemSpy.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          AttributeUpdates: expect.objectContaining({
            lastSeen: expect.objectContaining({
              Value: { N: today.valueOf().toString() }
            })
          })
        })
      );
    });

    it("Record frontId when error reoccurs", async () => {
      dynamo.updateItem = jest.fn(() =>
        promisify(dynamoUpdateForErrors("someFront3"))
      );
      updateItemSpy = jest.spyOn(dynamo, "updateItem");

      dynamo.getItem = jest.fn(() =>
        promisify(getItemResponse(["testFront"], today.valueOf().toString()))
      );
      getItemSpy = jest.spyOn(dynamo, "getItem");

      await invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

      const secondCall = updateItemSpy.mock.calls[1][0];
      expect(updateItemSpy).toHaveBeenCalledTimes(2);
      expect(secondCall).toEqual(
        expect.objectContaining({
          AttributeUpdates: expect.objectContaining({
            affectedFronts: expect.objectContaining({
              Value: expect.objectContaining({
                SS: ["testFront", "someFront3"]
              })
            })
          })
        })
      );
    });

    it("Discard old affected fronts if error is stale", async () => {
      dynamo.updateItem = jest.fn(() =>
        promisify(dynamoUpdateForErrors("newBrokenFront"))
      );
      updateItemSpy = jest.spyOn(dynamo, "updateItem");

      dynamo.getItem = jest.fn(() =>
        promisify(
          getItemResponse(
            ["staleBrokenFront"],
            new Date().setMinutes(today.getMinutes() - 60).toString(),
            true
          )
        )
      );

      getItemSpy = jest.spyOn(dynamo, "getItem");

      await invoke(kinesisEvent.withoutError, dynamo, postSpy, true, today);

      const secondCall = updateItemSpy.mock.calls[1][0];

      expect(updateItemSpy).toHaveBeenCalledTimes(2);
      expect(secondCall).toEqual(
        expect.objectContaining({
          AttributeUpdates: expect.objectContaining({
            affectedFronts: expect.objectContaining({
              Value: expect.objectContaining({
                SS: ["newBrokenFront"]
              })
            })
          })
        })
      );
    });
  });
});
