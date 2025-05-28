import * as vscode from 'vscode';
import * as path from 'path';
import { PullRequestComment } from '../services/github';

export class CommentItem extends vscode.TreeItem {
  constructor(
    public readonly comment: PullRequestComment,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isThreadHeader: boolean = false
  ) {
    super(CommentItem.formatTitle(comment, isThreadHeader), collapsibleState);
    
    // Set tooltip with full comment text
    this.tooltip = `${comment.body}\n\n${comment.resolved ? '✓ Resolved' : '⚠️ Unresolved'} comment by @${comment.user.login}`;
    
    // Format the description based on comment type
    if (isThreadHeader && comment.path && (comment.line || comment.position)) {
      // Thread header - show file and line info
      const fileName = path.basename(comment.path);
      const lineInfo = comment.line || comment.position || 0;
      this.description = `${fileName}:${lineInfo} · @${comment.user.login}`;
      this.iconPath = new vscode.ThemeIcon('comment-discussion');
    } else {
      // Regular comment - show user and date
      this.description = `@${comment.user.login} - ${new Date(comment.created_at).toLocaleString()}`;
      this.iconPath = new vscode.ThemeIcon('comment');
    }
    
    // Add context value for command registration
    this.contextValue = isThreadHeader ? 'prThreadHeader' : 'prComment';
    
    // Always make comments clickable to ensure consistent behavior
    this.command = {
      command: 'gittron.handleComment',
      title: 'Handle Comment',
      arguments: [comment]
    };
  }
  
  private static formatTitle(comment: PullRequestComment, isThreadHeader: boolean): string {
    // For both headers and regular comments, show the body
    let title = comment.body.split('\n')[0]; // Take first line
    if (title.length > 50) {
      title = `${title.substring(0, 47)}...`;
    }
    return title;
  }
}

export class CommentsProvider implements vscode.TreeDataProvider<CommentItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<CommentItem | undefined | null | void> = new vscode.EventEmitter<CommentItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<CommentItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private comments: PullRequestComment[] = [];
  private prInfo: { owner: string; repo: string; number: number } | undefined;
  private treeItems: CommentItem[] = [];
  private parentMap = new Map<string, CommentItem>(); // Map to track parent-child relationships
  
  constructor() {}
  
  setPRInfo(owner: string, repo: string, number: number): void {
    this.prInfo = { owner, repo, number };
  }
  
  getAllComments(): PullRequestComment[] {
    return this.comments;
  }
  
  getCommentsInThread(threadId: string): PullRequestComment[] {
    return this.comments.filter(comment => comment.threadId === threadId);
  }
  
  findTreeItem(comment: PullRequestComment): CommentItem | undefined {
    return this.treeItems.find(item => item.comment.id === comment.id);
  }
  
  refresh(comments: PullRequestComment[]): void {
    // Sort comments:
    // 1. Unresolved comments first (already filtered in the GitHub service)
    // 2. File comments before general PR comments
    // 3. Newest threads first
    // 4. Comments within threads in chronological order
    this.comments = comments.sort((a, b) => {
      // First, prioritize file comments over general PR comments
      const aHasFile = a.path ? 1 : 0;
      const bHasFile = b.path ? 1 : 0;
      if (aHasFile !== bHasFile) {
        return bHasFile - aHasFile; // File comments first
      }
      
      // If they're in different threads, sort by thread creation time
      if (a.threadId !== b.threadId) {
        const aFirstComment = comments.find(c => c.threadId === a.threadId && c.isFirstComment);
        const bFirstComment = comments.find(c => c.threadId === b.threadId && c.isFirstComment);
        if (aFirstComment && bFirstComment) {
          return new Date(bFirstComment.created_at).getTime() - new Date(aFirstComment.created_at).getTime();
        }
      }
      
      // Within the same thread, sort chronologically
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    
    this._onDidChangeTreeData.fire();
    
    // Show status message with summary
    const fileComments = this.comments.filter(c => c.path).length;
    const generalComments = this.comments.length - fileComments;
    const resolvedComments = this.comments.filter(c => c.resolved).length;
    const unresolvedComments = this.comments.length - resolvedComments;
    const uniqueThreads = new Set(this.comments.map(c => c.threadId).filter(Boolean)).size;
    
    if (this.comments.length === 0) {
      if (this.prInfo) {
        vscode.window.setStatusBarMessage(`PR #${this.prInfo.number}: No comments found`, 5000);
      } else {
        vscode.window.setStatusBarMessage('No comments found', 5000);
      }
    } else {
      const prText = this.prInfo ? `PR #${this.prInfo.number}: ` : '';
      vscode.window.setStatusBarMessage(
        `${prText}${uniqueThreads} discussion threads with ${this.comments.length} comments (${unresolvedComments} unresolved)`,
        8000
      );
    }
    
    // After processing comments, update the tree items and parent relationships
    this.getChildren().then(items => {
      this.treeItems = items;
      
      // Clear and rebuild parent relationships
      this.parentMap.clear();
      
      // For each thread, set up parent-child relationships
      for (const item of this.treeItems) {
        if (item.contextValue === 'prThreadHeader' && item.comment.threadId) {
          const threadId = item.comment.threadId;
          const threadComments = this.comments.filter(
            c => c.threadId === threadId && !c.isFirstComment
          );
          
          // Set up parent relationship for each child comment in the thread
          for (const comment of threadComments) {
            const childItem = this.treeItems.find(ti => ti.comment.id === comment.id);
            if (childItem) {
              this.parentMap.set(childItem.comment.id.toString(), item);
            }
          }
        }
      }
    });
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
      // If we're getting children of a thread header, return all comments in that thread except the first one
      if (element.contextValue === 'prThreadHeader' && element.comment.threadId) {
        const threadComments = this.comments.filter(
          c => c.threadId === element.comment.threadId && !c.isFirstComment
        );
        return Promise.resolve(
          threadComments.map(comment => new CommentItem(comment, vscode.TreeItemCollapsibleState.None))
        );
      }
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
    
    // Group comments by thread
    const threadMap = new Map<string, PullRequestComment[]>();
    const standaloneComments: PullRequestComment[] = [];
    
    for (const comment of this.comments) {
      if (comment.threadId) {
        const thread = threadMap.get(comment.threadId) || [];
        thread.push(comment);
        threadMap.set(comment.threadId, thread);
      } else {
        standaloneComments.push(comment);
      }
    }
    
    // Process threads
    for (const [threadId, comments] of threadMap) {
      const firstComment = comments.find(c => c.isFirstComment);
      if (firstComment) {
        if (comments.length === 1) {
          // For single-comment threads, just show the comment directly
          items.push(new CommentItem(firstComment, vscode.TreeItemCollapsibleState.None));
        } else {
          // For multi-comment threads, show as expandable thread
          items.push(new CommentItem(
            firstComment,
            vscode.TreeItemCollapsibleState.Expanded,
            true
          ));
        }
      }
    }
    
    // Add standalone comments
    items.push(...standaloneComments.map(
      comment => new CommentItem(comment, vscode.TreeItemCollapsibleState.None)
    ));
    
    return Promise.resolve(items);
  }

  getParent(element: CommentItem): vscode.ProviderResult<CommentItem> {
    if (element.comment.id) {
      return this.parentMap.get(element.comment.id.toString());
    }
    return null;
  }
} 