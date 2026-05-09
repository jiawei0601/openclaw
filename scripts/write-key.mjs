import fs from 'fs';

const CONFIG_PATH = '/app/openclaw.json';
const KEY_PATH = '/tmp/google-drive-key.json';

async function main() {
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON found. Google Drive tools will not be available.");
        return;
    }

    // Write credentials to a file so the MCP server reads it directly,
    // avoiding JSON double-encoding issues when embedding in openclaw.json.
    try {
        fs.writeFileSync(KEY_PATH, rawCredentials, 'utf8');
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
