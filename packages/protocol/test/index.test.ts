import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_CODES,
  InvalidNotificationRequestError,
  isHttpUrl,
  validateNotificationRequest
} from "../src/index.js";

describe("notification protocol", () => {
  it("accepts the documented notification shape", () => {
    assert.deepEqual(
      validateNotificationRequest({
        title: "构建完成",
        body: "任务执行成功",
        source: "ci",
        url: "https://example.com/build/123",
        metadata: { buildId: 123 }
      }),
      {
        title: "构建完成",
        body: "任务执行成功",
        source: "ci",
        url: "https://example.com/build/123",
        metadata: { buildId: 123 }
      }
    );
  });

  it("rejects missing required fields", () => {
    assert.throws(
      () => validateNotificationRequest({ title: "Only a title" }),
      (error: unknown) =>
        error instanceof InvalidNotificationRequestError &&
        error.code === ERROR_CODES.INVALID_REQUEST &&
        error.message === "body is required"
    );
  });

  it("rejects unsupported URLs and non-object metadata", () => {
    assert.throws(() =>
      validateNotificationRequest({
        title: "Title",
        body: "Body",
        url: "javascript:alert(1)"
      })
    );
    assert.throws(() =>
      validateNotificationRequest({
        title: "Title",
        body: "Body",
        metadata: []
      })
    );
  });

  it("recognizes only http and https URLs", () => {
    assert.equal(isHttpUrl("http://localhost:8765"), true);
    assert.equal(isHttpUrl("https://example.com/path"), true);
    assert.equal(isHttpUrl("file:///tmp/example"), false);
    assert.equal(isHttpUrl("not a URL"), false);
  });
});
