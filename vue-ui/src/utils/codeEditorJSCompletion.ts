import { ref } from "vue";

export const completionItems = ref([
  // --- EXISTING ITEMS ---
  {
    label: "myCustomFunction",
    kind: "Function",
    insertText: "myCustomFunction(${1:param})",
    snippet: true,
    documentation: "This is my custom function with autocomplete",
    detail: "(param: string) => void",
  },
  {
    label: "myVariable",
    kind: "Variable",
    insertText: "myVariable",
    documentation: "A custom variable",
    detail: "string",
  },
  {
    label: "myClass",
    kind: "Class",
    insertText: "class MyClass {\n\tconstructor() {\n\t\t$0\n\t}\n}",
    snippet: true,
    documentation: "Custom class template",
  },
  {
    label: "apiCall",
    kind: "Function",
    insertText:
      'fetch("${1:url}")\n\t.then(res => res.json())\n\t.then(data => ${2:console.log(data)})',
    snippet: true,
    documentation: "Quick API call snippet",
    detail: "(url: string) => Promise<any>",
  },

  // --- SUITESCRIPT COMPLETIONS BELOW ---

  /* ===========================
        QUERY → mappedResults
     =========================== */
  {
    label: "suiteQLQuery",
    kind: "Function",
    insertText:
      "const results = query.runSuiteQL({\n" +
      "\tquery: `SELECT ${1:columns} FROM ${2:table} WHERE ${3:condition}`,\n" +
      "}).asMappedResults();\n\n" +
      "results.forEach(r => {\n" +
      "\tconsole.log(r);\n" +
      "});",
    snippet: true,
    documentation: "SuiteQL query using query.runSuiteQL + mapped results.",
    detail: "SuiteScript 2.1: query.runSuiteQL → mapped results",
  },

  /* ======================================
        SEARCH.runPaged + GET ALL RESULTS
     ====================================== */
  {
    label: "searchRunPagedGetAll",
    kind: "Function",
    insertText:
      "const s = search.create({\n" +
      "\ttype: '${1:recordtype}',\n" +
      "\tfilters: [${2:['field', 'operator', 'value']}],\n" +
      "\tcolumns: [${3:'internalid'}]\n" +
      "});\n\n" +
      "const paged = s.runPaged({ pageSize: 1000 });\n" +
      "let results = [];\n\n" +
      "paged.pageRanges.forEach(pr => {\n" +
      "\tconst page = paged.fetch({ index: pr.index });\n" +
      "\tresults = results.concat(page.data);\n" +
      "});\n\n" +
      "console.log('Total results:', results.length);",
    snippet: true,
    documentation: "Search runPaged example including getting all results.",
    detail: "SuiteScript 2.1: search.runPaged → get all pages",
  },

  /* ==============================
         record.submitFields
     ============================== */
  {
    label: "recordSubmitFields",
    kind: "Function",
    insertText:
      "record.submitFields({\n" +
      "\ttype: '${1:recordtype}',\n" +
      "\tid: ${2:id},\n" +
      "\tvalues: {\n" +
      "\t\t${3:fieldid}: ${4:value}\n" +
      "\t},\n" +
      "\toptions: {\n" +
      "\t\tenableSourcing: false,\n" +
      "\t\tignoreMandatoryFields: true,\n" +
      "\t}\n" +
      "});",
    snippet: true,
    documentation: "Quick snippet for record.submitFields.",
    detail: "SuiteScript 2.1: record.submitFields",
  },

  /* ==============================
           search.lookupFields
     ============================== */
  {
    label: "lookupFields",
    kind: "Function",
    insertText:
      "const lookup = search.lookupFields({\n" +
      "\ttype: '${1:recordtype}',\n" +
      "\tid: ${2:id},\n" +
      "\tcolumns: [${3:'name'}]\n" +
      "});\n" +
      "console.log(lookup);",
    snippet: true,
    documentation: "Search lookupFields helper.",
    detail: "SuiteScript 2.1: search.lookupFields",
  },
]);
