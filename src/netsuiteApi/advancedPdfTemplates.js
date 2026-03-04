window.getAdvancedPDFTemplates = async (N) => {
  const { query } = N;
  const sql = `
SELECT
    CustomRecordType.name as customRecordType,
    CustomTransactionType.name as customTransactionType,
    AdvancedPdfTemplate.id,
    AdvancedPdfTemplate.inactive,
    AdvancedPdfTemplate.name,
    AdvancedPdfTemplate.preferred,
    AdvancedPdfTemplate.printType,
    AdvancedPdfTemplate.savedSearch,
    AdvancedPdfTemplate.scriptId,
    AdvancedPdfTemplate.tranType
FROM AdvancedPdfTemplate
LEFT JOIN CustomRecordType
    ON AdvancedPdfTemplate.customrecordtype = CustomRecordType.internalid
LEFT JOIN CustomTransactionType
    ON AdvancedPdfTemplate.customtransactiontype = CustomTransactionType.id
WHERE AdvancedPdfTemplate.scriptId NOT LIKE 'STDTMPL%'
`;

  const queryConfig = { query: sql };
  const resultSet = await query.runSuiteQL.promise(queryConfig);

  const results = resultSet.asMappedResults();

  console.log("Advanced PDF Templates: ", results.length);

  return results;
};

window.getAdvancedPDFTemplatesContent = async (
  N,
  { templateId, printType, transactionType }
) => {
  const latestTemplate = await getTemplateContent(
    templateId,
    printType,
    transactionType
  );

  console.log("Latest Template: ", latestTemplate);

  return latestTemplate;
};

const getTemplateContent = async (
  templateId,
  printType,
  transactionType,
  version = null
) => {
  // Construct URL with parameters
  const url = new URL(
    "https://1964539.app.netsuite.com/app/common/custom/advancedprint/pdftemplate.nl"
  );
  url.searchParams.set("id", templateId);
  url.searchParams.set("nl", "F");
  url.searchParams.set("pt", printType);
  url.searchParams.set("tt", transactionType);
  url.searchParams.set("source", "T");
  url.searchParams.set("rt", "");
  url.searchParams.set("e", "T");
  url.searchParams.set("sc", "-90");
  if (version) url.searchParams.set("version", version);

  // Perform the GET request
  const response = await fetch(url.toString(), {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": "it-IT,it;q=0.6",
      "sec-ch-ua": '"Not:A-Brand";v="99", "Brave";v="145", "Chromium";v="145"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "sec-gpc": "1",
      "upgrade-insecure-requests": "1"
    },
    referrer:
      "https://1964539.app.netsuite.com/app/common/custom/pdftemplates.nl",
    method: "GET",
    credentials: "include"
  });

  // Get the HTML text
  const htmlText = await response.text();

  // Parse the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  // Get the textarea with id and name "template"
  const textarea = doc.querySelector('textarea#template[name="template"]');
  return textarea ? textarea.value : null;
};
