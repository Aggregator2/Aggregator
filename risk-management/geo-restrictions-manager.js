const EventEmitter = require('events');
const { getSecureMetricsCollector } = require('../monitoring/secure-metrics-collector');

class GeoRestrictionsManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      // Default geographic restrictions
      blockedCountries: config.blockedCountries || [
        'US', 'CU', 'IR', 'KP', 'SY', 'MM' // OFAC sanctioned countries
      ],
      
      // Restricted countries (limited access)
      restrictedCountries: config.restrictedCountries || [
        'CN', 'RU', 'BY' // Countries with trading restrictions
      ],
      
      // Compliance frameworks
      complianceFrameworks: config.complianceFrameworks || {
        OFAC: { enabled: true, priority: 'critical' },
        EU_SANCTIONS: { enabled: true, priority: 'high' },
        UN_SANCTIONS: { enabled: true, priority: 'high' },
        FATF_GRAYLIST: { enabled: true, priority: 'medium' }
      },
      
      // IP geolocation settings
      geoProviders: config.geoProviders || [
        { name: 'maxmind', priority: 1, apiKey: process.env.MAXMIND_API_KEY },
        { name: 'ipapi', priority: 2, apiKey: process.env.IPAPI_KEY },
        { name: 'ipgeolocation', priority: 3, apiKey: process.env.IPGEO_API_KEY }
      ],
      
      // VPN/Proxy detection
      vpnDetection: config.vpnDetection !== false,
      vpnProviders: config.vpnProviders || [
        { name: 'iphub', apiKey: process.env.IPHUB_API_KEY },
        { name: 'vpnapi', apiKey: process.env.VPNAPI_KEY }
      ],
      
      // Caching settings
      ipCacheExpiry: config.ipCacheExpiry || 3600000, // 1 hour
      countryCacheExpiry: config.countryCacheExpiry || 86400000, // 24 hours
      maxCacheSize: config.maxCacheSize || 100000,
      
      // User verification
      kycRequiredCountries: config.kycRequiredCountries || [
        'DE', 'FR', 'UK', 'JP', 'AU', 'CA' // Countries requiring KYC
      ],
      
      // Trading restrictions by country
      tradingLimits: config.tradingLimits || {
        'CN': { dailyLimit: 10000, verificationRequired: true },
        'RU': { dailyLimit: 5000, verificationRequired: true },
        'TR': { dailyLimit: 20000, verificationRequired: false }
      },
      
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      keyPrefix: config.keyPrefix || 'risk:geo:',
      
      // Performance settings
      timeoutMs: config.timeoutMs || 5000,
      retryAttempts: config.retryAttempts || 3,
      batchSize: config.batchSize || 50,
      
      ...config
    };
    
    this.metrics = getSecureMetricsCollector();
    this.redis = null;
    this.isRunning = false;
    
    // Caching for performance
    this.ipLocationCache = new Map(); // IP -> location data
    this.countryDataCache = new Map(); // country -> compliance data
    this.vpnCache = new Map(); // IP -> VPN detection result
    
    // User location tracking
    this.userLocations = new Map(); // userId -> location history
    this.suspiciousLocations = new Map(); // userId -> suspicious location events
    
    // Compliance data
    this.sanctionLists = new Map(); // country -> sanction details
    this.complianceUpdates = new Map(); // framework -> last update time
    
    // Performance tracking
    this.performanceStats = {
      lookupsPerSecond: 0,
      averageLookupTime: 0,
      cacheHitRate: 0,
      vpnDetectionRate: 0,
      blockedRequests: 0,
      complianceChecks: 0
    };
    
    // Geolocation providers
    this.geoProviders = new Map();
    this.vpnProviders = new Map();
    
    // Rate limiting for external APIs
    this.rateLimiters = new Map();
  }

  async initialize() {
    try {
      // Initialize Redis connection
      const Redis = require('redis');
      this.redis = Redis.createClient({ url: this.config.redisUrl });
      await this.redis.connect();
      
      // Initialize geolocation providers
      await this.initializeGeoProviders();
      
      // Load compliance data
      await this.loadComplianceData();
      
      // Load cached data
      await this.loadLocationCache();
      
      // Initialize rate limiters
      this.initializeRateLimiters();
      
      console.log('✅ Geo restrictions manager initialized');
      
    } catch (error) {
      console.error('Failed to initialize geo restrictions manager:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;
    
    console.log('🌍 Starting geo restrictions manager...');
    this.isRunning = true;
    
    // Start compliance updates
    this.startComplianceUpdates();
    
    // Start cache maintenance
    this.startCacheMaintenance();
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
    
    console.log('✅ Geo restrictions manager started');
  }

  startComplianceUpdates() {
    this.complianceInterval = setInterval(async () => {
      try {
        await this.updateComplianceData();
      } catch (error) {
        console.error('Compliance update error:', error);
      }
    }, 86400000); // Daily updates
  }

  startCacheMaintenance() {
    this.cacheMaintenanceInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 3600000); // Every hour
  }

  startPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.updatePerformanceMetrics();
    }, 30000); // Every 30 seconds
  }

  initializeGeoProviders() {
    for (const provider of this.config.geoProviders) {
      if (provider.apiKey) {
        this.geoProviders.set(provider.name, {
          ...provider,
          client: this.createGeoClient(provider)
        });
      }
    }
    
    for (const provider of this.config.vpnProviders) {
      if (provider.apiKey) {
        this.vpnProviders.set(provider.name, {
          ...provider,
          client: this.createVpnClient(provider)
        });
      }
    }
  }

  createGeoClient(provider) {
    // Create HTTP client for geolocation provider
    const https = require('https');
    const http = require('http');
    
    return {
      lookup: async (ip) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Geolocation lookup timeout'));
          }, this.config.timeoutMs);
          
          try {
            const url = this.buildGeoUrl(provider, ip);
            const client = url.startsWith('https') ? https : http;
            
            const req = client.get(url, { 
              headers: this.getGeoHeaders(provider) 
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                clearTimeout(timeout);
                try {
                  const result = JSON.parse(data);
                  resolve(this.parseGeoResponse(provider, result));
                } catch (error) {
                  reject(error);
                }
              });
            });
            
            req.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      }
    };
  }

  createVpnClient(provider) {
    const https = require('https');
    
    return {
      detect: async (ip) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('VPN detection timeout'));
          }, this.config.timeoutMs);
          
          try {
            const url = this.buildVpnUrl(provider, ip);
            
            const req = https.get(url, {
              headers: this.getVpnHeaders(provider)
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                clearTimeout(timeout);
                try {
                  const result = JSON.parse(data);
                  resolve(this.parseVpnResponse(provider, result));
                } catch (error) {
                  reject(error);
                }
              });
            });
            
            req.on('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      }
    };
  }

  buildGeoUrl(provider, ip) {
    const urls = {
      maxmind: `https://geoip.maxmind.com/geoip/v2.1/country/${ip}`,
      ipapi: `https://ipapi.co/${ip}/json/`,
      ipgeolocation: `https://api.ipgeolocation.io/ipgeo?apiKey=${provider.apiKey}&ip=${ip}`
    };
    
    return urls[provider.name] || '';
  }

  buildVpnUrl(provider, ip) {
    const urls = {
      iphub: `https://v2.api.iphub.info/ip/${ip}`,
      vpnapi: `https://vpnapi.io/api/${ip}?key=${provider.apiKey}`
    };
    
    return urls[provider.name] || '';
  }

  getGeoHeaders(provider) {
    const headers = { 'User-Agent': 'DEX-Risk-Manager/1.0' };
    
    if (provider.name === 'maxmind' && provider.apiKey) {
      headers['Authorization'] = `Basic ${Buffer.from(provider.apiKey).toString('base64')}`;
    }
    
    return headers;
  }

  getVpnHeaders(provider) {
    const headers = { 'User-Agent': 'DEX-Risk-Manager/1.0' };
    
    if (provider.name === 'iphub' && provider.apiKey) {
      headers['X-Key'] = provider.apiKey;
    }
    
    return headers;
  }

  parseGeoResponse(provider, response) {
    const parsers = {
      maxmind: (data) => ({
        country: data.country?.iso_code,
        countryName: data.country?.names?.en,
        accuracy: data.traits?.accuracy_radius,
        provider: 'maxmind'
      }),
      
      ipapi: (data) => ({
        country: data.country_code,
        countryName: data.country_name,
        region: data.region,
        city: data.city,
        provider: 'ipapi'
      }),
      
      ipgeolocation: (data) => ({
        country: data.country_code2,
        countryName: data.country_name,
        region: data.state_prov,
        city: data.city,
        provider: 'ipgeolocation'
      })
    };
    
    const parser = parsers[provider.name];
    return parser ? parser(response) : {};
  }

  parseVpnResponse(provider, response) {
    const parsers = {
      iphub: (data) => ({
        isVpn: data.block === 1,
        vpnType: data.block === 1 ? 'detected' : 'none',
        confidence: data.block,
        provider: 'iphub'
      }),
      
      vpnapi: (data) => ({
        isVpn: data.security?.vpn || data.security?.proxy,
        vpnType: data.security?.vpn ? 'vpn' : data.security?.proxy ? 'proxy' : 'none',
        confidence: data.security?.vpn || data.security?.proxy ? 1 : 0,
        provider: 'vpnapi'
      })
    };
    
    const parser = parsers[provider.name];
    return parser ? parser(response) : { isVpn: false, vpnType: 'unknown', confidence: 0 };
  }

  async checkLocationCompliance(ip, userId = null) {
    const startTime = Date.now();
    
    try {
      // Get location data
      const location = await this.getLocationData(ip);
      
      // Check VPN/Proxy if enabled
      let vpnData = null;
      if (this.config.vpnDetection) {
        vpnData = await this.checkVpnUsage(ip);
      }
      
      // Perform compliance checks
      const compliance = await this.performComplianceChecks(location, vpnData);
      
      // Track user location if provided
      if (userId) {
        await this.trackUserLocation(userId, ip, location, compliance);
      }
      
      // Update metrics
      await this.updateComplianceMetrics(compliance);
      
      const result = {
        ip,
        userId,
        location,
        vpnData,
        compliance,
        timestamp: Date.now(),
        processingTime: Date.now() - startTime
      };
      
      // Emit compliance event
      this.emit('location_checked', result);
      
      return result;
      
    } catch (error) {
      console.error(`Location compliance check failed for ${ip}:`, error);
      
      // Return safe default (blocked)
      return {
        ip,
        userId,
        location: { country: 'UNKNOWN' },
        compliance: {
          allowed: false,
          reason: 'location_check_failed',
          restrictions: ['trading_suspended'],
          riskLevel: 'high'
        },
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  async getLocationData(ip) {
    // Check cache first
    const cacheKey = `location_${ip}`;
    let location = this.ipLocationCache.get(cacheKey);
    
    if (location && Date.now() - location.timestamp < this.config.ipCacheExpiry) {
      this.performanceStats.cacheHitRate++;
      return location;
    }
    
    // Try geolocation providers in priority order
    const providers = Array.from(this.geoProviders.values())
      .sort((a, b) => a.priority - b.priority);
    
    for (const provider of providers) {
      try {
        // Check rate limiting
        if (!this.canMakeRequest(provider.name)) {
          continue;
        }
        
        const result = await provider.client.lookup(ip);
        
        if (result.country) {
          location = {
            ...result,
            timestamp: Date.now(),
            source: provider.name
          };
          
          // Cache the result
          this.ipLocationCache.set(cacheKey, location);
          
          // Record successful lookup
          this.recordRequest(provider.name, true);
          
          return location;
        }
        
      } catch (error) {
        console.warn(`Geolocation lookup failed for provider ${provider.name}:`, error);
        this.recordRequest(provider.name, false);
      }
    }
    
    // Fallback to unknown location
    location = {
      country: 'UNKNOWN',
      provider: 'fallback',
      timestamp: Date.now()
    };
    
    this.ipLocationCache.set(cacheKey, location);
    return location;
  }

  async checkVpnUsage(ip) {
    // Check VPN cache first
    const cacheKey = `vpn_${ip}`;
    let vpnData = this.vpnCache.get(cacheKey);
    
    if (vpnData && Date.now() - vpnData.timestamp < this.config.ipCacheExpiry) {
      return vpnData;
    }
    
    // Try VPN detection providers
    for (const provider of this.vpnProviders.values()) {
      try {
        if (!this.canMakeRequest(`vpn_${provider.name}`)) {
          continue;
        }
        
        const result = await provider.client.detect(ip);
        
        vpnData = {
          ...result,
          timestamp: Date.now(),
          source: provider.name
        };
        
        // Cache the result
        this.vpnCache.set(cacheKey, vpnData);
        
        this.recordRequest(`vpn_${provider.name}`, true);
        
        if (result.isVpn) {
          this.performanceStats.vpnDetectionRate++;
        }
        
        return vpnData;
        
      } catch (error) {
        console.warn(`VPN detection failed for provider ${provider.name}:`, error);
        this.recordRequest(`vpn_${provider.name}`, false);
      }
    }
    
    // Fallback to no VPN detected
    vpnData = {
      isVpn: false,
      vpnType: 'unknown',
      confidence: 0,
      provider: 'fallback',
      timestamp: Date.now()
    };
    
    this.vpnCache.set(cacheKey, vpnData);
    return vpnData;
  }

  async performComplianceChecks(location, vpnData) {
    const country = location.country;
    const compliance = {
      allowed: true,
      restrictions: [],
      riskLevel: 'low',
      frameworks: {},
      requiresKyc: false,
      tradingLimits: null
    };
    
    // Check if country is blocked
    if (this.config.blockedCountries.includes(country)) {
      compliance.allowed = false;
      compliance.reason = 'country_blocked';
      compliance.restrictions.push('trading_blocked');
      compliance.riskLevel = 'critical';
      this.performanceStats.blockedRequests++;
    }
    
    // Check restricted countries
    if (this.config.restrictedCountries.includes(country)) {
      compliance.restrictions.push('limited_access');
      compliance.riskLevel = 'medium';
    }
    
    // Check VPN usage
    if (vpnData?.isVpn) {
      compliance.restrictions.push('vpn_detected');
      compliance.riskLevel = this.upgradeRiskLevel(compliance.riskLevel, 'high');
      
      // Some jurisdictions may block VPN usage
      if (this.config.blockedCountries.includes(country)) {
        compliance.allowed = false;
        compliance.reason = 'vpn_from_blocked_country';
      }
    }
    
    // Check compliance frameworks
    for (const [framework, config] of Object.entries(this.config.complianceFrameworks)) {
      if (config.enabled) {
        const frameworkResult = await this.checkComplianceFramework(framework, country);
        compliance.frameworks[framework] = frameworkResult;
        
        if (!frameworkResult.compliant) {
          compliance.allowed = false;
          compliance.reason = `${framework.toLowerCase()}_violation`;
          compliance.restrictions.push(`${framework.toLowerCase()}_sanctioned`);
          compliance.riskLevel = 'critical';
        }
      }
    }
    
    // Check KYC requirements
    if (this.config.kycRequiredCountries.includes(country)) {
      compliance.requiresKyc = true;
      compliance.restrictions.push('kyc_required');
    }
    
    // Check trading limits
    if (this.config.tradingLimits[country]) {
      compliance.tradingLimits = this.config.tradingLimits[country];
      compliance.restrictions.push('trading_limits_applied');
    }
    
    // Unknown country handling
    if (country === 'UNKNOWN') {
      compliance.allowed = false;
      compliance.reason = 'unknown_location';
      compliance.restrictions.push('location_verification_required');
      compliance.riskLevel = 'high';
    }
    
    this.performanceStats.complianceChecks++;
    
    return compliance;
  }

  async checkComplianceFramework(framework, country) {
    // Check cached compliance data
    const cacheKey = `compliance_${framework}_${country}`;
    let cached = this.countryDataCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.countryCacheExpiry) {
      return cached;
    }
    
    // Get sanctions data for framework
    const sanctionData = this.sanctionLists.get(framework) || {};
    
    const result = {
      compliant: !sanctionData[country],
      framework,
      country,
      sanctionLevel: sanctionData[country]?.level || 'none',
      lastUpdated: sanctionData.lastUpdated || 0,
      timestamp: Date.now()
    };
    
    // Cache the result
    this.countryDataCache.set(cacheKey, result);
    
    return result;
  }

  async trackUserLocation(userId, ip, location, compliance) {
    // Get user's location history
    let userHistory = this.userLocations.get(userId) || [];
    
    // Add current location
    const locationRecord = {
      ip,
      country: location.country,
      region: location.region,
      city: location.city,
      compliance,
      timestamp: Date.now()
    };
    
    userHistory.push(locationRecord);
    
    // Keep only recent history (last 100 records)
    if (userHistory.length > 100) {
      userHistory = userHistory.slice(-100);
    }
    
    this.userLocations.set(userId, userHistory);
    
    // Check for suspicious location changes
    await this.checkSuspiciousLocationChange(userId, userHistory);
    
    // Store in Redis for persistence
    await this.redis.hSet(
      `${this.config.keyPrefix}user_locations`,
      userId,
      JSON.stringify(userHistory.slice(-10)) // Store last 10 for performance
    );
  }

  async checkSuspiciousLocationChange(userId, locationHistory) {
    if (locationHistory.length < 2) return;
    
    const current = locationHistory[locationHistory.length - 1];
    const previous = locationHistory[locationHistory.length - 2];
    
    // Check for rapid country changes
    const timeDiff = current.timestamp - previous.timestamp;
    const countryChanged = current.country !== previous.country;
    
    if (countryChanged && timeDiff < 3600000) { // Less than 1 hour
      const suspiciousEvent = {
        userId,
        type: 'rapid_country_change',
        from: {
          country: previous.country,
          timestamp: previous.timestamp
        },
        to: {
          country: current.country,
          timestamp: current.timestamp
        },
        timeDiff,
        riskLevel: timeDiff < 300000 ? 'high' : 'medium', // Very suspicious if < 5 minutes
        id: this.generateEventId()
      };
      
      this.suspiciousLocations.set(suspiciousEvent.id, suspiciousEvent);
      
      this.emit('suspicious_location_change', suspiciousEvent);
      
      await this.metrics.incrementCounter('geo_restrictions.suspicious_locations', 1, {
        type: 'rapid_change',
        userId: this.hashUserId(userId)
      }, 'risk');
    }
    
    // Check for impossible travel
    await this.checkImpossibleTravel(userId, locationHistory);
  }

  async checkImpossibleTravel(userId, locationHistory) {
    if (locationHistory.length < 2) return;
    
    const current = locationHistory[locationHistory.length - 1];
    const previous = locationHistory[locationHistory.length - 2];
    
    // Skip if same country
    if (current.country === previous.country) return;
    
    // Calculate approximate travel time needed
    const distance = this.calculateDistance(previous, current);
    const timeDiff = (current.timestamp - previous.timestamp) / 1000 / 3600; // hours
    const maxSpeed = 1000; // km/h (commercial aircraft speed)
    
    const minimumTime = distance / maxSpeed;
    
    if (timeDiff < minimumTime) {
      const impossibleTravel = {
        userId,
        type: 'impossible_travel',
        from: previous,
        to: current,
        distance,
        timeDiff: timeDiff * 3600 * 1000, // back to milliseconds
        minimumTimeRequired: minimumTime * 3600 * 1000,
        riskLevel: 'critical',
        id: this.generateEventId()
      };
      
      this.suspiciousLocations.set(impossibleTravel.id, impossibleTravel);
      
      this.emit('impossible_travel_detected', impossibleTravel);
      
      await this.metrics.incrementCounter('geo_restrictions.impossible_travel', 1, {
        userId: this.hashUserId(userId)
      }, 'risk');
    }
  }

  calculateDistance(location1, location2) {
    // Simplified distance calculation using country centers
    // In production, would use actual coordinates and proper distance calculation
    const countryDistances = {
      'US-CN': 11000, 'US-RU': 8000, 'US-EU': 7000,
      'CN-EU': 7000, 'CN-JP': 2000, 'RU-EU': 2000,
      // Add more as needed
    };
    
    const key1 = `${location1.country}-${location2.country}`;
    const key2 = `${location2.country}-${location1.country}`;
    
    return countryDistances[key1] || countryDistances[key2] || 5000; // Default 5000km
  }

  upgradeRiskLevel(current, new_level) {
    const levels = { low: 1, medium: 2, high: 3, critical: 4 };
    const currentLevel = levels[current] || 1;
    const newLevel = levels[new_level] || 1;
    
    return newLevel > currentLevel ? new_level : current;
  }

  canMakeRequest(providerName) {
    const limiter = this.rateLimiters.get(providerName);
    if (!limiter) return true;
    
    const now = Date.now();
    const windowStart = Math.floor(now / 60000) * 60000; // 1-minute window
    
    if (limiter.window !== windowStart) {
      limiter.window = windowStart;
      limiter.count = 0;
    }
    
    return limiter.count < limiter.limit;
  }

  recordRequest(providerName, success) {
    const limiter = this.rateLimiters.get(providerName);
    if (limiter) {
      limiter.count++;
    }
    
    // Update performance stats
    if (success) {
      this.performanceStats.lookupsPerSecond++;
    }
  }

  initializeRateLimiters() {
    // Initialize rate limiters for external API providers
    const limits = {
      maxmind: { limit: 1000, window: 0, count: 0 }, // 1000/minute
      ipapi: { limit: 1000, window: 0, count: 0 },
      ipgeolocation: { limit: 1000, window: 0, count: 0 },
      vpn_iphub: { limit: 1000, window: 0, count: 0 },
      vpn_vpnapi: { limit: 1000, window: 0, count: 0 }
    };
    
    for (const [name, config] of Object.entries(limits)) {
      this.rateLimiters.set(name, config);
    }
  }

  async updateComplianceData() {
    console.log('Updating compliance data...');
    
    try {
      // Update OFAC sanctions list
      if (this.config.complianceFrameworks.OFAC?.enabled) {
        await this.updateOFACSanctions();
      }
      
      // Update EU sanctions
      if (this.config.complianceFrameworks.EU_SANCTIONS?.enabled) {
        await this.updateEUSanctions();
      }
      
      // Update UN sanctions
      if (this.config.complianceFrameworks.UN_SANCTIONS?.enabled) {
        await this.updateUNSanctions();
      }
      
      // Update FATF gray list
      if (this.config.complianceFrameworks.FATF_GRAYLIST?.enabled) {
        await this.updateFATFGraylist();
      }
      
      console.log('Compliance data updated successfully');
      
    } catch (error) {
      console.error('Failed to update compliance data:', error);
    }
  }

  async updateOFACSanctions() {
    // OFAC sanctions would be updated from official sources
    // For demo purposes, using static data
    const ofacSanctions = {
      'CU': { level: 'comprehensive', reason: 'Cuban embargo' },
      'IR': { level: 'comprehensive', reason: 'Iranian sanctions' },
      'KP': { level: 'comprehensive', reason: 'North Korean sanctions' },
      'SY': { level: 'comprehensive', reason: 'Syrian sanctions' },
      'MM': { level: 'targeted', reason: 'Myanmar sanctions' },
      lastUpdated: Date.now()
    };
    
    this.sanctionLists.set('OFAC', ofacSanctions);
    this.complianceUpdates.set('OFAC', Date.now());
    
    // Store in Redis
    await this.redis.set(
      `${this.config.keyPrefix}sanctions_OFAC`,
      JSON.stringify(ofacSanctions)
    );
  }

  async updateEUSanctions() {
    const euSanctions = {
      'RU': { level: 'targeted', reason: 'EU Russia sanctions' },
      'BY': { level: 'targeted', reason: 'EU Belarus sanctions' },
      lastUpdated: Date.now()
    };
    
    this.sanctionLists.set('EU_SANCTIONS', euSanctions);
    this.complianceUpdates.set('EU_SANCTIONS', Date.now());
    
    await this.redis.set(
      `${this.config.keyPrefix}sanctions_EU`,
      JSON.stringify(euSanctions)
    );
  }

  async updateUNSanctions() {
    const unSanctions = {
      'KP': { level: 'comprehensive', reason: 'UN North Korea sanctions' },
      'IR': { level: 'targeted', reason: 'UN Iran sanctions' },
      lastUpdated: Date.now()
    };
    
    this.sanctionLists.set('UN_SANCTIONS', unSanctions);
    this.complianceUpdates.set('UN_SANCTIONS', Date.now());
    
    await this.redis.set(
      `${this.config.keyPrefix}sanctions_UN`,
      JSON.stringify(unSanctions)
    );
  }

  async updateFATFGraylist() {
    const fatfGraylist = {
      'PK': { level: 'monitoring', reason: 'FATF gray list' },
      'JO': { level: 'monitoring', reason: 'FATF gray list' },
      lastUpdated: Date.now()
    };
    
    this.sanctionLists.set('FATF_GRAYLIST', fatfGraylist);
    this.complianceUpdates.set('FATF_GRAYLIST', Date.now());
    
    await this.redis.set(
      `${this.config.keyPrefix}sanctions_FATF`,
      JSON.stringify(fatfGraylist)
    );
  }

  async loadComplianceData() {
    try {
      // Load sanctions lists from Redis
      const frameworks = ['OFAC', 'EU_SANCTIONS', 'UN_SANCTIONS', 'FATF_GRAYLIST'];
      
      for (const framework of frameworks) {
        const data = await this.redis.get(`${this.config.keyPrefix}sanctions_${framework}`);
        if (data) {
          this.sanctionLists.set(framework, JSON.parse(data));
        }
      }
      
      console.log(`Loaded compliance data for ${this.sanctionLists.size} frameworks`);
      
    } catch (error) {
      console.error('Failed to load compliance data:', error);
    }
  }

  async loadLocationCache() {
    // Initialize empty caches - they will be populated as needed
    this.ipLocationCache.clear();
    this.vpnCache.clear();
    this.countryDataCache.clear();
  }

  cleanupExpiredCache() {
    const now = Date.now();
    
    // Cleanup IP location cache
    for (const [key, data] of this.ipLocationCache) {
      if (now - data.timestamp > this.config.ipCacheExpiry) {
        this.ipLocationCache.delete(key);
      }
    }
    
    // Cleanup VPN cache
    for (const [key, data] of this.vpnCache) {
      if (now - data.timestamp > this.config.ipCacheExpiry) {
        this.vpnCache.delete(key);
      }
    }
    
    // Cleanup country compliance cache
    for (const [key, data] of this.countryDataCache) {
      if (now - data.timestamp > this.config.countryCacheExpiry) {
        this.countryDataCache.delete(key);
      }
    }
    
    // Limit cache sizes
    if (this.ipLocationCache.size > this.config.maxCacheSize) {
      const entries = Array.from(this.ipLocationCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest 20%
      const toRemove = Math.floor(entries.length * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.ipLocationCache.delete(entries[i][0]);
      }
    }
  }

  async updatePerformanceMetrics() {
    await this.metrics.setGauge('geo_restrictions.lookups_per_second', 
      this.performanceStats.lookupsPerSecond, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.cache_hit_rate', 
      this.performanceStats.cacheHitRate, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.vpn_detection_rate', 
      this.performanceStats.vpnDetectionRate, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.blocked_requests', 
      this.performanceStats.blockedRequests, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.compliance_checks', 
      this.performanceStats.complianceChecks, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.cache_size', 
      this.ipLocationCache.size, {}, 'risk');
    
    await this.metrics.setGauge('geo_restrictions.suspicious_locations', 
      this.suspiciousLocations.size, {}, 'risk');
    
    // Reset counters
    this.performanceStats.lookupsPerSecond = 0;
    this.performanceStats.cacheHitRate = 0;
    this.performanceStats.vpnDetectionRate = 0;
  }

  async updateComplianceMetrics(compliance) {
    await this.metrics.incrementCounter('geo_restrictions.compliance_checks', 1, {
      allowed: compliance.allowed,
      riskLevel: compliance.riskLevel
    }, 'risk');
    
    if (!compliance.allowed) {
      await this.metrics.incrementCounter('geo_restrictions.blocked_requests', 1, {
        reason: compliance.reason
      }, 'risk');
    }
    
    for (const restriction of compliance.restrictions) {
      await this.metrics.incrementCounter('geo_restrictions.restrictions_applied', 1, {
        type: restriction
      }, 'risk');
    }
  }

  generateEventId() {
    const crypto = require('crypto');
    return `geo_event_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  hashUserId(userId) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(userId.toString()).digest('hex').substring(0, 16);
  }

  getUserLocationHistory(userId) {
    return this.userLocations.get(userId) || [];
  }

  getSuspiciousLocationEvents(userId = null) {
    if (userId) {
      return Array.from(this.suspiciousLocations.values())
        .filter(event => event.userId === userId);
    }
    return Array.from(this.suspiciousLocations.values());
  }

  getGeoRestrictionsStatus() {
    return {
      isRunning: this.isRunning,
      cacheStats: {
        ipLocationCache: this.ipLocationCache.size,
        vpnCache: this.vpnCache.size,
        countryDataCache: this.countryDataCache.size
      },
      providersActive: {
        geoProviders: this.geoProviders.size,
        vpnProviders: this.vpnProviders.size
      },
      compliance: {
        sanctionLists: this.sanctionLists.size,
        lastUpdates: Object.fromEntries(this.complianceUpdates)
      },
      tracking: {
        usersTracked: this.userLocations.size,
        suspiciousEvents: this.suspiciousLocations.size
      },
      performance: this.performanceStats
    };
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping geo restrictions manager...');
    
    // Stop intervals
    if (this.complianceInterval) clearInterval(this.complianceInterval);
    if (this.cacheMaintenanceInterval) clearInterval(this.cacheMaintenanceInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Close Redis connection
    if (this.redis) {
      this.redis.quit();
    }
    
    // Clear caches
    this.ipLocationCache.clear();
    this.countryDataCache.clear();
    this.vpnCache.clear();
    this.userLocations.clear();
    this.suspiciousLocations.clear();
    this.sanctionLists.clear();
    this.complianceUpdates.clear();
    this.geoProviders.clear();
    this.vpnProviders.clear();
    this.rateLimiters.clear();
    
    this.isRunning = false;
    console.log('✅ Geo restrictions manager stopped');
  }
}

module.exports = GeoRestrictionsManager;