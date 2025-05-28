# Gittron

A VS Code extension that brings GitHub PR comments directly into your editor. Navigate to commented code, resolve comments, and copy them as AI instructions.

## Features

- **Smart PR Detection**: Automatically finds your current PR
- **Comment Navigation**: Click comments to jump to the exact code line
- **Comment Resolution**: Resolve comments directly from VS Code
- **AI Integration**: Copy comments as formatted AI instructions
- **Unresolved Focus**: Shows only actionable, unresolved comments

## Quick Start

1. **Install** the extension
2. **Set GitHub Token**: `Cmd+Shift+P` → "Gittron: Set GitHub Token"
3. **Fetch Comments**: `Cmd+Shift+G P` or use the Gittron panel
4. **Navigate**: Click any comment to jump to the code
5. **Resolve**: Right-click comments or use hover tooltips

## GitHub Token Setup

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Create a token with `repo` permissions
3. In VS Code: `Gittron: Set GitHub Token`

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Fetch PR Comments | `Cmd+Shift+G P` | Load comments for current PR |
| Set GitHub Token | `Cmd+Shift+G T` | Configure GitHub access |

## Usage

- Open a repo with a PR
- Use `Cmd+Shift+G P` to fetch comments
- Click comments in the panel to navigate to code
- Hover over highlighted lines for comment details
- Right-click comments to resolve them

## Development

```bash
# Install dependencies
npm install

# Compile for development
npm run build

# Create VSIX package
npm run build-vsix

# Watch for changes
npm run watch
```

Built for streamlined code reviews with AI assistance.
