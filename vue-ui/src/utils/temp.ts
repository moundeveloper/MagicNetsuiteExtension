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
            icon: "pi pi-fw pi-file"
          }
        ]
      }
    ]
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
        icon: "pi pi-fw pi-file"
      }
    ]
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
        icon: "pi pi-fw pi-file"
      }
    ]
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
            icon: "pi pi-fw pi-file"
          }
        ]
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
            icon: "pi pi-fw pi-file"
          }
        ]
      },
      {
        key: "3-2",
        label: "App.vue",
        data: "App.vue file",
        icon: "pi pi-fw pi-file"
      },
      {
        key: "3-3",
        label: "main.js",
        data: "main.js file",
        icon: "pi pi-fw pi-file"
      },
      {
        key: "3-4",
        label: "style.css",
        data: "style.css file",
        icon: "pi pi-fw pi-file"
      }
    ]
  },
  {
    key: "4",
    label: "index.html",
    data: "index.html file",
    icon: "pi pi-fw pi-file"
  },
  {
    key: "5",
    label: "package.json",
    data: "package.json file",
    icon: "pi pi-fw pi-file"
  },
  {
    key: "6",
    label: "vite.config.js",
    data: "vite.config.js file",
    icon: "pi pi-fw pi-file"
  }
];

export const temporaryCode = [
  {
    code: `function greet(name) {
console.log('Hello, ' + name);
return 'Welcome!';
}

greet('World');`,
    opened: "0",
    matches: [],
    decorations: [],
    script: {
      scriptId: "1234",
      scriptName: "My Client Script",
      scriptType: "CLIENT",
      scriptFile: "greet.js"
    }
  },
  {
    code: `
  console.log('Hello World');
`,
    opened: "0",
    matches: [],
    decorations: [],
    script: {
      scriptId: "123",
      scriptName: "My Script",
      scriptType: "USEREVENT",
      scriptFile: "greet.js"
    }
  },

  {
    code: defaultCode,
    opened: "0",
    matches: [],
    decorations: [],
    script: {
      scriptId: "1235",
      scriptName: "My Script",
      scriptType: "ACTION",
      scriptFile: "greet.js"
    }
  },
  {
    code: defaultCode,
    opened: "0",
    matches: [],
    decorations: [],
    script: {
      scriptId: "1236",
      scriptName: "My Script",
      scriptType: "CLIENT",
      scriptFile: "greet.js"
    }
  },

  {
    code: defaultCode,
    opened: "0",
    matches: [],
    decorations: [],
    script: {
      scriptId: "1237",
      scriptName: "My Script",
      scriptType: "ACTION",
      scriptFile: "greet.js"
    }
  }
];

export const defaultUsers = [
  { id: 1, name: "Ada Lovelace", email: "ada@history.dev", isActive: true },
  { id: 2, name: "Alan Turing", email: "alan@history.dev", isActive: false },
  { id: 3, name: "Grace Hopper", email: "grace@history.dev", isActive: true },
  {
    id: 4,
    name: "Margaret Hamilton",
    email: "margaret@history.dev",
    isActive: true
  },
  {
    id: 5,
    name: "Rosalind Franklin",
    email: "rosalind@history.dev",
    isActive: false
  },
  {
    id: 6,
    name: "Katherine Johnson",
    email: "katherine@history.dev",
    isActive: true
  },
  {
    id: 7,
    name: "John von Neumann",
    email: "john@history.dev",
    isActive: true
  },
  {
    id: 8,
    name: "Dennis Ritchie",
    email: "dennis@history.dev",
    isActive: false
  },
  { id: 9, name: "Ken Thompson", email: "ken@history.dev", isActive: true },
  {
    id: 10,
    name: "Barbara Liskov",
    email: "barbara@history.dev",
    isActive: true
  },

  {
    id: 11,
    name: "Edsger Dijkstra",
    email: "edsger@history.dev",
    isActive: false
  },
  { id: 12, name: "Donald Knuth", email: "donald@history.dev", isActive: true },
  {
    id: 13,
    name: "Niklaus Wirth",
    email: "niklaus@history.dev",
    isActive: true
  },
  { id: 14, name: "Tim Berners-Lee", email: "tim@history.dev", isActive: true },
  {
    id: 15,
    name: "Linus Torvalds",
    email: "linus@history.dev",
    isActive: true
  },

  {
    id: 16,
    name: "Guido van Rossum",
    email: "guido@history.dev",
    isActive: true
  },
  {
    id: 17,
    name: "Bjarne Stroustrup",
    email: "bjarne@history.dev",
    isActive: false
  },
  { id: 18, name: "James Gosling", email: "james@history.dev", isActive: true },
  {
    id: 19,
    name: "Brendan Eich",
    email: "brendan@history.dev",
    isActive: true
  },
  {
    id: 20,
    name: "Anders Hejlsberg",
    email: "anders@history.dev",
    isActive: true
  },

  { id: 21, name: "Mary Jackson", email: "mary@history.dev", isActive: false },
  {
    id: 22,
    name: "Frances Allen",
    email: "frances@history.dev",
    isActive: true
  },
  { id: 23, name: "Jean Sammet", email: "jean@history.dev", isActive: false },
  {
    id: 24,
    name: "Sophie Wilson",
    email: "sophie@history.dev",
    isActive: true
  },
  { id: 25, name: "Radia Perlman", email: "radia@history.dev", isActive: true },

  { id: 26, name: "Steve Wozniak", email: "woz@history.dev", isActive: true },
  { id: 27, name: "Bill Gates", email: "bill@history.dev", isActive: false },
  { id: 28, name: "Steve Jobs", email: "steve@history.dev", isActive: false },
  { id: 29, name: "Paul Allen", email: "paul@history.dev", isActive: true },
  { id: 30, name: "Larry Page", email: "larry@history.dev", isActive: true },

  { id: 31, name: "Sergey Brin", email: "sergey@history.dev", isActive: true },
  {
    id: 32,
    name: "Marissa Mayer",
    email: "marissa@history.dev",
    isActive: false
  },
  {
    id: 33,
    name: "Sheryl Sandberg",
    email: "sheryl@history.dev",
    isActive: true
  },
  {
    id: 34,
    name: "Susan Wojcicki",
    email: "susan@history.dev",
    isActive: false
  },
  { id: 35, name: "Meg Whitman", email: "meg@history.dev", isActive: true },

  { id: 36, name: "Jeff Bezos", email: "jeff@history.dev", isActive: true },
  { id: 37, name: "Elon Musk", email: "elon@history.dev", isActive: false },
  { id: 38, name: "Satya Nadella", email: "satya@history.dev", isActive: true },
  {
    id: 39,
    name: "Sundar Pichai",
    email: "sundar@history.dev",
    isActive: true
  },
  {
    id: 40,
    name: "Mark Zuckerberg",
    email: "mark@history.dev",
    isActive: false
  },

  { id: 41, name: "Anne Wojcicki", email: "anne@history.dev", isActive: true },
  { id: 42, name: "Ginni Rometty", email: "ginni@history.dev", isActive: true },
  { id: 43, name: "Carol Shaw", email: "carol@history.dev", isActive: false },
  {
    id: 44,
    name: "Adele Goldberg",
    email: "adele@history.dev",
    isActive: true
  },
  { id: 45, name: "Joan Clarke", email: "joan@history.dev", isActive: true },

  {
    id: 46,
    name: "Claude Shannon",
    email: "claude@history.dev",
    isActive: false
  },
  { id: 47, name: "George Boole", email: "george@history.dev", isActive: true },
  {
    id: 48,
    name: "Alonzo Church",
    email: "alonzo@history.dev",
    isActive: true
  },
  {
    id: 49,
    name: "John McCarthy",
    email: "john.m@history.dev",
    isActive: false
  },
  {
    id: 50,
    name: "Leslie Lamport",
    email: "leslie@history.dev",
    isActive: true
  }
];
