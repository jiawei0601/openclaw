import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

const credentialsJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
if (!credentialsJson) {
  console.error("[CRITICAL] GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is missing");
  process.exit(1);
}

const credentials = JSON.parse(credentialsJson);
console.error(`[INFO] Starting MCP with Service Account: ${credentials.client_email}`);

const auth = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  ["https://www.googleapis.com/auth/drive"]
);

const drive = google.drive({ version: "v3", auth });

const server = new Server(
  { name: "gdrive-service-account", version: "1.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_files",
        description: "List files in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            pageSize: { type: "number", default: 10 },
            folderId: { type: "string", description: "Optional folder ID" }
          },
        },
      },
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: {
          type: "object",
          required: ["fileId"],
          properties: { fileId: { type: "string" } }
        }
      },
      {
        name: "write_file",
        description: "Create or update a file",
        inputSchema: {
          type: "object",
          required: ["name", "content"],
          properties: {
            name: { type: "string" },
            content: { type: "string" },
            fileId: { type: "string" },
            folderId: { type: "string" }
          }
        }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.error(`[TOOL_CALL] Executing ${name} with args: ${JSON.stringify(args)}`);
  
  try {
    if (name === "list_files") {
      const q = args?.folderId ? `'${args.folderId}' in parents` : undefined;
      const res = await drive.files.list({ pageSize: args?.pageSize || 10, fields: "files(id, name, mimeType)", q });
      return { content: [{ type: "text", text: JSON.stringify(res.data.files, null, 2) }] };
    }

    if (name === "read_file") {
      const res = await drive.files.get({ fileId: args.fileId, alt: "media" }, { responseType: "text" });
      return { content: [{ type: "text", text: res.data }] };
    }

    if (name === "write_file") {
      const mimeType = args.name.endsWith('.csv') ? 'text/csv' : 'text/plain';
      
      if (args.fileId) {
        console.error(`[INFO] Updating existing file ${args.fileId}`);
        const res = await drive.files.update({
          fileId: args.fileId,
          media: { mimeType, body: args.content }
        });
        return { content: [{ type: "text", text: `Updated ${res.data.name}` }] };
      } else {
        console.error(`[INFO] Creating new file ${args.name} in folder ${args.folderId || 'root'}`);
        const res = await drive.files.create({
          requestBody: { name: args.name, parents: args.folderId ? [args.folderId] : [] },
          media: { mimeType, body: args.content },
          fields: "id, name"
        });
        return { content: [{ type: "text", text: `Created ${res.data.name} (${res.data.id})` }] };
      }
    }
  } catch (err) {
    // CRITICAL: Log full error details to stderr for Railway logging
    console.error(`[ERROR] Google Drive API Failure:`, err.response?.data || err.message);
    return { content: [{ type: "text", text: `Drive API Error: ${err.message}. Details: ${JSON.stringify(err.response?.data || {})}` }], isError: true };
  }
  throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Google Drive Service Account MCP server (v1.2.0) running");
