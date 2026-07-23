export interface SdfProjectTextFile {
  path: string;
  content: string;
}

export interface SdfFeatureDependency {
  id: string;
  required: boolean;
  sources: string[];
}

export interface SdfManifestAnalysis {
  xml: string;
  features: SdfFeatureDependency[];
  unreadableXmlFiles: string[];
}

// Record-level feature requirements from Oracle's SuiteCloud SDK 2025.2 SDF metadata.
// These object types cannot be deployed when their feature is unavailable.
const OBJECT_FEATURES: Record<string, string> = {
  addressform: "ADDRESSCUSTOMIZATION",
  advancedpdftemplate: "ADVANCEDPRINTING",
  advancedrevrecplugin: "ADVANCEDREVENUERECOGNITION",
  bundleinstallationscript: "SERVERSIDESCRIPTING",
  center: "CUSTOMRECORDS",
  centercategory: "CUSTOMRECORDS",
  centerlink: "CUSTOMRECORDS",
  centertab: "CUSTOMRECORDS",
  clientscript: "SERVERSIDESCRIPTING",
  cmscontenttype: "ADVANCEDSITEMANAGEMENT",
  consolidatedrateadjustorplugin: "CREATECONSOLIDATEDRATEPLUGINS",
  customglplugin: "CUSTOMGLLINES",
  customrecordactionscript: "SERVERSIDESCRIPTING",
  customrecordtype: "CUSTOMRECORDS",
  customsegment: "CUSTOMSEGMENTS",
  customtransactiontype: "CUSTOMTRANSACTIONS",
  dataset: "USR",
  emailcaptureplugin: "SERVERSIDESCRIPTING",
  emailtemplate: "CRM",
  itemoptioncustomfield: "ITEMOPTIONS",
  mapreducescript: "SERVERSIDESCRIPTING",
  massupdatescript: "SERVERSIDESCRIPTING",
  paymentgatewayplugin: "CREATEPAYMENTGATEWAYPLUGINS",
  pluginimplementation: "SERVERSIDESCRIPTING",
  plugintype: "SERVERSIDESCRIPTING",
  portlet: "SERVERSIDESCRIPTING",
  promotionsplugin: "CREATEPROMOTIONSPLUGINS",
  restlet: "SERVERSIDESCRIPTING",
  savedsearch: "SERVERSIDESCRIPTING",
  scheduledscript: "SERVERSIDESCRIPTING",
  sdfinstallationscript: "SERVERSIDESCRIPTING",
  shippingpartnersplugin: "SHIPPINGPARTNERS",
  singlepageapp: "SERVERSIDESCRIPTING",
  sspapplication: "WEBAPPLICATIONS",
  sublist: "CUSTOMRECORDS",
  suitelet: "SERVERSIDESCRIPTING",
  taxcalculationplugin: "TAX_OVERHAULINGDEV",
  usereventscript: "SERVERSIDESCRIPTING",
  workbook: "USR",
  workflow: "WORKFLOW",
  workflowactionscript: "SERVERSIDESCRIPTING",
};

// Field-level feature gates are optional dependencies under Oracle's enhanced
// feature dependency behavior: the object can deploy, but gated fields are ignored
// or hidden until the target account enables the feature.
const FIELD_FEATURES: Record<string, Record<string, string>> = {
  advancedpdftemplate: { savedsearch: "SERVERSIDESCRIPTING" },
  centertab: { allpartners: "CRM" },
  clientscript: deploymentFields(),
  customrecordactionscript: deploymentFields(),
  massupdatescript: deploymentFields(),
  portlet: deploymentFields(),
  restlet: deploymentFields(),
  suitelet: deploymentFields(),
  usereventscript: deploymentFields(),
  workflowactionscript: deploymentFields(),
  crmcustomfield: {
    appliesperkeyword: "MARKETING",
    appliestocampaign: "MARKETING",
    appliestocase: "SUPPORT",
    appliestoissue: "ISSUEDB",
    appliestomfgprojecttask: "MFGROUTING",
    appliestoprojecttask: "ADVANCEDJOBS",
    appliestoresourceallocation: "RESOURCEALLOCATIONS",
    appliestosolution: "KNOWLEDGEBASE",
    showissuechanges: "ISSUEDB",
  },
  customlist: {
    abbreviation: "MATRIXITEMS",
    ismatrixoption: "MATRIXITEMS",
  },
  customrecordtype: {
    customsegment: "CUSTOMSEGMENTS",
    enabledle: "EXTREMELIST",
    enablemailmerge: "MAILMERGE",
    enablenametranslation: "MULTILANGUAGE",
  },
  customtransactiontype: {
    classposition: "CLASSES",
    departmentposition: "DEPARTMENTS",
    isclassmandatory: "CLASSES",
    isdepartmentmandatory: "DEPARTMENTS",
    islocationmandatory: "LOCATIONS",
    locationposition: "LOCATIONS",
  },
  entitycustomfield: {
    appliestogenericrsrc: "ADVANCEDJOBS",
    appliestopartner: "CRM",
    appliestoproject: "JOBS",
    appliestovendor: "ACCOUNTING",
    appliestowebsite: "WEBSITE",
    availabletosso: "SUITESIGNON",
  },
  itemcustomfield: {
    appliestoexpense: "CHARGEBASEDBILLING",
    appliestoinventory: "INVENTORY",
    appliestoitemassembly: "ASSEMBLIES",
    ismhitemattribute: "MERCHANDISEHIERARCHY",
    itemmatrix: "MATRIXITEMS",
  },
  itemoptioncustomfield: {
    colopportunity: "OPPORTUNITIES",
    colpurchase: "ACCOUNTING",
    colstore: "WEBSITE",
    colstorehidden: "WEBSITE",
    coltransferorder: "MULTILOCINVT",
  },
  kpiscorecard: { allpartners: "CRM" },
  publisheddashboard: {
    allowinlineediting: "EXTREMELIST",
    showresourceallocations: "RESOURCEALLOCATIONS",
  },
  role: {
    issuerole: "ISSUEDB",
    iswebserviceonlyrole: "WEBSERVICES",
    restrictip: "IPADDRESSRULES",
    subsidiaryoption: "SUBSIDIARIES",
    subsidiaryviewingallowed: "SUBSIDIARIES",
  },
  sublist: { customtransactions: "CUSTOMTRANSACTIONS" },
  transactionbodycustomfield: {
    bodyassemblybuild: "ASSEMBLIES",
    bodybom: "WORKORDERS",
    bodybtegata: "ACCOUNTING",
    bodycustomerpayment: "RECEIVABLES",
    bodycustomtransactions: "CUSTOMTRANSACTIONS",
    bodyexpensereport: "EXPREPORTS",
    bodyfulfillmentrequest: "FULFILLMENTREQUEST",
    bodyinventoryadjustment: "INVENTORY",
    bodyitemfulfillment: "ACCOUNTING",
    bodyitemfulfillmentorder: "ACCOUNTING",
    bodyitemreceipt: "ADVRECEIVING",
    bodyitemreceiptorder: "ADVRECEIVING",
    bodyjournal: "ACCOUNTING",
    bodyopportunity: "OPPORTUNITIES",
    bodypaycheck: "PAYCHECKJOURNAL",
    bodyperiodendjournal: "PERIODENDJOURNALENTRIES",
    bodyprintpackingslip: "ACCOUNTING",
    bodyprintstatement: "ACCOUNTING",
    bodypurchase: "ACCOUNTING",
    bodystore: "WEBSTORE",
    bodystorepickup: "STOREPICKUP",
    bodytransferorder: "MULTILOCINVT",
    bodyvendorpayment: "PAYABLES",
  },
  transactioncolumncustomfield: {
    colbuild: "WORKORDERS",
    colexpense: "ACCOUNTING",
    colexpensereport: "EXPREPORTS",
    colfulfillmentrequest: "FULFILLMENTREQUEST",
    colinventoryadjustment: "ACCOUNTING",
    colitemfulfillment: "ACCOUNTING",
    colitemfulfillmentorder: "ACCOUNTING",
    colitemreceipt: "ADVRECEIVING",
    colitemreceiptorder: "ADVRECEIVING",
    coljournal: "ACCOUNTING",
    colopportunity: "OPPORTUNITIES",
    colpackingslip: "ACCOUNTING",
    colpaycheckcompanycontribution: "PAYCHECKJOURNAL",
    colpaycheckcompanytax: "PAYCHECKJOURNAL",
    colpaycheckdeduction: "PAYCHECKJOURNAL",
    colpaycheckearning: "PAYCHECKJOURNAL",
    colpaycheckemployeetax: "PAYCHECKJOURNAL",
    colperiodendjournal: "PERIODENDJOURNALENTRIES",
    colpurchase: "ACCOUNTING",
    colreturnform: "ACCOUNTING",
    colstore: "WEBSITE",
    colstorehidden: "WEBSITE",
    colstorepickup: "STOREPICKUP",
    coltime: "TIMETRACKING",
    coltransferorder: "MULTILOCINVT",
    columncustomtransactions: "CUSTOMTRANSACTIONS",
  },
  transactionform: {
    emailtemplate: "ADVANCEDPRINTING",
    printtemplate: "ADVANCEDPRINTING",
  },
};

// Strong, account-feature-specific record identifiers found in object XML or
// SuiteScript. These cover dependencies exposed through SDK list metadata rather
// than an SDF object root (for example SuiteBilling standard records).
const CONTENT_FEATURES: Array<{ feature: string; pattern: RegExp }> = [
  {
    feature: "SUBSCRIPTIONBILLING",
    pattern:
      /\b(?:subscriptionchangeorder|subscriptionline|subscriptionplan|subscriptionterm|pricebook|priceplan|billingaccount)\b/i,
  },
  {
    feature: "ADVSUBSCRIPTIONBILLING",
    pattern: /\b(?:subscriptionusage|usageauditlog|usageexternalid)\b/i,
  },
];

function deploymentFields(): Record<string, string> {
  return {
    allpartners: "CRM",
    auddepartment: "DEPARTMENTS",
    audpartner: "CRM",
    audsubsidiary: "SUBSIDIARIES",
  };
}

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const localName = (node: Element) =>
  (node.localName || node.tagName).toLowerCase();

export function generateSdfManifest(
  files: SdfProjectTextFile[],
  projectName: string,
): SdfManifestAnalysis {
  const dependencies = new Map<string, SdfFeatureDependency>();
  const unreadableXmlFiles: string[] = [];

  const add = (id: string, required: boolean, source: string) => {
    const normalized = id.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(normalized) || normalized === "BASE") return;
    const existing = dependencies.get(normalized);
    if (existing) {
      existing.required ||= required;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    dependencies.set(normalized, {
      id: normalized,
      required,
      sources: [source],
    });
  };

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".xml")) {
      for (const rule of CONTENT_FEATURES) {
        if (rule.pattern.test(file.content))
          add(
            rule.feature,
            true,
            `${file.path}: feature-specific record reference`,
          );
      }
      continue;
    }

    const document = new DOMParser().parseFromString(
      file.content,
      "application/xml",
    );
    if (document.querySelector("parsererror")) {
      unreadableXmlFiles.push(file.path);
      continue;
    }

    const root = document.documentElement;
    const rootName = localName(root);
    if (rootName === "manifest") {
      root
        .querySelectorAll("dependencies > features > feature")
        .forEach((feature) => {
          add(
            feature.textContent || "",
            feature.getAttribute("required")?.toLowerCase() === "true",
            `${file.path}: existing declaration`,
          );
        });
      continue;
    }

    const objectFeature = OBJECT_FEATURES[rootName];
    if (objectFeature)
      add(objectFeature, true, `${file.path}: <${root.tagName}> object`);

    const fieldFeatures = FIELD_FEATURES[rootName] || {};
    root.querySelectorAll("*").forEach((element) => {
      const feature = fieldFeatures[localName(element)];
      if (feature)
        add(feature, false, `${file.path}: <${element.tagName}> field`);
    });

    const oneWorldFields =
      rootName === "customrecordtype"
        ? Array.from(root.querySelectorAll("customrecordcustomfield"))
        : [
              "customrecordcustomfield",
              "othercustomfield",
              "otherrecordfield",
            ].includes(rootName)
          ? [root]
          : [];
    for (const field of oneWorldFields) {
      const recordTypeValues = Array.from(
        field.querySelectorAll("selectrecordtype, rectype"),
      ).map((element) => element.textContent?.trim().toUpperCase());
      if (
        !recordTypeValues.some(
          (value) => value === "-117" || value === "SUBSIDIARY",
        )
      )
        continue;
      const mandatoryValue = field
        .querySelector("ismandatory")
        ?.textContent?.trim()
        .toUpperCase();
      const mandatory = mandatoryValue === "T" || mandatoryValue === "TRUE";
      add(
        "SUBSIDIARIES",
        mandatory,
        `${file.path}: ${mandatory ? "required" : "optional"} Subsidiary custom field`,
      );
    }

    for (const rule of CONTENT_FEATURES) {
      if (rule.pattern.test(file.content))
        add(
          rule.feature,
          true,
          `${file.path}: feature-specific record reference`,
        );
    }
  }

  const features = [...dependencies.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const featureLines = features.length
    ? features
        .map(
          ({ id, required }) =>
            `      <feature required="${required}">${id}</feature>`,
        )
        .join("\n")
    : "";
  const xml = [
    '<manifest projecttype="ACCOUNTCUSTOMIZATION">',
    `  <projectname>${xmlEscape(projectName)}</projectname>`,
    "  <frameworkversion>1.0</frameworkversion>",
    "  <dependencies>",
    "    <features>",
    featureLines,
    "    </features>",
    "  </dependencies>",
    "</manifest>",
    "",
  ]
    .filter((line, index, lines) => line !== "" || index === lines.length - 1)
    .join("\n");

  return { xml, features, unreadableXmlFiles };
}
