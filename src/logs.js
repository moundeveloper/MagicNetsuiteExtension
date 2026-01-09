/**
 * Get script execution logs by time range
 * @param {Object} options
 * @param {string} [options.startTime] - start time in format "HH:mm"
 * @param {string} [options.endTime] - end time in format "HH:mm"
 * @returns {Promise<SearchResult>} - search result containing script execution logs
 */
window.getLogsByTime = async (
  { search },
  { startTime = null, endTime = null }
) => {
  console.log("Get logs by time", startTime, endTime);
  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(":")) return NaN;
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  };

  const filters = [["date", "within", "today"]];

  // Build formula for total minutes
  const formula =
    "formulanumeric: (TO_NUMBER(TO_CHAR({time}, 'HH24')) * 60) + TO_NUMBER(TO_CHAR({time}, 'MI'))";

  if (startTime && endTime) {
    filters.push("AND");
    filters.push([
      formula,
      "between",
      timeToMinutes(startTime),
      timeToMinutes(endTime),
    ]);
  } else if (startTime) {
    filters.push("AND");
    filters.push([formula, "greaterthan", timeToMinutes(startTime)]);
  } else if (endTime) {
    filters.push("AND");
    filters.push([formula, "lessthanorequalto", timeToMinutes(endTime)]);
  }

  const logsSearch = search.create({
    type: "scriptexecutionlog",
    filters,
    columns: [
      search.createColumn({ name: "view" }),
      search.createColumn({ name: "title" }),
      search.createColumn({ name: "type" }),
      search.createColumn({ name: "date" }),
      search.createColumn({ name: "time" }),
      search.createColumn({ name: "user" }),
      search.createColumn({ name: "scripttype" }),
      search.createColumn({ name: "detail" }),
    ],
  });

  console.log("count: ", logsSearch.runPaged().count);

  const results = [];
  const pagedData = await logsSearch.runPaged.promise({ pageSize: 1000 });

  pagedData.pageRanges.forEach(async (pageRange) => {
    const page = await pagedData.fetch.promise({ index: pageRange.index });

    page.data.forEach((result) => {
      results.push(
        result.columns.reduce((acc, col) => {
          acc[col.name] = result.getValue(col);
          return acc;
        }, {})
      );
    });
  });

  console.log("Results", results);

  return results;
};

/* const logsSearch = getLogsByTime({ startTime: "8:23", endTime: "8:46" });
console.log("count: ", logsSearch.runPaged().count);

const results = [];
logsSearch
  .runPaged({ pageSize: 1000 })
  .fetch({ index: 0 })
  .data.forEach((r) => {
    results.push(
      r.columns.reduce((acc, col) => {
        acc[col.name] = r.getValue(col);
        return acc;
      }, {})
    );
  });

console.log("Results", results); */
