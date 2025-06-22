# 🔑 API Key Setup Guide for Claude Code YOLO Mode

## ⚠️ **IMPORTANT: You Need Your Own API Key**

The current setup has a placeholder API key. You need to replace it with your **actual Anthropic Pro Max API key**.

## **Step 1: Get Your API Key**

1. **Go to Anthropic Console**: https://console.anthropic.com/
2. **Sign in** with your Pro Max account
3. **Navigate to API Keys** (usually in settings/dashboard)
4. **Create new key** or copy existing key
5. **Copy the full API key** (starts with `sk-ant-api03-...`)

## **Step 2: Update devcontainer.json**

**Replace the placeholder in `.devcontainer/devcontainer.json`:**

```json
"runArgs": [
  "--cap-add=NET_ADMIN",
  "--cap-add=NET_RAW",
  "-e", "ANTHROPIC_API_KEY=sk-ant-api03-YOUR_ACTUAL_KEY_HERE"
],
```

**Current status**: ❌ Placeholder key needs replacement
**File location**: `.devcontainer/devcontainer.json` line 12

## **Step 3: Alternative Methods**

### **Option A: Environment Variable (Recommended for Security)**
Instead of hardcoding in devcontainer.json, you can set it as a system environment variable:

```json
"runArgs": [
  "--cap-add=NET_ADMIN",
  "--cap-add=NET_RAW",
  "-e", "ANTHROPIC_API_KEY=${localEnv:ANTHROPIC_API_KEY}"
],
```

Then set `ANTHROPIC_API_KEY` in your Windows environment variables.

### **Option B: .env File**
Create `.devcontainer/.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_ACTUAL_KEY_HERE
```

And update devcontainer.json:
```json
"runArgs": [
  "--cap-add=NET_ADMIN",
  "--cap-add=NET_RAW",
  "--env-file", ".devcontainer/.env"
],
```

## **Step 4: Security Best Practices**

### **✅ DO:**
- Use environment variables when possible
- Keep API keys in `.env` files (add to `.gitignore`)
- Use the principle of least privilege
- Monitor your API usage in Anthropic Console

### **❌ DON'T:**
- Commit API keys to version control
- Share API keys in screenshots or logs
- Use production keys in development
- Leave default/placeholder keys

## **Step 5: Verification**

After setting your API key, verify it works:

1. **Build container**: "Reopen in Container" in VS Code
2. **Run setup**: `./yolo-setup.sh`
3. **Check key**: Should show "✅ API key found: sk-ant-api03-..."
4. **Test Claude**: `claude --version`
5. **Test connection**: `claude --test-connection` (if available)

## **Step 6: Pro Max Benefits**

With your Pro Max account, you get:
- **Higher rate limits**: More requests per minute
- **Priority access**: Faster response times
- **Extended context**: Larger context windows
- **Advanced features**: Latest model access

## **Example: Complete Setup**

```json
{
  "name": "Claude Code Sandbox - YOLO Mode",
  "build": {
    "dockerfile": "Dockerfile",
    "args": {
      "TZ": "${localEnv:TZ:America/Los_Angeles}"
    }
  },
  "runArgs": [
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW",
    "-e", "ANTHROPIC_API_KEY=sk-ant-api03-YOUR_REAL_KEY_HERE"
  ],
  // ... rest of config
}
```

## **Troubleshooting**

### **"API key not found" error:**
- Check the key is correctly set in devcontainer.json
- Verify no extra spaces or quotes
- Ensure the key starts with `sk-ant-api03-`

### **"Authentication failed" error:**
- Verify the key is valid in Anthropic Console
- Check if the key has been revoked
- Ensure your Pro Max subscription is active

### **"Rate limit exceeded" error:**
- Check your usage in Anthropic Console
- Consider upgrading if needed
- Wait for rate limits to reset

---

**🎯 Once you've set your real API key, Claude Code will connect to your Pro Max account and work perfectly in YOLO mode!**

**Next**: After updating your API key, proceed with the container setup and enjoy unattended Claude operation! 🚀
