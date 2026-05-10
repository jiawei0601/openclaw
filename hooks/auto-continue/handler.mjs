const MAX_RETRIES = 3;
const RESET_AFTER_MS = 10 * 60 * 1000; // 10 minutes — treat as a new task

// In-memory retry state: sessionKey → { count, lastAt }
const retryState = new Map();

const TIMEOUT_PATTERN = /model idle timeout|did not produce a response before/i;

const handler = async (event) => {
    if (event.type !== 'message' || event.action !== 'sent') return;

    const content = event.context?.content ?? '';
    if (!TIMEOUT_PATTERN.test(content)) return;

    const sessionKey = event.sessionKey;
    if (!sessionKey) return;

    const now = Date.now();

    // Reset counter if last timeout was >10 minutes ago (new task started)
    const existing = retryState.get(sessionKey);
    if (existing && (now - existing.lastAt) > RESET_AFTER_MS) {
        retryState.delete(sessionKey);
    }

    const state = retryState.get(sessionKey) ?? { count: 0, lastAt: now };

    if (state.count >= MAX_RETRIES) {
        console.error(`[auto-continue] Max retries (${MAX_RETRIES}) reached for session ${sessionKey}. Manual intervention required.`);
        return;
    }

    state.count++;
    state.lastAt = now;
    retryState.set(sessionKey, state);

    console.error(`[auto-continue] Timeout detected. Auto-retry ${state.count}/${MAX_RETRIES} for session ${sessionKey}`);

    // Wait 2s for gateway to settle before sending next turn
    await new Promise(r => setTimeout(r, 2000));

    const port = process.env.OPENCLAW_GATEWAY_PORT ?? '18789';
    const url = `http://localhost:${port}/hooks/agent`;

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: '繼續', sessionKey }),
        });

        if (resp.ok) {
            console.error(`[auto-continue] ✓ Sent 繼續 (retry ${state.count}/${MAX_RETRIES})`);
        } else {
            const text = await resp.text().catch(() => '');
            console.error(`[auto-continue] ✗ POST failed: ${resp.status} ${text}`);
        }
    } catch (err) {
        console.error(`[auto-continue] ✗ Error calling /hooks/agent: ${err.message}`);
    }
};

export default handler;
