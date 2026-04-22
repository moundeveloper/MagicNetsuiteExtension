// ============================================================================
// SuiteQL Table Metadata API
// ============================================================================

/**
 * Fetch all record types (tables) available for SuiteQL
 * Uses the NetSuite Record Catalog endpoint
 */
window.fetchSuiteQLTables = async () => {
  const url = '/app/recordscatalog/rcendpoint.nl?action=getRecordTypes&data=' +
    encodeURI(JSON.stringify({
      structureType: 'FLAT'
    }));

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const data = await response.json();
  console.log('Record Types Result:', data);
  return data;
};

/**
 * Fetch record type detail (fields, joins) for a specific table
 * @param {string} tableName - The script ID / table name (e.g. 'customer')
 */
window.fetchSuiteQLTableDetail = async (tableName) => {
  const url = '/app/recordscatalog/rcendpoint.nl?action=getRecordTypeDetail&data=' +
    encodeURI(JSON.stringify({
      scriptId: tableName,
      detailType: 'SS_ANAL'
    }));

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const data = await response.json();
  console.log('Table Detail Result:', data);
  return data;
};

/**
 * Run a SuiteQL query using N/query module
 * @param {object} N - NetSuite modules
 * @param {string} sql - The SuiteQL query string
 */
window.runSuiteQLQuery = async (N, sql) => {
  const { query } = N;
  const resultSet = await query.runSuiteQL.promise({ query: sql });
  const results = resultSet.asMappedResults();
  return results;
};
