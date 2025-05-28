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
  resolved?: boolean; // Whether the comment has been resolved
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

  private async getResolvedCommentIds(owner: string, repo: string, pullNumber: number): Promise<Set<number>> {
    const token = vscode.workspace.getConfiguration('gittron').get<string>('githubToken');
    
    if (!token) {
      throw new Error('GitHub token not set.');
    }

    // GraphQL query to get resolved status of review threads
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

      const resolvedCommentIds = new Set<number>();
      
      if (data.data?.repository?.pullRequest?.reviewThreads?.nodes) {
        for (const thread of data.data.repository.pullRequest.reviewThreads.nodes) {
          if (thread.isResolved && thread.comments?.nodes) {
            for (const comment of thread.comments.nodes) {
              if (comment.databaseId) {
                resolvedCommentIds.add(comment.databaseId);
              }
            }
          }
        }
      }

      console.log(`Found ${resolvedCommentIds.size} resolved comment IDs via GraphQL`);
      return resolvedCommentIds;
    } catch (error) {
      console.error('Error fetching resolved comments via GraphQL:', error);
      return new Set();
    }
  }

  public async getPullRequestComments(
    owner: string, 
    repo: string, 
    pullNumber: number
  ): Promise<PullRequestComment[]> {
    try {
      // First, get resolved comment IDs using GraphQL
      const resolvedCommentIds = await this.getResolvedCommentIds(owner, repo, pullNumber);
      
      // Get issue comments with pagination
      console.log('Fetching issue comments...');
      const issueComments = await this.fetchAllPages<any>(
        `https://api.github.com/repos/${owner}/${repo}/issues/${pullNumber}/comments`
      );
      
      console.log(`Retrieved ${issueComments.length} issue comments`);
      
      // Get review comments with pagination
      console.log('Fetching review comments...');
      const reviewComments = await this.fetchAllPages<any>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/comments`
      );
      
      console.log(`Retrieved ${reviewComments.length} review comments`);
      
      // Also try to get review comments from all reviews to catch any we might have missed
      console.log('Fetching reviews to get additional comments...');
      const reviews = await this.fetchAllPages<any>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`
      );
      
      console.log(`Retrieved ${reviews.length} reviews`);
      
      // Get comments from each review
      let additionalReviewComments: any[] = [];
      for (const review of reviews) {
        try {
          const reviewSpecificComments = await this.fetchAllPages<any>(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${review.id}/comments`
          );
          additionalReviewComments.push(...reviewSpecificComments);
          console.log(`Retrieved ${reviewSpecificComments.length} comments from review ${review.id}`);
        } catch (error) {
          console.log(`Could not fetch comments for review ${review.id}:`, error);
        }
      }
      
      console.log(`Retrieved ${additionalReviewComments.length} additional review comments`);
      
      // Combine all review comments and deduplicate by ID
      const allReviewComments = [...reviewComments, ...additionalReviewComments];
      const uniqueReviewComments = allReviewComments.filter((comment, index, array) => 
        array.findIndex(c => c.id === comment.id) === index
      );
      
      console.log(`Total unique review comments: ${uniqueReviewComments.length}`);
      
      // Log sample review comment to understand the structure
      if (uniqueReviewComments.length > 0) {
        const sampleComment = uniqueReviewComments[0];
        console.log('Sample review comment structure:', JSON.stringify({
          id: sampleComment.id,
          path: sampleComment.path,
          position: sampleComment.position,
          line: sampleComment.line,
          original_line: (sampleComment as any).original_line,
          original_position: (sampleComment as any).original_position,
          in_reply_to_id: (sampleComment as any).in_reply_to_id,
          subject_type: (sampleComment as any).subject_type,
          outdated: (sampleComment as any).outdated,
          diff_hunk: sampleComment.diff_hunk?.substring(0, 100) + '...',
          has_user: !!sampleComment.user,
          user_login: sampleComment.user?.login,
          created_at: sampleComment.created_at
        }, null, 2));
      }
      
      // Combine and format comments - ONLY include file-related comments
      let comments: PullRequestComment[] = [
        // Skip issue comments since they're not file-related
        // ...issueComments.map(comment => ({
        //   id: comment.id,
        //   body: comment.body || '',
        //   user: {
        //     login: comment.user?.login || 'unknown'
        //   },
        //   created_at: comment.created_at,
        //   html_url: comment.html_url,
        //   resolved: false // Issue comments can't be resolved
        // })),
        
        // Only include review comments that have a file path
        ...uniqueReviewComments
          .filter(comment => {
            // Only file-related comments
            if (!comment.path) return false;
            
            // Filter out outdated comments completely - they're no longer relevant
            if ((comment as any).outdated === true) {
              console.log(`Filtering out outdated comment ${comment.id} on ${comment.path}`);
              return false;
            }
            
            return true;
          })
          .map(comment => {
            // Use GraphQL data to determine if comment is resolved
            const isResolved = resolvedCommentIds.has(comment.id);
            
            console.log(`File comment ${comment.id} - Path: ${comment.path}, Line: ${comment.line}, Position: ${comment.position}, Resolved: ${isResolved}, Created: ${comment.created_at}`);
            
            return {
          id: comment.id,
          body: comment.body || '',
          user: {
            login: comment.user?.login || 'unknown'
          },
          path: comment.path,
              // GitHub API may provide different line/position properties, try to get the correct one
              line: comment.line || (comment as any).original_line,
              position: comment.position || (comment as any).original_position,
          created_at: comment.created_at,
              html_url: comment.html_url,
              resolved: isResolved
            };
          })
      ];
      
      console.log(`Total file-related comments before filtering: ${comments.length}`);
      
      // Log all comments with their basic info
      comments.forEach((comment, index) => {
        console.log(`File comment ${index + 1}: ID=${comment.id}, User=${comment.user.login}, File=${comment.path}, Line=${comment.line}, Resolved=${comment.resolved}, Created=${comment.created_at}, Body="${comment.body.substring(0, 50)}..."`);
      });
      
      // Always filter out resolved comments - we only want unresolved ones
      const beforeFilterCount = comments.length;
      comments = comments.filter(comment => !comment.resolved);
      console.log(`Filtered out ${beforeFilterCount - comments.length} resolved comments`);
      
      // Log the final comment array structure
      console.log(`Final result: ${comments.length} unresolved file comments (outdated comments already filtered out)`);
      for (let i = 0; i < Math.min(comments.length, 5); i++) {
        const comment = comments[i];
        console.log(`Comment ${i}: ID=${comment.id}, File=${comment.path}, Line=${comment.line}, Position=${comment.position}, Resolved=${comment.resolved}`);
      }
      
      return comments;
    } catch (error) {
      console.error('Error fetching PR comments:', error);
      throw error;
    }
  }
} 