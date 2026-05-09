// [Matt Pocock Soul] - Deep Module implementation for Google Workspace
console.error("[BOOT] mcp-gdrive.mjs: Starting GoogleWorkspaceManager (v1.4.0)");

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import axios from "axios";
import { Stream } from "stream";

// --- Internal Helper: Result Pattern ---
const success = (data) => ({ content: [{ type: "text", text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const failure = (err) => ({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });

// --- Core Class: GoogleWorkspaceManager (Deep Module) ---
class GoogleWorkspaceManager {
  constructor(credentials) {
    this.auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/documents"
      ]
    );
    this.drive = google.drive({ version: "v3", auth: this.auth });
    this.sheets = google.sheets({ version: "v4", auth: this.auth });
    this.docs = google.docs({ version: "v1", auth: this.auth });
  }

  /**
   * Deep implementation of file downloading to Drive.
   * Handles stream downloading, metadata detection, and atomic upload.
   */
  async downloadAndStore(url, name, folderId = null) {
    console.error(`[INFO] Downloading from ${url} to Drive as ${name}`);
    try {
      const response = await axios({ method: 'get', url, responseType: 'stream' });
      const contentType = response.headers['content-type'] || 'application/octet-stream';
      
      const fileMetadata = { name, parents: folderId ? [folderId] : [] };
      const media = { mimeType: contentType, body: response.data };

      const res = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, name, webViewLink"
      });
      return `Successfully downloaded ${res.data.name}. Link: ${res.data.webViewLink}`;
    } catch (err) {
      throw new Error(`Download failure: ${err.message}`);
    }
  }

  /**
   * Deep implementation of Google Doc creation and content injection.
   */
  async createAndWriteDoc(name, content, folderId = null) {
    try {
      // 1. Create file in Drive to get ID and set parent
      const fileMetadata = {
        name,
        mimeType: 'application/vnd.google-apps.document',
        parents: folderId ? [folderId] : []
      };
      const file = await this.drive.files.create({ requestBody: fileMetadata, fields: 'id' });
      const documentId = file.data.id;

      // 2. Insert content via Docs API
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [{ insertText: { location: { index: 1 }, text: content } }]
        }
      });
      return `Created Google Doc: ${name} (${documentId})`;
    } catch (err) {
      throw new Error(`Doc creation failure: ${err.message}`);
    }
  }

  // ... other methods (list, append sheets) refactored for clarity ...
}

// --- Bootstrap ---
async function startServer() {
  let rawCreds = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!rawCreds) {
    console.error("[FATAL] Credentials missing");
    process.exit(1);
  }

  // Soul Fix: Strip quotes if necessary
  rawCreds = rawCreds.trim();
  if (rawCreds.startsWith('"')) rawCreds = JSON.parse(rawCreds);
  const credentials = typeof rawCreds === 'string' ? JSON.parse(rawCreds) : rawCreds;

  const manager = new GoogleWorkspaceManager(credentials);
  const server = new Server(
    { name: "google-workspace-pro", version: "1.4.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_files",
        description: "List files and folders in Google Drive",
        inputSchema: {
          type: "object",
          properties: { folderId: { type: "string" }, pageSize: { type: "number", default: 10 } }
        }
      },
      {
        name: "write_spreadsheet_row",
        description: "Append rows to a Google Spreadsheet (Batch)",
        inputSchema: {
          type: "object",
          required: ["spreadsheetId", "values"],
          properties: {
            spreadsheetId: { type: "string" },
            values: { type: "array", items: { type: "array", items: { type: "string" } } },
            range: { type: "string", default: "Sheet1!A1" }
          }
        }
      },
      {
        name: "write_google_doc",
        description: "Create a new Google Doc with specified content",
        inputSchema: {
          type: "object",
          required: ["name", "content"],
          properties: {
            name: { type: "string" },
            content: { type: "string" },
            folderId: { type: "string" }
          }
        }
      },
      {
        name: "download_to_drive",
        description: "Download a file from a URL directly to Google Drive",
        inputSchema: {
          type: "object",
          required: ["url", "name"],
          properties: {
            url: { type: "string" },
            name: { type: "string", description: "Target filename in Drive" },
            folderId: { type: "string", description: "Target folder ID" }
          }
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case "list_files":
          const q = args.folderId ? `'${args.folderId}' in parents` : undefined;
          const res = await manager.drive.files.list({ q, fields: "files(id, name, mimeType)", pageSize: args.pageSize });
          return success(res.data.files);
        
        case "write_spreadsheet_row":
          await manager.sheets.spreadsheets.values.append({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: args.values }
          });
          return success(`Appended ${args.values.length} rows.`);

        case "write_google_doc":
          const docMsg = await manager.createAndWriteDoc(args.name, args.content, args.folderId);
          return success(docMsg);

        case "download_to_drive":
          const dlMsg = await manager.downloadAndStore(args.url, args.name, args.folderId);
          return success(dlMsg);

        default:
          throw new Error("Tool not found");
      }
    } catch (err) {
      return failure(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[SUCCESS] Google Workspace Pro MCP server running");
}

startServer().catch(err => {
  console.error("[FATAL] Server crashed:", err);
  process.exit(1);
});
