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
define([], () => {
  const pageInit = (context) => {
    console.log("Sales Order page initialized");
  };

  const fieldChanged = (context) => {
    if (context.fieldId === "entity") {
      console.log("Customer changed");
    }
  };

  return { pageInit, fieldChanged };
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
define(["N/error"], (error) => {
  const beforeSubmit = (context) => {
    if (!context.newRecord.getValue("entity")) {
      throw error.create({
        name: "MISSING_ENTITY",
        message: "Entity is required"
      });
    }
  };

  return { beforeSubmit };
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
define(["N/log"], (log) => {
  const afterSubmit = (context) => {
    log.debug({
      title: "Record Saved",
      details: context.newRecord.id
    });
  };

  return { afterSubmit };
});
`
  },

  {
    script: {
      scriptId: "custscript_client_customer",
      scriptName: "Customer Client Enhancements",
      scriptType: "client",
      scriptFile: "customer_client.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
  const validateLine = (context) => {
    console.log("Validating sublist line");
    return true;
  };

  return { validateLine };
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
define(["N/record"], (record) => {
  const onAction = (context) => {
    const rec = record.load({
      type: context.newRecord.type,
      id: context.newRecord.id
    });

    rec.setValue({
      fieldId: "approvalstatus",
      value: 2
    });

    rec.save();
  };

  return { onAction };
});
`
  },

  {
    script: {
      scriptId: "custscript_client_invoice",
      scriptName: "Invoice Client Helper",
      scriptType: "client",
      scriptFile: "invoice_client.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
  const saveRecord = () => {
    console.log("Invoice saved");
    return true;
  };

  return { saveRecord };
});
`
  },

  {
    script: {
      scriptId: "custscript_ue_po_defaults",
      scriptName: "PO Default Values",
      scriptType: "userevent",
      scriptFile: "po_defaults.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([], () => {
  const beforeLoad = (context) => {
    context.newRecord.setValue({
      fieldId: "memo",
      value: "Auto-filled by UE"
    });
  };

  return { beforeLoad };
});
`
  },

  {
    script: {
      scriptId: "custscript_workflow_notify",
      scriptName: "Workflow Email Notify",
      scriptType: "action",
      scriptFile: "workflow_notify.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(["N/email"], (email) => {
  const onAction = () => {
    email.send({
      author: -5,
      recipients: ["test@example.com"],
      subject: "Workflow Triggered",
      body: "The workflow has executed."
    });
  };

  return { onAction };
});
`
  },

  {
    script: {
      scriptId: "custscript_client_search",
      scriptName: "Client Search Helper",
      scriptType: "client",
      scriptFile: "client_search.js"
    },
    code: `
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
  const lineInit = () => {
    console.log("Line initialized");
  };

  return { lineInit };
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
define(["N/search"], (search) => {
  const afterSubmit = () => {
    search.create({
      type: "customrecord_test",
      filters: [],
      columns: ["internalid"]
    }).run();
  };

  return { afterSubmit };
});
`
  }
];
