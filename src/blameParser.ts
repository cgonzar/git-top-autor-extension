import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GitRunner } from './gitRunner';

export interface BlameLineData {
    author: string;
    lineNumber: number;
    content: string;
}

export class BlameParser {
    async getBlameData(filePath: string, fileContent: string, gitRunner: GitRunner): Promise<BlameLineData[]> {
        // Check if file is tracked and modified
        const isTracked = await gitRunner.isFileTracked(filePath);
        const isModified = await gitRunner.isFileModified(filePath);
        
        let tempFilePath: string | undefined;
        
        try {
            // If file is untracked or modified, create temp file with current content
            if (!isTracked || isModified) {
                tempFilePath = await this.createTempFile(fileContent);
            }
            
            // Get blame output
            const blameOutput = await gitRunner.getBlame(filePath, tempFilePath);
            
            // Parse blame output
            return this.parseBlameOutput(blameOutput, fileContent);
            
        } finally {
            // Clean up temp file
            if (tempFilePath) {
                try {
                    fs.unlinkSync(tempFilePath);
                } catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
    
    private async createTempFile(content: string): Promise<string> {
        const tempDir = os.tmpdir();
        const tempFileName = `vscode-blame-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.tmp`;
        const tempFilePath = path.join(tempDir, tempFileName);
        
        fs.writeFileSync(tempFilePath, content, 'utf8');
        return tempFilePath;
    }
    
    private parseBlameOutput(blameOutput: string, fileContent: string): BlameLineData[] {
        const lines = blameOutput.split('\n');
        const fileLines = fileContent.split('\n');
        const result: BlameLineData[] = [];
        
        let currentCommit = '';
        let currentAuthor = '';
        let currentLineNumber = 0;
        let lineIndex = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line.trim()) {
                continue;
            }
            
            // Check if this is a commit hash line (start of new blame block)
            if (line.match(/^[0-9a-f]{40}/)) {
                const parts = line.split(' ');
                currentCommit = parts[0];
                currentLineNumber = parseInt(parts[2], 10);
                continue;
            }
            
            // Parse metadata lines
            if (line.startsWith('author ')) {
                currentAuthor = line.substring(7); // Remove 'author ' prefix
                continue;
            }
            
            if (line.startsWith('author-mail ')) {
                // If we don't have an author name, use email (without < >)
                if (!currentAuthor) {
                    const email = line.substring(12); // Remove 'author-mail ' prefix
                    currentAuthor = email.replace(/^<|>$/g, '');
                }
                continue;
            }
            
            // Skip other metadata lines
            if (line.startsWith('author-time ') || 
                line.startsWith('author-tz ') ||
                line.startsWith('committer ') ||
                line.startsWith('committer-mail ') ||
                line.startsWith('committer-time ') ||
                line.startsWith('committer-tz ') ||
                line.startsWith('summary ') ||
                line.startsWith('boundary') ||
                line.startsWith('filename ') ||
                line.startsWith('previous ')) {
                continue;
            }
            
            // This should be the actual file content line
            if (line.startsWith('\t')) {
                const content = line.substring(1); // Remove leading tab
                
                // Ensure we have valid data
                if (currentAuthor && currentLineNumber > 0) {
                    // Verify line number is within bounds
                    if (currentLineNumber <= fileLines.length) {
                        result.push({
                            author: this.normalizeAuthor(currentAuthor),
                            lineNumber: currentLineNumber,
                            content: content
                        });
                    }
                }
                
                // Reset for next line
                currentAuthor = '';
                currentLineNumber = 0;
                lineIndex++;
            }
        }
        
        // Handle case where file has uncommitted changes or is untracked
        if (result.length === 0 && fileContent.trim()) {
            // All lines are uncommitted, attribute to current user
            const fileLines = fileContent.split('\n');
            for (let i = 0; i < fileLines.length; i++) {
                result.push({
                    author: 'not commited yet',
                    lineNumber: i + 1,
                    content: fileLines[i]
                });
            }
        }
        
        return result;
    }
    
    private normalizeAuthor(author: string): string {
        // Remove extra whitespace and normalize
        const normalized = author.trim();
        if (!normalized) return 'Unknown';
        const lower = normalized.toLowerCase();
        // Map common git blame markers for uncommitted/external contents
        if (lower.includes('not committed yet') || lower.includes('external file')) {
            return 'not commited yet';
        }
        return normalized;
    }
}
