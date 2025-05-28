import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

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
  private getOctokit(): Octokit {
    const token = vscode.workspace.getConfiguration('gittron').get<string>('githubToken');
    
    if (!token) {
      throw new Error('GitHub token not set. Please set a token using the "Set GitHub Token" command.');
    }
    
    return new Octokit({
      auth: token
    });
  }

  public setToken(token: string) {
    vscode.workspace.getConfiguration('gittron').update('githubToken', token, vscode.ConfigurationTarget.Global);
  }

  public async getPullRequestComments(
    owner: string, 
    repo: string, 
    pullNumber: number,
    includeResolved: boolean = false
  ): Promise<PullRequestComment[]> {
    try {
      const octokit = this.getOctokit();
      
      // Get issue comments with pagination
      console.log('Fetching issue comments...');
      const issueComments = await octokit.paginate(octokit.issues.listComments, {
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100
      });
      
      console.log(`Retrieved ${issueComments.length} issue comments`);
      
      // Get review comments with pagination
      console.log('Fetching review comments...');
      const reviewComments = await octokit.paginate(octokit.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100
      });
      
      console.log(`Retrieved ${reviewComments.length} review comments`);
      
      // Also try to get review comments from all reviews to catch any we might have missed
      console.log('Fetching reviews to get additional comments...');
      const reviews = await octokit.paginate(octokit.pulls.listReviews, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100
      });
      
      console.log(`Retrieved ${reviews.length} reviews`);
      
      // Get comments from each review
      let additionalReviewComments: any[] = [];
      for (const review of reviews) {
        try {
          const reviewSpecificComments = await octokit.paginate(octokit.pulls.listCommentsForReview, {
            owner,
            repo,
            pull_number: pullNumber,
            review_id: review.id,
            per_page: 100
          });
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
          resolved: (sampleComment as any).resolved,
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
          .filter(comment => comment.path) // Only file-related comments
          .map(comment => {
            // Simple resolution detection using REST API properties
            const isResolved = 
              // Direct resolved property (if available)
              (comment as any).resolved === true ||
              // Some comments might be marked as outdated which could indicate resolution
              (comment as any).outdated === true;
            
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
      
      // If we're not including resolved comments, filter them out
      if (!includeResolved) {
        const beforeFilterCount = comments.length;
        comments = comments.filter(comment => !comment.resolved);
        console.log(`Filtered out ${beforeFilterCount - comments.length} resolved comments`);
      }
      
      // Log the final comment array structure
      console.log(`Final result: ${comments.length} ${includeResolved ? 'total' : 'unresolved'} file comments`);
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