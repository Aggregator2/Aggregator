# Claude Code YOLO Mode Setup

This DevContainer is configured for **Claude Code CLI in YOLO Mode** - unattended operation with `--dangerously-skip-permissions` and no firewall restrictions.

## ⚠️ YOLO Mode Warning

**YOLO Mode** means:
- No firewall restrictions (unrestricted network access)
- Passwordless sudo access for all commands
- Claude CLI runs with `--dangerously-skip-permissions`
- Fully automated, unattended operation

## 🚀 Quick Start

### Option 1: Use VS Code Dev Containers (Recommended)

1. **Open in VS Code**: Open this project in VS Code
2. **Reopen in Container**: Click the blue "Reopen in Container" button when prompted
3. **Wait for Build**: The container will build with all Claude Code dependencies
4. **Start YOLO Mode**: Once the container is ready, run:
   ```bash
   ./yolo-setup.sh
   claude --dangerously-skip-permissions
   ```

### Option 2: Manual Container Build

```bash
# Build the container
docker build -t claude-yolo .devcontainer/

# Run with YOLO mode
docker run -it --rm \
  --cap-add=NET_ADMIN \
  --cap-add=NET_RAW \
  -e ANTHROPIC_API_KEY=your_api_key_here \
  -v "$(pwd):/workspace" \
  claude-yolo
```

## 🔧 What's Included

### Official Claude Code Components
- **Dockerfile**: Based on official Claude Code container with YOLO modifications
- **devcontainer.json**: Official VS Code DevContainer config (firewall disabled)
- **init-firewall.sh**: Official firewall script (not used in YOLO mode)

### YOLO Mode Enhancements
- **Passwordless sudo**: `node ALL=(root) NOPASSWD: ALL` in sudoers
- **No firewall**: Network restrictions disabled for full access
- **API key injection**: Anthropic API key pre-configured
- **Unattended operation**: Ready for automated Claude workflows

### Development Tools
- Node.js 20 with npm/yarn
- Git, gh (GitHub CLI)
- Zsh with oh-my-zsh and powerline10k theme
- VS Code extensions for TypeScript, ESLint, Prettier
- Claude Code CLI (`@anthropic-ai/claude-code`)

## 🎯 YOLO Mode Commands

### Start Claude in YOLO Mode
```bash
# Interactive mode (recommended for testing)
claude --dangerously-skip-permissions

# Background mode (for automation)
nohup claude --dangerously-skip-permissions > /dev/null 2>&1 &

# With specific model
claude --dangerously-skip-permissions --model claude-3-5-sonnet-20241022
```

### Check Status
```bash
# Check if Claude is running
ps aux | grep claude

# Check Claude CLI version
claude --version

# Test API connection
claude --test-connection
```

## � API Key Management

The API key is configured in multiple ways:
- Environment variable: `ANTHROPIC_API_KEY`
- DevContainer runArgs: Injected at container start
- Claude config: `~/.claude/config.json`

## � Project Structure

```
.devcontainer/
├── Dockerfile              # Official Claude Code + YOLO modifications
├── devcontainer.json       # VS Code DevContainer config
├── init-firewall.sh        # Official firewall script (disabled)
├── yolo-setup.sh           # YOLO mode initialization
├── README.md               # This file
└── ...                     # Additional scripts and configs
```

## 🚨 Security Considerations

**YOLO Mode disables all security restrictions:**
- No network firewall
- Passwordless sudo access
- No permission prompts
- Full system access

**Only use YOLO mode in:**
- Development environments
- Isolated containers
- Trusted networks
- Testing scenarios

**Never use YOLO mode in:**
- Production systems
- Shared environments
- Public networks
- Systems with sensitive data

## 🐛 Troubleshooting

### Claude CLI Not Found
```bash
# Reinstall Claude CLI
npm install -g @anthropic-ai/claude-code

# Check npm global path
npm config get prefix
echo $PATH
```

### API Key Issues
```bash
# Check environment variable
echo $ANTHROPIC_API_KEY

# Test API connection
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
     -H "Content-Type: application/json" \
     https://api.anthropic.com/v1/messages
```

### Container Build Issues
```bash
# Rebuild without cache
docker build --no-cache -t claude-yolo .devcontainer/

# Check Docker permissions
docker info
```

## 📚 Next Steps

1. **Open in Container**: Use VS Code "Reopen in Container"
2. **Run YOLO Setup**: Execute `./yolo-setup.sh`
3. **Start Claude**: Run `claude --dangerously-skip-permissions`
4. **Begin Development**: Claude is ready for unattended operation!

## 🤝 Integration with Meta Aggregator 2.0

This setup is specifically configured for the Meta Aggregator 2.0 project:
- TypeScript/React/Next.js development
- Hardhat blockchain development
- Advanced UI/UX improvements
- Automated code generation and fixes
- Performance optimization
- Type safety enhancements

The project already includes generated code improvements in `.claude-output/` ready for implementation.

---

**Happy coding with Claude in YOLO mode! 🚀**
