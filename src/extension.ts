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

// Store review mode state
let isReviewModeActive = false;
let currentReviewIndex = 0;

export function activate(context: vscode.ExtensionContext) {
  const githubService = new GitHubService();
  const gitService = new GitService();
  const commentsProvider = new CommentsProvider();
  const commentsTreeView = vscode.window.createTreeView("gittronComments", {
    treeDataProvider: commentsProvider,
    showCollapseAll: true,
  });

  // Helper function to show a specific thread during review
  async function showThreadAtIndex(index: number, threadArray: [string, PullRequestComment[]][]) {
    const [threadId, comments] = threadArray[index];
    const firstComment = comments[0];
    
    // Use the existing comment handling logic to show the thread
    await vscode.commands.executeCommand("gittron.handleComment", firstComment);
    
    // Focus the comments view
    await vscode.commands.executeCommand('gittronComments.focus');
    
    // Reveal the comment in the tree view
    const treeItem = commentsProvider.findTreeItem(firstComment);
    if (treeItem) {
      await commentsTreeView.reveal(treeItem, { select: true, focus: true });
    }
  }

  // Set up context for command visibility
  vscode.commands.executeCommand('setContext', 'gittron:hasComments', false);
  vscode.commands.executeCommand('setContext', 'gittron:isReviewMode', false);

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
      const targetLine = (activeComment.line || activeComment.position || 1) - 1;

      if (lineNumber === targetLine) {
        // Store the current line of code for the copy command
        activeCommentLine = document.lineAt(lineNumber).text;

        // Create markdown content for the hover
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // If this comment is part of a thread, find all related comments
        if (activeComment.threadId) {
          const threadComments = commentsProvider.getCommentsInThread(activeComment.threadId)
            .sort((a: PullRequestComment, b: PullRequestComment) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

          // Add thread summary
          markdown.appendMarkdown(`**Discussion Thread (${threadComments.length} comments)**\n\n`);

          // Add each comment in the thread
          threadComments.forEach((comment: PullRequestComment, index: number) => {
            // Add separator between comments
            if (index > 0) {
              markdown.appendMarkdown('\n\n---\n\n');
            }

            // Add comment header with author and timestamp
            const date = new Date(comment.created_at);
            const timeString = date.toLocaleString();
            markdown.appendMarkdown(
              `**[@${comment.user.login}](${comment.html_url})** · ${timeString}\n\n`
            );

            // Add comment body
            markdown.appendMarkdown(`${comment.body}\n\n`);
            markdown.appendMarkdown(
              `<a href="command:gittron.addToAIChat?${encodeURIComponent(JSON.stringify([comment]))}">💬 Add to Chat</a>`
            );
            markdown.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;`);
            markdown.appendMarkdown(
              `<a href="command:gittron.replyToCommentFromHover?${encodeURIComponent(JSON.stringify([comment]))}">↩️ Reply</a>`
            );
            markdown.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;`);
            if (index === threadComments.length - 1) {
              markdown.appendMarkdown(
                `<a href="command:gittron.resolveCommentFromHover?${encodeURIComponent(JSON.stringify([comment]))}">✅ Resolve</a>`
              );
            }
          });

          // Add a reply button at the bottom of the thread
          markdown.appendMarkdown('\n\n---\n\n');
          markdown.appendMarkdown(
            `<a href="command:gittron.replyToCommentFromHover">💬 Reply to Thread</a>`
          );
          markdown.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;`);
          markdown.appendMarkdown(
            `<a href="command:gittron.resolveCommentFromHover">✅ Resolve Thread</a>`
          );
        } else {
          // Single comment view
          markdown.appendMarkdown(
            `**Comment by [@${activeComment.user.login}](${activeComment.html_url})**\n\n`
          );
          markdown.appendMarkdown(activeComment.body);

          // Add action buttons
          markdown.appendMarkdown('\n\n---\n\n');
          markdown.appendMarkdown(
            `  <a href="command:gittron.addToAIChat">💬 Add to Chat</a>`
          );
          markdown.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;`);
          markdown.appendMarkdown(
            `<a href="command:gittron.replyToCommentFromHover">↩️ Reply</a>`
          );
          markdown.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;`);
          markdown.appendMarkdown(
            `<a href="command:gittron.resolveCommentFromHover">✅ Resolve</a>`
          );
        }

        return new vscode.Hover(markdown);
      }

      return null;
    },
  });

  // Register the hover provider
  context.subscriptions.push(hoverProvider);

  // Add Git repository watcher
  let currentBranch: string | undefined;
  
  async function watchRepository() {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return;
      }

      // Subscribe to Git extension activation
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        return;
      }

      // Ensure Git extension is activated
      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      const git = gitExtension.exports.getAPI(1);
      
      interface Repository {
        state: {
          HEAD?: {
            name?: string;
          };
          onDidChange: (listener: () => void) => vscode.Disposable;
        };
      }

      // Function to handle repository state changes
      const handleRepositoryChange = async (repository: Repository) => {
        const newBranch = repository.state.HEAD?.name;
        if (newBranch && newBranch !== currentBranch) {
          currentBranch = newBranch;
          // Add a small delay to ensure Git operations are complete
          setTimeout(async () => {
            await refreshComments(true);
          }, 1000);
        }
      };

      // Watch for repository changes
      const disposables: vscode.Disposable[] = [];

      // Handle initial repositories
      for (const repository of git.repositories) {
        currentBranch = repository.state.HEAD?.name;
        disposables.push(repository.state.onDidChange(() => handleRepositoryChange(repository)));
      }

      // Watch for new repositories
      disposables.push(git.onDidOpenRepository((repository: Repository) => {
        currentBranch = repository.state.HEAD?.name;
        disposables.push(repository.state.onDidChange(() => handleRepositoryChange(repository)));
      }));

      // Add disposables to context subscriptions
      context.subscriptions.push(...disposables);

    } catch (error) {
      console.error('Error setting up repository watcher:', error);
    }
  }

  // Start watching repository for changes
  watchRepository();

  // Automatically fetch comments on extension activation with delay to avoid race conditions
  // Wait a bit to ensure Git extension is fully initialized
  setTimeout(async () => {
    try {
      await refreshComments(true);
    } catch (error) {
      // Only show error if it's not related to missing PR or Git initialization issues
      if (error instanceof Error && 
          !error.message.includes("Could not determine PR number") &&
          !error.message.includes("No Git repository found") &&
          !error.message.includes("Git extension not found")) {
        vscode.window.showErrorMessage(
          `Error fetching PR comments: ${error.message}`
        );
      }
    }
  }, 2000); // 2 second delay to allow Git extension to initialize

  // Helper function to refresh PR comments
  async function refreshComments(forceNewPR: boolean = false): Promise<void> {
    if (!currentPRInfo || forceNewPR) {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: "Checking for PR comments...",
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
              // If no PR is found, clear everything
              currentPRInfo = undefined;
              commentsProvider.clear();
              vscode.commands.executeCommand('setContext', 'gittron:hasComments', false);
              return;
            }

            // If no PR number was found, clear everything
            if (!prNumber) {
              currentPRInfo = undefined;
              commentsProvider.clear();
              vscode.commands.executeCommand('setContext', 'gittron:hasComments', false);
              return;
            }

            currentPRInfo = {
              owner: repoInfo.owner,
              repo: repoInfo.name,
              number: prNumber,
            };

            progress.report({
              message: `Getting comments for PR #${prNumber}`,
            });

            const comments = await githubService.getPullRequestComments(
              repoInfo.owner,
              repoInfo.name,
              prNumber
            );

            commentsProvider.refresh(comments);
            commentsProvider.setPRInfo(repoInfo.owner, repoInfo.name, prNumber);
            
            // Update context based on whether there are comments
            vscode.commands.executeCommand('setContext', 'gittron:hasComments', comments.length > 0);

            // Only show notification if comments were found
            if (comments.length > 0) {
              const unresolvedCount = comments.filter(c => !c.resolved).length;
              if (unresolvedCount > 0) {
                vscode.window.showInformationMessage(
                  `Found ${unresolvedCount} unresolved comment${unresolvedCount === 1 ? '' : 's'} in PR #${prNumber}`
                );
              }
            }

            return comments;
          }
        );
      } catch (error) {
        // Only show error if it's not related to missing PR or Git initialization issues
        if (error instanceof Error && 
            !error.message.includes("Could not determine PR number") &&
            !error.message.includes("No Git repository found") &&
            !error.message.includes("Git extension not found")) {
          vscode.window.showErrorMessage(
            `Error fetching PR comments: ${error.message}`
          );
        }
      }
    } else {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: "Refreshing PR comments...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({
              message: `Getting comments for PR #${currentPRInfo!.number}`,
            });

            const comments = await githubService.getPullRequestComments(
              currentPRInfo!.owner,
              currentPRInfo!.repo,
              currentPRInfo!.number
            );

            commentsProvider.refresh(comments);
            
            // Update context based on whether there are comments
            vscode.commands.executeCommand('setContext', 'gittron:hasComments', comments.length > 0);

            // Only show notification if new unresolved comments were found
            const unresolvedCount = comments.filter(c => !c.resolved).length;
            if (unresolvedCount > 0) {
              vscode.window.showInformationMessage(
                `Found ${unresolvedCount} unresolved comment${unresolvedCount === 1 ? '' : 's'} in PR #${currentPRInfo!.number}`
              );
            }

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
      async (comment?: PullRequestComment) => {
        const targetComment = comment || activeComment;
        if (!targetComment || !activeCommentLine) {
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

Comment by @${targetComment.user.login}:
${targetComment.body}
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

    vscode.commands.registerCommand(
      "gittron.addToAIChat",
      async (comment?: PullRequestComment) => {
        const targetComment = comment || activeComment;
        if (!targetComment || !activeCommentLine) {
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

Comment by @${targetComment.user.login}:
${targetComment.body}
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
      }
    ),

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
        // Clear any existing decorations
        if (activeCommentDecoration) {
          activeCommentDecoration.dispose();
          activeCommentDecoration = undefined;
        }

        // Reset active comment and line
        activeComment = comment;
        activeCommentLine = undefined;

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

            // Create a new decoration type for each comment to ensure proper updating
            activeCommentDecoration = vscode.window.createTextEditorDecorationType({
              backgroundColor: new vscode.ThemeColor(
                "editor.findMatchHighlightBackground"
              ),
              isWholeLine: true,
              overviewRulerColor: new vscode.ThemeColor(
                "editorOverviewRuler.findMatchForeground"
              ),
              overviewRulerLane: vscode.OverviewRulerLane.Right,
            });

            editor.setDecorations(activeCommentDecoration, [range]);

            // Force the hover provider to update
            setTimeout(() => {
              vscode.commands.executeCommand("editor.action.showHover");
            }, 100);
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
      async (comment?: PullRequestComment) => {
        const targetComment = comment || activeComment;
        if (!targetComment) {
          vscode.window.showErrorMessage("No active comment to resolve");
          return;
        }

        if (!currentPRInfo) {
          vscode.window.showErrorMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Resolving comment by @${targetComment.user.login}...`,
              cancellable: false,
            },
            async (progress) => {
              const success = await githubService.resolveCommentThread(
                currentPRInfo!.owner,
                currentPRInfo!.repo,
                currentPRInfo!.number,
                targetComment.id
              );

              if (success) {
                vscode.window.showInformationMessage(
                  `Comment by @${targetComment.user.login} has been resolved`
                );

                if (targetComment === activeComment) {
                  activeComment = undefined;
                  if (activeCommentDecoration) {
                    activeCommentDecoration.dispose();
                    activeCommentDecoration = undefined;
                  }
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
      async (comment?: PullRequestComment) => {
        const targetComment = comment || activeComment;
        if (!targetComment) {
          vscode.window.showErrorMessage("No active comment to reply to");
          return;
        }

        if (!currentPRInfo) {
          vscode.window.showErrorMessage(
            "No PR information available. Please fetch PR comments first."
          );
          return;
        }

        const replyText = await vscode.window.showInputBox({
          prompt: `Reply to comment by @${targetComment.user.login}`,
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
              title: `Replying to comment by @${targetComment.user.login}...`,
              cancellable: false,
            },
            async (progress) => {
              const replyComment = await githubService.replyToComment(
                currentPRInfo!.owner,
                currentPRInfo!.repo,
                currentPRInfo!.number,
                targetComment.id,
                replyText.trim()
              );

              if (replyComment) {
                vscode.window.showInformationMessage(
                  `Reply posted to comment by @${targetComment.user.login}`
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

    vscode.commands.registerCommand("gittron.startReviewMode", async () => {
      if (!currentPRInfo) {
        vscode.window.showErrorMessage(
          "No PR information available. Please fetch PR comments first."
        );
        return;
      }

      // Get all unresolved threads
      const threads = new Map<string, PullRequestComment[]>();
      for (const comment of commentsProvider.getAllComments()) {
        if (comment.threadId && !comment.resolved) {
          const thread = threads.get(comment.threadId) || [];
          thread.push(comment);
          threads.set(comment.threadId, thread);
        }
      }

      const threadArray = Array.from(threads.entries());
      if (threadArray.length === 0) {
        vscode.window.showInformationMessage("No unresolved comment threads to review.");
        return;
      }

      // Start review mode
      isReviewModeActive = true;
      currentReviewIndex = 0;
      vscode.commands.executeCommand('setContext', 'gittron:isReviewMode', true);

      // Show review mode status bar item
      const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
      );
      statusBarItem.text = `$(comment-discussion) Review Mode: Thread ${currentReviewIndex + 1}/${threadArray.length}`;
      statusBarItem.tooltip = "Click to exit review mode";
      statusBarItem.command = 'gittron.exitReviewMode';
      statusBarItem.show();

      // Create quick pick items for navigation
      const navigationButtons = [
        {
          label: "$(arrow-right) Next Thread",
          description: "Move to the next comment thread",
          action: "next"
        },
        {
          label: "$(arrow-left) Previous Thread",
          description: "Move to the previous comment thread",
          action: "previous"
        },
        {
          label: "$(check) Resolve Current Thread",
          description: "Resolve the current thread and move to next",
          action: "resolve"
        },
        {
          label: "$(reply) Reply to Thread",
          description: "Add a reply to the current thread",
          action: "reply"
        },
        {
          label: "$(close) Exit Review Mode",
          description: "Exit the review mode",
          action: "exit"
        }
      ];

      // Show the first thread
      await showThreadAtIndex(0, threadArray);

      // Show the navigation quick pick
      while (isReviewModeActive) {
        const selection = await vscode.window.showQuickPick(navigationButtons, {
          placeHolder: `Reviewing thread ${currentReviewIndex + 1} of ${threadArray.length}`,
        });

        if (!selection) {
          continue;
        }

        switch (selection.action) {
          case "next":
            if (currentReviewIndex < threadArray.length - 1) {
              currentReviewIndex++;
              await showThreadAtIndex(currentReviewIndex, threadArray);
              statusBarItem.text = `$(comment-discussion) Review Mode: Thread ${currentReviewIndex + 1}/${threadArray.length}`;
            } else {
              vscode.window.showInformationMessage("This is the last thread.");
            }
            break;

          case "previous":
            if (currentReviewIndex > 0) {
              currentReviewIndex--;
              await showThreadAtIndex(currentReviewIndex, threadArray);
              statusBarItem.text = `$(comment-discussion) Review Mode: Thread ${currentReviewIndex + 1}/${threadArray.length}`;
            } else {
              vscode.window.showInformationMessage("This is the first thread.");
            }
            break;

          case "resolve":
            const [threadId, comments] = threadArray[currentReviewIndex];
            const firstComment = comments[0];
            await vscode.commands.executeCommand("gittron.resolveCommentFromHover", firstComment);
            
            // Refresh the thread array after resolution
            threads.clear();
            for (const comment of commentsProvider.getAllComments()) {
              if (comment.threadId && !comment.resolved) {
                const thread = threads.get(comment.threadId) || [];
                thread.push(comment);
                threads.set(comment.threadId, thread);
              }
            }
            
            const newThreadArray = Array.from(threads.entries());
            if (newThreadArray.length === 0) {
              vscode.window.showInformationMessage("All threads have been resolved! 🎉");
              isReviewModeActive = false;
              statusBarItem.dispose();
              vscode.commands.executeCommand('setContext', 'gittron:isReviewMode', false);
              break;
            }

            // Adjust current index if needed
            currentReviewIndex = Math.min(currentReviewIndex, newThreadArray.length - 1);
            await showThreadAtIndex(currentReviewIndex, newThreadArray);
            statusBarItem.text = `$(comment-discussion) Review Mode: Thread ${currentReviewIndex + 1}/${newThreadArray.length}`;
            break;

          case "reply":
            await vscode.commands.executeCommand("gittron.replyToCommentFromHover", threadArray[currentReviewIndex][1][0]);
            break;

          case "exit":
            isReviewModeActive = false;
            statusBarItem.dispose();
            vscode.commands.executeCommand('setContext', 'gittron:isReviewMode', false);
            vscode.window.showInformationMessage("Exited review mode.");
            break;
        }
      }
    }),

    vscode.commands.registerCommand("gittron.exitReviewMode", () => {
      isReviewModeActive = false;
      vscode.commands.executeCommand('setContext', 'gittron:isReviewMode', false);
      vscode.window.showInformationMessage("Exited review mode.");
    })
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
