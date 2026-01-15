window.getLogsByTime = async (
  { search, format },
  {
    startDate,
    endDate,
    scriptIds = [],
    deploymentIds = [],
    scriptTypes = [],
    type,
  }
) => {
  console.log("Get logs by time:", {
    startDate,
    endDate,
    scriptIds,
    deploymentIds,
    scriptTypes,
    type,
  });

  const dateToMinutes = (date) => date.getHours() * 60 + date.getMinutes();

  // Initialize filters
  const filters = [];

  // Date filters
  if (startDate && endDate) {
    filters.push(["date", "between", startDate, endDate]);
  } else if (startDate) {
    filters.push(["date", "onorafter", startDate]);
  } else if (endDate) {
    filters.push(["date", "onorbefore", endDate]);
  } else {
    filters.push(["date", "within", "today"]);
  }

  // Time filters
  const startTime = startDate ? dateToMinutes(startDate) : null;
  const endTime = endDate ? dateToMinutes(endDate) : null;

  console.log("Time filters:", { startTime, endTime });

  const formula =
    "formulanumeric: (TO_NUMBER(TO_CHAR({time}, 'HH24')) * 60) + TO_NUMBER(TO_CHAR({time}, 'MI'))";

  if (startTime != null && endTime != null) {
    filters.push([formula, "between", startTime, endTime]);
  } else if (startTime != null) {
    filters.push([formula, "greaterthan", startTime]);
  } else if (endTime != null) {
    filters.push([formula, "lessthanorequalto", endTime]);
  }

  // Type filters
  if (type) {
    filters.push(["type", "anyof", type]);
  }
  if (scriptTypes.length > 0) {
    filters.push(["type", "anyof", scriptTypes]);
  }

  // Script / deployment filters
  if (scriptIds.length > 0) {
    filters.push(["script.internalid", "anyof", scriptIds]);
  }
  if (deploymentIds.length > 0) {
    filters.push(["scriptdeployment.internalid", "anyof", deploymentIds]);
  }

  // Helpers
  const getColumnKey = (col) =>
    col.join ? col.join + "." + col.name : col.name;
  const getColumnValue = (result, col) =>
    result.getValue({ name: col.name, join: col.join || null });

  // Create search
  const logsSearch = search.create({
    type: "scriptexecutionlog",
    filters: filters.join("AND"),
    columns: [
      search.createColumn({ name: "view" }),
      search.createColumn({ name: "title" }),
      search.createColumn({ name: "type" }),
      search.createColumn({ name: "date" }),
      search.createColumn({ name: "time" }),
      search.createColumn({ name: "user" }),
      search.createColumn({ name: "scripttype" }),
      search.createColumn({ name: "detail" }),
      search.createColumn({
        name: "internalid",
        join: "script",
        label: "Script ID",
      }),
      search.createColumn({
        name: "internalid",
        join: "scriptDeployment",
        label: "Deployment ID",
      }),
      search.createColumn({
        name: "scriptid",
        join: "scriptDeployment",
        label: "Custom ID",
      }),
      search.createColumn({
        name: "name",
        join: "script",
        label: "Script Name",
      }),
    ],
  });

  console.log("Total logs count:", logsSearch.runPaged().count);

  const results = [];
  const pagedData = await logsSearch.runPaged.promise({ pageSize: 1000 });

  for (const pageRange of pagedData.pageRanges) {
    const page = await pagedData.fetch.promise({ index: pageRange.index });

    for (const result of page.data) {
      const row = {};

      result.columns.forEach((col) => {
        let value = getColumnValue(result, col);
        let key = getColumnKey(col);

        if (col.name === "date") {
          value = format.parse({ value: value, type: format.Type.DATE });
          key = "datetime";
        }

        if (col.name === "time") {
          const timeValue = format.parse({
            value: value,
            type: format.Type.TIMEOFDAY,
          });
          const datetime = row["datetime"] || new Date();
          datetime.setHours(
            timeValue.getHours(),
            timeValue.getMinutes(),
            timeValue.getSeconds()
          );
          value = datetime;
          key = "datetime";
        }

        row[key] = value;
      });

      results.push(row);
    }
  }

  console.log("Results:", results);
  return results;
};
