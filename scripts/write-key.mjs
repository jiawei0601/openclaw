import fs from 'fs';

const CONFIG_PATH = '/app/openclaw.json';
const KEY_PATH = '/tmp/google-drive-key.json';

function parseCredentials(raw) {
    let clean = raw.trim();

    // 1. Direct parse
    try { const r = JSON.parse(clean); console.log('[PARSE] Step 1 (direct) succeeded.'); return r; } catch {}

    // 2. Escape actual newlines inside JSON string values (state-machine, no regex)
    try {
        let inStr = false, esc = false, out = '';
        for (let i = 0; i < clean.length; i++) {
            const ch = clean[i];
            if (esc) { out += ch; esc = false; }
            else if (ch === '\\' && inStr) { out += ch; esc = true; }
            else if (ch === '"') { inStr = !inStr; out += ch; }
            else if (ch === '\n' && inStr) { out += '\\n'; }
            else if (ch === '\r' && inStr) { /* skip */ }
            else { out += ch; }
        }
        const r = JSON.parse(out);
        if (typeof r === 'object' && r !== null && !Array.isArray(r)) {
            console.log('[PARSE] Step 2 (state-machine sanitize) succeeded.');
            return r;
        }
    } catch {}

    // 3. Outer quotes wrapping a JSON string
    if (clean.startsWith('"')) {
        try {
            const inner = JSON.parse(clean);
            if (typeof inner === 'string') {
                const r = JSON.parse(inner);
                console.log('[PARSE] Step 3a (double-encoded) succeeded.');
                return r;
            }
        } catch {}
        const stripped = clean
            .slice(1, clean.endsWith('"') ? -1 : undefined)
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n');
        try {
            const r = JSON.parse(stripped);
            console.log('[PARSE] Step 3b (strip+unescape) succeeded.');
            return r;
        } catch {}
        clean = stripped;
    }

    // 4. Backslash-escaped inner quotes
    if (clean.startsWith('{')) {
        try {
            const r = JSON.parse(clean.replace(/\\"/g, '"'));
            console.log('[PARSE] Step 4 (unescape quotes) succeeded.');
            return r;
        } catch {}
    }

    throw new Error(
        `Cannot parse credentials. First 80 raw chars: ${JSON.stringify(raw.slice(0, 80))}`
    );
}

async function main() {
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    // NOTE: Do NOT patch models.providers.google here — openclaw schema requires
    // baseUrl and models[] alongside timeoutSeconds, and we don't know those values.
    // Set the timeout via openclaw.json in Railway's volume or env instead.

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON found. Google Drive tools will not be available.");
        return;
    }

    console.log(`[INFO] GOOGLE_DRIVE_CREDENTIALS_JSON raw length: ${rawCredentials.length}`);
    console.log(`[INFO] First 40 chars: ${JSON.stringify(rawCredentials.slice(0, 40))}`);

    let credentials;
    try {
        credentials = parseCredentials(rawCredentials);
    } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        console.error('[ERROR] Google Drive MCP will not be available. Fix GOOGLE_DRIVE_CREDENTIALS_JSON in Railway variables.');
        return;
    }

    const keys = Object.keys(credentials);
    console.log(`[INFO] Parsed credential keys: ${keys.join(', ')}`);
    console.log(`[INFO] client_email: ${credentials.client_email || '(missing)'}`);
    console.log(`[INFO] private_key: ${credentials.private_key
        ? `present (${credentials.private_key.length} chars, starts: ${credentials.private_key.slice(0, 27)}...)`
        : '(missing or empty)'}`);

    if (!credentials.private_key) {
        console.error('[ERROR] Parsed credentials are missing private_key.');
        console.error('[ERROR] Make sure GOOGLE_DRIVE_CREDENTIALS_JSON is the FULL service account JSON from GCP (not partial).');
        console.error('[ERROR] Google Drive MCP will not be available.');
        return;
    }
    if (!credentials.client_email) {
        console.error('[ERROR] Parsed credentials are missing client_email.');
        console.error('[ERROR] Google Drive MCP will not be available.');
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