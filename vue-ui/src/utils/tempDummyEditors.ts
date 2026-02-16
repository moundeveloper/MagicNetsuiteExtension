// Dummy deployed scripts for testing the Editors view
// Can be imported and pushed directly into `editors`

export type DeployedScript = {
  scriptName: string;
  scriptType: "client" | "userevent" | "action";
  scriptFile: string;
  scriptId: string;
};

export const dummyEditors: {
  code: string;
  script: DeployedScript;
}[] = [
  {
    script: {
      scriptId: "custscript_client_sales_order",
      scriptName: "Sales Order Client",
      scriptType: "client",
      scriptFile: "sales_order_client.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(["N/currentRecord", "N/ui/message"], (currentRecord, message) => {

  const pageInit = (context) => {
    const rec = currentRecord.get();
    console.log("Sales Order initialized:", rec.id);

    const msg = message.create({
      title: "Sales Order Loaded",
      message: "Review mandatory fields before saving.",
      type: message.Type.INFORMATION
    });

    msg.show({ duration: 3000 });
  };

  const fieldChanged = (context) => {
    const rec = currentRecord.get();

    if (context.fieldId === "entity") {
      const customer = rec.getValue("entity");
      console.log("Customer changed:", customer);

      if (!customer) {
        alert("Customer must be selected.");
      }
    }

    if (context.fieldId === "trandate") {
      const date = rec.getValue("trandate");
      console.log("Transaction date updated:", date);
    }
  };

  const validateLine = (context) => {
    if (context.sublistId === "item") {
      const rec = currentRecord.get();
      const quantity = rec.getCurrentSublistValue({
        sublistId: "item",
        fieldId: "quantity"
      });

      if (!quantity || quantity <= 0) {
        alert("Quantity must be greater than zero.");
        return false;
      }
    }

    return true;
  };

  const saveRecord = () => {
    const rec = currentRecord.get();
    const total = rec.getValue("total");

    if (!total || total <= 0) {
      alert("Total must be greater than zero.");
      return false;
    }

    console.log("Sales Order validated successfully.");
    return true;
  };

  return { pageInit, fieldChanged, validateLine, saveRecord };
});
`
  },

  {
    script: {
      scriptId: "custscript_ue_before_submit",
      scriptName: "Before Submit Validator",
      scriptType: "userevent",
      scriptFile: "before_submit_validator.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/error", "N/log"], (error, log) => {

  const beforeLoad = (context) => {
    log.debug("Before Load Triggered", context.type);
  };

  const beforeSubmit = (context) => {
    const rec = context.newRecord;

    const entity = rec.getValue("entity");
    const memo = rec.getValue("memo");

    if (!entity) {
      throw error.create({
        name: "MISSING_ENTITY",
        message: "Entity is required before saving.",
        notifyOff: false
      });
    }

    if (memo && memo.length > 200) {
      throw error.create({
        name: "MEMO_TOO_LONG",
        message: "Memo cannot exceed 200 characters."
      });
    }

    log.audit({
      title: "Validation Passed",
      details: "Record ready for submission"
    });
  };

  return { beforeLoad, beforeSubmit };
});
`
  },

  {
    script: {
      scriptId: "custscript_ue_after_submit",
      scriptName: "After Submit Logger",
      scriptType: "userevent",
      scriptFile: "after_submit_logger.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/log", "N/record"], (log, record) => {

  const afterSubmit = (context) => {
    if (context.type === context.UserEventType.DELETE) {
      log.audit("Record Deleted", context.oldRecord.id);
      return;
    }

    const recId = context.newRecord.id;

    log.debug({
      title: "Record Saved",
      details: recId
    });

    try {
      record.submitFields({
        type: context.newRecord.type,
        id: recId,
        values: {
          custbody_processed_flag: true
        }
      });

      log.audit("Post Processing Complete", recId);
    } catch (e) {
      log.error("Post Processing Failed", e);
    }
  };

  return { afterSubmit };
});
`
  },

  {
    script: {
      scriptId: "custscript_workflow_approve",
      scriptName: "Workflow Approval Action",
      scriptType: "action",
      scriptFile: "workflow_approve.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(["N/record", "N/log"], (record, log) => {

  const onAction = (context) => {
    const rec = record.load({
      type: context.newRecord.type,
      id: context.newRecord.id
    });

    const amount = rec.getValue("total");

    if (amount > 10000) {
      rec.setValue({
        fieldId: "approvalstatus",
        value: 1
      });

      log.audit("Requires Approval", amount);
    } else {
      rec.setValue({
        fieldId: "approvalstatus",
        value: 2
      });

      log.audit("Auto Approved", amount);
    }

    rec.save();
  };

  return { onAction };
});
`
  },

  {
    script: {
      scriptId: "custscript_ue_cleanup",
      scriptName: "Data Cleanup UE",
      scriptType: "userevent",
      scriptFile: "data_cleanup.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/search", "N/log"], (search, log) => {

  const afterSubmit = (context) => {
    const results = search.create({
      type: "customrecord_test",
      filters: [["isinactive", "is", "T"]],
      columns: ["internalid"]
    }).run().getRange({ start: 0, end: 100 });

    if (results && results.length) {
      log.audit("Inactive Records Found", results.length);
    } else {
      log.debug("No Cleanup Needed", "All records active");
    }
  };

  return { afterSubmit };
});
`
  }
];
