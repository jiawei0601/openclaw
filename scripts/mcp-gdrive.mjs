// [Matt Pocock Soul] - Deep Module v1.4.1 (Zero-Dependency Scraper Edition)
console.error("[BOOT] mcp-gdrive.mjs: Initializing Google Workspace Pro...");

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

  /**
   * Native implementation using built-in fetch (Node 18+)
   */
  async downloadAndStore(url, name, folderId = null) {
    console.error(`[INFO] Fetching content from: ${url}`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const body = Readable.fromWeb(response.body); // Convert Web Stream to Node Stream

      const res = await this.drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : [] },
        media: { mimeType: contentType, body },
        fields: "id, name, webViewLink"
      });
      return `Success: ${res.data.name} saved. Link: ${res.data.webViewLink}`;
    } catch (err) {
      throw new Error(`Download failed: ${err.message}`);
    }
  }

  async createAndWriteDoc(name, content, folderId = null) {
    try {
      const file = await this.drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.document', parents: folderId ? [folderId] : [] },
        fields: 'id'
      });
      const documentId = file.data.id;
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] }
      });
      return `Created Doc: ${name} (${documentId})`;
    } catch (err) {
      throw new Error(`Doc error: ${err.message}`);
    }
  }
}

// --- Bootstrap ---
async function startServer() {
  try {
    let rawCreds = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    if (!rawCreds) throw new Error("Credentials missing in env");

    // Robust stripping of potential outer quotes/escapes from Railway Raw Editor
    let cleanJson = rawCreds.trim();
    if (cleanJson.startsWith('"')) {
      console.error("[INFO] Stripping surrounding quotes from variable...");
      try {
        cleanJson = JSON.parse(cleanJson); // First pass to unescape
      } catch (e) {
        // If fails, manually strip and replace basic escapes
        cleanJson = cleanJson.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n');
      }
    }
    
    const credentials = typeof cleanJson === 'string' ? JSON.parse(cleanJson) : cleanJson;
    const manager = new GoogleWorkspaceManager(credentials);
    
    const server = new Server(
      { name: "google-workspace-pro", version: "1.4.1" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: "list_files", description: "List files/folders", inputSchema: { type: "object", properties: { folderId: { type: "string" } } } },
        { 
          name: "write_spreadsheet_row", 
          description: "Append rows to Sheet", 
          inputSchema: { type: "object", required: ["spreadsheetId", "values"], properties: { spreadsheetId: { type: "string" }, values: { type: "array", items: { type: "array" } } } } 
        },
        { 
          name: "write_google_doc", 
          description: "Create Google Doc", 
          inputSchema: { type: "object", required: ["name", "content"], properties: { name: { type: "string" }, content: { type: "string" }, folderId: { type: "string" } } } 
        },
        { 
          name: "download_to_drive", 
          description: "Download URL to Drive", 
          inputSchema: { type: "object", required: ["url", "name"], properties: { url: { type: "string" }, name: { type: "string" }, folderId: { type: "string" } } } 
        }
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
    console.error("[SUCCESS] Google Workspace Pro (Zero-Dep) is live.");

  } catch (err) {
    console.error("[FATAL] Startup Failure:", err.stack || err.message);
    process.exit(1);
  }
}

startServer();
