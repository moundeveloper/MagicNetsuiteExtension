/**
 * Exports a record and its fields and sublists into a JSON object.
 *
 * @param {Object} N - The Netsuite API object.
 * @param {string} recordId - The ID of the record to export.
 * @param {string} recordType - The type of the record to export.
 * @param {Object} [config] - Optional configuration object.
 * @param {string[]} [config.blackListFields] - Array of field IDs to exclude from the export.
 * @param {string[]} [config.blackListSublistFields] - Array of field IDs to exclude from the export of sublists.
 * @param {string[]} [config.whiteListFields] - Array of field IDs to include in the export.
 * @param {string[]} [config.whiteListSublists] - Array of sublist IDs to include in the export.
 * @param {string[]} [config.include] - Array of properties to include in the export of each field: ['fieldId', 'fieldName', 'text', 'value']
 *
 * @return {Object} - The exported record data in JSON format.
 */
const exportRecord = (N, recordId, recordType, config = {}) => {
  const {
    blackListFields = [],
    blackListSublistFields = [],
    whiteListFields = null,
    whiteListSublists = null,
    include = null, // Array of properties to include: ['fieldId', 'fieldName', 'text', 'value']
  } = config;

  const { record } = N;

  if (!recordId || !recordType) {
    console.log("No record selected");
    return;
  }

  // 1️⃣ Load record
  const rec = null;
  try {
    rec = record.load({
      type: recordType,
      id: recordId,
    });
  } catch (error) {
    console.log("Record not found");
    return;
  }

  if (!rec) {
    console.log("Record not found");
    return;
  }

  const exportData = {};

  // Helper function to build field data based on include array
  const buildFieldData = (fieldId, getText, getValue, getField) => {
    // If include is null, return simple text value (backward compatible)
    if (include === null) {
      return getText();
    }

    // Build object with only requested properties
    const fieldData = {};

    if (include.includes("fieldId")) {
      fieldData.fieldId = fieldId;
    }

    if (include.includes("fieldName")) {
      const field = getField();
      fieldData.fieldName = field ? field.label : null;
    }

    if (include.includes("text")) {
      fieldData.text = getText();
    }

    if (include.includes("value")) {
      fieldData.value = getValue();
    }

    return fieldData;
  };

  // 2️⃣ Export body fields
  const fieldIds = rec.getFields();
  exportData.body = {};

  fieldIds.forEach((fid) => {
    // Apply blacklist first
    if (blackListFields.includes(fid)) return;

    // Then apply whitelist if specified
    if (whiteListFields !== null && !whiteListFields.includes(fid)) return;

    exportData.body[fid] = buildFieldData(
      fid,
      () => rec.getText({ fieldId: fid }),
      () => rec.getValue({ fieldId: fid }),
      () => rec.getField({ fieldId: fid })
    );
  });

  // 3️⃣ Export sublists and their fields
  const sublistIds = rec.getSublists();
  exportData.sublists = {};

  sublistIds.forEach((sublistId) => {
    if (whiteListSublists !== null && !whiteListSublists.includes(sublistId))
      return;

    const lineCount = rec.getLineCount({ sublistId });
    exportData.sublists[sublistId] = [];

    for (let i = 0; i < lineCount; i++) {
      const lineFields = rec.getSublistFields({ sublistId });
      const lineData = {};

      lineFields.forEach((fieldId) => {
        if (blackListSublistFields.includes(fieldId)) return;

        lineData[fieldId] = buildFieldData(
          fieldId,
          () => rec.getSublistText({ sublistId, fieldId, line: i }),
          () => rec.getSublistValue({ sublistId, fieldId, line: i }),
          () => rec.getSublistField({ sublistId, fieldId, line: i }) // Added line parameter
        );
      });

      exportData.sublists[sublistId].push(lineData);
    }
  });

  return exportData;
};
// Example usage:

window.getScripts = async (N, config = {}) => {
  const exportedRecord = exportRecord(N, config);
  return exportedRecord;
};
