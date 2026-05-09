// [Matt Pocock Soul] - Deep Module v1.4.2 (Robust Parsing Edition)
console.error("[BOOT] mcp-gdrive.mjs: Starting Google Workspace Pro (v1.4.2)");

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { Readable } from "stream";

// --- Internal Helper: Result Pattern ---
const success = (data) => ({ content: [{ type: "text", text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const failure = (err) => {
  console.error("[ERROR] Task failed:", err.message);
  return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
};

// --- Core Class: GoogleWorkspaceManager ---
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

  async downloadAndStore(url, name, folderId = null) {
    console.error(`[INFO] Fetching from ${url}`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const body = Readable.fromWeb(response.body);
      const res = await this.drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : [] },
        media: { mimeType: contentType, body },
        fields: "id, name, webViewLink"
      });
      return `Success: ${res.data.name}. Link: ${res.data.webViewLink}`;
    } catch (err) { throw new Error(`Download failed: ${err.message}`); }
  }

  async createAndWriteDoc(name, content, folderId = null) {
    try {
      const file = await this.drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.document', parents: folderId ? [folderId] : [] },
        fields: 'id'
      });
      await this.docs.documents.batchUpdate({
        documentId: file.data.id,
        requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] }
      });
      return `Created Doc: ${name} (${file.data.id})`;
    } catch (err) { throw new Error(`Doc error: ${err.message}`); }
  }
}

// --- Bootstrap ---
async function startServer() {
  try {
    let rawCreds = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    if (!rawCreds) throw new Error("Credentials missing");

    let credentials;
    if (typeof rawCreds === 'object') {
      credentials = rawCreds; // Already an object
    } else {
      let cleanJson = rawCreds.trim();
      if (cleanJson.startsWith('"')) {
        try {
          cleanJson = JSON.parse(cleanJson);
        } catch (e) {
          cleanJson = cleanJson.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n');
        }
      }
      credentials = typeof cleanJson === 'string' ? JSON.parse(cleanJson) : cleanJson;
    }

    const manager = new GoogleWorkspaceManager(credentials);
    const server = new Server(
      { name: "google-workspace-pro", version: "1.4.2" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: "list_files", description: "List files", inputSchema: { type: "object", properties: { folderId: { type: "string" } } } },
        { name: "write_spreadsheet_row", description: "Append rows to Sheet", inputSchema: { type: "object", required: ["spreadsheetId", "values"], properties: { spreadsheetId: { type: "string" }, values: { type: "array", items: { type: "array" } } } } },
        { name: "write_google_doc", description: "Create Doc", inputSchema: { type: "object", required: ["name", "content"], properties: { name: { type: "string" }, content: { type: "string" }, folderId: { type: "string" } } } },
        { name: "download_to_drive", description: "URL to Drive", inputSchema: { type: "object", required: ["url", "name"], properties: { url: { type: "string" }, name: { type: "string" }, folderId: { type: "string" } } } }
      ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.error(`[EXEC] ${name}`);
      try {
        if (name === "list_files") {
          const res = await manager.drive.files.list({ q: args.folderId ? `'${args.folderId}' in parents` : undefined, fields: "files(id, name, mimeType)" });
          return success(res.data.files);
        }
        if (name === "write_spreadsheet_row") {
          await manager.sheets.spreadsheets.values.append({ spreadsheetId: args.spreadsheetId, range: "Sheet1!A1", valueInputOption: "USER_ENTERED", requestBody: { values: args.values } });
          return success(`Appended ${args.values.length} rows.`);
        }
        if (name === "write_google_doc") return success(await manager.createAndWriteDoc(args.name, args.content, args.folderId));
        if (name === "download_to_drive") return success(await manager.downloadAndStore(args.url, args.name, args.folderId));
        throw new Error("Tool not found");
      } catch (err) { return failure(err); }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[SUCCESS] Google Workspace Pro (v1.4.2) is active.");

  } catch (err) {
    console.error("[FATAL] Startup Failure:", err.stack || err.message);
    process.exit(1);
  }
}

startServer();
