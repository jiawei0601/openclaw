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

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) return JSON.parse(raw);
        }
    } catch {}
    return {};
}

async function main() {
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    // Ensure openclaw.json is valid — the Dockerfile does not copy it into the
    // final runtime image so the file starts empty, which causes a JSON parse crash.
    try {
        const raw = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8').trim() : '';
        if (raw.length === 0) {
            fs.writeFileSync(CONFIG_PATH, '{}');
            console.log('[INFO] Initialized empty openclaw.json');
        }
    } catch (err) {
        console.error(`[ERROR] Failed to initialize openclaw.json: ${err.message}`);
    }

    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const useOAuth = oauthClientId && oauthClientSecret && oauthRefreshToken;

    const mcpEnv = {};
    if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
        mcpEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    }

    if (useOAuth) {
        console.log('[INFO] Auth mode: OAuth user credentials detected.');
        mcpEnv.GOOGLE_OAUTH_CLIENT_ID = oauthClientId;
        mcpEnv.GOOGLE_OAUTH_CLIENT_SECRET = oauthClientSecret;
        mcpEnv.GOOGLE_OAUTH_REFRESH_TOKEN = oauthRefreshToken;
    } else {
        const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
        if (!rawCredentials) {
            console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON or OAuth variables found. Google Drive tools will not be available.");
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

        mcpEnv.GOOGLE_DRIVE_KEY_PATH = KEY_PATH;
    }

    try {
        const config = readConfig();

        // Inject agent defaults
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};

        const systemPrompt = process.env.AGENT_SYSTEM_PROMPT;
        if (systemPrompt) {
            config.agents.defaults.systemPromptOverride = systemPrompt;
            console.log('[INFO] System prompt injected.');
        }

        // Set primary model
        const agentModel = process.env.AGENT_MODEL || 'google/gemini-3.1-flash-lite-preview';
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = agentModel;
        console.log(`[INFO] Primary model set to: ${agentModel}`);

        // Extend agent turn timeout for complex multi-step tasks
        config.agents.defaults.timeoutSeconds = 600;
        console.log('[INFO] Agent timeout set to 600s.');

        // Enable auto-continue hook
        if (!config.hooks) config.hooks = {};
        if (!config.hooks.internal) config.hooks.internal = {};
        if (!config.hooks.internal.load) config.hooks.internal.load = {};
        if (!Array.isArray(config.hooks.internal.load.extraDirs)) config.hooks.internal.load.extraDirs = [];
        if (!config.hooks.internal.load.extraDirs.includes('/app/hooks')) {
            config.hooks.internal.load.extraDirs.push('/app/hooks');
        }
        config.hooks.internal.enabled = true;
        config.hooks.allowRequestSessionKey = true;
        console.log('[INFO] Auto-continue hook configured.');

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

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