import * as vscode from 'vscode';
import * as path from 'path';

export interface GitRepository {
  owner: string;
  name: string;
  branch: string;
}

export interface PullRequest {
  number: number;
  title: string;
  head: string;
  base: string;
}

export class GitService {
  private async getGitApi() {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      throw new Error('Git extension not found');
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const gitApi = gitExtension.exports.getAPI(1);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder open');
    }

    // Wait a bit for repositories to be discovered if needed
    if (gitApi.repositories.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const repository = gitApi.repositories.find((repo: any) => 
      repo.rootUri.fsPath === workspaceFolder.uri.fsPath
    );

    if (!repository) {
      throw new Error('No Git repository found in workspace');
    }

    return repository;
  }

  public async getRepositoryInfo(): Promise<GitRepository> {
    try {
      const repository = await this.getGitApi();
      
      // Get remote URL
      const remotes = repository.state.remotes;
      const originRemote = remotes.find((remote: any) => remote.name === 'origin');
      
      if (!originRemote) {
        throw new Error('No origin remote found');
      }
      
      // Parse GitHub repository from URL
      const remoteUrl = originRemote.fetchUrl || originRemote.pushUrl;
      const { owner, name } = this.parseGitHubUrl(remoteUrl);
      
      // Get current branch
      const branch = repository.state.HEAD?.name;
      if (!branch) {
        throw new Error('No current branch found');
      }
      
      return { owner, name, branch };
    } catch (error) {
      console.error('Error getting repository info:', error);
      throw error;
    }
  }

  public async getCurrentPullRequest(): Promise<number | null> {
    try {
      const repoInfo = await this.getRepositoryInfo();
      console.log('Current branch:', repoInfo.branch);
      
      // Get GitHub token from extension settings
      const config = vscode.workspace.getConfiguration('gittron');
      const token = config.get('githubToken') as string;
      
      if (!token) {
        throw new Error('GitHub token not set. Please set your GitHub token first.');
      }
      
      // Find PRs where the current branch is the source branch
      const prs = await this.findPullRequestsForBranch(repoInfo, token);
      
      if (prs.length === 0) {
        throw new Error(`No open pull requests found for branch '${repoInfo.branch}'`);
      }
      
      if (prs.length === 1) {
        // If there's only one PR, use that
        return prs[0].number;
      } else {
        // If there are multiple PRs, let the user select one
        const prItems = prs.map(pr => ({
          label: `#${pr.number}: ${pr.title}`,
          description: `${pr.head} → ${pr.base}`,
          pr
        }));
        
        const selectedItem = await vscode.window.showQuickPick(prItems, {
          placeHolder: 'Select a pull request'
        });
        
        if (selectedItem) {
          return selectedItem.pr.number;
        } else {
          throw new Error('No pull request selected');
        }
      }
    } catch (error) {
      console.error('Error getting current pull request:', error);
      if (error instanceof Error) {
        throw error; // Re-throw the error to provide better feedback in the UI
      }
      return null;
    }
  }

  private async findPullRequestsForBranch(repo: GitRepository, token: string): Promise<PullRequest[]> {
    try {
      const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?head=${repo.owner}:${repo.branch}&state=open`;
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as Array<{
        number: number;
        title: string;
        head: { ref: string };
        base: { ref: string };
      }>;
      
      return data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        head: pr.head.ref,
        base: pr.base.ref
      }));
    } catch (error) {
      console.error('Error finding pull requests for branch:', error);
      throw new Error(`Failed to fetch pull requests from GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseGitHubUrl(url: string): { owner: string, name: string } {
    // Handle different URL formats
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    let match;
    
    if (url.startsWith('https')) {
      match = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(?:\.git)?$/);
    } else {
      match = url.match(/git@github\.com:([^\/]+)\/([^\/\.]+)(?:\.git)?$/);
    }
    
    if (!match) {
      throw new Error(`Unable to parse GitHub repository from URL: ${url}`);
    }
    
    return {
      owner: match[1],
      name: match[2]
    };
  }
} 