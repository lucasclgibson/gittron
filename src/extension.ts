// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { GitHubService, PullRequestComment } from "./services/github";
import { GitService } from "./services/git";
import { CommentsProvider, CommentItem } from "./ui/commentsView";

// Store the active comment for the hover provider
let activeComment: PullRequestComment | undefined;
let activeCommentDecoration: vscode.TextEditorDecorationType | undefined;
let activeCommentLine: string | undefined; // Store the line of code the comment refers to

// Store the current PR info for refreshing
interface CurrentPRInfo {
  owner: string;
  repo: string;
  number: number;
}
let currentPRInfo: CurrentPRInfo | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Activating Gittron extension");

	// Initialize services
	const githubService = new GitHubService();
	const gitService = new GitService();
	
  console.log("Services initialized");
	
	// Initialize UI components
	const commentsProvider = new CommentsProvider();
  const commentsTreeView = vscode.window.createTreeView("gittronComments", {
		treeDataProvider: commentsProvider,
    showCollapseAll: true,
  });

  console.log("UI components initialized");

  // Create decoration type for highlighting the commented line
  const commentDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor(
      "editor.findMatchHighlightBackground"
    ),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor(
      "editorOverviewRuler.findMatchForeground"
    ),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  // Register the hover provider for comments
  const hoverProvider = vscode.languages.registerHoverProvider("*", {
    provideHover(document, position, token) {
      // Only provide a hover if we have an active comment
      if (!activeComment || !activeComment.path) {
        return null;
      }

      // Check if the hover is on the line we navigated to
      const lineNumber = position.line;
      const targetLine =
        (activeComment.line || activeComment.position || 1) - 1;

      if (lineNumber === targetLine) {
        // Store the current line of code for the copy command
        activeCommentLine = document.lineAt(lineNumber).text;

        // Create markdown content for the hover
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        markdown.appendMarkdown(
          `**Comment by [@${activeComment.user.login}](${activeComment.html_url})**\n\n`
        );
        markdown.appendMarkdown(activeComment.body);

        // Add link to GitHub
        markdown.appendMarkdown(
          `\n\n[View on GitHub](${activeComment.html_url})`
        );

        // Add button to copy as agent instruction
        markdown.appendMarkdown(
          `\n\n<a href="command:gittron.copyAsAgentInstruction">📋 Copy as Agent Instruction</a>`
        );

        // Add button to add to AI chat
        markdown.appendMarkdown(
          `  <a href="command:gittron.addToAIChat">💬 Add to AI Chat</a>`
        );

        return new vscode.Hover(markdown);
      }

      return null;
    },
  });

  // Register the hover provider
  context.subscriptions.push(hoverProvider);

  // Helper function to refresh PR comments
  async function refreshComments(
    includeResolved: boolean = false,
    forceNewPR: boolean = false
  ): Promise<void> {
    if (!currentPRInfo || forceNewPR) {
      // If no PR info or forcing new PR, perform a full fetch like gittron.fetchPRComments
      console.log("No current PR info or forcing new PR fetch");
			try {
				// Show progress indicator
        await vscode.window.withProgress(
          {
					location: vscode.ProgressLocation.Notification,
            title: "Fetching PR comments...",
            cancellable: false,
          },
          async (progress) => {
					// Get repository info
					const repoInfo = await gitService.getRepositoryInfo();
            progress.report({
              message: `Detected repository: ${repoInfo.owner}/${repoInfo.name}`,
            });
					
					// Get PR number from current branch
            let prNumber: number | null = null;
            try {
              prNumber = await gitService.getCurrentPullRequest();
            } catch (error) {
              // If getCurrentPullRequest throws an error, prompt the user to enter a PR number
              console.log("Error getting PR number from branch:", error);

              if (error instanceof Error) {
                // Show the error message
                vscode.window.showErrorMessage(`${error.message}`);
              }

              // Prompt for manual PR number input
              const prInput = await vscode.window.showInputBox({
                prompt: "Enter PR number",
                placeHolder: "e.g., 123",
                validateInput: (input) => {
                  return /^\d+$/.test(input)
                    ? null
                    : "Please enter a valid PR number (digits only)";
                },
              });

              if (prInput) {
                prNumber = parseInt(prInput, 10);
              } else {
                throw new Error("PR number is required");
              }
            }

					if (!prNumber) {
              throw new Error("Could not determine PR number");
            }

            // Store the PR info for refreshing
            currentPRInfo = {
              owner: repoInfo.owner,
              repo: repoInfo.name,
              number: prNumber,
            };

            progress.report({
              message: `Getting ${
                includeResolved ? "all" : "unresolved"
              } comments for PR #${prNumber}`,
            });
					
					// Fetch comments from GitHub
					const comments = await githubService.getPullRequestComments(
						repoInfo.owner,
						repoInfo.name,
              prNumber,
              includeResolved
					);
					
					// Update UI
					commentsProvider.refresh(comments);

            // Set PR info in the comments provider
            commentsProvider.setPRInfo(repoInfo.owner, repoInfo.name, prNumber);
					
					return comments;
          }
        );

        vscode.window.showInformationMessage(
          "PR comments fetched successfully."
        );
      } catch (error) {
        if (error instanceof Error) {
          vscode.window.showErrorMessage(
            `Error fetching PR comments: ${error.message}`
          );
        } else {
          vscode.window.showErrorMessage("Unknown error fetching PR comments");
        }
      }
    } else {
      // Use existing PR info for a quicker refresh
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing PR comments...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({
              message: `Getting ${
                includeResolved ? "all" : "unresolved"
              } comments for PR #${currentPRInfo!.number}`,
            });

            // Fetch comments from GitHub
            const comments = await githubService.getPullRequestComments(
              currentPRInfo!.owner,
              currentPRInfo!.repo,
              currentPRInfo!.number,
              includeResolved
            );

            // Update UI
            commentsProvider.refresh(comments);

            // Set PR info in the comments provider
            if (currentPRInfo) {
              commentsProvider.setPRInfo(
                currentPRInfo.owner,
                currentPRInfo.repo,
                currentPRInfo.number
              );
            }

            return comments;
          }
        );
        vscode.window.showInformationMessage(
          "PR comments refreshed successfully."
        );
			} catch (error) {
				if (error instanceof Error) {
          vscode.window.showErrorMessage(
            `Error refreshing PR comments: ${error.message}`
          );
				} else {
          vscode.window.showErrorMessage(
            "Unknown error refreshing PR comments"
          );
        }
      }
    }
  }

  // Register commands
  console.log("Registering commands...");

  // Register the setGitHubToken command directly first to ensure it's available
  const setGitHubTokenCommand = vscode.commands.registerCommand(
    "gittron.setGitHubToken",
    async () => {
      console.log("Set GitHub Token command executed");
      const token = await vscode.window.showInputBox({
        prompt: "Enter your GitHub Personal Access Token",
        password: true,
        placeHolder: "GitHub token with repo permissions",
      });

      if (token) {
        githubService.setToken(token);
        vscode.window.showInformationMessage("GitHub token has been set.");
      }
    }
  );

  // Add the command to context.subscriptions
  context.subscriptions.push(setGitHubTokenCommand);
  console.log("Set GitHub Token command registered");

  const commands = [
    vscode.commands.registerCommand("gittron.helloWorld", () => {
      console.log("Hello World command executed");
      vscode.window.showInformationMessage("Hello World from Gittron!");
    }),

    vscode.commands.registerCommand("gittron.fetchPRComments", async () => {
      console.log("Fetch PR Comments command executed");
      // Use the enhanced refreshComments with forceNewPR=true
      await refreshComments(false, true);
    }),

    vscode.commands.registerCommand(
      "gittron.copyAsAgentInstruction",
      async () => {
        console.log("Copy as Agent Instruction command executed");

        if (!activeComment || !activeCommentLine) {
          vscode.window.showWarningMessage(
            "No active comment or code line to copy"
          );
          return;
        }

        try {
          // Format the instruction text
          const instruction = `Code: 
\`\`\`
${activeCommentLine.trim()}
\`\`\`

Comment by @${activeComment.user.login}:
${activeComment.body}

Instructions:

`;

          // Copy to clipboard
          await vscode.env.clipboard.writeText(instruction);
          vscode.window.showInformationMessage(
            "Agent instruction copied to clipboard"
          );
        } catch (error) {
          console.error("Error copying to clipboard:", error);
          vscode.window.showErrorMessage("Failed to copy to clipboard");
        }
      }
    ),

    vscode.commands.registerCommand("gittron.addToAIChat", async () => {
      console.log("Add to AI Chat command executed");

      if (!activeComment || !activeCommentLine) {
        vscode.window.showWarningMessage(
          "No active comment or code line to add to AI chat"
        );
        return;
      }

      try {
        // Format the instruction text
        const instruction = `Code: 
\`\`\`
${activeCommentLine.trim()}
\`\`\`

Comment by @${activeComment.user.login}:
${activeComment.body}

Instructions:

`;

        console.log("Adding to AI Chat...");
        const originalClipboard = await vscode.env.clipboard.readText();
        console.log("Original clipboard saved");
        console.log("Opening new chat...");
        await vscode.commands.executeCommand("composer.newAgentChat");
        console.log("Waiting for chat window...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        console.log("Setting clipboard with task description:", instruction);
        await vscode.env.clipboard.writeText(instruction);
        console.log("Pasting content...");
        await vscode.commands.executeCommand(
          "editor.action.clipboardPasteAction"
        );
        console.log("Restoring original clipboard");
        await vscode.env.clipboard.writeText(originalClipboard);
        console.log("Add to AI Chat complete");

        vscode.window.showInformationMessage("Comment added to AI chat");
      } catch (error) {
        console.error("Error adding to AI chat:", error);
        vscode.window.showErrorMessage(
          "Failed to add to AI chat. Make sure Cursor AI chat is available."
        );
      }
    }),

    vscode.commands.registerCommand(
      "gittron.toggleResolvedComments",
      async () => {
        console.log("Toggle Resolved Comments command executed");

        if (!currentPRInfo) {
          vscode.window.showWarningMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        // Get current configuration
        const config = vscode.workspace.getConfiguration("gittron");
        const includeResolved = config.get("includeResolvedComments", false);

        // Toggle the setting
        await config.update(
          "includeResolvedComments",
          !includeResolved,
          vscode.ConfigurationTarget.Global
        );

        // Refresh comments with new setting
        await refreshComments(!includeResolved);

        vscode.window.showInformationMessage(
          `Now showing ${!includeResolved ? "all" : "only unresolved"} comments`
        );
      }
    ),

    vscode.commands.registerCommand("gittron.refreshComments", async () => {
      console.log("Refresh Comments command executed");

      // Get current configuration
      const config = vscode.workspace.getConfiguration("gittron");
      const includeResolved = config.get("includeResolvedComments", false);

      // Check if there's a PR already loaded
      if (!currentPRInfo) {
        // If no PR loaded, treat like fetchPRComments
        await refreshComments(includeResolved, true);
      } else {
        // Refresh existing PR
        await refreshComments(includeResolved);
      }
    }),

    vscode.commands.registerCommand(
      "gittron.handleComment",
      async (comment: PullRequestComment) => {
        console.log(
          "Handle Comment command executed with data:",
          JSON.stringify(
            {
              id: comment.id,
              user: comment.user.login,
              path: comment.path,
              line: comment.line,
              position: comment.position,
              bodyLength: comment.body.length,
              firstLineOfBody: comment.body.split("\n")[0],
            },
            null,
            2
          )
        );

        // Clear any existing decoration
        if (activeCommentDecoration) {
          activeCommentDecoration.dispose();
          activeCommentDecoration = undefined;
        }

        // Set the active comment for the hover provider
        activeComment = comment;

        if (comment.path && (comment.line || comment.position)) {
          console.log(
            `Opening file comment at ${comment.path}:${
              comment.line || comment.position
            }`
          );
          // This is a file comment, open the file at the correct line
          try {
            // Find the workspace folder
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
              throw new Error("No workspace folder open");
            }

            // Try to find the file in different ways
            let fileUri: vscode.Uri | undefined;
            let document: vscode.TextDocument | undefined;

            // Try the direct path first
            try {
              fileUri = vscode.Uri.joinPath(workspaceFolder.uri, comment.path);
              console.log(
                "Attempting to open file at URI:",
                fileUri.toString()
              );
              await vscode.workspace.fs.stat(fileUri);
              console.log("File exists at direct path:", comment.path);
              document = await vscode.workspace.openTextDocument(fileUri);
            } catch (err) {
              console.log(
                "Could not find file at direct path, trying to search for filename..."
              );

              // If direct path fails, try to search for the file by name
              const fileName = comment.path.split("/").pop() || "";
              if (fileName) {
                console.log("Searching for file by name:", fileName);
                const files = await vscode.workspace.findFiles(
                  `**/${fileName}`,
                  "**/node_modules/**",
                  5
                );
                if (files.length > 0) {
                  console.log(
                    "Found file matches:",
                    files.map((f) => f.toString()).join(", ")
                  );
                  fileUri = files[0];
                  document = await vscode.workspace.openTextDocument(fileUri);
                } else {
                  throw new Error(
                    `File ${fileName} not found in the workspace`
                  );
                }
              }
            }

            if (!document) {
              throw new Error(`Could not open document for ${comment.path}`);
            }

            // Open the document in the editor
            const editor = await vscode.window.showTextDocument(document);

            // Line numbers in GitHub API are 1-based, VS Code is 0-based
            const lineNumber = (comment.line || comment.position || 1) - 1;
            console.log("Navigating to line number:", lineNumber);

            // Make sure the line number is valid
            const lineCount = document.lineCount;
            const targetLine = Math.min(lineNumber, lineCount - 1);
            if (targetLine !== lineNumber) {
              console.log(
                `Adjusted line number from ${lineNumber} to ${targetLine} (document has ${lineCount} lines)`
              );
            }

            // Position at the beginning of the line
            const position = new vscode.Position(targetLine, 0);

            // Move cursor to the line and show it
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );

            // Store the line of code for the copy command
            activeCommentLine = document.lineAt(targetLine).text;

            // Apply decoration to highlight the line
            const range = new vscode.Range(
              new vscode.Position(targetLine, 0),
              new vscode.Position(
                targetLine,
                document.lineAt(targetLine).text.length
              )
            );

            activeCommentDecoration = commentDecoration;
            editor.setDecorations(commentDecoration, [range]);

            // Simulate hovering to show the comment immediately
            setTimeout(() => {
              vscode.commands.executeCommand("editor.action.showHover");
            }, 500);
          } catch (error) {
            console.error("Error opening file:", error);

            // Fallback to showing comment in a new tab
            const doc = await vscode.workspace.openTextDocument({
              content: `# Comment by @${comment.user.login} on ${
                comment.path
              }:${comment.line || comment.position}\n\n${
                comment.body
              }\n\n[View on GitHub](${comment.html_url})`,
              language: "markdown",
            });

            await vscode.window.showTextDocument(doc);
          }
        } else {
          console.log("Opening general PR comment (not file-specific)");
          // This is a general PR comment (not on a specific line), show in a new tab
			const doc = await vscode.workspace.openTextDocument({
            content: `# Comment by @${comment.user.login}\n\n${comment.body}\n\n[View on GitHub](${comment.html_url})`,
            language: "markdown",
			});
			
			await vscode.window.showTextDocument(doc);
        }
      }
    ),
	];
	
	// Register contribution points
  context.subscriptions.push(...commands, commentsTreeView);
	
	// Register views
	context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gittronComments", commentsProvider)
  );

  // Log all registered commands for debugging
  vscode.commands.getCommands(true).then((commands) => {
    console.log("All registered commands:");
    commands
      .filter((cmd) => cmd.startsWith("gittron."))
      .forEach((cmd) => {
        console.log(`- ${cmd}`);
      });
  });
}

// This method is called when your extension is deactivated
export function deactivate() {
  // Dispose of any active decorations
  if (activeCommentDecoration) {
    activeCommentDecoration.dispose();
    activeCommentDecoration = undefined;
  }
}
