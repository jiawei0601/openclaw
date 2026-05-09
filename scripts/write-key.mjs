import fs from 'fs';

const CONFIG_PATH = '/app/openclaw.json';
const KEY_PATH = '/tmp/google-drive-key.json';

function parseCredentials(raw) {
    let clean = raw.trim();

    // Try direct parse first (ideal case)
    try { return JSON.parse(clean); } catch {}

    // Wrapped in outer quotes: "{ \"type\": ... }" or "{\"type\":...}"
    if (clean.startsWith('"')) {
        try {
            const inner = JSON.parse(clean);
            if (typeof inner === 'string') return JSON.parse(inner);
        } catch {}
        // Manual strip outer quotes and unescape
        clean = clean.slice(1, clean.endsWith('"') ? -1 : undefined)
                     .replace(/\\"/g, '"')
                     .replace(/\\n/g, '\n');
        try { return JSON.parse(clean); } catch {}
    }

    // Starts with { but has backslash-escaped quotes: {\"type\":...}
    if (clean.startsWith('{')) {
        try { return JSON.parse(clean.replace(/\\"/g, '"')); } catch {}
    }

    throw new Error(`Cannot parse GOOGLE_DRIVE_CREDENTIALS_JSON (starts with: ${JSON.stringify(clean.slice(0, 30))})`);
}

async function main() {
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON found. Google Drive tools will not be available.");
        return;
    }

    // Parse and re-serialize to guarantee clean JSON before writing to file.
    // Railway may store the value with backslash-escaped quotes ({\"type\":...}),
    // which would cause JSON.parse to fail in the MCP server.
    let credentials;
    try {
        credentials = parseCredentials(rawCredentials);
    } catch (err) {
        console.error(`[ERROR] Failed to parse credentials: ${err.message}`);
        process.exit(1);
    }

    try {
        fs.writeFileSync(KEY_PATH, JSON.stringify(credentials), 'utf8');
        console.log(`[INFO] Credentials written to ${KEY_PATH}`);
    } catch (err) {
        console.error(`[ERROR] Failed to write credentials file: ${err.message}`);
        process.exit(1);
    }

    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        const mcpEnv = {
            GOOGLE_DRIVE_KEY_PATH: KEY_PATH,
        };
        if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
            mcpEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
        }

        config.mcp.servers["google_drive"] = {
            command: "node",
            args: ["/app/scripts/mcp-gdrive.mjs"],
            env: mcpEnv,
            type: "stdio",
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] MCP injected. Root folder: ${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '(unrestricted)'}`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
        process.exit(1);
    }
}

main();
