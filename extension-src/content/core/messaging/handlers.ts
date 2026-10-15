import {
  MESSAGE_TYPES,
  STREAM_TIMEOUT,
  createMessageFilter,
  MAX_RETRY_ATTEMPTS
} from "./constants.js";

export class StreamHandler {
  requestId: string;
  bridgeCapability: string;
  sendChunk: (chunk: Record<string, unknown>) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  isActive: boolean;
  chunkCount: number;

  constructor(
    requestId: string,
    bridgeCapability: string,
    sendChunk: (chunk: Record<string, unknown>) => void
  ) {
    this.requestId = requestId;
    this.bridgeCapability = bridgeCapability;
    this.sendChunk = sendChunk;
    this.timeoutId = null;
    this.isActive = true;
    this.chunkCount = 0;
  }

  start() {
    this.handleStream = this.handleStream.bind(this);
    window.addEventListener("message", this.handleStream);

    this.timeoutId = setTimeout(() => {
      this.sendChunk({
        status: "error",
        error: "Stream timeout",
        isComplete: true
      });
      this.cleanup();
    }, STREAM_TIMEOUT);
  }

  handleStream(event: MessageEvent) {
    if (!this.isActive) return;
    if (!createMessageFilter(this.requestId, this.bridgeCapability)(event)) return;

    const { payload } = event.data;
    this.chunkCount++;

    switch (payload.type) {
      case MESSAGE_TYPES.STREAM_END:
        console.log(
          "[StreamHandler] Received stream end, sending last chunk",
          payload
        );
        this.sendChunk({ ...payload, isComplete: true });
        this.cleanup();
        break;

      case MESSAGE_TYPES.STREAM_ERROR:
        console.log("[StreamHandler] Received stream error", payload);
        this.sendChunk({
          status: "error",
          error: payload.error,
          isComplete: true
        });
        this.cleanup();
        break;

      case MESSAGE_TYPES.STREAM_ABORT:
        console.log("[StreamHandler] Received stream abort", payload);
        this.cleanup();
        break;

      default:
        console.log("[StreamHandler] Received stream chunk", payload);
        this.sendChunk({ ...payload, isComplete: false });
    }
  }

  cleanup() {
    this.isActive = false;
    window.removeEventListener("message", this.handleStream);
    clearTimeout(this.timeoutId as number);
  }

  abort() {
    this.cleanup();
  }
}

export class NormalRequestHandler {
  requestId: string;
  bridgeCapability: string;
  sendResponse: (response: unknown) => void;
  retryAttempts: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  isActive: boolean;

  constructor(
    requestId: string,
    bridgeCapability: string,
    sendResponse: (response: unknown) => void,
    retryAttempts = 0
  ) {
    this.requestId = requestId;
    this.bridgeCapability = bridgeCapability;
    this.sendResponse = sendResponse;
    this.retryAttempts = retryAttempts;
    this.timeoutId = null;
    this.isActive = true;
  }

  start() {
    this.handleResponse = this.handleResponse.bind(this);
    window.addEventListener("message", this.handleResponse);

    this.timeoutId = setTimeout(() => {
      // No caller re-sends on a "retry" status: background callers treated it
      // as success (e.g. SuiteQL returned 0 rows). Always report an error.
      const message =
        `NetSuite page did not respond within ${STREAM_TIMEOUT}ms. ` +
        "The operation may still complete in NetSuite; verify before retrying a write.";
      console.error(`[Request ${this.requestId}] ${message} (attempt ${this.retryAttempts + 1}/${MAX_RETRY_ATTEMPTS})`);
      this.sendResponse({
        status: "error",
        error: "Request timeout",
        message,
        requestId: this.requestId
      });
      this.cleanup();
    }, STREAM_TIMEOUT);

    console.log(`[Request ${this.requestId}] Started`);
  }

  handleResponse(event: MessageEvent) {
    if (!this.isActive) return;
    if (!createMessageFilter(this.requestId, this.bridgeCapability)(event)) return;

    const { payload } = event.data;
    console.log(`[Request ${this.requestId}] Response received`, payload);

    if (payload.event && !["done", "error"].includes(payload.event)) {
      return;
    }

    if (payload.event === "done") {
      this.sendResponse({
        requestId: this.requestId,
        status: "ok",
        message: {
          result: payload.result,
          logs: payload.logs || []
        }
      });
      this.cleanup();
      return;
    }

    if (payload.event === "error") {
      this.sendResponse({
        requestId: this.requestId,
        status: "error",
        message: payload.error || "Request failed"
      });
      this.cleanup();
      return;
    }

    this.sendResponse(payload);
    this.cleanup();
  }

  cleanup() {
    this.isActive = false;
    window.removeEventListener("message", this.handleResponse);

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
