import fs from 'fs';
import path from 'path';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    // 1. Write the Google Drive Key
    const credentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (credentials) {
        try {
            fs.writeFileSync(KEY_PATH, credentials);
            console.log(`[INFO] Google Drive key written to ${KEY_PATH}`);
        } catch (err) {
            console.error(`[ERROR] Failed to write key: ${err.message}`);
        }
    } else {
        console.warn('[WARN] GOOGLE_DRIVE_CREDENTIALS_JSON is not set');
    }

    // 2. Inject into openclaw.json
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            config = JSON.parse(raw);
        }

        // Ensure structures exist
        if (!config.gateway) config.gateway = {};
        if (!config.gateway.mcpServers) config.gateway.mcpServers = {};

        // Inject Google Drive
        config.gateway.mcpServers["google_drive"] = {
            command: "/usr/local/bin/mcp-server-gdrive",
            args: ["--service-account-key", KEY_PATH],
            env: {
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                NODE_ENV: "production"
            },
            type: "stdio",
            description: "Access and manage files in Google Drive, including reading, creating, and editing documents."
        };

        // Write back
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Google Drive tool injected into ${CONFIG_PATH}`);
        console.log(`[DEBUG] Current MCP Servers: ${Object.keys(config.gateway.mcpServers).join(', ')}`);

    } catch (err) {
        console.error(`[ERROR] Configuration injection failed: ${err.message}`);
    }
}

main();
