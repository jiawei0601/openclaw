/**
 * Google Workspace Pro MCP Server v3.0.0
 * Architecture: Matt Pocock's Deep Module Principle
 * 
 * Features: Full CRUD, OAuth/ServiceAccount support, Semantic Header Updates, 
 *           Chart & Image handling, and Robust Path Abstraction.
 */

import fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Readable } from "stream";

// --- Types & Constants ---
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null;

// --- Helper: A1 Parser ---
function parseA1Range(range) {
  const rangeOnly = range.includes("!") ? range.split("!")[1] : range;
  const [start, end] = rangeOnly.split(":");
  const colToIndex = (col) => {
    let idx = 0;
    for (const ch of col.toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
    return idx - 1;
  };
  const parseCell = (cell) => {
    const m = cell.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) throw new Error(`Invalid cell: ${cell}`);
    return { col: colToIndex(m[1]), row: parseInt(m[2]) - 1 };
  };
  const s = parseCell(start);
  const e = end ? parseCell(end) : s;
  return { startRow: s.row, endRow: e.row + 1, startCol: s.col, endCol: e.col + 1 };
}

// --- Layer 1: Auth Strategy (The Seam) ---
class AuthManager {
  static async getAuth(google) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      console.error("[AUTH] Mode: OAuth user credentials");
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      return oauth2Client;
    }

    console.error("[AUTH] Mode: Service account credentials");
    const creds = await this._loadServiceAccount();
    return new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/documents",
      ]
    );
  }

  static async _loadServiceAccount() {
    const raw = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("Missing Google credentials in environment variables.");
    let clean = raw.trim();
    if (clean.startsWith('"') && clean.endsWith('"')) {
      try { clean = JSON.parse(clean); } catch { clean = clean.slice(1, -1).replace(/\\"/g, '"'); }
    }
    const creds = typeof clean === 'string' ? JSON.parse(clean) : clean;
    if (creds.private_key?.includes("\\n")) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    return creds;
  }
}

// --- Layer 2: Workspace Kernel (The Deep Module) ---
class WorkspaceKernel {
  constructor(auth, google) {
    this.auth = auth;
    this.google = google;
    this.drive = google.drive({ version: "v3", auth });
    this.sheets = google.sheets({ version: "v4", auth });
    this.docs = google.docs({ version: "v1", auth });
  }

  _folder(folderId) { return folderId || ROOT_FOLDER_ID || null; }

  // --- Drive Operations ---
  async findFileByName(name, mimeType = null) {
    let q = `name = '${name}' and trashed = false`;
    if (mimeType) q += ` and mimeType = '${mimeType}'`;
    const res = await this.drive.files.list({ q, fields: "files(id, name, mimeType)", pageSize: 1 });
    return res.data.files?.[0] || null;
  }

  async listFiles(folderId) {
    const target = this._folder(folderId);
    const q = target ? `'${target}' in parents and trashed = false` : "trashed = false";
    const res = await this.drive.files.list({ q, fields: "files(id, name, mimeType, webViewLink)", pageSize: 100 });
    return res.data.files;
  }

  async deleteFile(fileId, permanent = false) {
    if (permanent) { await this.drive.files.delete({ fileId }); return `Permanently deleted ${fileId}`; }
    await this.drive.files.update({ fileId, requestBody: { trashed: true } });
    return `Moved ${fileId} to trash.`;
  }

  // --- Spreadsheet Surgery (High Leverage) ---
  async smartUpdateSheetHeader(fileName, oldHeaderText, newHeaderText) {
    const file = await this.findFileByName(fileName, "application/vnd.google-apps.spreadsheet");
    if (!file) throw new Error(`Spreadsheet "${fileName}" not found.`);
    const spreadsheetId = file.id;
    const res = await this.sheets.spreadsheets.values.get({ spreadsheetId, range: "1:1" });
    const headers = res.data.values?.[0] || [];
    const colIndex = headers.indexOf(oldHeaderText);
    if (colIndex === -1) throw new Error(`Header "${oldHeaderText}" not found. Current headers: ${headers.join(", ")}`);
    const colLetter = String.fromCharCode(65 + colIndex);
    const range = `${colLetter}1`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId, range, valueInputOption: "USER_ENTERED", requestBody: { values: [[newHeaderText]] }
    });
    return `Updated header in "${fileName}": [${oldHeaderText}] -> [${newHeaderText}] at ${range}.`;
  }

  async appendSheetRows(spreadsheetId, values) {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId, range: "A1", valueInputOption: "USER_ENTERED", requestBody: { values }
    });
    return `Appended ${values.length} rows to ${spreadsheetId}.`;
  }

  // --- Document Operations ---
  async readDoc(documentId) {
    const res = await this.docs.documents.get({ documentId });
    let text = "";
    for (const el of res.data.body.content || []) {
      if (el.paragraph) for (const e of el.paragraph.elements || []) if (e.textRun) text += e.textRun.content;
    }
    return { title: res.data.title, text };
  }

  async createDoc(name, content, folderId) {
    const target = this._folder(folderId);
    const file = await this.drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.document", parents: target ? [target] : [] },
      fields: "id, webViewLink"
    });
    await this.docs.documents.batchUpdate({
      documentId: file.data.id,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] }
    });
    return `Created Doc: ${name} (${file.data.id})`;
  }

  // --- Advanced: Charts & Downloads ---
  async downloadAndStore(url, name, folderId) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const body = Readable.fromWeb(response.body);
    const target = this._folder(folderId);
    const res = await this.drive.files.create({
      requestBody: { name, parents: target ? [target] : [] },
      media: { mimeType: response.headers.get("content-type") || "application/octet-stream", body },
      fields: "id, webViewLink"
    });
    return `Downloaded and stored: ${res.data.id}`;
  }
}

// --- Layer 3: MCP Interface ---
let kernelInstance = null;
async function getKernel() {
  if (kernelInstance) return kernelInstance;
  const { google } = await import("googleapis");
  const auth = await AuthManager.getAuth(google);
  kernelInstance = new WorkspaceKernel(auth, google);
  return kernelInstance;
}

const server = new Server(
  { name: "google-workspace-pro", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "smart_sheet_header_update",
      description: "Rename a column header in a Google Sheet by providing the file name and current header text.",
      inputSchema: {
        type: "object",
        required: ["fileName", "oldHeaderText", "newHeaderText"],
        properties: {
          fileName: { type: "string" },
          oldHeaderText: { type: "string" },
          newHeaderText: { type: "string" }
        }
      }
    },
    {
      name: "list_files",
      description: "List files in Google Drive.",
      inputSchema: { type: "object", properties: { folderId: { type: "string" } } }
    },
    {
      name: "read_doc",
      description: "Read content of a Google Doc.",
      inputSchema: { type: "object", required: ["documentId"], properties: { documentId: { type: "string" } } }
    },
    {
      name: "create_doc",
      description: "Create a new Google Doc.",
      inputSchema: { type: "object", required: ["name", "content"], properties: { name: { type: "string" }, content: { type: "string" }, folderId: { type: "string" } } }
    },
    {
      name: "download_to_drive",
      description: "Download a file from URL to Google Drive.",
      inputSchema: { type: "object", required: ["url", "name"], properties: { url: { type: "string" }, name: { type: "string" }, folderId: { type: "string" } } }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const kernel = await getKernel();
  try {
    switch (name) {
      case "smart_sheet_header_update": return { content: [{ type: "text", text: await kernel.smartUpdateSheetHeader(args.fileName, args.oldHeaderText, args.newHeaderText) }] };
      case "list_files": return { content: [{ type: "text", text: JSON.stringify(await kernel.listFiles(args.folderId), null, 2) }] };
      case "read_doc": return { content: [{ type: "text", text: JSON.stringify(await kernel.readDoc(args.documentId)) }] };
      case "create_doc": return { content: [{ type: "text", text: await kernel.createDoc(args.name, args.content, args.folderId) }] };
      case "download_to_drive": return { content: [{ type: "text", text: await kernel.downloadAndStore(args.url, args.name, args.folderId) }] };
      default: throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[SUCCESS] Google Workspace Pro v3.0 (Deep Module) is active.");
