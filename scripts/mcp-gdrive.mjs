// [Matt Pocock Soul] - Deep Module v1.5.0 (Lazy-Loading Performance Edition)
console.error("[BOOT] mcp-gdrive.mjs: Initializing Ultra-Fast Startup...");

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Readable } from "stream";

// --- State Holder ---
let managerInstance = null;

// --- Core Logic: Lazy Loading Manager ---
class GoogleWorkspaceManager {
  constructor(credentials, googleLib) {
    this.google = googleLib;
    this.auth = new this.google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/documents"
      ]
    );
    this.drive = this.google.drive({ version: "v3", auth: this.auth });
    this.sheets = this.google.sheets({ version: "v4", auth: this.auth });
    this.docs = this.google.docs({ version: "v1", auth: this.auth });
  }

  async downloadAndStore(url, name, folderId = null) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Readable.fromWeb(response.body);
    const res = await this.drive.files.create({
      requestBody: { name, parents: folderId ? [folderId] : [] },
      media: { mimeType: response.headers.get('content-type') || 'application/octet-stream', body },
      fields: "id, name, webViewLink"
    });
    return `Success: ${res.data.name}. Link: ${res.data.webViewLink}`;
  }

  async createAndWriteDoc(name, content, folderId = null) {
    const file = await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.document', parents: folderId ? [folderId] : [] },
      fields: 'id'
    });
    await this.docs.documents.batchUpdate({
      documentId: file.data.id,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] }
    });
    return `Created Doc: ${name} (${file.data.id})`;
  }
}

// --- Singleton Loader ---
async function getManager() {
  if (managerInstance) return managerInstance;

  console.error("[INFO] Lazy loading 'googleapis' package...");
  const { google } = await import("googleapis");
  
  let rawCreds = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!rawCreds) throw new Error("Credentials missing");

  let credentials;
  if (typeof rawCreds === 'object') {
    credentials = rawCreds;
  } else {
    let cleanJson = rawCreds.trim();
    if (cleanJson.startsWith('"')) {
      try { cleanJson = JSON.parse(cleanJson); } catch (e) {
        cleanJson = cleanJson.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n');
      }
    }
    credentials = typeof cleanJson === 'string' ? JSON.parse(cleanJson) : cleanJson;
  }

  managerInstance = new GoogleWorkspaceManager(credentials, google);
  console.error("[SUCCESS] Google Workspace Manager initialized.");
  return managerInstance;
}

// --- MCP Server Setup (Starts Instantly) ---
const server = new Server(
  { name: "google-workspace-pro", version: "1.5.0" },
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
    const manager = await getManager(); // Load googleapis only when a tool is called

    if (name === "list_files") {
      const res = await manager.drive.files.list({ q: args.folderId ? `'${args.folderId}' in parents` : undefined, fields: "files(id, name, mimeType)" });
      return { content: [{ type: "text", text: JSON.stringify(res.data.files, null, 2) }] };
    }
    if (name === "write_spreadsheet_row") {
      await manager.sheets.spreadsheets.values.append({ spreadsheetId: args.spreadsheetId, range: "Sheet1!A1", valueInputOption: "USER_ENTERED", requestBody: { values: args.values } });
      return { content: [{ type: "text", text: `Appended ${args.values.length} rows.` }] };
    }
    if (name === "write_google_doc") {
      const msg = await manager.createAndWriteDoc(args.name, args.content, args.folderId);
      return { content: [{ type: "text", text: msg }] };
    }
    if (name === "download_to_drive") {
      const msg = await manager.downloadAndStore(args.url, args.name, args.folderId);
      return { content: [{ type: "text", text: msg }] };
    }
    throw new Error("Tool not found");
  } catch (err) {
    console.error("[ERROR] Task failed:", err.message);
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[SUCCESS] Fast-boot MCP Server is listening.");
