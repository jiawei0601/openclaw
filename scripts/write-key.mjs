import fs from 'fs';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    console.log("--- ENABLING FULL WRITE PERMISSIONS ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) return;

    try {
        fs.writeFileSync(KEY_PATH, rawCredentials);
    } catch (err) {
        console.error(`[ERROR] Write failed: ${err.message}`);
    }

    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        // Updated configuration with FULL SCOPES for writing
        config.mcp.servers["google_drive"] = {
            command: "npx", 
            args: ["-y", "@piotr-agier/google-drive-mcp"],
            env: {
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: rawCredentials,
                // Explicitly request full drive and docs access
                GDRIVE_SCOPES: "https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/documents"
            },
            type: "stdio"
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Configuration updated with WRITE SCOPES.`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();
