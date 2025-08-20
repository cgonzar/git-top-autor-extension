import * as fs from 'fs';
import * as crypto from 'crypto';
import { ContributorMetrics } from './metrics';

interface CacheEntry {
    data: ContributorMetrics[];
    timestamp: number;
    ttl: number;
}

export class ContributorCache {
    private cache = new Map<string, CacheEntry>();
    private readonly defaultTTL = 30000; // 30 seconds
    private readonly maxCacheSize = 100; // Maximum number of cached entries

    async getCacheKey(filePath: string, fileContent: string): Promise<string> {
        try {
            // Try to get file stats for mtime and size
            const stats = fs.statSync(filePath);
            const mtime = stats.mtime.getTime();
            const size = stats.size;
            
            // Create a simple hash of the content for verification
            const contentHash = crypto.createHash('md5').update(fileContent).digest('hex').substring(0, 8);
            
            return `${filePath}:${mtime}:${size}:${contentHash}`;
        } catch {
            // If file doesn't exist or can't be accessed, use content hash only
            const contentHash = crypto.createHash('md5').update(fileContent).digest('hex');
            return `${filePath}:content:${contentHash}`;
        }
    }

    get(key: string): ContributorMetrics[] | null {
        const entry = this.cache.get(key);
        
        if (!entry) {
            return null;
        }

        // Check if entry has expired
        const now = Date.now();
        if (now - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    set(key: string, data: ContributorMetrics[], ttl: number = this.defaultTTL): void {
        // Enforce cache size limit
        if (this.cache.size >= this.maxCacheSize) {
            // Remove oldest entries (simple LRU-like behavior)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
    }

    invalidate(filePath: string): void {
        // Remove all cache entries for this file path
        const keysToDelete: string[] = [];
        
        for (const key of this.cache.keys()) {
            if (key.startsWith(filePath + ':')) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    // Clean up expired entries
    cleanup(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];
        
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
    }
}
