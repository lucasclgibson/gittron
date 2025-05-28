# Gittron - AI-Powered PR Review Assistant

Gittron is a VS Code extension that streamlines your pull request review workflow by bringing GitHub PR comments directly into your editor. Navigate to commented code instantly, filter by resolution status, and copy comments as AI agent instructions for seamless code review automation.

## ✨ Features

### 🎯 **Smart PR Detection**
- Automatically detects the current pull request from your Git branch
- Supports PRs where your current branch is the source branch
- Manual PR number input for edge cases

### 💬 **File Comment Navigation**
- View all file-specific comments from your PR in a dedicated panel
- Click any comment to jump directly to the commented line in your editor
- Automatic line highlighting with hover tooltips showing comment details

### 🔍 **Intelligent Filtering**
- Automatically shows only unresolved comments to focus on actionable feedback
- Focus on file-related comments only (excludes general PR discussion)
- Real-time status updates showing comment counts

### 🤖 **AI Agent Integration**
- Copy any comment as a formatted AI agent instruction
- Includes the commented code block, comment text, and space for additional instructions
- Perfect for automating code review responses with AI tools

### 🔄 **Live Updates**
- Refresh comments without losing context
- Comprehensive pagination ensures all comments are retrieved
- Multiple API endpoints for maximum comment coverage

## 🚀 Getting Started

### Prerequisites
- VS Code or Cursor editor
- A GitHub repository with pull requests
- GitHub Personal Access Token with `repo` permissions

### Installation
1. Install the extension from the VS Code marketplace (or load locally for development)
2. Open a Git repository in VS Code
3. Set up your GitHub token (see Configuration below)

### Configuration

#### Setting Your GitHub Token
1. Generate a GitHub Personal Access Token:
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Create a token with `repo` permissions
2. In VS Code, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run `Gittron: Set GitHub Token`
4. Paste your token when prompted

## 📖 Usage

### Basic Workflow

1. **Open a repository** with an active pull request
2. **Fetch comments** using one of these methods:
   - Command Palette: `Gittron: Focus PR Comments`
   - Keyboard shortcut: `Cmd+Shift+G P` (Mac) / `Ctrl+Shift+G P` (Windows/Linux)
   - Click the refresh button in the Gittron panel

3. **Navigate comments** in the Gittron panel:
   - See PR information at the top
   - Click any comment to jump to the file and line
   - Hover over highlighted lines to see comment details

4. **Filter comments** as needed:
   - The extension automatically shows only unresolved comments to focus on actionable feedback
   - Status bar shows current comment counts

5. **Copy for AI assistance**:
   - Hover over a commented line
   - Click "📋 Copy as Agent Instruction" in the tooltip
   - Paste into your AI tool for automated responses

### Available Commands

| Command | Keyboard Shortcut | Description |
|---------|------------------|-------------|
| `Gittron: Focus PR Comments` | `Cmd+Shift+G P` | Fetch and display PR comments |
| `Gittron: Set GitHub Token` | `Cmd+Shift+G T` | Configure your GitHub token |
| `Gittron: Refresh Comments` | - | Refresh current PR comments |
| `Gittron: Copy as Agent Instruction` | - | Copy comment as AI instruction |

### Panel Features

The **Gittron Comments** panel shows:
- **PR Header**: Repository and PR number information
- **File Comments**: Only comments related to specific code lines
- **Comment Details**: Author, file, line number, and preview text
- **Status Icons**: Visual indicators for comment types and resolution status

### Status Bar Information

The status bar displays:
- Current PR number
- Total unresolved comment count

## 🎨 UI Elements

### Comment Panel
- **Header**: Shows PR #123 in owner/repo format
- **Comments**: Listed with file icons and line information
- **Descriptions**: Show @username, filename, and line number

### Code Editor Integration
- **Line Highlighting**: Commented lines are highlighted when navigated to
- **Hover Tooltips**: Rich tooltips with comment content and action buttons
- **Automatic Navigation**: Smooth scrolling to commented lines

### Copy Format
When copying as an AI agent instruction, the format includes:
```
Code: 
```
[commented line of code]
```

Comment by @username:
[comment text]

Instructions:

```

## ⚙️ Configuration Options

The extension supports these VS Code settings:

- `gittron.githubToken`: Your GitHub Personal Access Token (set via command)

**Note:** The extension automatically shows only unresolved comments to focus on actionable feedback.

## 🔧 Troubleshooting

### Common Issues

**"GitHub token not set"**
- Run `Gittron: Set GitHub Token` and enter a valid token with repo permissions

**"Could not determine PR number from current branch"**
- Ensure you're on a branch that has an open PR
- Use the manual PR number input when prompted
- Check that your branch name matches the PR source branch

**"No file comments found"**
- Verify the PR has comments on specific code lines (not just general discussion)
- Check that the comments are unresolved (the extension only shows unresolved comments)

**Missing recent comments**
- Use the refresh button to get the latest comments
- The extension uses pagination to fetch all comments from multiple API endpoints

### Debug Information

Enable debug logging by opening the Developer Console (`Help → Toggle Developer Tools`) and checking the Console tab for detailed information about:
- API requests and responses
- Comment fetching progress
- File navigation attempts
- Filter operations

## 🤝 Contributing

This extension is designed to streamline PR review workflows. Contributions and feedback are welcome!

### Development Setup
1. Clone the repository
2. Run `npm install`
3. Open in VS Code
4. Press F5 to launch the extension development host
5. Make changes and test

### Building
```bash
npm run compile
```

## 📝 License

[Add your license information here]

## 🛠️ **Built With**

- [VS Code Extension API](https://code.visualstudio.com/api) for editor integration
- [GitHub REST API](https://docs.github.com/en/rest) for fetching PR data
- [GitHub GraphQL API](https://docs.github.com/en/graphql) for accurate resolution detection
- [Simple Git](https://github.com/steveukx/git-js) for Git operations
- [TypeScript](https://www.typescriptlang.org/) for type safety
- [Webpack](https://webpack.js.org/) for bundling

---

**Happy reviewing! 🚀**
