import fs from 'fs';

const key = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
if (key) {
  try {
    fs.writeFileSync('/tmp/google-drive-key.json', key);
    console.log('[INFO] Google Drive key written to /tmp/google-drive-key.json');
  } catch (err) {
    console.error('[ERROR] Failed to write Google Drive key:', err);
    process.exit(1);
  }
} else {
  console.warn('[WARN] GOOGLE_DRIVE_CREDENTIALS_JSON environment variable is missing');
}
