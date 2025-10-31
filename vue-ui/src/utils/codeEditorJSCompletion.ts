// src/completion/jsCompletions.ts
import { snippetCompletion } from "@codemirror/autocomplete";

export const jsGlobals = [
  { label: "console", type: "variable", info: "Console object for logging" },
  { label: "window", type: "variable", info: "Global window object" },
  { label: "document", type: "variable", info: "Document object" },
  { label: "Math", type: "variable", info: "Math functions and constants" },
  { label: "Date", type: "variable", info: "Date object" },
  {
    label: "JSON",
    type: "variable",
    info: "JSON object for parsing/stringifying",
  },
  {
    label: "Promise",
    type: "variable",
    info: "Promise object for async operations",
  },
  { label: "Array", type: "variable", info: "Array object and methods" },
  { label: "String", type: "variable", info: "String object and methods" },
  { label: "Number", type: "variable", info: "Number object and methods" },
  { label: "Boolean", type: "variable", info: "Boolean object" },
];

export const jsMethods = [
  "push",
  "pop",
  "shift",
  "unshift",
  "map",
  "filter",
  "reduce",
  "forEach",
  "slice",
  "splice",
  "join",
  "toString",
  "includes",
  "indexOf",
  "find",
  "findIndex",
];

export const jsSnippets = [
  snippetCompletion(
    "for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t$0\n}",
    { label: "for loop", type: "keyword", info: "For loop snippet" }
  ),
  snippetCompletion("if (${1:condition}) {\n\t$0\n}", {
    label: "if statement",
    type: "keyword",
    info: "If statement snippet",
  }),
  snippetCompletion("function ${1:name}(${2:params}) {\n\t$0\n}", {
    label: "function",
    type: "keyword",
    info: "Function declaration snippet",
  }),
];

// Optional: extend with more snippets or globals
export const jsExtraGlobals = [
  { label: "fetch", type: "variable", info: "Fetch API for HTTP requests" },
  { label: "localStorage", type: "variable", info: "Local storage" },
  { label: "sessionStorage", type: "variable", info: "Session storage" },
];
