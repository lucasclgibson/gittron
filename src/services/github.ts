import * as vscode from 'vscode';

export interface PullRequestComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
  path?: string;
  position?: number;
  line?: number;
  created_at: string;
  html_url: string;
  resolved?: boolean; // Always false - only unresolved comments are returned
  threadId?: string;
  isFirstComment?: boolean;
}

export class GitHubService {
  private getAuthHeaders(): { [key: string]: string } {
    const token = vscode.workspace.getConfiguration('gittron').get<string>('githubToken');
    
    if (!token) {
      throw new Error('GitHub token not set. Please set a token using the "Set GitHub Token" command.');
    }
    
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  public setToken(token: string) {
    vscode.workspace.getConfiguration('gittron').update('githubToken', token, vscode.ConfigurationTarget.Global);
  }

  private async fetchAllPages<T>(url: string): Promise<T[]> {
    const headers = this.getAuthHeaders();
    let allItems: T[] = [];
    let currentUrl: string | null = `${url}${url.includes('?') ? '&' : '?'}per_page=100`;

    while (currentUrl) {
      const response = await fetch(currentUrl, { headers });
      
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const items: T[] = await response.json() as T[];
      allItems.push(...items);

      // Check for next page in Link header
      const linkHeader = response.headers.get('link');
      const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
      currentUrl = nextMatch ? nextMatch[1] : null;
    }

    return allItems;
  }

  private async getDisplayableCommentIds(owner: string, repo: string, pullNumber: number): Promise<Set<number>> {
    const token = vscode.workspace.getConfiguration('gittron').get<string>('githubToken');
    
    if (!token) {
      throw new Error('GitHub token not set.');
    }

    const query = `
      query($owner: String!, $repo: String!, $pullNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 100) {
                  nodes {
                    id
                    databaseId
                    path
                    outdated
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { owner, repo, pullNumber }
        })
      });

      const data: any = await response.json();
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        return new Set();
      }

      const displayableCommentIds = new Set<number>();
      
      if (data.data?.repository?.pullRequest?.reviewThreads?.nodes) {
        for (const thread of data.data.repository.pullRequest.reviewThreads.nodes) {
          if (thread.comments?.nodes) {
            for (const comment of thread.comments.nodes) {
              if (comment.databaseId && comment.path && !comment.outdated && !thread.isResolved) {
                displayableCommentIds.add(comment.databaseId);
              }
            }
          }
        }
      }
      
      return displayableCommentIds;
    } catch (error) {
      console.error('Error fetching displayable comments via GraphQL:', error);
      return new Set();
    }
  }

  public async getPullRequestComments(
    owner: string, 
    repo: string, 
    pullNumber: number
  ): Promise<PullRequestComment[]> {
    try {
      const displayableCommentIds = await this.getDisplayableCommentIds(owner, repo, pullNumber);
      
      if (displayableCommentIds.size === 0) {
        return [];
      }

      // First get the thread information
      const token = vscode.workspace.getConfiguration('gittron').get<string>('githubToken');
      if (!token) {
        throw new Error('GitHub token not set.');
      }

      const threadQuery = `
        query($owner: String!, $repo: String!, $pullNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  comments(first: 100) {
                    nodes {
                      databaseId
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const threadResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: threadQuery,
          variables: { owner, repo, pullNumber }
        })
      });

      const threadData: any = await threadResponse.json();
      const commentToThreadMap = new Map<number, string>();
      
      if (threadData.data?.repository?.pullRequest?.reviewThreads?.nodes) {
        for (const thread of threadData.data.repository.pullRequest.reviewThreads.nodes) {
          if (thread.comments?.nodes) {
            for (const comment of thread.comments.nodes) {
              if (comment.databaseId) {
                commentToThreadMap.set(comment.databaseId, thread.id);
              }
            }
          }
        }
      }
      
      const reviewComments = await this.fetchAllPages<any>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/comments`
      );
      
      const comments: PullRequestComment[] = reviewComments
        .filter(comment => displayableCommentIds.has(comment.id))
        .map(comment => {
          const threadId = commentToThreadMap.get(comment.id);
          const isFirstComment = threadId ? 
            reviewComments.filter(c => commentToThreadMap.get(c.id) === threadId)
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]?.id === comment.id
            : false;

          return {
            id: comment.id,
            body: comment.body || '',
            user: {
              login: comment.user?.login || 'unknown'
            },
            path: comment.path,
            line: comment.line || (comment as any).original_line,
            position: comment.position || (comment as any).original_position,
            created_at: comment.created_at,
            html_url: comment.html_url,
            resolved: false,
            threadId,
            isFirstComment
          };
        });
      
      return comments;
    } catch (error) {
      console.error('Error fetching PR comments:', error);
      throw error;
    }
  }

  public async resolveCommentThread(owner: string, repo: string, pullNumber: number, commentId: number): Promise<boolean> {
    const token = vscode.workspace.getConfiguration('gittron').get<string>('githubToken');
    
    if (!token) {
      throw new Error('GitHub token not set.');
    }

    try {
      // Find the thread ID for this comment
      const threadQuery = `
        query($owner: String!, $repo: String!, $pullNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  comments(first: 100) {
                    nodes {
                      databaseId
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const threadResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: threadQuery,
          variables: { owner, repo, pullNumber }
        })
      });

      const threadData: any = await threadResponse.json();
      
      if (threadData.errors) {
        console.error('GraphQL errors finding thread:', threadData.errors);
        return false;
      }

      // Find the thread that contains our comment
      let threadId: string | null = null;
      if (threadData.data?.repository?.pullRequest?.reviewThreads?.nodes) {
        for (const thread of threadData.data.repository.pullRequest.reviewThreads.nodes) {
          if (thread.comments?.nodes) {
            for (const comment of thread.comments.nodes) {
              if (comment.databaseId === commentId) {
                threadId = thread.id;
                break;
              }
            }
            if (threadId) break;
          }
        }
      }

      if (!threadId) {
        return false;
      }

      // Resolve the thread
      const resolveMutation = `
        mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `;

      const resolveResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: resolveMutation,
          variables: { threadId }
        })
      });

      const resolveData: any = await resolveResponse.json();
      
      if (resolveData.errors) {
        console.error('GraphQL errors resolving thread:', resolveData.errors);
        return false;
      }

      return resolveData.data?.resolveReviewThread?.thread?.isResolved === true;
    } catch (error) {
      console.error('Error resolving comment thread:', error);
      return false;
    }
  }

  public async replyToComment(
    owner: string, 
    repo: string, 
    pullNumber: number, 
    commentId: number, 
    replyBody: string
  ): Promise<PullRequestComment | null> {
    try {
      const headers = this.getAuthHeaders();
      headers['Content-Type'] = 'application/json';

      // First, get the original comment to find its position and path
      const originalCommentResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}`,
        { headers }
      );

      if (!originalCommentResponse.ok) {
        throw new Error(`Failed to fetch original comment: ${originalCommentResponse.status} ${originalCommentResponse.statusText}`);
      }

      const originalComment = await originalCommentResponse.json();

      // Create a reply comment
      const replyData = {
        body: replyBody,
        in_reply_to: commentId
      };

      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/comments`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(replyData)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const replyComment: any = await response.json();

      return {
        id: replyComment.id,
        body: replyComment.body || '',
        user: {
          login: replyComment.user?.login || 'unknown'
        },
        path: replyComment.path,
        line: replyComment.line || replyComment.original_line,
        position: replyComment.position || replyComment.original_position,
        created_at: replyComment.created_at,
        html_url: replyComment.html_url,
        resolved: false
      };
    } catch (error) {
      console.error('Error replying to comment:', error);
      throw error;
    }
  }
} 