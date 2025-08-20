import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export class GitRunner {
    private readonly timeout = 5000; // 5 seconds timeout

    async isInGitRepository(filePath: string): Promise<boolean> {
        try {
            const workingDir = path.dirname(filePath);
            const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
                cwd: workingDir,
                timeout: this.timeout
            });
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    async isFileTracked(filePath: string): Promise<boolean> {
        try {
            const workingDir = path.dirname(filePath);
            const relativePath = path.basename(filePath);
            
            await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
                cwd: workingDir,
                timeout: this.timeout
            });
            return true;
        } catch {
            return false;
        }
    }

    async isFileModified(filePath: string): Promise<boolean> {
        try {
            const workingDir = path.dirname(filePath);
            const relativePath = path.basename(filePath);
            
            const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-z', '--', relativePath], {
                cwd: workingDir,
                timeout: this.timeout
            });
            
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    async getBlame(filePath: string, tempFilePath?: string): Promise<string> {
        const workingDir = path.dirname(filePath);
        const relativePath = path.basename(filePath);
        
        const args = [
            'blame',
            '--line-porcelain',
            '--encoding=UTF-8'
        ];

        if (tempFilePath) {
            args.push('--contents', tempFilePath);
        }

        args.push('--', relativePath);

        try {
            const { stdout } = await execFileAsync('git', args, {
                cwd: workingDir,
                timeout: this.timeout,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });
            
            return stdout;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error('Git not found in PATH');
            }
            if (error.signal === 'SIGTERM') {
                throw new Error('Git blame timeout');
            }
            throw new Error(`Git blame failed: ${error.message}`);
        }
    }

    async getRepositoryRoot(filePath: string): Promise<string> {
        try {
            const workingDir = path.dirname(filePath);
            const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
                cwd: workingDir,
                timeout: this.timeout
            });
            return stdout.trim();
        } catch (error: any) {
            throw new Error(`Failed to get repository root: ${error.message}`);
        }
    }

    async getCurrentCommitHash(filePath: string): Promise<string> {
        try {
            const workingDir = path.dirname(filePath);
            const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
                cwd: workingDir,
                timeout: this.timeout
            });
            return stdout.trim();
        } catch (error: any) {
            throw new Error(`Failed to get current commit: ${error.message}`);
        }
    }
}
