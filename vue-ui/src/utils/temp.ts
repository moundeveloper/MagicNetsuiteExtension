export const defaultCode = `
console.log('Hello, world!')

console.log("ciaoooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo")

const bruh = async () => {
  const scriptId = null

  let sql = \`
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
    \`;

  // Only add WHERE if scriptId is provided
  if (scriptId) {
    sql += \` WHERE script.scriptid = ?\`;
  }

  const queryConfig = { query: sql };

  if (scriptId) {
    queryConfig.params = [scriptId];
  }

  const resultSet = await query.runSuiteQL.promise(queryConfig);

  const results = resultSet.asMappedResults();

  console.log(\`Retrieved \${results.length} script records\`);
  console.log(results)
}

await bruh()
`;

export const treeNodes = [
  {
    key: "0",
    label: ".github",
    data: ".github folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "0-0",
        label: "workflows",
        data: "workflows folder",
        icon: "pi pi-fw pi-folder",
        children: [
          {
            key: "0-0-0",
            label: "node.js.yml",
            data: "node.js.yml file",
            icon: "pi pi-fw pi-file",
          },
        ],
      },
    ],
  },
  {
    key: "1",
    label: ".vscode",
    data: ".vscode folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "1-0",
        label: "extensions.json",
        data: "extensions.json file",
        icon: "pi pi-fw pi-file",
      },
    ],
  },
  {
    key: "2",
    label: "public",
    data: "public folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "2-0",
        label: "vite.svg",
        data: "vite.svg file",
        icon: "pi pi-fw pi-file",
      },
    ],
  },
  {
    key: "3",
    label: "src",
    data: "src folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "3-0",
        label: "assets",
        data: "assets folder",
        icon: "pi pi-fw pi-folder",
        children: [
          {
            key: "3-0-0",
            label: "vue.svg",
            data: "vue.svg file",
            icon: "pi pi-fw pi-file",
          },
        ],
      },
      {
        key: "3-1",
        label: "components",
        data: "components folder",
        icon: "pi pi-fw pi-folder",
        children: [
          {
            key: "3-1-0",
            label: "HelloWorld.vue",
            data: "HelloWorld.vue file",
            icon: "pi pi-fw pi-file",
          },
        ],
      },
      {
        key: "3-2",
        label: "App.vue",
        data: "App.vue file",
        icon: "pi pi-fw pi-file",
      },
      {
        key: "3-3",
        label: "main.js",
        data: "main.js file",
        icon: "pi pi-fw pi-file",
      },
      {
        key: "3-4",
        label: "style.css",
        data: "style.css file",
        icon: "pi pi-fw pi-file",
      },
    ],
  },
  {
    key: "4",
    label: "index.html",
    data: "index.html file",
    icon: "pi pi-fw pi-file",
  },
  {
    key: "5",
    label: "package.json",
    data: "package.json file",
    icon: "pi pi-fw pi-file",
  },
  {
    key: "6",
    label: "vite.config.js",
    data: "vite.config.js file",
    icon: "pi pi-fw pi-file",
  },
];
