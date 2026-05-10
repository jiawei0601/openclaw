// Handles the four encoding formats Railway env vars can produce for JSON credentials:
//   1. Valid JSON pasted directly
//   2. JSON with raw (unescaped) newlines inside string values
//   3. JSON double-encoded inside outer quotes
//   4. JSON with backslash-escaped inner quotes
export function parseCredentials(raw) {
    let clean = raw.trim();

    // 1. Direct parse
    try {
        const r = JSON.parse(clean);
        console.log('[PARSE] Step 1 (direct) succeeded.');
        return r;
    } catch {}

    // 2. State-machine: escape raw newlines inside string values
    try {
        let inStr = false, esc = false, out = '';
        for (let i = 0; i < clean.length; i++) {
            const ch = clean[i];
            if (esc)                         { out += ch; esc = false; }
            else if (ch === '\\' && inStr)   { out += ch; esc = true; }
            else if (ch === '"')             { inStr = !inStr; out += ch; }
            else if (ch === '\n' && inStr)   { out += '\\n'; }
            else if (ch === '\r' && inStr)   { /* skip */ }
            else                             { out += ch; }
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
