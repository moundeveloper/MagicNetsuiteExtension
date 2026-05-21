import type { ToolDefinition } from "../composables/useAgent";

export type TodoStatus = "pending" | "in_progress" | "done";

export interface AgentTodo {
  id: string;
  content: string;
  status: TodoStatus;
}

export function createTodoTools(
  setTodos: (todos: AgentTodo[]) => void,
  getTodos: () => AgentTodo[]
): ToolDefinition[] {
  return [
    {
      name: "agent_todo_write",
      description:
        "Create or fully replace the agent task list. " +
        "Call this FIRST for any request with 2+ distinct steps, then again whenever a task status changes. " +
        "You MUST pass a 'todos' array. Each item must have 'content' (string) and 'status' ('pending'|'in_progress'|'done'). " +
        "Only one item should be 'in_progress' at a time. " +
        "Before your final response, ensure all items are 'done'. " +
        "Example call: { \"todos\": [{ \"content\": \"Search for script\", \"status\": \"done\" }, { \"content\": \"Read file\", \"status\": \"in_progress\" }] }",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: { type: "object" },
            description:
              "The complete todo list (replaces any existing list). " +
              "Each item MUST have: 'content' (string) and 'status' ('pending'|'in_progress'|'done'). " +
              "Example: [{ \"content\": \"Search script\", \"status\": \"done\" }, { \"content\": \"Read file\", \"status\": \"in_progress\" }]"
          }
        },
        required: ["todos"]
      },
      execute: (input) => {
        const items = input.todos as { content: string; status: string }[];
        const todos: AgentTodo[] = items.map((item, i) => ({
          id: `todo-${Date.now()}-${i}`,
          content: String(item.content),
          status: item.status as TodoStatus
        }));
        setTodos(todos);
        return {
          updated: todos.length,
          pending: todos.filter((t) => t.status === "pending").length,
          inProgress: todos.filter((t) => t.status === "in_progress").length,
          done: todos.filter((t) => t.status === "done").length
        };
      }
    },
    {
      name: "agent_todo_read",
      description:
        "Read the current agent task list. " +
        "Use this to check which tasks remain before deciding on the next step or before finalizing your response.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      },
      execute: () => {
        const todos = getTodos();
        if (todos.length === 0) return { todos: [], message: "No todos set." };
        return {
          todos: todos.map((t) => ({ content: t.content, status: t.status })),
          pending: todos.filter((t) => t.status === "pending").length,
          inProgress: todos.filter((t) => t.status === "in_progress").length,
          done: todos.filter((t) => t.status === "done").length
        };
      }
    }
  ];
}
