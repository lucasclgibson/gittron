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
  const githubService = new GitHubService();
  const gitService = new GitService();
  const commentsProvider = new CommentsProvider();
  const commentsTreeView = vscode.window.createTreeView("gittronComments", {
    treeDataProvider: commentsProvider,
    showCollapseAll: true,
  });

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
          `\n\n<a href="command:gittron.copyAsAgentInstruction">📋 Copy Instruction</a>`
        );

        // Add button to add to AI chat
        markdown.appendMarkdown(
          `  <a href="command:gittron.addToAIChat">💬 Add to Chat</a>`
        );

        // Add button to reply to comment
        markdown.appendMarkdown(
          `  <a href="command:gittron.replyToCommentFromHover">💬 Reply</a>`
        );

        // Add button to resolve comment
        markdown.appendMarkdown(
          `  <a href="command:gittron.resolveCommentFromHover">✅ Resolve</a>`
        );

        return new vscode.Hover(markdown);
      }

      return null;
    },
  });

  // Register the hover provider
  context.subscriptions.push(hoverProvider);

  // Helper function to refresh PR comments
  async function refreshComments(forceNewPR: boolean = false): Promise<void> {
    if (!currentPRInfo || forceNewPR) {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Fetching PR comments...",
            cancellable: false,
          },
          async (progress) => {
            const repoInfo = await gitService.getRepositoryInfo();
            progress.report({
              message: `Detected repository: ${repoInfo.owner}/${repoInfo.name}`,
            });

            let prNumber: number | null = null;
            try {
              prNumber = await gitService.getCurrentPullRequest();
            } catch (error) {
              if (error instanceof Error) {
                vscode.window.showErrorMessage(`${error.message}`);
              }

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

            currentPRInfo = {
              owner: repoInfo.owner,
              repo: repoInfo.name,
              number: prNumber,
            };

            progress.report({
              message: `Getting unresolved comments for PR #${prNumber}`,
            });

            const comments = await githubService.getPullRequestComments(
              repoInfo.owner,
              repoInfo.name,
              prNumber
            );

            commentsProvider.refresh(comments);
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
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing PR comments...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({
              message: `Getting unresolved comments for PR #${
                currentPRInfo!.number
              }`,
            });

            const comments = await githubService.getPullRequestComments(
              currentPRInfo!.owner,
              currentPRInfo!.repo,
              currentPRInfo!.number
            );

            commentsProvider.refresh(comments);

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
  const setGitHubTokenCommand = vscode.commands.registerCommand(
    "gittron.setGitHubToken",
    async () => {
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

  context.subscriptions.push(setGitHubTokenCommand);

  const commands = [
    vscode.commands.registerCommand("gittron.fetchPRComments", async () => {
      await refreshComments(true);
    }),

    vscode.commands.registerCommand(
      "gittron.copyAsAgentInstruction",
      async () => {
        if (!activeComment || !activeCommentLine) {
          vscode.window.showWarningMessage(
            "No active comment or code line to copy"
          );
          return;
        }

        try {
          const instruction = `Code: 
\`\`\`
${activeCommentLine.trim()}
\`\`\`

Comment by @${activeComment.user.login}:
${activeComment.body}
`;

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
      if (!activeComment || !activeCommentLine) {
        vscode.window.showWarningMessage(
          "No active comment or code line to add to AI chat"
        );
        return;
      }

      try {
        const instruction = `Code: 
\`\`\`
${activeCommentLine.trim()}
\`\`\`

Comment by @${activeComment.user.login}:
${activeComment.body}
`;

        const originalClipboard = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand("composer.newAgentChat");
        await new Promise((resolve) => setTimeout(resolve, 500));
        await vscode.env.clipboard.writeText(instruction);
        await vscode.commands.executeCommand(
          "editor.action.clipboardPasteAction"
        );
        await vscode.env.clipboard.writeText(originalClipboard);

        vscode.window.showInformationMessage("Comment added to AI chat");
      } catch (error) {
        console.error("Error adding to AI chat:", error);
        vscode.window.showErrorMessage(
          "Failed to add to AI chat. Make sure Cursor AI chat is available."
        );
      }
    }),

    vscode.commands.registerCommand("gittron.refreshComments", async () => {
      if (!currentPRInfo) {
        await refreshComments(true);
      } else {
        await refreshComments();
      }
    }),

    vscode.commands.registerCommand(
      "gittron.handleComment",
      async (comment: PullRequestComment) => {
        if (activeCommentDecoration) {
          activeCommentDecoration.dispose();
          activeCommentDecoration = undefined;
        }

        activeComment = comment;

        if (comment.path && (comment.line || comment.position)) {
          try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
              throw new Error("No workspace folder open");
            }

            let fileUri: vscode.Uri | undefined;
            let document: vscode.TextDocument | undefined;

            try {
              fileUri = vscode.Uri.joinPath(workspaceFolder.uri, comment.path);
              await vscode.workspace.fs.stat(fileUri);
              document = await vscode.workspace.openTextDocument(fileUri);
            } catch (err) {
              const fileName = comment.path.split("/").pop() || "";
              if (fileName) {
                const files = await vscode.workspace.findFiles(
                  `**/${fileName}`,
                  "**/node_modules/**",
                  5
                );
                if (files.length > 0) {
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

            const editor = await vscode.window.showTextDocument(document);
            const lineNumber = (comment.line || comment.position || 1) - 1;
            const lineCount = document.lineCount;
            const targetLine = Math.min(lineNumber, lineCount - 1);

            const position = new vscode.Position(targetLine, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter
            );

            activeCommentLine = document.lineAt(targetLine).text;

            const range = new vscode.Range(
              new vscode.Position(targetLine, 0),
              new vscode.Position(
                targetLine,
                document.lineAt(targetLine).text.length
              )
            );

            activeCommentDecoration = commentDecoration;
            editor.setDecorations(commentDecoration, [range]);

            setTimeout(() => {
              vscode.commands.executeCommand("editor.action.showHover");
            }, 500);
          } catch (error) {
            console.error("Error opening file:", error);

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
          const doc = await vscode.workspace.openTextDocument({
            content: `# Comment by @${comment.user.login}\n\n${comment.body}\n\n[View on GitHub](${comment.html_url})`,
            language: "markdown",
          });

          await vscode.window.showTextDocument(doc);
        }
      }
    ),

    vscode.commands.registerCommand(
      "gittron.resolveComment",
      async (commentItem: CommentItem) => {
        if (!commentItem || !commentItem.comment) {
          vscode.window.showErrorMessage("No comment selected to resolve");
          return;
        }

        if (!currentPRInfo) {
          vscode.window.showErrorMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        const comment = commentItem.comment;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Resolving comment by @${comment.user.login}...`,
              cancellable: false,
            },
            async (progress) => {
              const success = await githubService.resolveCommentThread(
                currentPRInfo!.owner,
                currentPRInfo!.repo,
                currentPRInfo!.number,
                comment.id
              );

              if (success) {
                vscode.window.showInformationMessage(
                  `Comment by @${comment.user.login} has been resolved`
                );

                progress.report({ message: "Refreshing comments..." });
                await refreshComments();
              } else {
                throw new Error("Failed to resolve comment thread");
              }
            }
          );
        } catch (error) {
          console.error("Error resolving comment:", error);
          if (error instanceof Error) {
            vscode.window.showErrorMessage(
              `Error resolving comment: ${error.message}`
            );
          } else {
            vscode.window.showErrorMessage("Unknown error resolving comment");
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      "gittron.resolveCommentFromHover",
      async () => {
        if (!activeComment) {
          vscode.window.showErrorMessage("No active comment to resolve");
          return;
        }

        if (!currentPRInfo) {
          vscode.window.showErrorMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        const comment = activeComment;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Resolving comment by @${comment.user.login}...`,
              cancellable: false,
            },
            async (progress) => {
              const success = await githubService.resolveCommentThread(
                currentPRInfo!.owner,
                currentPRInfo!.repo,
                currentPRInfo!.number,
                comment.id
              );

              if (success) {
                vscode.window.showInformationMessage(
                  `Comment by @${comment.user.login} has been resolved`
                );

                activeComment = undefined;
                if (activeCommentDecoration) {
                  activeCommentDecoration.dispose();
                  activeCommentDecoration = undefined;
                }

                progress.report({ message: "Refreshing comments..." });
                await refreshComments();
              } else {
                throw new Error("Failed to resolve comment thread");
              }
            }
          );
        } catch (error) {
          console.error("Error resolving comment from hover:", error);
          if (error instanceof Error) {
            vscode.window.showErrorMessage(
              `Error resolving comment: ${error.message}`
            );
          } else {
            vscode.window.showErrorMessage("Unknown error resolving comment");
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      "gittron.replyToComment",
      async (commentItem: CommentItem) => {
        if (!commentItem || !commentItem.comment) {
          vscode.window.showErrorMessage("No comment selected to reply to");
          return;
        }

        if (!currentPRInfo) {
          vscode.window.showErrorMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        const comment = commentItem.comment;

        const replyText = await vscode.window.showInputBox({
          prompt: `Reply to comment by @${comment.user.login}`,
          placeHolder: "Enter your reply...",
          validateInput: (input) => {
            return input.trim().length === 0 ? "Reply cannot be empty" : null;
          },
        });

        if (!replyText) {
          return;
        }

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Replying to comment by @${comment.user.login}...`,
              cancellable: false,
            },
            async (progress) => {
              const replyComment = await githubService.replyToComment(
                currentPRInfo!.owner,
                currentPRInfo!.repo,
                currentPRInfo!.number,
                comment.id,
                replyText.trim()
              );

              if (replyComment) {
                vscode.window.showInformationMessage(
                  `Reply posted to comment by @${comment.user.login}`
                );

                progress.report({ message: "Refreshing comments..." });
                await refreshComments();
              } else {
                throw new Error("Failed to post reply");
              }
            }
          );
        } catch (error) {
          console.error("Error replying to comment:", error);
          if (error instanceof Error) {
            vscode.window.showErrorMessage(
              `Error replying to comment: ${error.message}`
            );
          } else {
            vscode.window.showErrorMessage("Unknown error replying to comment");
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      "gittron.replyToCommentFromHover",
      async () => {
        if (!activeComment) {
          vscode.window.showErrorMessage("No active comment to reply to");
          return;
        }

        if (!currentPRInfo) {
          vscode.window.showErrorMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        const comment = activeComment;

        const replyText = await vscode.window.showInputBox({
          prompt: `Reply to comment by @${comment.user.login}`,
          placeHolder: "Enter your reply...",
          validateInput: (input) => {
            return input.trim().length === 0 ? "Reply cannot be empty" : null;
          },
        });

        if (!replyText) {
          return;
        }

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Replying to comment by @${comment.user.login}...`,
              cancellable: false,
            },
            async (progress) => {
              const replyComment = await githubService.replyToComment(
                currentPRInfo!.owner,
                currentPRInfo!.repo,
                currentPRInfo!.number,
                comment.id,
                replyText.trim()
              );

              if (replyComment) {
                vscode.window.showInformationMessage(
                  `Reply posted to comment by @${comment.user.login}`
                );

                progress.report({ message: "Refreshing comments..." });
                await refreshComments();
              } else {
                throw new Error("Failed to post reply");
              }
            }
          );
        } catch (error) {
          console.error("Error replying to comment from hover:", error);
          if (error instanceof Error) {
            vscode.window.showErrorMessage(
              `Error replying to comment: ${error.message}`
            );
          } else {
            vscode.window.showErrorMessage("Unknown error replying to comment");
          }
        }
      }
    ),
  ];

  context.subscriptions.push(...commands, commentsTreeView);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gittronComments", commentsProvider)
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (activeCommentDecoration) {
    activeCommentDecoration.dispose();
    activeCommentDecoration = undefined;
  }
}
