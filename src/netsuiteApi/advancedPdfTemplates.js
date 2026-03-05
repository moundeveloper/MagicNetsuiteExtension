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
    AdvancedPdfTemplate.tranType,
    CustomRecordType.scriptid as customrecordtypescriptid
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

  const allLinks = await getPdfTemplateLinks();

  console.log("PDF Template Links: ", allLinks);

  // Example: exclude savedsearchid = -1
  const filtered = filterPdfTemplateLinks(allLinks, {
    excludeSavedSearchId: ["-1"]
  });

  const linksBySearchId = new Map();
  filtered.forEach((link) => {
    const key = String(link.savedsearchid);
    if (!linksBySearchId.has(key)) {
      linksBySearchId.set(key, { tt: link.tt, recordType: link.recordType });
    }
  });

  results.forEach((result) => {
    const key = String(result.savedsearch);
    if (linksBySearchId.has(key)) {
      const { tt, recordType } = linksBySearchId.get(key);
      result.trantype = tt;
      result.recordtype = recordType;
    }
  });

  return results;
};

window.getAdvancedPDFTemplatesContent = async (
  N,
  {
    templateId,
    printType,
    transactionType,
    customRecordType,
    savedSearch,
    version
  }
) => {
  const latestTemplate = await getTemplateContent({
    templateId,
    printType,
    transactionType,
    customRecordType,
    savedSearch,
    version
  });

  return latestTemplate;
};

const getTemplateContent = async ({
  templateId,
  printType,
  transactionType,
  customRecordType = null,
  savedSearch = null,
  version = null
}) => {
  // Construct URL with parameters
  const baseUrl = window.location.origin;
  const url = new URL(
    `${baseUrl}/app/common/custom/advancedprint/pdftemplate.nl`
  );
  url.searchParams.set("id", templateId);
  url.searchParams.set("nl", "F");
  url.searchParams.set("pt", printType);

  if (printType === "CUSTOMRECORD") {
    url.searchParams.set("tt", "Custom");
  } else {
    url.searchParams.set("tt", transactionType);
  }

  url.searchParams.set("source", "T");

  if (customRecordType) url.searchParams.set("rt", customRecordType);

  url.searchParams.set("e", "T");
  url.searchParams.set("sc", "-90");
  if (version) url.searchParams.set("version", version);

  if (savedSearch) url.searchParams.set("savedsearchid", savedSearch);

  console.log("url.searchParams", {
    templateId,
    printType,
    transactionType,
    customRecordType,
    savedSearch,
    version
  });

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
    referrer: `${baseUrl}/app/common/custom/pdftemplates.nl`,
    method: "GET",
    credentials: "include"
  });

  // Get the HTML text
  const htmlText = await response.text();

  // Parse the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  // Get version number
  const versionSpan = doc.querySelector("#pdftemplate-version-number");
  const currentVersion = versionSpan
    ? parseInt(versionSpan.textContent.trim(), 10)
    : 0;

  // Get the textarea with id and name "template"
  const textarea = doc.querySelector('textarea#template[name="template"]');
  const templateContent = textarea ? textarea.value : null;

  return {
    templateContent,
    currentVersion
  };
};

const getPdfTemplateLinks = async () => {
  const baseUrl = window.location.origin;
  const url = `${baseUrl}/app/common/custom/pdftemplates.nl`;

  const response = await fetch(url, {
    method: "GET",
    credentials: "include"
  });

  const html = await response.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const links = [
    ...doc.querySelectorAll("td.listtext.uir-list-row-cell a.dottedlink")
  ];

  return links
    .map((link) => {
      const href = link.getAttribute("href");
      if (!href) return null;

      const fullUrl = new URL(href, baseUrl);

      // Navigate to the parent row
      const tr = link.closest("tr");
      let recordType = null;

      if (tr) {
        const tds = tr.querySelectorAll("td");
        // 4th column = index 3
        if (tds[3]) {
          recordType = tds[3].textContent.trim();
        }
      }

      return {
        href: fullUrl.href,
        tt: fullUrl.searchParams.get("tt"),
        savedsearchid: fullUrl.searchParams.get("savedsearchid"),
        recordType
      };
    })
    .filter(Boolean);
};

const filterPdfTemplateLinks = (links, options = {}) => {
  const {
    excludeSavedSearchId = [],
    includeSavedSearchId = null,
    tt = null
  } = options;

  return links.filter((link) => {
    if (
      includeSavedSearchId &&
      !includeSavedSearchId.includes(link.savedsearchid)
    ) {
      return false;
    }

    if (excludeSavedSearchId.includes(link.savedsearchid)) {
      return false;
    }

    if (tt && link.tt !== tt) {
      return false;
    }

    return true;
  });
};
