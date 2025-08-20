import * as vscode from 'vscode';
import { GitRunner } from './gitRunner';
import { BlameParser } from './blameParser';
import { MetricsCalculator } from './metrics';
import { ContributorCache } from './cache';

let statusBarItem: vscode.StatusBarItem;
let gitRunner: GitRunner;
let blameParser: BlameParser;
let metricsCalculator: MetricsCalculator;
let cache: ContributorCache;
let debounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Initialize components
    gitRunner = new GitRunner();
    blameParser = new BlameParser();
    metricsCalculator = new MetricsCalculator();
    cache = new ContributorCache();

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'topContributor.showContributors';
    statusBarItem.text = 'Top: —';
    statusBarItem.tooltip = 'Click to see all contributors';
    statusBarItem.show();

    // Register command
    const showContributorsCommand = vscode.commands.registerCommand('topContributor.showContributors', showContributors);

    // Register event listeners
    const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(handleEditorChange);
    const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(handleDocumentSave);

    // Add to context subscriptions
    context.subscriptions.push(
        statusBarItem,
        showContributorsCommand,
        onDidChangeActiveTextEditor,
        onDidSaveTextDocument
    );

    // Process current active editor
    if (vscode.window.activeTextEditor) {
        handleEditorChange(vscode.window.activeTextEditor);
    }
}

export function deactivate() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}

function handleEditorChange(editor: vscode.TextEditor | undefined) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
        if (editor) {
            updateContributors(editor);
        } else {
            statusBarItem.text = 'Top: —';
            statusBarItem.tooltip = 'No active file';
        }
    }, 300);
}

function handleDocumentSave(document: vscode.TextDocument) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document === document) {
        // Clear cache for this file and update
        cache.invalidate(document.uri.fsPath);
        updateContributors(activeEditor);
    }
}

async function updateContributors(editor: vscode.TextEditor) {
    try {
        const filePath = editor.document.uri.fsPath;
        const fileContent = editor.document.getText();
        
        // Check file size limit
        const config = vscode.workspace.getConfiguration('topContributor');
        const maxSizeKB = config.get<number>('maxFileSizeKB', 2048);
        const fileSizeKB = Buffer.byteLength(fileContent, 'utf8') / 1024;
        
        if (fileSizeKB > maxSizeKB) {
            statusBarItem.text = 'Top: File too large';
            statusBarItem.tooltip = `File size (${Math.round(fileSizeKB)}KB) exceeds limit (${maxSizeKB}KB)`;
            return;
        }

        // Check if file is in a git repository
        const isInRepo = await gitRunner.isInGitRepository(filePath);
        if (!isInRepo) {
            statusBarItem.text = 'Top: No Git';
            statusBarItem.tooltip = 'File is not in a Git repository';
            return;
        }

        // Check cache first
        const cacheKey = await cache.getCacheKey(filePath, fileContent);
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            updateStatusBar(cachedResult);
            return;
        }

        // Get blame data
        const blameData = await blameParser.getBlameData(filePath, fileContent, gitRunner);
        
        // Calculate metrics
        const contributors = metricsCalculator.calculateContributions(blameData);
        
        // Cache result
        cache.set(cacheKey, contributors);
        
        // Update UI
        updateStatusBar(contributors);
        
    } catch (error) {
        console.error('Error updating contributors:', error);
        statusBarItem.text = 'Top: Error';
        statusBarItem.tooltip = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

function updateStatusBar(contributors: Array<{author: string, lines: number, percentage: number}>) {
    if (contributors.length === 0) {
        statusBarItem.text = 'Top: No data';
        statusBarItem.tooltip = 'No contribution data available';
        return;
    }

    const topContributor = contributors[0];
    statusBarItem.text = `Top: ${topContributor.author} (${topContributor.percentage}%)`;
    
    // Create tooltip with top 3 contributors
    const top3 = contributors.slice(0, 3);
    const tooltipLines = top3.map(c => `${c.author}: ${c.percentage}% (${c.lines} lines)`);
    const totalLines = contributors.reduce((sum, c) => sum + c.lines, 0);
    tooltipLines.push(`Total: ${totalLines} lines`);
    statusBarItem.tooltip = tooltipLines.join('\n');
}

async function showContributors() {
    try {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showInformationMessage('No active file');
            return;
        }

        const filePath = activeEditor.document.uri.fsPath;
        const fileContent = activeEditor.document.getText();
        
        // Check if file is in a git repository
        const isInRepo = await gitRunner.isInGitRepository(filePath);
        if (!isInRepo) {
            vscode.window.showInformationMessage('File is not in a Git repository');
            return;
        }

        // Get cached or fresh data
        const cacheKey = await cache.getCacheKey(filePath, fileContent);
        let contributors = cache.get(cacheKey);
        
        if (!contributors) {
            const blameData = await blameParser.getBlameData(filePath, fileContent, gitRunner);
            contributors = metricsCalculator.calculateContributions(blameData);
            cache.set(cacheKey, contributors);
        }

        if (contributors.length === 0) {
            vscode.window.showInformationMessage('No contribution data available');
            return;
        }

        // Create QuickPick items
        const items: vscode.QuickPickItem[] = contributors.map(contributor => ({
            label: contributor.author,
            description: `${contributor.percentage}% (${contributor.lines} lines)`
        }));

        // Show QuickPick
        const selected = await vscode.window.showQuickPick(items, {
            title: 'File Contributors',
            placeHolder: 'Contributors sorted by contribution'
        });

        // Navigate to a line authored by the selected contributor
        if (selected) {
            try {
                const blameData = await blameParser.getBlameData(filePath, fileContent, gitRunner);
                const match = blameData.find(b => b.author === selected.label);
                if (match) {
                    const line = Math.max(0, match.lineNumber - 1);
                    const position = new vscode.Position(line, 0);
                    const selection = new vscode.Selection(position, position);
                    activeEditor.selection = selection;
                    activeEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                } else {
                    vscode.window.showInformationMessage(`No lines found for ${selected.label}`);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to navigate to contributor lines: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }
    } catch (error) {
        console.error('Error showing contributors:', error);
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
