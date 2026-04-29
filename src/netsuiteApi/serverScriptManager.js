/**
 * Server Script Manager - Manages folder, files, script records, and deployments
 * for server-side Quick Script execution
 */

const MAGIC_FOLDER_NAME = "MagicNetsuiteScripts";
const SUITELET_SCRIPT_NAME = "MagicNetsuiteServer";
const SUITELET_SCRIPT_ID = "customscript_magic_netsuite_server";
const HANDLER_MODULE_NAME = "magic_netsuite_handlers";
const HANDLER_MODULE_SCRIPT_ID = "customscript_magic_netsuite_handlers";

/**
 * Get or create the MagicNetsuiteScripts folder
 * @param {object} N - NetSuite modules
 * @returns {Promise<{folderId: string|null, created: boolean}>}
 */
window.getOrCreateMagicFolder = async (N) => {
  const { query } = N;

  try {
    // Check if folder exists in SuiteScripts (-15)
    const sql = `
      SELECT id, name
      FROM MediaItemFolder
      WHERE name = ?
      AND parent = -15
    `;

    const resultSet = await query.runSuiteQL.promise({
      query: sql,
      params: [MAGIC_FOLDER_NAME]
    });

    const results = resultSet.asMappedResults();

    if (results.length > 0) {
      return { folderId: results[0].id, created: false };
    }

    // Folder doesn't exist, create it using the proven createFolder function
    const csrfToken = document.querySelector('input[name="_csrf"]')?.value;

    const { folderId } = await window.createFolder(
      {},
      {
        folderName: MAGIC_FOLDER_NAME,
        parentFolderId: -15,
        csrfToken
      }
    );

    return { folderId, created: true };
  } catch (error) {
    console.error("[getOrCreateMagicFolder]", error);
    throw error;
  }
};

/**
 * Get or create the handler module file
 * @param {object} N - NetSuite modules
 * @param {string} folderId - Target folder ID
 * @returns {Promise<{fileId: string|null}>}
 */
window.getOrCreateHandlerModule = async (N, folderId) => {
  const { query } = N;

  try {
    // Check if handler module file already exists
    const fileResult = await query.runSuiteQL.promise({
      query: `SELECT file.id, file.name FROM file WHERE file.name = ?`,
      params: [`${HANDLER_MODULE_NAME}.js`]
    });

    const files = fileResult.asMappedResults();

    if (files.length > 0) {
      return { fileId: files[0].id };
    }

    // Upload the handler module file
    const initialContent = buildHandlerModuleContent({});
    const uploadResult = await window.uploadFile(
      N,
      {
        fileName: `${HANDLER_MODULE_NAME}.js`,
        fileContent: initialContent,
        folderId
      },
      document.querySelector('input[name="_csrf"]')?.value
    );

    if (!uploadResult.uploaded.length) {
      throw new Error("Failed to upload handler module file");
    }

    return { fileId: uploadResult.uploaded[0].fileId };
  } catch (error) {
    console.error("[getOrCreateHandlerModule]", error);
    throw error;
  }
};

/**
 * Get or create the suitelet script
 * @param {object} N - NetSuite modules
 * @param {string} folderId - Target folder ID
 * @param {string} handlerFileId - Handler module file ID (for dependencies)
 * @returns {Promise<{fileId: string|null, scriptRecordId: string|null, deploymentId: string|null}>}
 */
window.getOrCreateSuitelet = async (N, folderId, handlerScriptId) => {
  const { query, url } = N;

  try {
    // Check if script record exists
const scriptResult = await query.runSuiteQL.promise({
  query: `SELECT id, scriptid FROM script WHERE LOWER(scriptid) = LOWER(?)`,
  params: [SUITELET_SCRIPT_ID]
});

    const scripts = scriptResult.asMappedResults();
    console.log("[getOrCreateSuitelet] Script check result:", scripts);

    if (scripts.length > 0) {
      const scriptRecordId = scripts[0].id;

      // Get the file ID associated with this script
      const fileResult = await query.runSuiteQL.promise({
        query: `SELECT script.scriptfile FROM script WHERE id = ?`,
        params: [scriptRecordId]
      });
      const fileId = fileResult.asMappedResults()[0]?.scriptfile || null;

      // Get deployment
      const deployResult = await query.runSuiteQL.promise({
        query: `SELECT id, scriptid FROM scriptdeployment WHERE script = ?`,
        params: [scriptRecordId]
      });

      const deployments = deployResult.asMappedResults();
      const deploymentId = deployments.length > 0 ? deployments[0].scriptid : null;

      return {
        fileId,
        scriptRecordId,
        deploymentId
      };
    }

    // Need to create - first upload the file
    const suiteletContent = buildSuiteletContent();
    const uploadResult = await window.uploadFile(
      N,
      {
        fileName: `${SUITELET_SCRIPT_NAME}.js`,
        fileContent: suiteletContent,
        folderId
      },
      document.querySelector('input[name="_csrf"]')?.value
    );

    if (!uploadResult.uploaded.length) {
      throw new Error("Failed to upload suitelet file");
    }

    const fileId = uploadResult.uploaded[0].fileId;

    // Create script record with dependency on handler module
    const csrfToken = document.querySelector('input[name="_csrf"]')?.value;
    const { scriptRecordId } = await window.createScriptRecord(
      N,
      {
        name: "Magic Netsuite Server",
        scriptId: SUITELET_SCRIPT_ID,
        fileId,
        scriptType: "SUITELET",
        description: "Suitelet for Magic Netsuite extension server-side script execution",
        apiVersion: "2.1"
      },
      csrfToken
    );

    if (!scriptRecordId) {
      throw new Error("Failed to create suitelet script record");
    }

    // Create deployment
    const deployment = await window.createScriptDeployment(
      N,
      scriptRecordId,
      "customdeploy_magic_netsuite_server",
      "Magic Netsuite Server Deployment"
    );

    return {
      fileId,
      scriptRecordId,
      deploymentId: deployment?.deploymentId || null
    };
  } catch (error) {
    console.error("[getOrCreateSuitelet]", error);
    throw error;
  }
};

/**
 * Create a script deployment
 * @param {object} N - NetSuite modules
 * @param {string} scriptRecordId - Internal ID of the script record
 * @param {string} deploymentId - Deployment script ID
 * @param {string} title - Deployment title
 * @returns {Promise<{deploymentId: string|null}>}
 */
window.createScriptDeployment = async (
  N,
  scriptRecordId,
  deploymentId,
  title
) => {
  const { url } = N;
  const domain = url.resolveDomain({ hostType: url.HostType.APPLICATION });
  const csrfToken = document.querySelector('input[name="_csrf"]')?.value;

  const body = `submitter=Save&scripttype=scriptdeployment&name=${encodeURIComponent(
    title
  )}&scriptid=${encodeURIComponent(
    deploymentId
  )}&script=${scriptRecordId}&isdeployed=T&status=RELEASED&loglevel=DEBUG&_csrf=${encodeURIComponent(
    csrfToken
  )}&nsapiCT=${Date.now()}&type=scriptdeployment&id=&externalid=&whence=${encodeURIComponent(
    `/app/common/scripting/scriptdeployment.nl`
  )}`;

  try {
    const response = await fetch(
      `${domain}/app/common/scripting/scriptdeployment.nl`,
      {
        method: "POST",
        credentials: "include",
        mode: "cors",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "it-IT,it;q=0.6",
          "cache-control": "max-age=0",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1"
        },
        referrer: `https://${domain}/app/common/scripting/scriptdeployment.nl`,
        body
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create deployment: ${response.status}`);
    }

    const html = await response.text();
    const extractedId = extractDeploymentIdFromHtml(html);

    return { deploymentId: extractedId || deploymentId };
  } catch (error) {
    console.error("[createScriptDeployment]", error);
    throw error;
  }
};

/**
 * Update handler module with user-specific handler
 * @param {object} N - NetSuite modules
 * @param {string} folderId - Folder containing the handler file
 * @param {string} userId - Extension user ID
 * @param {string} code - User's script code
 * @returns {Promise<boolean>}
 */
window.updateUserHandler = async (N, folderId, userId, code) => {
  const { query } = N;

  try {
    // Find the handler module file
    const sql = `
      SELECT file.id, file.name, file.url
      FROM file
      INNER JOIN script ON script.scriptfile = file.id
      WHERE script.scriptid = ?
    `;

    const resultSet = await query.runSuiteQL.promise({
      query: sql,
      params: [HANDLER_MODULE_SCRIPT_ID]
    });

    const results = resultSet.asMappedResults();

    if (!results.length) {
      throw new Error("Handler module file not found");
    }

    const fileId = results[0].id;
    const domain = N.url.resolveDomain({ hostType: N.url.HostType.APPLICATION });
    const fileUrl = `https://${domain}${results[0].url}`;

    // Fetch current content
    const response = await fetch(fileUrl, { credentials: "include" });
    if (!response.ok) {
      throw new Error("Failed to fetch handler module content");
    }

    let currentContent = await response.text();

    // Build the new handler
    const handlerName = `handle_${userId}`;
    const newHandler = buildUserHandler(userId, code);

    // Check if handler already exists
    const handlerRegex = new RegExp(
      `\\b${handlerName}\\s*:\\s*\\(?\\)?\\s*=>\\s*{`
    );

    if (handlerRegex.test(currentContent)) {
      // Replace existing handler
      const replaceRegex = new RegExp(
        `(${handlerName}\\s*:\\s*\\(?\\)?\\s*=>\\s*{)[^}]*(})`,
        "m"
      );
      currentContent = currentContent.replace(
        replaceRegex,
        `$1\n    ${newHandler}\n  $2`
      );
    } else {
      // Add new handler - find the handlers object and add to it
      currentContent = currentContent.replace(
        /(const handlers\s*=\s*\(\)\s*=>\s*{\s*return\s*{)/,
        `$1\n    ${newHandler},`
      );
    }

    // Upload updated file
    const uploadResult = await window.uploadFile(
      N,
      {
        fileName: `${HANDLER_MODULE_NAME}.js`,
        fileContent: currentContent,
        folderId
      },
      document.querySelector('input[name="_csrf"]')?.value
    );

    return uploadResult.uploaded.length > 0;
  } catch (error) {
    console.error("[updateUserHandler]", error);
    throw error;
  }
};

/**
 * Execute server-side script via suitelet
 * @param {object} N - NetSuite modules
 * @param {string} suiteletScriptId - Suitelet script ID
 * @param {string} deploymentId - Deployment ID
 * @param {string} userId - Extension user ID
 * @returns {Promise<any>}
 */
window.executeServerScript = async (
  N,
  suiteletScriptId,
  deploymentId,
  userId
) => {
  const { url } = N;

  try {
    const suiteletUrl = url.resolveScript({
      scriptId: suiteletScriptId,
      deploymentId: deploymentId,
      returnExternalUrl: false
    });

    const fullUrl = `https://${url.resolveDomain({
      hostType: url.HostType.APPLICATION
    })}${suiteletUrl}`;

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: `action=handle_${userId}`,
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(`Server script failed: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("[executeServerScript]", error);
    throw error;
  }
};

/**
 * Remove all Magic Netsuite server-side components
 * @param {object} N - NetSuite modules
 * @returns {Promise<{removed: string[]}>}
 */
window.removeMagicNetsuiteComponents = async (N) => {
  const { query, record } = N;
  const removed = [];

  try {
    // Find and delete deployments
    const deployments = await query.runSuiteQL.promise({
      query: `SELECT id FROM scriptdeployment WHERE script IN (SELECT id FROM script WHERE scriptid IN (?, ?))`,
      params: [SUITELET_SCRIPT_ID, HANDLER_MODULE_SCRIPT_ID]
    });

    const deploymentIds = deployments.asMappedResults();
    for (const dep of deploymentIds) {
      try {
        record.delete({ type: "scriptdeployment", id: dep.id });
        removed.push(`deployment_${dep.id}`);
      } catch (e) {
        console.warn("Failed to delete deployment", dep.id, e);
      }
    }

    // Find and delete script records
    const scripts = await query.runSuiteQL.promise({
      query: `SELECT id, scriptid FROM script WHERE scriptid IN (?, ?)`,
      params: [SUITELET_SCRIPT_ID, HANDLER_MODULE_SCRIPT_ID]
    });

    const scriptRecords = scripts.asMappedResults();
    for (const scr of scriptRecords) {
      try {
        record.delete({ type: "script", id: scr.id });
        removed.push(scr.scriptid);
      } catch (e) {
        console.warn("Failed to delete script record", scr.scriptid, e);
      }
    }

    // Find and delete files
    const files = await query.runSuiteQL.promise({
      query: `SELECT file.id FROM file WHERE file.name IN (?, ?)`,
      params: [`${SUITELET_SCRIPT_NAME}.js`, `${HANDLER_MODULE_NAME}.js`]
    });

    const fileRecords = files.asMappedResults();
    for (const f of fileRecords) {
      try {
        record.delete({ type: "file", id: f.id });
        removed.push(`file_${f.id}`);
      } catch (e) {
        console.warn("Failed to delete file", f.id, e);
      }
    }

    // Find and delete folder
    const folders = await query.runSuiteQL.promise({
      query: `SELECT id FROM MediaItemFolder WHERE name = ?`,
      params: [MAGIC_FOLDER_NAME]
    });

    const folderRecords = folders.asMappedResults();
    for (const f of folderRecords) {
      try {
        record.delete({ type: "folder", id: f.id });
        removed.push(`folder_${f.id}`);
      } catch (e) {
        console.warn("Failed to delete folder", f.id, e);
      }
    }

    return { removed };
  } catch (error) {
    console.error("[removeMagicNetsuiteComponents]", error);
    throw error;
  }
};

// ─── Helper Functions ──────────────────────────────────────────────────────────

function buildHandlerModuleContent(initialHandlers = {}) {
  return `/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  const handlers = () => {
    return {
      // User handlers will be added here dynamically
      ${Object.entries(initialHandlers)
        .map(
          ([key, code]) =>
            `${key}: () => {\n        ${code}\n      }`
        )
        .join(",\n      ")}
    };
  };

  return { handlers };
});`;
}

function buildSuiteletContent() {
  return `/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["./${HANDLER_MODULE_NAME}"], (handler) => {
  const onRequest = (context) => {
    try {
      const { method } = context.request;
      const handlers = handler.handlers();

      if (method !== "POST") return;

      const { action } = context.request.parameters;

      const handlerFn = handlers[action];
      if (handlerFn) {
        const result = handlerFn();
        context.response.write(JSON.stringify(result));
      }
    } catch (error) {
      context.response.write(JSON.stringify(error));
    }
  };

  return { onRequest };
});`;
}

function buildUserHandler(userId, code) {
  return `${userId}: () => {
    ${code}
  }`;
}

function extractDeploymentIdFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const idInput = doc.querySelector('input[name="id"]');
  if (idInput && idInput.value) return idInput.value;

  const m = html.match(/scriptdeployment\.nl\?id=(\d+)/);
  if (m) return m[1];

  return null;
}
