import { ref } from "vue";

export const completionItems = ref([
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
]);
