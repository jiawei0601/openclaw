console.error("[BOOT] mcp-gdrive.mjs process started");
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
  [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets"
  ]
);

const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

const server = new Server(
  { name: "gdrive-service-account", version: "1.3.0" },
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
        name: "create_spreadsheet",
        description: "Create a new Google Spreadsheet",
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", description: "Name of the spreadsheet" },
            folderId: { type: "string", description: "Optional folder ID" }
          }
        }
      },
      {
        name: "append_spreadsheet_values",
        description: "Append rows to a Google Spreadsheet",
        inputSchema: {
          type: "object",
          required: ["spreadsheetId", "values"],
          properties: {
            spreadsheetId: { type: "string" },
            range: { type: "string", description: "e.g. Sheet1!A1", default: "Sheet1!A1" },
            values: { 
              type: "array", 
              items: { type: "array", items: { type: "string" } },
              description: "Array of rows (each row is an array of strings)"
            }
          }
        }
      },
      {
        name: "write_file",
        description: "Create or update a generic file (non-spreadsheet)",
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

    if (name === "create_spreadsheet") {
      const res = await drive.files.create({
        requestBody: { 
          name: args.name, 
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: args.folderId ? [args.folderId] : [] 
        },
        fields: "id, name"
      });
      return { content: [{ type: "text", text: `Created Spreadsheet: ${res.data.name} (${res.data.id})` }] };
    }

    if (name === "append_spreadsheet_values") {
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: args.spreadsheetId,
        range: args.range || "Sheet1!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: args.values }
      });
      return { content: [{ type: "text", text: `Appended ${res.data.updates.updatedRows} rows to spreadsheet.` }] };
    }

    if (name === "write_file") {
      const mimeType = args.name.endsWith('.csv') ? 'text/csv' : 'text/plain';
      if (args.fileId) {
        await drive.files.update({ fileId: args.fileId, media: { mimeType, body: args.content } });
        return { content: [{ type: "text", text: `Updated file ${args.fileId}` }] };
      } else {
        const res = await drive.files.create({
          requestBody: { name: args.name, parents: args.folderId ? [args.folderId] : [] },
          media: { mimeType, body: args.content },
          fields: "id, name"
        });
        return { content: [{ type: "text", text: `Created file ${res.data.name} (${res.data.id})` }] };
      }
    }
  } catch (err) {
    console.error(`[ERROR] Google API Failure:`, err.response?.data || err.message);
    return { content: [{ type: "text", text: `Error: ${err.message}. Details: ${JSON.stringify(err.response?.data || {})}` }], isError: true };
  }
  throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Google Drive/Sheets Service Account MCP server (v1.3.0) running");
