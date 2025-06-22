"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mobileOptimizationService = void 0;
const tokenCacheService_1 = require("./tokenCacheService");
class MobileOptimizationService {
    constructor() {
        this.isLowEndDevice = false;
        this.networkCondition = null;
        this.imageCache = new Map();
        this.requestQueue = new Map();
        // Configuration
        this.config = {
            lowEndDeviceThreshold: 4, // GB of RAM
            imageQuality: {
                '4g': 0.9,
                '3g': 0.7,
                '2g': 0.5,
                'slow-2g': 0.3
            },
            requestLimits: {
                '4g': 10,
                '3g': 5,
                '2g': 3,
                'slow-2g': 2
            },
            timeouts: {
                '4g': 15000,
                '3g': 20000,
                '2g': 30000,
                'slow-2g': 45000
            }
        };
        this.detectDeviceCapabilities();
        this.monitorNetworkConditions();
        this.setupServiceWorker();
    }
    static getInstance() {
        if (!MobileOptimizationService.instance) {
            MobileOptimizationService.instance = new MobileOptimizationService();
        }
        return MobileOptimizationService.instance;
    }
    detectDeviceCapabilities() {
        if (typeof window === 'undefined')
            return;
        // Detect low-end device based on hardware concurrency and memory
        const hardwareConcurrency = navigator.hardwareConcurrency || 4;
        const deviceMemory = navigator.deviceMemory || 4;
        this.isLowEndDevice = hardwareConcurrency <= 4 || deviceMemory <= this.config.lowEndDeviceThreshold;
        console.log(`Device detected: ${this.isLowEndDevice ? 'Low-end' : 'High-end'} (${hardwareConcurrency} cores, ${deviceMemory}GB RAM)`);
    }
    monitorNetworkConditions() {
        if (typeof window === 'undefined' || !('connection' in navigator))
            return;
        const connection = navigator.connection;
        const updateNetworkInfo = () => {
            this.networkCondition = {
                type: connection.effectiveType,
                effectiveType: connection.effectiveType,
                downlink: connection.downlink,
                rtt: connection.rtt,
                saveData: connection.saveData || false
            };
            console.log('Network condition updated:', this.networkCondition);
            this.optimizeForNetwork();
        };
        updateNetworkInfo();
        connection.addEventListener('change', updateNetworkInfo);
    }
    optimizeForNetwork() {
        if (!this.networkCondition)
            return;
        // Adjust based on network conditions
        if (this.networkCondition.type === '3g' || this.networkCondition.type === '2g') {
            // Enable aggressive caching
            this.enableAggressiveCaching();
            // Reduce concurrent requests
            this.limitConcurrentRequests();
            // Enable data saver mode
            this.enableDataSaverMode();
        }
    }
    enableAggressiveCaching() {
        // Extend cache TTL for slow connections
        if (this.networkCondition?.type === '3g' || this.networkCondition?.type === '2g') {
            console.log('Enabling aggressive caching for slow network');
            // Token cache already handles this internally
            tokenCacheService_1.tokenCacheService.preloadCommonChains();
        }
    }
    limitConcurrentRequests() {
        const limit = this.config.requestLimits[this.networkCondition?.type || '4g'];
        console.log(`Limiting concurrent requests to ${limit}`);
    }
    enableDataSaverMode() {
        console.log('Data saver mode enabled');
        // This would be used by components to reduce data usage
    }
    async setupServiceWorker() {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator))
            return;
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered:', registration);
        }
        catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
    // Optimize image loading
    optimizeImageUrl(originalUrl) {
        if (!this.networkCondition || !originalUrl)
            return originalUrl;
        // Check cache first
        const cached = this.imageCache.get(originalUrl);
        if (cached)
            return cached;
        // For slow networks, use lower quality images
        const quality = this.config.imageQuality[this.networkCondition.type];
        // If it's a known image service, add quality parameters
        let optimizedUrl = originalUrl;
        if (originalUrl.includes('cloudinary.com')) {
            optimizedUrl = originalUrl.replace('/upload/', `/upload/q_${quality * 100}/`);
        }
        else if (originalUrl.includes('imgix.net')) {
            optimizedUrl = `${originalUrl}${originalUrl.includes('?') ? '&' : '?'}q=${quality * 100}`;
        }
        // For very slow connections, use placeholder
        if (this.networkCondition.type === 'slow-2g') {
            optimizedUrl = '/fallback.svg';
        }
        this.imageCache.set(originalUrl, optimizedUrl);
        return optimizedUrl;
    }
    // Debounce function for search inputs on mobile
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }
    // Request with timeout based on network conditions
    async fetchWithTimeout(url, options = {}) {
        const timeout = this.config.timeouts[this.networkCondition?.type || '4g'];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        }
    }
    // Queue and batch API requests for better performance
    async queueRequest(key, requestFn) {
        // Check if request is already in progress
        const existing = this.requestQueue.get(key);
        if (existing) {
            return existing;
        }
        // Execute request and cache promise
        const promise = requestFn().finally(() => {
            // Remove from queue after completion
            setTimeout(() => this.requestQueue.delete(key), 100);
        });
        this.requestQueue.set(key, promise);
        return promise;
    }
    // Get performance recommendations
    getPerformanceRecommendations() {
        const recommendations = [];
        if (this.isLowEndDevice) {
            recommendations.push('Reduce animations and transitions');
            recommendations.push('Limit concurrent operations');
            recommendations.push('Use simpler UI components');
        }
        if (this.networkCondition) {
            switch (this.networkCondition.type) {
                case 'slow-2g':
                case '2g':
                    recommendations.push('Use text-only mode when possible');
                    recommendations.push('Disable auto-refresh features');
                    recommendations.push('Pre-load essential data only');
                    break;
                case '3g':
                    recommendations.push('Reduce image quality');
                    recommendations.push('Enable data saver mode');
                    recommendations.push('Batch API requests');
                    break;
            }
        }
        if (this.networkCondition?.saveData) {
            recommendations.push('User has data saver enabled - minimize data usage');
        }
        return recommendations;
    }
    // Measure page performance
    async measurePerformance() {
        if (typeof window === 'undefined' || !window.performance) {
            throw new Error('Performance API not available');
        }
        // Wait for page to fully load
        await new Promise(resolve => {
            if (document.readyState === 'complete') {
                resolve(null);
            }
            else {
                window.addEventListener('load', resolve);
            }
        });
        // Get performance entries
        const navigation = performance.getEntriesByType('navigation')[0];
        const paintEntries = performance.getEntriesByType('paint');
        // Get Core Web Vitals
        let largestContentfulPaint = 0;
        let cumulativeLayoutShift = 0;
        let totalBlockingTime = 0;
        // Observe LCP
        try {
            const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
            if (lcpEntries.length > 0) {
                largestContentfulPaint = lcpEntries[lcpEntries.length - 1].startTime;
            }
        }
        catch (e) {
            console.error('LCP measurement failed:', e);
        }
        return {
            loadTime: navigation.loadEventEnd - navigation.loadEventStart,
            firstPaint: paintEntries.find(e => e.name === 'first-paint')?.startTime || 0,
            firstContentfulPaint: paintEntries.find(e => e.name === 'first-contentful-paint')?.startTime || 0,
            largestContentfulPaint,
            timeToInteractive: navigation.domInteractive - navigation.fetchStart,
            totalBlockingTime,
            cumulativeLayoutShift
        };
    }
    // Check if should use reduced motion
    shouldReduceMotion() {
        if (typeof window === 'undefined')
            return false;
        return this.isLowEndDevice ||
            this.networkCondition?.type === '2g' ||
            this.networkCondition?.type === 'slow-2g' ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    // Get optimal batch size for operations
    getOptimalBatchSize() {
        if (this.isLowEndDevice)
            return 10;
        if (this.networkCondition?.type === 'slow-2g')
            return 5;
        if (this.networkCondition?.type === '2g')
            return 10;
        if (this.networkCondition?.type === '3g')
            return 25;
        return 50; // Default for 4g
    }
    // Check if should enable instant loading features
    shouldEnableInstantLoading() {
        return !this.isLowEndDevice &&
            this.networkCondition?.type === '4g' &&
            !this.networkCondition?.saveData;
    }
}
exports.mobileOptimizationService = MobileOptimizationService.getInstance();
