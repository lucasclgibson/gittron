import * as vscode from 'vscode';
import * as path from 'path';
import { PullRequestComment } from '../services/github';

export class CommentItem extends vscode.TreeItem {
  constructor(
    public readonly comment: PullRequestComment,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(CommentItem.formatTitle(comment), collapsibleState);
    
    // Set tooltip with full comment text
    this.tooltip = `${comment.body}\n\n${comment.resolved ? '✓ Resolved' : '⚠️ Unresolved'} comment by @${comment.user.login}`;
    
    // Format the description based on comment type
    if (comment.path && (comment.line || comment.position)) {
      // File comment - show user, file, and line
      const fileName = path.basename(comment.path);
      const lineInfo = comment.line || comment.position || 0;
      this.description = `@${comment.user.login} · ${fileName}:${lineInfo}`;
      
      // Add file icon for file-specific comments
      this.iconPath = new vscode.ThemeIcon('file-code');
    } else {
      // General PR comment - show just the user and date
    this.description = `@${comment.user.login} - ${new Date(comment.created_at).toLocaleString()}`;
      this.iconPath = new vscode.ThemeIcon('comment');
    }
    
    // Add context value for command registration
    this.contextValue = 'prComment';
    
    // Add metadata as command arguments
    this.command = {
      command: 'gittron.handleComment',
      title: 'Handle Comment',
      arguments: [comment]
    };
  }
  
  private static formatTitle(comment: PullRequestComment): string {
    // For file comments, prefix with file name
    let prefix = '';
    if (comment.path) {
      prefix = `[${path.basename(comment.path)}] `;
    }
    
    // Truncate body if it's too long
    let title = comment.body.split('\n')[0]; // Take first line
    if (title.length > 50) {
      title = `${title.substring(0, 47)}...`;
    }
    
    return prefix + title;
  }
}

export class CommentsProvider implements vscode.TreeDataProvider<CommentItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<CommentItem | undefined | null | void> = new vscode.EventEmitter<CommentItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<CommentItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private comments: PullRequestComment[] = [];
  private prInfo: { owner: string; repo: string; number: number } | undefined;
  
  constructor() {}
  
  setPRInfo(owner: string, repo: string, number: number): void {
    this.prInfo = { owner, repo, number };
  }
  
  refresh(comments: PullRequestComment[]): void {
    // Sort comments:
    // 1. Unresolved comments first (already filtered in the GitHub service)
    // 2. File comments before general PR comments
    // 3. Newest comments first within each group
    this.comments = comments.sort((a, b) => {
      // First, prioritize file comments over general PR comments
      const aHasFile = a.path ? 1 : 0;
      const bHasFile = b.path ? 1 : 0;
      if (aHasFile !== bHasFile) {
        return bHasFile - aHasFile; // File comments first
      }
      
      // If both are the same type, sort by date (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    
    this._onDidChangeTreeData.fire();
    
    // Show status message with summary
    const fileComments = this.comments.filter(c => c.path).length;
    const generalComments = this.comments.length - fileComments;
    const resolvedComments = this.comments.filter(c => c.resolved).length;
    const unresolvedComments = this.comments.length - resolvedComments;
    
    if (this.comments.length === 0) {
      if (this.prInfo) {
        vscode.window.setStatusBarMessage(`PR #${this.prInfo.number}: No file comments found`, 5000);
      } else {
        vscode.window.setStatusBarMessage('No file comments found', 5000);
      }
    } else {
      const prText = this.prInfo ? `PR #${this.prInfo.number}: ` : '';
      vscode.window.setStatusBarMessage(
        `${prText}${this.comments.length} file comments (${unresolvedComments} unresolved, ${resolvedComments} resolved)`,
        8000
      );
    }
  }
  
  clear(): void {
    this.comments = [];
    this.prInfo = undefined;
    this._onDidChangeTreeData.fire();
  }
  
  getTreeItem(element: CommentItem): vscode.TreeItem {
    return element;
  }
  
  getChildren(element?: CommentItem): Thenable<CommentItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    
    // Add a header item if we have PR info
    const items: CommentItem[] = [];
    
    if (this.prInfo && this.comments.length > 0) {
      // Create a header item with PR information
      const headerComment: PullRequestComment = {
        id: -1,
        body: `Pull Request #${this.prInfo.number} in ${this.prInfo.owner}/${this.prInfo.repo}`,
        user: { login: 'system' },
        created_at: new Date().toISOString(),
        html_url: `https://github.com/${this.prInfo.owner}/${this.prInfo.repo}/pull/${this.prInfo.number}`,
        resolved: false
      };
      
      const headerItem = new CommentItem(headerComment, vscode.TreeItemCollapsibleState.None);
      headerItem.description = `${this.comments.length} comments`;
      headerItem.iconPath = new vscode.ThemeIcon('git-pull-request');
      headerItem.command = undefined; // Remove the click action for header
      headerItem.contextValue = 'prHeader';
      
      items.push(headerItem);
    }
    
    // Add all comment items
    items.push(...this.comments.map(comment => new CommentItem(comment, vscode.TreeItemCollapsibleState.None)));
    
    return Promise.resolve(items);
  }
} 