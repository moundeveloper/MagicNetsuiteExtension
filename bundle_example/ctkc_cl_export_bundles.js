/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(["N/url"], /**
 * @param{url} url
 */ function (url) {
  /* Global variables */
  const WORKER_LIMIT = 3;
  const WORKERS = [];
  const workerQueue = [];
  const loader = createLoader();

  /**
   * Function to be executed after page is initialized.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
   *
   * @since 2015.2
   */
  function pageInit(scriptContext) {}

  const exportBundles = async () => {
    try {
      loader.view();
      initWorkerPool();

      const listCSV = await fetchBundles();

      const map = {
        Name: "name",
        "Bundle ID": "bundleId",
        Version: "version",
        "App ID": "appId",
        Abstract: "abstract",
        "Created By": "createdBy",
        "Created On": "createdOn",
        "Last Update": "lastUpdate",
      };

      const parseBundles = createCSVParser(map);

      const bundles = parseBundles(listCSV);

      const bundlesWithComponents = await loadBundleComponents(bundles);

      console.log("Bundles with components:", bundlesWithComponents.length);

      await exportBundlesRequest(bundlesWithComponents);

      loader.updateText("🎉 Bundles exported successfully 🎉", false);
    } catch (error) {
      console.error("Error exporting bundles:", error);

      loader.updateText("Error exporting bundles: " + error.message, false);
    }
  };

  const exportBundlesRequest = async (bundles) => {
    try {
      const suiteletUrl = url.resolveScript({
        scriptId: "customscript_ctkc_bundle_manager",
        deploymentId: "customdeploy_ctkc_bundle_manager",
      });

      const domain = url.resolveDomain({
        hostType: url.HostType.APPLICATION,
      });

      const fullUrl = `https://${domain}${suiteletUrl}`;

      const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: JSON.stringify({
          action: "export_bundles",
          bundles: bundles,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log("Export Bundles Response:", data);
      return data;
    } catch (error) {
      console.error("Error exporting bundles:", error);
      throw error;
    }
  };

  const createWorkerFromFunction = (fn) => {
    const blob = new Blob([`(${fn.toString()})();`], {
      type: "application/javascript",
    });

    const urlObj = URL.createObjectURL(blob);
    const worker = new Worker(urlObj);

    worker.addEventListener("exit", () => URL.revokeObjectURL(urlObj));
    return worker;
  };

  const initWorkerPool = () => {
    for (let i = 0; i < WORKER_LIMIT; i++) {
      WORKERS.push(createPooledWorker());
    }
  };

  const createPooledWorker = () => {
    const w = createWorkerFromFunction(CSVParserWorker);
    w.busy = false;
    return w;
  };

  const CSVParserWorker = () => {
    self.onmessage = (e) => {
      const csv = e.data;
      const lines = csv.trim().split("\n");

      let components = [];
      let currentCategory = null;
      let currentSubCategory = null;

      const isCategory = (line) => {
        const c = line.split(",");
        return c[0] && !c[1] && !c[2] && !c[3];
      };

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const [name, id, referencedBy, isLocked] = line.split(",");
        const next = lines[i + 1];

        if (isCategory(line) && !isCategory(next)) {
          currentSubCategory = name;
          continue;
        }

        if (isCategory(line)) {
          currentCategory = name;
          continue;
        }

        components.push({
          name,
          id,
          referencedBy,
          isLocked: !!isLocked,
          category: currentCategory,
          subCategory: currentSubCategory,
        });
      }

      postMessage(components);
    };
  };

  const parseInWorker = (csv) => {
    return new Promise((resolve, reject) => {
      const free = WORKERS.find((w) => !w.busy);
      const job = { csv, resolve, reject };

      const runJob = (worker, job) => {
        worker.busy = true;

        const handleMessage = (e) => {
          worker.busy = false;
          worker.onmessage = null;
          worker.onerror = null;
          job.resolve(e.data);

          if (workerQueue.length > 0) {
            const nextJob = workerQueue.shift();
            runJob(worker, nextJob);
          }
        };

        const handleError = (err) => {
          worker.busy = false;
          worker.onmessage = null;
          worker.onerror = null;
          job.reject(err);

          if (workerQueue.length > 0) {
            const nextJob = workerQueue.shift();
            runJob(worker, nextJob);
          }
        };

        worker.onmessage = handleMessage;
        worker.onerror = handleError;
        worker.postMessage(job.csv);
      };

      if (free) {
        runJob(free, job);
      } else {
        workerQueue.push(job);
      }
    });
  };

  const runWorker = (worker, csv, resolve) => {
    worker.busy = true;

    worker.onmessage = (e) => {
      worker.busy = false;
      resolve(e.data);

      if (workerQueue.length > 0) {
        const job = workerQueue.shift();
        runWorker(worker, job.csv, job.resolve);
      }
    };

    worker.postMessage(csv);
  };

  const loadBundleComponents = async (bundles) => {
    console.log("Fetching + parsing components asynchronously…");

    await fetchWithLimit(bundles, 5, async (bundle) => {
      const csv = await fetchBundleComponent(bundle);

      bundle.components = await parseInWorker(csv);
      return bundle;
    });

    return bundles;
  };

  const fetchWithLimit = async (items, limit, handler) => {
    const queue = [...items];
    let running = 0;
    let results = [];

    return new Promise((resolve) => {
      const next = () => {
        if (queue.length === 0 && running === 0) {
          resolve(results);
          return;
        }

        while (running < limit && queue.length > 0) {
          const item = queue.shift();
          running++;

          handler(item)
            .then((res) => results.push(res))
            .finally(() => {
              running--;
              next();
            });
        }
      };

      next();
    });
  };

  const fetchBundles = async () => {
    const domain = url.resolveDomain({
      hostType: url.HostType.APPLICATION,
    });

    const bundlesUrl = `https://${domain}/app/bundler/bundlelist.csv?type=S&sortcol=bundlename&sortdir=ASC&csv=Export`;

    const response = await fetch(bundlesUrl, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch bundle list: ${response.status}`);
    }

    const csv = await response.text();
    return csv;
  };

  const createCSVParser = (propertyMapping = {}) => {
    return (csvText) => {
      const lines = csvText.split("\n").filter((line) => line.trim() !== "");
      lines.shift();
      const headers = lines[0].split(",").map((header) => header.trim());
      const result = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values = line.split(",");
        const obj = {};

        headers.forEach((header, index) => {
          const friendlyProperty = propertyMapping[header] || header;
          obj[friendlyProperty] = values[index] ? values[index].trim() : "";
        });

        result.push(obj);
      }

      return result;
    };
  };

  const fetchBundleComponent = async ({ bundleId, name }) => {
    loader.updateText(`Fetching bundle component for ${bundleId} - ${name}`);

    const domain = url.resolveDomain({
      hostType: url.HostType.APPLICATION,
    });

    const partBeforeDot = domain.split(".")[0] || ""; // Handle case where there's no dot
    const fetchCompId = partBeforeDot.toLowerCase().replace(/-/g, "_");

    const bundleUrl = `https://${domain}/app/bundler/bundlecontents.csv?csv=Export&OfficeXML=F&id=${bundleId}&fetchcompid=${fetchCompId}`;

    const response = await fetch(bundleUrl, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch bundle component for ${bundleId}: ${response.status}`
      );
    }

    return await response.text();
  };

  /**
   * Function to be executed when field is changed.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   * @param {string} scriptContext.fieldId - Field name
   * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
   * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
   *
   * @since 2015.2
   */
  function fieldChanged(scriptContext) {}

  /**
   * Function to be executed when field is slaved.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   * @param {string} scriptContext.fieldId - Field name
   *
   * @since 2015.2
   */
  function postSourcing(scriptContext) {}

  /**
   * Function to be executed after sublist is inserted, removed, or edited.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   *
   * @since 2015.2
   */
  function sublistChanged(scriptContext) {}

  /**
   * Function to be executed after line is selected.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   *
   * @since 2015.2
   */
  function lineInit(scriptContext) {}

  /**
   * Validation function to be executed when field is changed.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   * @param {string} scriptContext.fieldId - Field name
   * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
   * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
   *
   * @returns {boolean} Return true if field is valid
   *
   * @since 2015.2
   */
  function validateField(scriptContext) {}

  /**
   * Validation function to be executed when sublist line is committed.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   *
   * @returns {boolean} Return true if sublist line is valid
   *
   * @since 2015.2
   */
  function validateLine(scriptContext) {}

  /**
   * Validation function to be executed when sublist line is inserted.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   *
   * @returns {boolean} Return true if sublist line is valid
   *
   * @since 2015.2
   */
  function validateInsert(scriptContext) {}

  /**
   * Validation function to be executed when record is deleted.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.sublistId - Sublist name
   *
   * @returns {boolean} Return true if sublist line is valid
   *
   * @since 2015.2
   */
  function validateDelete(scriptContext) {}

  /**
   * Validation function to be executed when record is saved.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @returns {boolean} Return true if record is valid
   *
   * @since 2015.2
   */
  function saveRecord(scriptContext) {}

  function createLoader(options = {}) {
    const parent = document.getElementById("div__body");
    if (!parent) throw new Error("Parent element not found");

    const {
      textColor = "#3498db",
      spinnerColor = "#e74c3c",
      size = 40,
    } = options;

    // Loader container (relative to parent)
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.top = "50%";
    container.style.left = "50%";
    container.style.transform = "translate(-50%, -50%)";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.visibility = "hidden"; // hidden by default

    // Text element
    const text = document.createElement("div");
    text.style.marginTop = "10px";
    text.style.fontSize = "16px";
    text.style.color = textColor;
    text.innerText = "Loading...";

    // Spinner element
    const spinner = document.createElement("div");
    spinner.style.border = `${Math.floor(size / 6)}px solid #f3f3f3`;
    spinner.style.borderTop = `${Math.floor(size / 6)}px solid ${spinnerColor}`;
    spinner.style.borderRadius = "50%";
    spinner.style.width = `${size}px`;
    spinner.style.height = `${size}px`;
    spinner.style.animation = "spin 1s linear infinite";

    container.appendChild(spinner);
    container.appendChild(text);
    parent.appendChild(container);

    // Add spin animation if not already present
    if (!document.getElementById("loader-spin-style")) {
      const styleSheet = document.createElement("style");
      styleSheet.id = "loader-spin-style";
      styleSheet.type = "text/css";
      styleSheet.innerText = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(styleSheet);
    }

    return {
      view: () => {
        container.style.visibility = "visible";
        spinner.style.visibility = "visible";
      },
      hide: () => (container.style.visibility = "hidden"),
      updateText: (newText, loader = true) => {
        if (!loader) {
          spinner.style.visibility = "hidden";
          text.innerText = newText;
          return;
        }

        spinner.style.visibility = "visible";
        text.innerText = newText;
      },
      remove: () => container.remove(),
    };
  }

  return {
    pageInit: pageInit,
    /*     fieldChanged: fieldChanged,
    postSourcing: postSourcing,
    sublistChanged: sublistChanged,
    lineInit: lineInit,
    validateField: validateField,
    validateLine: validateLine,
    validateInsert: validateInsert,
    validateDelete: validateDelete,
    saveRecord: saveRecord, */
    exportBundles: exportBundles,
  };
});
