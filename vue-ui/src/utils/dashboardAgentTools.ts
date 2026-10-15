import type { ToolDefinition } from '../composables/useAgent';
import definitions from '../../../mcp_server/dashboardTools.json';
// Importing the bridge lazily keeps the dashboard renderer off the startup path.
export const dashboardAgentTools: ToolDefinition[] = definitions.map(definition => ({
  name: definition.name,
  description: definition.description,
  parameters: definition.inputSchema as unknown as ToolDefinition['parameters'],
  destructive: definition.name.endsWith('_run'),
  execute: async input => {
    const {dashboardCommand} = await import('../features/dashboards/api');
    return dashboardCommand(definition.name.replace('magic_netsuite_dashboard_', ''), input);
  }
}));
