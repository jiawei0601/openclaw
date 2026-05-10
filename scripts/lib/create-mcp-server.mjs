import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// tools: Array<{ definition: { name, description, inputSchema }, handler: (args) => string | object }>
// handler should return a value or throw an Error — boilerplate handles isError framing.
export async function createMcpServer(name, version, tools) {
    const server = new Server(
        { name, version },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map(t => t.definition),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name: toolName, arguments: args } = request.params;
        const tool = tools.find(t => t.definition.name === toolName);
        if (!tool) {
            return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
        }
        try {
            const result = await tool.handler(args);
            const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return { content: [{ type: 'text', text }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}
