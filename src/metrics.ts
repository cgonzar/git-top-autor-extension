import * as vscode from 'vscode';
import { BlameLineData } from './blameParser';

export interface ContributorMetrics {
    author: string;
    lines: number;
    characters: number;
    percentage: number;
}

export class MetricsCalculator {
    calculateContributions(blameData: BlameLineData[]): ContributorMetrics[] {
        if (blameData.length === 0) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('gitFlex');
        const countMode = config.get<string>('countMode', 'lines');
        const ignoreBlankLines = config.get<boolean>('ignoreBlankLines', false);

        // Group by author
        const authorStats = new Map<string, { lines: number; characters: number }>();

        for (const lineData of blameData) {
            const { author, content } = lineData;

            // Skip blank lines if configured
            if (ignoreBlankLines && this.isBlankLine(content)) {
                continue;
            }

            const existing = authorStats.get(author) || { lines: 0, characters: 0 };
            existing.lines += 1;
            existing.characters += content.length;
            authorStats.set(author, existing);
        }

        // Calculate totals
        let totalLines = 0;
        let totalCharacters = 0;
        
        for (const stats of authorStats.values()) {
            totalLines += stats.lines;
            totalCharacters += stats.characters;
        }

        // Convert to metrics array
        const metrics: ContributorMetrics[] = [];
        
        for (const [author, stats] of authorStats.entries()) {
            const countValue = countMode === 'characters' ? stats.characters : stats.lines;
            const totalValue = countMode === 'characters' ? totalCharacters : totalLines;
            
            const percentage = totalValue > 0 ? Math.round((countValue / totalValue) * 100) : 0;
            
            metrics.push({
                author,
                lines: stats.lines,
                characters: stats.characters,
                percentage
            });
        }

        // Sort by the selected count mode (descending)
        metrics.sort((a, b) => {
            if (countMode === 'characters') {
                return b.characters - a.characters;
            }
            return b.lines - a.lines;
        });

        return metrics;
    }

    private isBlankLine(content: string): boolean {
        return content.trim().length === 0;
    }

    getTopContributor(metrics: ContributorMetrics[]): ContributorMetrics | null {
        return metrics.length > 0 ? metrics[0] : null;
    }

    formatContributorSummary(metrics: ContributorMetrics[], maxCount: number = 3): string {
        const top = metrics.slice(0, maxCount);
        const config = vscode.workspace.getConfiguration('gitFlex');
        const countMode = config.get<string>('countMode', 'lines');
        
        const lines = top.map(contributor => {
            const countValue = countMode === 'characters' ? contributor.characters : contributor.lines;
            const unit = countMode === 'characters' ? 'chars' : 'lines';
            return `${contributor.author}: ${contributor.percentage}% (${countValue} ${unit})`;
        });

        const totalLines = metrics.reduce((sum, c) => sum + c.lines, 0);
        const totalChars = metrics.reduce((sum, c) => sum + c.characters, 0);
        const totalValue = countMode === 'characters' ? totalChars : totalLines;
        const unit = countMode === 'characters' ? 'characters' : 'lines';
        
        lines.push(`Total: ${totalValue} ${unit}`);
        
        return lines.join('\n');
    }
}
