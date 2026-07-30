interface AbortableRequest {
  abort?: () => void;
  cleanup?: () => void;
}

export class RequestManager {
  activeRequests: Map<string, AbortableRequest>;

  constructor() {
    this.activeRequests = new Map();
  }

  addRequest(requestId: string, handler: AbortableRequest) {
    this.activeRequests.set(requestId, handler);
  }

  removeRequest(requestId: string) {
    this.activeRequests.delete(requestId);
  }

  abortRequest(requestId: string) {
    const handler = this.activeRequests.get(requestId);
    if (handler && typeof handler.abort === "function") {
      handler.abort();
      this.removeRequest(requestId);
      return true;
    }
    return false;
  }

  abortAll() {
    this.activeRequests.forEach((handler) => {
      if (typeof handler.abort === "function") {
        handler.abort();
      }
    });
    this.activeRequests.clear();
  }

  getActiveCount() {
    return this.activeRequests.size;
  }
}
