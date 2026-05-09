import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

const credentialsJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
if (!credentialsJson) {
  console.error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON environment variable is required");
  process.exit(1);
}

const credentials = JSON.parse(credentialsJson);
const auth = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  ["https://www.googleapis.com/auth/drive"]
);

const drive = google.drive({ version: "v3", auth });

const server = new Server(
  { name: "gdrive-service-account", version: "1.1.0" },
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
            folderId: { type: "string", description: "Optional folder ID to list" }
          },
        },
      },
      {
        name: "read_file",
        description: "Read content of a file from Google Drive",
        inputSchema: {
          type: "object",
          required: ["fileId"],
          properties: {
            fileId: { type: "string", description: "The ID of the file to read" }
          }
        }
      },
      {
        name: "write_file",
        description: "Create or update a file in Google Drive",
        inputSchema: {
          type: "object",
          required: ["name", "content"],
          properties: {
            name: { type: "string", description: "Filename" },
            content: { type: "string", description: "Text content" },
            fileId: { type: "string", description: "Optional file ID to update instead of creating" },
            folderId: { type: "string", description: "Optional folder ID to place the file in" }
          }
        }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "list_files") {
      const q = args?.folderId ? `'${args.folderId}' in parents` : undefined;
      const res = await drive.files.list({
        pageSize: args?.pageSize || 10,
        fields: "files(id, name, mimeType)",
        q
      });
      return { content: [{ type: "text", text: JSON.stringify(res.data.files, null, 2) }] };
    }

    if (name === "read_file") {
      const res = await drive.files.get({ fileId: args.fileId, alt: "media" }, { responseType: "text" });
      return { content: [{ type: "text", text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) }] };
    }

    if (name === "write_file") {
      if (args.fileId) {
        // Update
        const res = await drive.files.update({
          fileId: args.fileId,
          media: { mimeType: "text/plain", body: args.content }
        });
        return { content: [{ type: "text", text: `Updated file ${res.data.name} (${res.data.id})` }] };
      } else {
        // Create
        const res = await drive.files.create({
          requestBody: { name: args.name, parents: args.folderId ? [args.folderId] : [] },
          media: { mimeType: "text/plain", body: args.content }
        });
        return { content: [{ type: "text", text: `Created file ${res.data.name} (${res.data.id})` }] };
      }
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
  
  throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Google Drive Service Account MCP server (v1.1.0) running");
