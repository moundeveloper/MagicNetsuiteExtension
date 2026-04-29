/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["./magic_netsuite_handlers"], (handler) => {
  const onRequest = (context) => {
    try {
      const { method } = context.request;
      const handlers = handler.handlers();

      if (method !== "POST") return;

      const { action } = context.request.parameters;

      const handler = handlers[action];
      if (handler) {
        const result = handler();
        context.response.write(JSON.stringify(result));
      }
    } catch (error) {
      context.response.write(JSON.stringify(error));
    }
  };

  return { onRequest };
});
