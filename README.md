# 🤖 Gittron - AI-Powered PR Review for Cursor

> **Seamlessly integrate GitHub PR comments with Cursor's AI agent for intelligent code reviews**

Gittron transforms your PR review workflow by bringing GitHub comments directly into Cursor and enabling one-click AI assistance for every review comment.

## ✨ **Perfect for Cursor Users**

- 🎯 **One-click AI integration** - Send any PR comment directly to Cursor's AI chat
- 🔍 **Smart code context** - Automatically includes the relevant code with every comment
- ⚡ **Instant review mode** - Navigate through all unresolved comments with keyboard shortcuts
- 📊 **Status bar integration** - See unresolved comment count at a glance
- 🎨 **Seamless workflow** - Designed specifically for Cursor's AI-first development approach

## 🚀 **Key Features**

### **AI-First Review Workflow**
- **Add to AI Chat**: Send PR comments with code context directly to Cursor's AI agent
- **Smart Context**: Automatically formats code and comments for optimal AI understanding
- **Intelligent Replies**: Use AI assistance to craft thoughtful comment responses

### **Efficient Comment Management**
- **Status Bar Indicator**: Shows unresolved comment count and starts review mode
- **Review Mode**: Step-by-step navigation through all unresolved comments
- **Hover Integration**: View, reply to, and resolve comments without leaving your code
- **Auto-Detection**: Automatically finds PR comments when you switch branches

### **GitHub Integration**
- **Real-time Sync**: Automatically fetches and updates PR comments
- **Thread Support**: Full conversation threads with proper chronological ordering
- **Comment Actions**: Reply, resolve, and manage comments directly from Cursor
- **Branch Awareness**: Switches context automatically when you change branches

## 📦 **Installation**

1. Install from the Cursor Extensions Marketplace
2. Set your GitHub Personal Access Token: `Cmd+Shift+P` → "Gittron: Set GitHub Token"
3. Open any repository with an active PR
4. Comments will appear automatically in the sidebar and status bar

## 🎮 **Usage**

### **Quick Start with AI**
1. **See the status bar** - Shows `$(comment-discussion) X unresolved` when comments are found
2. **Click to start review** - Enters focused review mode
3. **Add to AI Chat** - Click the 💬 button on any comment to send it to Cursor's AI
4. **Get AI assistance** - Use Cursor's AI to help understand, respond to, or resolve comments

### **Keyboard Shortcuts**
- `Cmd+Shift+G P` - Fetch PR comments
- `Cmd+Shift+G T` - Set GitHub token

### **Review Mode Navigation**
- **Next/Previous Thread** - Navigate between comment discussions
- **Resolve Current Thread** - Mark the current thread as resolved
- **Reply to Thread** - Add your response to the discussion
- **Exit Review Mode** - Return to normal editing

## ⚙️ **Configuration**

### **GitHub Token Setup**
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Create a token with `repo` scope
3. In Cursor: `Cmd+Shift+P` → "Gittron: Set GitHub Token"
4. Paste your token

### **Supported Repository Types**
- GitHub repositories with active pull requests
- Both public and private repositories (with proper token permissions)
- Automatic detection of PR context based on current branch

## 🤖 **AI Integration Tips**

**Best Practices for Cursor AI:**
- Comments include full code context for better AI understanding
- Use "Add to AI Chat" for complex technical discussions
- Let AI help you craft diplomatic responses to feedback
- Use AI to understand unfamiliar code patterns mentioned in comments

**Example AI Prompts:**
- "Help me understand this comment and suggest how to address it"
- "Draft a professional response to this code review feedback"
- "Explain why this reviewer might be concerned about this approach"

## 🛠 **For Cursor Power Users**

- **Agent Workflow**: Gittron formats comments perfectly for Cursor's AI agents
- **Context Preservation**: Maintains code-comment relationships for AI analysis
- **Batch Processing**: Review mode enables efficient AI-assisted comment resolution
- **Smart Formatting**: Markdown and code blocks are preserved for AI readability

## 📊 **Privacy & Security**

- Your GitHub token is stored securely in Cursor's settings
- No data is sent to external servers except GitHub API calls
- All AI interactions happen through Cursor's built-in AI (your existing setup)
- Comments and code context are only shared with your chosen AI provider via Cursor

## 🐛 **Troubleshooting**

**Common Issues:**
- **No comments showing**: Ensure you're on a branch with an active PR
- **Token errors**: Verify your GitHub token has `repo` scope
- **Git not detected**: Wait a few seconds after opening a repository

**Getting Help:**
- Open an issue on [GitHub](https://github.com/lucasclgibson/gittron/issues)
- Include your Cursor version and error messages
- Check the Cursor Developer Console for additional logs

## 🔄 **Changelog**

### v0.0.2
- Added status bar integration with comment count
- Improved AI chat integration for Cursor
- Enhanced review mode with better navigation
- Fixed race conditions on startup
- Optimized bundle size (90% reduction)

### v0.0.1
- Initial release with basic PR comment integration
- Hover providers and comment navigation
- GitHub API integration

## 🤝 **Contributing**

We welcome contributions! This extension is specifically designed for Cursor users who want better AI-assisted code review workflows.

## 📄 **License**

MIT License - see [LICENSE](LICENSE) for details.

---

**Made with ❤️ for the Cursor community**

*Gittron bridges the gap between GitHub's collaborative code review and Cursor's AI-powered development environment.*
