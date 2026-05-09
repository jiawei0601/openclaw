// Pre-start logging to verify process execution
console.error("[BOOT] mcp-gdrive.mjs: Process started at " + new Date().toISOString());

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

// Catch all top-level errors to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error("[FATAL] Uncaught Exception:", err.message);
  console.error(err.stack);
  process.exit(1);
});

async function run() {
  try {
    let credentialsJson = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    
    if (!credentialsJson) {
      throw new Error("GOOGLE_DRIVE_CREDENTIALS_JSON is missing from environment");
    }

    // Robust JSON parsing: Railway Raw Editor sometimes adds surrounding quotes
    credentialsJson = credentialsJson.trim();
    if (credentialsJson.startsWith('"') && credentialsJson.endsWith('"')) {
      console.error("[INFO] Detecting double-quoted environment variable, stripping quotes...");
      credentialsJson = credentialsJson.substring(1, credentialsJson.length - 1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }

    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch (parseErr) {
      console.error("[CRITICAL] JSON Parse Failure. Content starts with:", credentialsJson.substring(0, 50));
      throw new Error(`Invalid JSON format in credentials: ${parseErr.message}`);
    }

    console.error(`[INFO] Authenticating with: ${credentials.client_email}`);

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
      { name: "gdrive-service-account", version: "1.3.1" },
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
      console.error(`[TOOL_CALL] Executing ${name}`);
      
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
        console.error(`[ERROR] Tool Execution Failure:`, err.response?.data || err.message);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
      throw new Error(`Tool not found: ${name}`);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[SUCCESS] Google Drive/Sheets MCP server running");

  } catch (err) {
    console.error("[FATAL] Startup Error:", err.message);
    process.exit(1);
  }
}

run();
