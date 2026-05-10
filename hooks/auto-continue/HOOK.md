---
name: auto-continue
description: "Auto-continues agent execution after model idle timeout (max 3 retries per task)"
metadata:
  { "openclaw": { "emoji": "🔄", "events": ["message:sent"] } }
---

# Auto-Continue Hook

Detects model idle timeout errors in outbound messages and automatically sends "繼續"
back to the same session, up to 3 times per task (resets after 10 minutes of no timeouts).
