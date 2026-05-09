import fs from 'fs';

const CONFIG_PATH = '/app/openclaw.json';
const KEY_PATH = '/tmp/google-drive-key.json';

function parseCredentials(raw) {
    let clean = raw.trim();

    // 1. Direct parse (ideal: raw is clean JSON)
    try { return JSON.parse(clean); } catch {}

    // 2. Pretty-printed JSON with actual newlines inside private_key string value.
    //    Escape any literal newlines that appear inside quoted strings.
    try {
        const sanitized = clean.replace(/"((?:[^"\\]|\\.)*)"/gs, (match) =>
            match.replace(/\n/g, '\\n').replace(/\r/g, '')
        );
        return JSON.parse(sanitized);
    } catch {}

    // 3. Outer quotes wrapping a JSON string: "{ ... }" or "{\"type\":...}"
    if (clean.startsWith('"')) {
        // 3a. Railway double-encoded: JSON.parse gives us the inner string
        try {
            const inner = JSON.parse(clean);
            if (typeof inner === 'string') return JSON.parse(inner);
        } catch {}
        // 3b. Manual strip outer quotes + unescape
        const stripped = clean
            .slice(1, clean.endsWith('"') ? -1 : undefined)
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n');
        try { return JSON.parse(stripped); } catch {}
        clean = stripped;
    }

    // 4. Starts with { but inner quotes are backslash-escaped: {\"type\":...}
    if (clean.startsWith('{')) {
        try { return JSON.parse(clean.replace(/\\"/g, '"')); } catch {}
    }

    throw new Error(
        `Cannot parse credentials. First 80 raw chars: ${JSON.stringify(raw.slice(0, 80))}`
    );
}

async function main() {
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON found. Google Drive tools will not be available.");
        return;
    }

    let credentials;
    try {
        credentials = parseCredentials(rawCredentials);
    } catch (err) {
        // Log the error but DO NOT exit — let the gateway start without Drive tools.
        console.error(`[ERROR] ${err.message}`);
        console.error('[ERROR] Google Drive MCP will not be available. Fix GOOGLE_DRIVE_CREDENTIALS_JSON in Railway variables.');
        return;
    }

    try {
        fs.writeFileSync(KEY_PATH, JSON.stringify(credentials), 'utf8');
        console.log(`[INFO] Credentials written to ${KEY_PATH}`);
    } catch (err) {
        console.error(`[ERROR] Failed to write credentials file: ${err.message}`);
        return;
    }

    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        const mcpEnv = { GOOGLE_DRIVE_KEY_PATH: KEY_PATH };
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
    }
}

main();
