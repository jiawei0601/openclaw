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
    }

    // 2. Inject into openclaw.json
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) {
                try {
                    config = JSON.parse(raw);
                } catch (parseErr) {
                    config = {};
                }
            }
        }

        // Try TWO locations just in case
        const mcpConfig = {
            command: "/usr/local/bin/mcp-server-gdrive",
            args: ["--service-account-key", KEY_PATH],
            env: {
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                NODE_ENV: "production"
            },
            type: "stdio",
            description: "Access and manage files in Google Drive."
        };

        // Location 1: mcp.servers
        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};
        config.mcp.servers["google_drive"] = mcpConfig;

        // Location 2: mcpServers (Top level) - Use a safe name to avoid validation if it fails
        // config.mcpServers = { "google_drive": mcpConfig }; 

        // Write back
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        
        // --- DIAGNOSTIC LOG ---
        console.log("--- FINAL CONFIG CONTENT (SANITIZED) ---");
        const sanitized = JSON.parse(JSON.stringify(config));
        if (sanitized.mcp?.servers?.google_drive) {
             sanitized.mcp.servers.google_drive.args = ["--service-account-key", "MASKED"];
        }
        console.log(JSON.stringify(sanitized, null, 2));
        console.log("--- END DIAGNOSTIC LOG ---");

    } catch (err) {
        console.error(`[ERROR] Configuration injection failed: ${err.message}`);
    }
}

main();
