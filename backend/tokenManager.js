// Token structure for better traceability
export class TokenManager {
  
  /**
   * Generate a new user token
   * Format: usr_[timestamp]_[random]
   * Example: usr_1729348923_a3f2c9d1e4b5
   */
  static generateToken() {
    const timestamp = Date.now();
    const randomBytes = crypto.getRandomValues(new Uint8Array(16));
    const randomHex = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 12);
    
    return `usr_${timestamp}_${randomHex}`;
  }

  /**
   * Validate token format
   */
  static isValidFormat(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'Token is missing or not a string' };
    }
    
    // Check format: usr_[numbers]_[hexchars]
    const pattern = /^usr_\d{13}_[a-f0-9]{12}$/;
    if (!pattern.test(token)) {
      return { valid: false, reason: 'Token format is invalid' };
    }
    
    return { valid: true };
  }

  /**
   * Create user object
   */
  static createUser(email, limit = 5) {
    return {
      email,
      limit,
      analyses: [],
      createdAt: new Date().toISOString(),
      lastUsed: null,
      status: 'active' // active, suspended, expired
    };
  }

  /**
   * Validate user object from KV
   */
  static validateUser(userData, token) {
    if (!userData) {
      return { 
        valid: false, 
        reason: 'Token not found in database',
        code: 'TOKEN_NOT_FOUND'
      };
    }

    if (userData.status === 'suspended') {
      return { 
        valid: false, 
        reason: 'Account has been suspended',
        code: 'ACCOUNT_SUSPENDED'
      };
    }

    if (userData.status === 'expired') {
      return { 
        valid: false, 
        reason: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      };
    }

    if (userData.analyses.length >= userData.limit) {
      return { 
        valid: false, 
        reason: `Usage limit exceeded (${userData.limit} analyses used)`,
        code: 'LIMIT_EXCEEDED'
      };
    }

    return { valid: true, userData };
  }
}

export default TokenManager;
