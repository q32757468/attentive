import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_CODES,
  InvalidNotificationRequestError,
  isHttpUrl,
  isOpenUri,
  MAX_OPEN_URI_LENGTH,
  MAX_WINDOW_CONTEXT_RESPONSE_BYTES,
  WINDOW_CONTEXT_VERSION,
  parseWindowContextResponse,
  validateNotificationRequest
} from "../src/index.js";

describe("notification protocol", () => {
  it("accepts the documented notification shape", () => {
    assert.deepEqual(
      validateNotificationRequest({
        title: "构建完成",
        body: "任务执行成功",
        source: "ci",
        action: { type: "open-uri", uri: "https://example.com/build/123" },
        metadata: { buildId: 123 }
      }),
      {
        title: "构建完成",
        body: "任务执行成功",
        source: "ci",
        action: { type: "open-uri", uri: "https://example.com/build/123" },
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
        action: { type: "open-uri", uri: "javascript:alert(1)" }
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

  it("accepts only bounded open URI schemes", () => {
    assert.equal(isOpenUri("https://example.com/path"), true);
    assert.equal(isOpenUri("vscode://attentive.attentive-vscode/focus?window=1"), true);
    assert.equal(isOpenUri("file:///tmp/example"), false);
    assert.equal(isOpenUri("javascript:alert(1)"), false);
    assert.equal(isOpenUri(""), false);
    assert.equal(isOpenUri(`https://example.com/${"a".repeat(MAX_OPEN_URI_LENGTH)}`), false);
  });

  it("rejects malformed actions", () => {
    for (const action of [
      "https://example.com",
      { type: "run-command", uri: "https://example.com" },
      { type: "open-uri", uri: "" }
    ]) {
      assert.throws(() => validateNotificationRequest({ title: "Title", body: "Body", action }));
    }
  });

  it("rejects the replaced top-level url field", () => {
    assert.throws(
      () => validateNotificationRequest({
        title: "Title",
        body: "Body",
        url: "https://example.com"
      }),
      /url is no longer supported; use action/
    );
  });

  it("parses a focused window context with a callback", () => {
    assert.deepEqual(
      parseWindowContextResponse({
        version: WINDOW_CONTEXT_VERSION,
        focused: true,
        callbackUri: "vscode://attentive.attentive-vscode/focus?window=one"
      }),
      {
        version: WINDOW_CONTEXT_VERSION,
        focused: true,
        callbackUri: "vscode://attentive.attentive-vscode/focus?window=one"
      }
    );
  });

  it("keeps focused state when the optional callback is absent or invalid", () => {
    assert.deepEqual(
      parseWindowContextResponse({ version: 1, focused: false }),
      { version: 1, focused: false }
    );
    assert.deepEqual(
      parseWindowContextResponse({
        version: 1,
        focused: true,
        callbackUri: "file:///not-allowed"
      }),
      { version: 1, focused: true }
    );
  });

  it("rejects invalid core window context fields", () => {
    for (const value of [
      null,
      [],
      { version: 2, focused: false },
      { version: 1 },
      { version: 1, focused: "true" }
    ]) {
      assert.equal(parseWindowContextResponse(value), undefined);
    }
  });

  it("accepts the callback length boundary and rejects the next character", () => {
    const prefix = "https://example.com/";
    const valid = `${prefix}${"a".repeat(MAX_OPEN_URI_LENGTH - prefix.length)}`;
    const invalid = `${valid}a`;
    assert.deepEqual(
      parseWindowContextResponse({ version: 1, focused: false, callbackUri: valid }),
      { version: 1, focused: false, callbackUri: valid }
    );
    assert.deepEqual(
      parseWindowContextResponse({ version: 1, focused: false, callbackUri: invalid }),
      { version: 1, focused: false }
    );
    assert.equal(MAX_WINDOW_CONTEXT_RESPONSE_BYTES, 8 * 1024);
  });
});
