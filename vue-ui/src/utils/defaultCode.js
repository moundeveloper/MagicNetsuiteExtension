console.log("Hello, world!");

console.log("ciaoooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo");

const bruh = async () => {
  const scriptId = null;

  let sql = `
      SELECT
          script.scriptid,
          script.id,
          script.name,
          script.scriptfile,
          script.scripttype,
          entity.entityid as owner
      FROM
          script
          INNER JOIN entity on script.owner = entity.id
    `;

  // Only add WHERE if scriptId is provided
  if (scriptId) {
    sql += ` WHERE script.scriptid = ?`;
  }

  const queryConfig = { query: sql };

  if (scriptId) {
    queryConfig.params = [scriptId];
  }

  const resultSet = await query.runSuiteQL.promise(queryConfig);

  const results = resultSet.asMappedResults();

  console.log(`Retrieved ${results.length} script records`);
  console.log(results);
};

await bruh();
