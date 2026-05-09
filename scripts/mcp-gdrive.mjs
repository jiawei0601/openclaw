// Google Workspace MCP Server v2.0.0 - Full CRUD
console.error("[BOOT] mcp-gdrive.mjs: Initializing...");

import fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Readable } from "stream";

let managerInstance = null;
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null;

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
        "https://www.googleapis.com/auth/documents",
      ]
    );
    this.drive = this.google.drive({ version: "v3", auth: this.auth });
    this.sheets = this.google.sheets({ version: "v4", auth: this.auth });
    this.docs = this.google.docs({ version: "v1", auth: this.auth });
  }

  // Returns folderId if given, otherwise falls back to ROOT_FOLDER_ID
  _folder(folderId) {
    return folderId || ROOT_FOLDER_ID || null;
  }

  async listFiles(folderId) {
    const target = this._folder(folderId);
    const q = target
      ? `'${target}' in parents and trashed = false`
      : "trashed = false";
    const res = await this.drive.files.list({
      q,
      fields: "files(id, name, mimeType, parents, webViewLink)",
      pageSize: 100,
    });
    return res.data.files;
  }

  async moveFile(fileId, targetFolderId) {
    const target = this._folder(targetFolderId);
    if (!target)
      throw new Error(
        "targetFolderId is required when GOOGLE_DRIVE_ROOT_FOLDER_ID is not set"
      );
    const file = await this.drive.files.get({ fileId, fields: "parents" });
    const previousParents = (file.data.parents || []).join(",");
    await this.drive.files.update({
      fileId,
      addParents: target,
      removeParents: previousParents,
      fields: "id, name",
    });
    return `Moved file ${fileId} to folder ${target}`;
  }

  async readGoogleDoc(documentId) {
    const res = await this.docs.documents.get({ documentId });
    const doc = res.data;
    let text = "";
    for (const element of doc.body.content || []) {
      if (element.paragraph) {
        for (const elem of element.paragraph.elements || []) {
          if (elem.textRun) text += elem.textRun.content;
        }
      }
    }
    return { title: doc.title, text };
  }

  async editGoogleDoc(documentId, content, mode = "replace") {
    const res = await this.docs.documents.get({ documentId });
    const lastContent = res.data.body.content.at(-1);
    const endIndex = (lastContent?.endIndex ?? 2) - 1;

    if (mode === "replace") {
      const requests = [];
      if (endIndex > 1) {
        requests.push({
          deleteContentRange: { range: { startIndex: 1, endIndex } },
        });
      }
      requests.push({ insertText: { location: { index: 1 }, text: content } });
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });
    } else {
      // append
      await this.docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            { insertText: { location: { index: endIndex }, text: "\n" + content } },
          ],
        },
      });
    }
    return `Updated Doc ${documentId} (mode: ${mode})`;
  }

  async createDoc(name, content, folderId) {
    const target = this._folder(folderId);
    const file = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.document",
        parents: target ? [target] : [],
      },
      fields: "id, webViewLink",
    });
    await this.docs.documents.batchUpdate({
      documentId: file.data.id,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      },
    });
    return `Created Doc: ${name} (${file.data.id}). Link: ${file.data.webViewLink}`;
  }

  async createSpreadsheet(name, folderId) {
    const target = this._folder(folderId);
    const file = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: target ? [target] : [],
      },
      fields: "id, webViewLink",
    });
    return `Created Spreadsheet: ${name} (${file.data.id}). Link: ${file.data.webViewLink}`;
  }

  async appendSheetRows(spreadsheetId, values) {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return `Appended ${values.length} row(s) to spreadsheet ${spreadsheetId}.`;
  }

  async updateSheetCells(spreadsheetId, range, values) {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return `Updated range ${range} in spreadsheet ${spreadsheetId}.`;
  }

  async downloadAndStore(url, name, folderId) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Readable.fromWeb(response.body);
    const target = this._folder(folderId);
    const res = await this.drive.files.create({
      requestBody: {
        name,
        parents: target ? [target] : [],
      },
      media: {
        mimeType: response.headers.get("content-type") || "application/octet-stream",
        body,
      },
      fields: "id, name, webViewLink",
    });
    return `Uploaded: ${res.data.name}. Link: ${res.data.webViewLink}`;
  }
}

async function loadCredentials() {
  // Prefer reading from a file to avoid JSON double-encoding issues
  const keyPath = process.env.GOOGLE_DRIVE_KEY_PATH;
  if (keyPath) {
    if (!fs.existsSync(keyPath))
      throw new Error(`Credentials file not found: ${keyPath}`);
    const raw = fs.readFileSync(keyPath, "utf8");
    const creds = JSON.parse(raw);
    console.error(`[INFO] Loaded credentials: client_email=${creds.client_email || "(missing)"}, private_key length=${creds.private_key ? creds.private_key.length : 0}`);
    if (!creds.private_key) throw new Error(`Credentials file is missing private_key. client_email=${creds.client_email || "(missing)"}`);
    if (!creds.client_email) throw new Error(`Credentials file is missing client_email`);
    // Ensure private_key has real newlines (not literal \n sequences)
    if (creds.private_key.includes("\\n")) {
      creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    }
    return creds;
  }

  // Fallback: parse from env var
  const rawCreds =
    process.env.GOOGLE_DRIVE_CREDENTIALS_JSON ||
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!rawCreds)
    throw new Error(
      "Missing GOOGLE_DRIVE_KEY_PATH, GOOGLE_DRIVE_CREDENTIALS_JSON, or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"
    );

  let clean = rawCreds.trim();
  // Strip surrounding quotes added by some platforms
  if (clean.startsWith('"') && clean.endsWith('"')) {
    try {
      const inner = JSON.parse(clean);
      clean = typeof inner === "string" ? inner : JSON.stringify(inner);
    } catch {
      clean = clean.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
  }
  const creds = JSON.parse(clean);
  if (!creds.private_key) throw new Error(`Parsed credentials missing private_key`);
  return creds;
}

async function getManager() {
  if (managerInstance) return managerInstance;

  console.error("[INFO] Lazy loading 'googleapis'...");
  const { google } = await import("googleapis");

  const credentials = await loadCredentials();
  managerInstance = new GoogleWorkspaceManager(credentials, google);
  console.error(
    `[SUCCESS] Manager initialized. Root folder: ${ROOT_FOLDER_ID || "(unrestricted)"}`
  );
  return managerInstance;
}

// --- MCP Server ---
const server = new Server(
  { name: "google-workspace-pro", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_files",
      description:
        "List files in a Google Drive folder. Defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID if set.",
      inputSchema: {
        type: "object",
        properties: {
          folderId: { type: "string", description: "Folder ID to list (optional)" },
        },
      },
    },
    {
      name: "move_file",
      description: "Move a file to a different Google Drive folder.",
      inputSchema: {
        type: "object",
        required: ["fileId"],
        properties: {
          fileId: { type: "string" },
          targetFolderId: {
            type: "string",
            description: "Destination folder ID. Defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID.",
          },
        },
      },
    },
    {
      name: "create_google_doc",
      description: "Create a new Google Doc with content.",
      inputSchema: {
        type: "object",
        required: ["name", "content"],
        properties: {
          name: { type: "string" },
          content: { type: "string" },
          folderId: {
            type: "string",
            description: "Folder ID (optional). Defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID.",
          },
        },
      },
    },
    {
      name: "read_google_doc",
      description: "Read the text content of an existing Google Doc.",
      inputSchema: {
        type: "object",
        required: ["documentId"],
        properties: {
          documentId: { type: "string" },
        },
      },
    },
    {
      name: "edit_google_doc",
      description: "Edit an existing Google Doc by replacing or appending content.",
      inputSchema: {
        type: "object",
        required: ["documentId", "content"],
        properties: {
          documentId: { type: "string" },
          content: { type: "string" },
          mode: {
            type: "string",
            enum: ["replace", "append"],
            description: "Default: replace",
          },
        },
      },
    },
    {
      name: "create_spreadsheet",
      description: "Create a new Google Sheet.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          folderId: {
            type: "string",
            description: "Folder ID (optional). Defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID.",
          },
        },
      },
    },
    {
      name: "append_sheet_rows",
      description: "Append rows to the end of a Google Sheet.",
      inputSchema: {
        type: "object",
        required: ["spreadsheetId", "values"],
        properties: {
          spreadsheetId: { type: "string" },
          values: {
            type: "array",
            items: { type: "array" },
            description: "2D array of values, e.g. [[\"A\",\"B\"],[\"C\",\"D\"]]",
          },
        },
      },
    },
    {
      name: "update_sheet_cells",
      description: "Update specific cells in a Google Sheet using A1 notation.",
      inputSchema: {
        type: "object",
        required: ["spreadsheetId", "range", "values"],
        properties: {
          spreadsheetId: { type: "string" },
          range: {
            type: "string",
            description: "A1 notation, e.g. \"Sheet1!A2:C4\"",
          },
          values: {
            type: "array",
            items: { type: "array" },
            description: "2D array of values",
          },
        },
      },
    },
    {
      name: "download_to_drive",
      description: "Download a file from a URL and upload it to Google Drive.",
      inputSchema: {
        type: "object",
        required: ["url", "name"],
        properties: {
          url: { type: "string" },
          name: { type: "string" },
          folderId: {
            type: "string",
            description: "Folder ID (optional). Defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID.",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.error(`[EXEC] ${name}`);
  try {
    const manager = await getManager();

    switch (name) {
      case "list_files": {
        const files = await manager.listFiles(args.folderId);
        return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
      }
      case "move_file": {
        const msg = await manager.moveFile(args.fileId, args.targetFolderId);
        return { content: [{ type: "text", text: msg }] };
      }
      case "create_google_doc": {
        const msg = await manager.createDoc(args.name, args.content, args.folderId);
        return { content: [{ type: "text", text: msg }] };
      }
      case "read_google_doc": {
        const result = await manager.readGoogleDoc(args.documentId);
        return {
          content: [{ type: "text", text: `Title: ${result.title}\n\n${result.text}` }],
        };
      }
      case "edit_google_doc": {
        const msg = await manager.editGoogleDoc(
          args.documentId,
          args.content,
          args.mode || "replace"
        );
        return { content: [{ type: "text", text: msg }] };
      }
      case "create_spreadsheet": {
        const msg = await manager.createSpreadsheet(args.name, args.folderId);
        return { content: [{ type: "text", text: msg }] };
      }
      case "append_sheet_rows": {
        const msg = await manager.appendSheetRows(args.spreadsheetId, args.values);
        return { content: [{ type: "text", text: msg }] };
      }
      case "update_sheet_cells": {
        const msg = await manager.updateSheetCells(
          args.spreadsheetId,
          args.range,
          args.values
        );
        return { content: [{ type: "text", text: msg }] };
      }
      case "download_to_drive": {
        const msg = await manager.downloadAndStore(args.url, args.name, args.folderId);
        return { content: [{ type: "text", text: msg }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    console.error(`[ERROR] ${name} failed:`, err.message);
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[SUCCESS] MCP Server listening.");
