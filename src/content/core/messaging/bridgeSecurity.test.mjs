import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_TYPES,
  createMessageFilter,
} from "./constants.js";
import {
  createBridgeCapability,
  injectScript,
} from "../injection/scriptInjector.js";

const PAGE_ORIGIN = "https://123456.app.netsuite.com";

test("content bridge accepts only the matching window, origin, capability, and request", () => {
  const previousWindow = globalThis.window;
  const pageWindow = { location: { origin: PAGE_ORIGIN } };
  globalThis.window = pageWindow;

  try {
    const filter = createMessageFilter("request-1", "capability-1");
    const validEvent = {
      source: pageWindow,
      origin: PAGE_ORIGIN,
      data: {
        type: MESSAGE_TYPES.TO_EXTENSION,
        capability: "capability-1",
        payload: { requestId: "request-1" },
      },
    };

    assert.equal(filter(validEvent), true);
    assert.equal(
      filter({ ...validEvent, origin: "https://attacker.test" }),
      false,
    );
    assert.equal(filter({ ...validEvent, source: {} }), false);
    assert.equal(
      filter({
        ...validEvent,
        data: { ...validEvent.data, capability: "wrong-capability" },
      }),
      false,
    );
    assert.equal(
      filter({
        ...validEvent,
        data: {
          ...validEvent.data,
          payload: { requestId: "wrong-request" },
        },
      }),
      false,
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("bridge capabilities are random 256-bit hex values", () => {
  const first = createBridgeCapability();
  const second = createBridgeCapability();

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("injector exposes the capability only to the NetSuite API entry script", () => {
  const previousChrome = globalThis.chrome;
  const previousDocument = globalThis.document;
  const appended = [];

  globalThis.chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://extension-id/${file}`,
    },
  };
  globalThis.document = {
    createElement: () => ({ remove() {} }),
    head: { appendChild: (script) => appended.push(script) },
    documentElement: { appendChild: (script) => appended.push(script) },
  };

  try {
    injectScript("netsuiteApi/netsuiteApi.js", "secret-capability");
    injectScript("netsuiteApi/scripts.js", "secret-capability");

    assert.equal(appended.length, 2);
    assert.equal(
      new URL(appended[0].src).searchParams.get("bridgeCapability"),
      "secret-capability",
    );
    assert.equal(
      new URL(appended[1].src).searchParams.has("bridgeCapability"),
      false,
    );
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.document = previousDocument;
  }
});

test("page bridge rejects messages with the wrong capability or origin before API access", async () => {
  const testFile = fileURLToPath(import.meta.url);
  const apiFile = new URL("../../../netsuiteApi/netsuiteApi.js", import.meta.url);
  const source = fs.readFileSync(fileURLToPath(apiFile), "utf8");
  let messageListener;
  let documentAccesses = 0;
  let postedMessages = 0;
  const pageWindow = {
    location: { origin: PAGE_ORIGIN },
    addEventListener(name, listener) {
      if (name === "message") messageListener = listener;
    },
    postMessage() {
      postedMessages += 1;
    },
  };
  const context = {
    window: pageWindow,
    document: {
      currentScript: {
        src:
          "chrome-extension://extension-id/netsuiteApi/netsuiteApi.js" +
          "?bridgeCapability=expected-capability",
      },
      querySelector() {
        documentAccesses += 1;
        return null;
      },
      createElement: () => ({ dataset: {} }),
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
    },
    location: { origin: PAGE_ORIGIN, search: "" },
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      throw new Error(`Unexpected fetch while running ${testFile}`);
    },
    DOMParser: class {},
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  assert.equal(typeof messageListener, "function");

  const baseEvent = {
    source: pageWindow,
    origin: PAGE_ORIGIN,
    data: {
      type: MESSAGE_TYPES.FROM_EXTENSION,
      capability: "expected-capability",
      payload: {
        requestId: "request-1",
        action: "unknown-action",
        data: {},
        mode: "normal",
      },
    },
  };

  await messageListener({
    ...baseEvent,
    data: { ...baseEvent.data, capability: "wrong-capability" },
  });
  await messageListener({
    ...baseEvent,
    origin: "https://attacker.test",
  });
  await messageListener({
    ...baseEvent,
    data: {
      type: MESSAGE_TYPES.FROM_EXTENSION,
      capability: "expected-capability",
      payload: null,
    },
  });

  assert.equal(documentAccesses, 0);
  assert.equal(postedMessages, 0);
});
