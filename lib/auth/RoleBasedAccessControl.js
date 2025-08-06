/**
 * @title Role-Based Access Control (RBAC) System
 * @author DEX Security Team
 * @notice Comprehensive RBAC system with hierarchical roles and fine-grained permissions
 * @dev Implements enterprise-grade access control with dynamic permissions and audit trails
 */

const crypto = require('crypto');

class RoleBasedAccessControl {
    constructor(config) {
        this.config = {
            enableHierarchy: config.enableHierarchy !== false, // Default true
            enableDynamicPermissions: config.enableDynamicPermissions || true,
            enableAuditLogging: config.enableAuditLogging !== false, // Default true
            cacheTimeout: config.cacheTimeout || 300000, // 5 minutes
            maxRoleDepth: config.maxRoleDepth || 10,
            ...config
        };

        // Core RBAC data structures
        this.roles = new Map(); // roleId -> Role object
        this.permissions = new Map(); // permissionId -> Permission object
        this.userRoles = new Map(); // userId -> Set of roleIds
        this.roleHierarchy = new Map(); // parentRole -> Set of childRoles
        this.rolePermissions = new Map(); // roleId -> Set of permissionIds
        this.permissionCache = new Map(); // userId -> { permissions, timestamp }
        
        // Context-based permissions
        this.contextualPermissions = new Map(); // context -> Map of rules
        this.dynamicRoles = new Map(); // Temporary roles based on conditions
        
        // Audit and security
        this.auditLogger = config.auditLogger || console;
        this.securityLogger = config.securityLogger || console;
        
        // Initialize with default roles and permissions
        this._initializeDefaultRBAC();
        this._startCacheCleanup();
    }

    // =============================================================================
    // ROLE MANAGEMENT
    // =============================================================================

    /**
     * Create a new role
     * @param {Object} roleData Role configuration
     * @returns {Promise<string>} Role ID
     */
    async createRole(roleData) {
        try {
            const {
                name,
                description,
                parentRoles = [],
                permissions = [],
                isSystem = false,
                metadata = {}
            } = roleData;

            // Validate role data
            this._validateRoleData(roleData);

            const roleId = this._generateRoleId(name);
            
            // Check if role already exists
            if (this.roles.has(roleId)) {
                throw new RBACError(`Role '${name}' already exists`);
            }

            // Validate parent roles exist
            for (const parentRole of parentRoles) {
                if (!this.roles.has(parentRole)) {
                    throw new RBACError(`Parent role '${parentRole}' does not exist`);
                }
            }

            // Check for circular hierarchy
            await this._checkCircularHierarchy(roleId, parentRoles);

            const role = {
                id: roleId,
                name,
                description,
                parentRoles: new Set(parentRoles),
                permissions: new Set(permissions),
                isSystem,
                metadata,
                createdAt: Date.now(),
                createdBy: metadata.createdBy || 'system',
                isActive: true
            };

            // Store role
            this.roles.set(roleId, role);

            // Update hierarchy
            await this._updateRoleHierarchy(roleId, parentRoles);

            // Assign permissions
            await this._assignPermissionsToRole(roleId, permissions);

            // Clear permission cache for affected users
            await this._clearCacheForRole(roleId);

            await this.auditLogger.logRoleCreated?.({
                roleId,
                name,
                parentRoles,
                permissions,
                createdBy: metadata.createdBy
            });

            return roleId;

        } catch (error) {
            await this.securityLogger.logRoleError?.({
                action: 'create_role',
                error: error.message,
                roleData
            });
            throw error;
        }
    }

    /**
     * Update an existing role
     * @param {string} roleId Role ID
     * @param {Object} updates Role updates
     * @returns {Promise<void>}
     */
    async updateRole(roleId, updates) {
        try {
            const role = this.roles.get(roleId);
            if (!role) {
                throw new RBACError(`Role '${roleId}' not found`);
            }

            if (role.isSystem && !updates.allowSystemModification) {
                throw new RBACError('Cannot modify system role without explicit permission');
            }

            const oldRole = { ...role };

            // Update basic properties
            if (updates.description !== undefined) {
                role.description = updates.description;
            }
            if (updates.metadata !== undefined) {
                role.metadata = { ...role.metadata, ...updates.metadata };
            }

            // Update parent roles
            if (updates.parentRoles !== undefined) {
                await this._checkCircularHierarchy(roleId, updates.parentRoles);
                role.parentRoles = new Set(updates.parentRoles);
                await this._updateRoleHierarchy(roleId, updates.parentRoles);
            }

            // Update permissions
            if (updates.permissions !== undefined) {
                role.permissions = new Set(updates.permissions);
                await this._assignPermissionsToRole(roleId, updates.permissions);
            }

            role.updatedAt = Date.now();
            role.updatedBy = updates.updatedBy || 'system';

            // Clear affected caches
            await this._clearCacheForRole(roleId);

            await this.auditLogger.logRoleUpdated?.({
                roleId,
                oldRole: this._sanitizeRoleForLogging(oldRole),
                newRole: this._sanitizeRoleForLogging(role),
                updatedBy: updates.updatedBy
            });

        } catch (error) {
            await this.securityLogger.logRoleError?.({
                action: 'update_role',
                roleId,
                error: error.message,
                updates
            });
            throw error;
        }
    }

    /**
     * Delete a role
     * @param {string} roleId Role ID
     * @param {Object} options Deletion options
     * @returns {Promise<void>}
     */
    async deleteRole(roleId, options = {}) {
        try {
            const role = this.roles.get(roleId);
            if (!role) {
                throw new RBACError(`Role '${roleId}' not found`);
            }

            if (role.isSystem && !options.allowSystemDeletion) {
                throw new RBACError('Cannot delete system role without explicit permission');
            }

            // Check if role is assigned to users
            const usersWithRole = await this._getUsersWithRole(roleId);
            if (usersWithRole.length > 0 && !options.force) {
                throw new RBACError(`Cannot delete role '${roleId}': assigned to ${usersWithRole.length} users`);
            }

            // Remove role from all users
            for (const userId of usersWithRole) {
                await this.removeRoleFromUser(userId, roleId);
            }

            // Remove from hierarchy
            await this._removeFromHierarchy(roleId);

            // Delete role
            this.roles.delete(roleId);
            this.rolePermissions.delete(roleId);

            await this.auditLogger.logRoleDeleted?.({
                roleId,
                roleName: role.name,
                usersAffected: usersWithRole.length,
                deletedBy: options.deletedBy
            });

        } catch (error) {
            await this.securityLogger.logRoleError?.({
                action: 'delete_role',
                roleId,
                error: error.message,
                options
            });
            throw error;
        }
    }

    // =============================================================================
    // PERMISSION MANAGEMENT
    // =============================================================================

    /**
     * Create a new permission
     * @param {Object} permissionData Permission configuration
     * @returns {Promise<string>} Permission ID
     */
    async createPermission(permissionData) {
        try {
            const {
                name,
                resource,
                action,
                description,
                conditions = [],
                metadata = {}
            } = permissionData;

            this._validatePermissionData(permissionData);

            const permissionId = this._generatePermissionId(resource, action);

            if (this.permissions.has(permissionId)) {
                throw new RBACError(`Permission '${permissionId}' already exists`);
            }

            const permission = {
                id: permissionId,
                name,
                resource,
                action,
                description,
                conditions,
                metadata,
                createdAt: Date.now(),
                createdBy: metadata.createdBy || 'system',
                isActive: true
            };

            this.permissions.set(permissionId, permission);

            await this.auditLogger.logPermissionCreated?.({
                permissionId,
                name,
                resource,
                action,
                createdBy: metadata.createdBy
            });

            return permissionId;

        } catch (error) {
            await this.securityLogger.logPermissionError?.({
                action: 'create_permission',
                error: error.message,
                permissionData
            });
            throw error;
        }
    }

    /**
     * Assign permission to role
     * @param {string} roleId Role ID
     * @param {string} permissionId Permission ID
     * @returns {Promise<void>}
     */
    async assignPermissionToRole(roleId, permissionId) {
        try {
            const role = this.roles.get(roleId);
            const permission = this.permissions.get(permissionId);

            if (!role) {
                throw new RBACError(`Role '${roleId}' not found`);
            }
            if (!permission) {
                throw new RBACError(`Permission '${permissionId}' not found`);
            }

            role.permissions.add(permissionId);
            
            if (!this.rolePermissions.has(roleId)) {
                this.rolePermissions.set(roleId, new Set());
            }
            this.rolePermissions.get(roleId).add(permissionId);

            // Clear permission cache
            await this._clearCacheForRole(roleId);

            await this.auditLogger.logPermissionAssigned?.({
                roleId,
                permissionId,
                roleName: role.name,
                permissionName: permission.name
            });

        } catch (error) {
            await this.securityLogger.logPermissionError?.({
                action: 'assign_permission',
                roleId,
                permissionId,
                error: error.message
            });
            throw error;
        }
    }

    // =============================================================================
    // USER ROLE MANAGEMENT
    // =============================================================================

    /**
     * Assign role to user
     * @param {string} userId User ID
     * @param {string} roleId Role ID
     * @param {Object} options Assignment options
     * @returns {Promise<void>}
     */
    async assignRoleToUser(userId, roleId, options = {}) {
        try {
            const role = this.roles.get(roleId);
            if (!role) {
                throw new RBACError(`Role '${roleId}' not found`);
            }

            if (!role.isActive) {
                throw new RBACError(`Role '${roleId}' is inactive`);
            }

            if (!this.userRoles.has(userId)) {
                this.userRoles.set(userId, new Set());
            }

            const userRoleSet = this.userRoles.get(userId);
            
            // Check if user already has role
            if (userRoleSet.has(roleId)) {
                return; // Already assigned
            }

            // Check role assignment limits
            await this._checkRoleAssignmentLimits(userId, roleId);

            userRoleSet.add(roleId);

            // Clear user's permission cache
            this.permissionCache.delete(userId);

            await this.auditLogger.logRoleAssigned?.({
                userId,
                roleId,
                roleName: role.name,
                assignedBy: options.assignedBy,
                expiresAt: options.expiresAt
            });

        } catch (error) {
            await this.securityLogger.logRoleError?.({
                action: 'assign_role_to_user',
                userId,
                roleId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Remove role from user
     * @param {string} userId User ID
     * @param {string} roleId Role ID
     * @param {Object} options Removal options
     * @returns {Promise<void>}
     */
    async removeRoleFromUser(userId, roleId, options = {}) {
        try {
            const userRoleSet = this.userRoles.get(userId);
            if (!userRoleSet || !userRoleSet.has(roleId)) {
                return; // Role not assigned
            }

            const role = this.roles.get(roleId);
            userRoleSet.delete(roleId);

            if (userRoleSet.size === 0) {
                this.userRoles.delete(userId);
            }

            // Clear user's permission cache
            this.permissionCache.delete(userId);

            await this.auditLogger.logRoleRemoved?.({
                userId,
                roleId,
                roleName: role?.name,
                removedBy: options.removedBy
            });

        } catch (error) {
            await this.securityLogger.logRoleError?.({
                action: 'remove_role_from_user',
                userId,
                roleId,
                error: error.message
            });
            throw error;
        }
    }

    // =============================================================================
    // PERMISSION CHECKING
    // =============================================================================

    /**
     * Check if user has permission
     * @param {string} userId User ID
     * @param {string} resource Resource name
     * @param {string} action Action name
     * @param {Object} context Additional context
     * @returns {Promise<boolean>} True if user has permission
     */
    async hasPermission(userId, resource, action, context = {}) {
        try {
            const userPermissions = await this.getUserPermissions(userId);
            const permissionId = this._generatePermissionId(resource, action);
            
            // Check direct permission
            const hasDirectPermission = userPermissions.has(permissionId);
            if (hasDirectPermission) {
                // Check contextual conditions
                return await this._checkPermissionConditions(userId, permissionId, context);
            }

            // Check wildcard permissions
            const wildcardPermissions = [
                this._generatePermissionId(resource, '*'),
                this._generatePermissionId('*', action),
                this._generatePermissionId('*', '*')
            ];

            for (const wildcardPermission of wildcardPermissions) {
                if (userPermissions.has(wildcardPermission)) {
                    const hasWildcardPermission = await this._checkPermissionConditions(
                        userId, 
                        wildcardPermission, 
                        context
                    );
                    if (hasWildcardPermission) {
                        return true;
                    }
                }
            }

            // Check dynamic permissions
            if (this.config.enableDynamicPermissions) {
                return await this._checkDynamicPermissions(userId, resource, action, context);
            }

            return false;

        } catch (error) {
            await this.securityLogger.logPermissionError?.({
                action: 'check_permission',
                userId,
                resource,
                action,
                error: error.message
            });
            return false; // Fail secure
        }
    }

    /**
     * Get all permissions for user (with caching)
     * @param {string} userId User ID
     * @param {boolean} useCache Whether to use cache
     * @returns {Promise<Set>} Set of permission IDs
     */
    async getUserPermissions(userId, useCache = true) {
        // Check cache first
        if (useCache) {
            const cached = this.permissionCache.get(userId);
            if (cached && (Date.now() - cached.timestamp) < this.config.cacheTimeout) {
                return cached.permissions;
            }
        }

        const permissions = new Set();
        const userRoleSet = this.userRoles.get(userId);

        if (!userRoleSet) {
            return permissions;
        }

        // Get permissions from all roles (including inherited)
        const allRoles = await this._getAllUserRoles(userId);
        
        for (const roleId of allRoles) {
            const rolePermissions = this.rolePermissions.get(roleId);
            if (rolePermissions) {
                for (const permission of rolePermissions) {
                    permissions.add(permission);
                }
            }
        }

        // Cache the result
        this.permissionCache.set(userId, {
            permissions,
            timestamp: Date.now()
        });

        return permissions;
    }

    /**
     * Get all roles for user including inherited roles
     * @param {string} userId User ID
     * @returns {Promise<Set>} Set of role IDs
     */
    async getUserRoles(userId) {
        return await this._getAllUserRoles(userId);
    }

    /**
     * Check multiple permissions at once
     * @param {string} userId User ID
     * @param {Array} permissionChecks Array of {resource, action, context}
     * @returns {Promise<Object>} Permission check results
     */
    async checkMultiplePermissions(userId, permissionChecks) {
        const results = {};
        
        for (const check of permissionChecks) {
            const key = `${check.resource}:${check.action}`;
            try {
                results[key] = await this.hasPermission(
                    userId, 
                    check.resource, 
                    check.action, 
                    check.context || {}
                );
            } catch (error) {
                results[key] = false;
            }
        }

        return results;
    }

    // =============================================================================
    // CONTEXTUAL AND DYNAMIC PERMISSIONS
    // =============================================================================

    /**
     * Add contextual permission rule
     * @param {string} context Context name
     * @param {Object} rule Permission rule
     * @returns {Promise<void>}
     */
    async addContextualRule(context, rule) {
        if (!this.contextualPermissions.has(context)) {
            this.contextualPermissions.set(context, new Map());
        }
        
        const contextRules = this.contextualPermissions.get(context);
        const ruleId = crypto.randomUUID();
        
        contextRules.set(ruleId, {
            ...rule,
            id: ruleId,
            createdAt: Date.now()
        });

        return ruleId;
    }

    /**
     * Create temporary role with conditions
     * @param {string} userId User ID
     * @param {Object} roleConfig Temporary role configuration
     * @returns {Promise<string>} Temporary role ID
     */
    async createTemporaryRole(userId, roleConfig) {
        const {
            permissions,
            conditions,
            expiresAt,
            reason
        } = roleConfig;

        const tempRoleId = `temp_${crypto.randomUUID()}`;
        
        this.dynamicRoles.set(tempRoleId, {
            userId,
            permissions: new Set(permissions),
            conditions,
            expiresAt,
            reason,
            createdAt: Date.now()
        });

        // Auto-cleanup expired role
        if (expiresAt) {
            setTimeout(() => {
                this.dynamicRoles.delete(tempRoleId);
            }, expiresAt - Date.now());
        }

        await this.auditLogger.logTemporaryRoleCreated?.({
            tempRoleId,
            userId,
            permissions,
            expiresAt,
            reason
        });

        return tempRoleId;
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    /**
     * Get all roles for user including inherited ones
     * @param {string} userId User ID
     * @returns {Promise<Set>} All role IDs
     * @private
     */
    async _getAllUserRoles(userId) {
        const allRoles = new Set();
        const userRoleSet = this.userRoles.get(userId);

        if (!userRoleSet) {
            return allRoles;
        }

        // Add direct roles
        for (const roleId of userRoleSet) {
            allRoles.add(roleId);
            
            // Add inherited roles if hierarchy is enabled
            if (this.config.enableHierarchy) {
                const inheritedRoles = await this._getInheritedRoles(roleId);
                for (const inheritedRole of inheritedRoles) {
                    allRoles.add(inheritedRole);
                }
            }
        }

        return allRoles;
    }

    /**
     * Get inherited roles from role hierarchy
     * @param {string} roleId Role ID
     * @param {Set} visited Visited roles (for cycle detection)
     * @returns {Promise<Set>} Inherited role IDs
     * @private
     */
    async _getInheritedRoles(roleId, visited = new Set()) {
        if (visited.has(roleId)) {
            return new Set(); // Prevent infinite recursion
        }

        visited.add(roleId);
        const inheritedRoles = new Set();
        const role = this.roles.get(roleId);

        if (!role) {
            return inheritedRoles;
        }

        for (const parentRoleId of role.parentRoles) {
            inheritedRoles.add(parentRoleId);
            
            // Recursively get parent's inherited roles
            const parentInherited = await this._getInheritedRoles(parentRoleId, visited);
            for (const inheritedRole of parentInherited) {
                inheritedRoles.add(inheritedRole);
            }
        }

        return inheritedRoles;
    }

    /**
     * Check permission conditions
     * @param {string} userId User ID
     * @param {string} permissionId Permission ID
     * @param {Object} context Context data
     * @returns {Promise<boolean>} True if conditions are met
     * @private
     */
    async _checkPermissionConditions(userId, permissionId, context) {
        const permission = this.permissions.get(permissionId);
        if (!permission || !permission.conditions.length) {
            return true;
        }

        for (const condition of permission.conditions) {
            const conditionMet = await this._evaluateCondition(condition, userId, context);
            if (!conditionMet) {
                return false;
            }
        }

        return true;
    }

    /**
     * Evaluate a single condition
     * @param {Object} condition Condition to evaluate
     * @param {string} userId User ID
     * @param {Object} context Context data
     * @returns {Promise<boolean>} True if condition is met
     * @private
     */
    async _evaluateCondition(condition, userId, context) {
        const { type, field, operator, value } = condition;

        switch (type) {
            case 'context':
                return this._evaluateContextCondition(field, operator, value, context);
            case 'time':
                return this._evaluateTimeCondition(field, operator, value);
            case 'user':
                return this._evaluateUserCondition(field, operator, value, userId);
            default:
                return true;
        }
    }

    /**
     * Check dynamic permissions based on runtime conditions
     * @param {string} userId User ID
     * @param {string} resource Resource name
     * @param {string} action Action name
     * @param {Object} context Context data
     * @returns {Promise<boolean>} True if dynamic permission is granted
     * @private
     */
    async _checkDynamicPermissions(userId, resource, action, context) {
        // Check temporary roles
        for (const [tempRoleId, tempRole] of this.dynamicRoles.entries()) {
            if (tempRole.userId !== userId) continue;
            
            // Check if temporary role has expired
            if (tempRole.expiresAt && Date.now() > tempRole.expiresAt) {
                this.dynamicRoles.delete(tempRoleId);
                continue;
            }

            // Check if temp role has the permission
            const permissionId = this._generatePermissionId(resource, action);
            if (tempRole.permissions.has(permissionId)) {
                // Check conditions if any
                if (tempRole.conditions) {
                    const conditionsMet = await this._evaluateConditions(tempRole.conditions, userId, context);
                    if (conditionsMet) {
                        return true;
                    }
                } else {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Initialize default RBAC structure
     * @private
     */
    _initializeDefaultRBAC() {
        // Create default permissions
        const defaultPermissions = [
            { resource: 'orders', action: 'read', name: 'Read Orders' },
            { resource: 'orders', action: 'create', name: 'Create Orders' },
            { resource: 'orders', action: 'update', name: 'Update Orders' },
            { resource: 'orders', action: 'delete', name: 'Delete Orders' },
            { resource: 'trades', action: 'read', name: 'Read Trades' },
            { resource: 'trades', action: 'execute', name: 'Execute Trades' },
            { resource: 'admin', action: '*', name: 'Admin Access' },
            { resource: '*', action: '*', name: 'Super Admin' }
        ];

        for (const permission of defaultPermissions) {
            this.createPermission({
                ...permission,
                description: `Permission to ${permission.action} ${permission.resource}`,
                metadata: { createdBy: 'system', isDefault: true }
            }).catch(console.error);
        }

        // Create default roles
        const defaultRoles = [
            {
                name: 'Trader',
                description: 'Basic trader role',
                permissions: ['orders:read', 'orders:create', 'trades:read', 'trades:execute'],
                isSystem: true
            },
            {
                name: 'Market Maker',
                description: 'Market maker role with enhanced trading permissions',
                permissions: ['orders:read', 'orders:create', 'orders:update', 'trades:read', 'trades:execute'],
                parentRoles: ['trader'],
                isSystem: true
            },
            {
                name: 'Admin',
                description: 'Administrative role',
                permissions: ['admin:*'],
                isSystem: true
            },
            {
                name: 'Super Admin',
                description: 'Super administrative role with all permissions',
                permissions: ['*:*'],
                parentRoles: ['admin'],
                isSystem: true
            }
        ];

        for (const role of defaultRoles) {
            this.createRole({
                ...role,
                metadata: { createdBy: 'system', isDefault: true }
            }).catch(console.error);
        }
    }

    /**
     * Generate role ID from role name
     * @param {string} name Role name
     * @returns {string} Role ID
     * @private
     */
    _generateRoleId(name) {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }

    /**
     * Generate permission ID from resource and action
     * @param {string} resource Resource name
     * @param {string} action Action name
     * @returns {string} Permission ID
     * @private
     */
    _generatePermissionId(resource, action) {
        return `${resource}:${action}`;
    }

    /**
     * Validate role data
     * @param {Object} roleData Role data to validate
     * @private
     */
    _validateRoleData(roleData) {
        if (!roleData.name || typeof roleData.name !== 'string') {
            throw new RBACError('Role name is required and must be a string');
        }
        if (roleData.name.length < 2 || roleData.name.length > 50) {
            throw new RBACError('Role name must be between 2 and 50 characters');
        }
    }

    /**
     * Validate permission data
     * @param {Object} permissionData Permission data to validate
     * @private
     */
    _validatePermissionData(permissionData) {
        if (!permissionData.resource || typeof permissionData.resource !== 'string') {
            throw new RBACError('Permission resource is required and must be a string');
        }
        if (!permissionData.action || typeof permissionData.action !== 'string') {
            throw new RBACError('Permission action is required and must be a string');
        }
    }

    /**
     * Check for circular hierarchy
     * @param {string} roleId Role ID
     * @param {Array} parentRoles Parent role IDs
     * @private
     */
    async _checkCircularHierarchy(roleId, parentRoles) {
        // Implementation would check for circular references in role hierarchy
        // For now, this is a placeholder
        return true;
    }

    /**
     * Update role hierarchy mappings
     * @param {string} roleId Role ID
     * @param {Array} parentRoles Parent role IDs
     * @private
     */
    async _updateRoleHierarchy(roleId, parentRoles) {
        // Remove old hierarchy relationships
        for (const [parentId, children] of this.roleHierarchy.entries()) {
            children.delete(roleId);
        }

        // Add new hierarchy relationships
        for (const parentId of parentRoles) {
            if (!this.roleHierarchy.has(parentId)) {
                this.roleHierarchy.set(parentId, new Set());
            }
            this.roleHierarchy.get(parentId).add(roleId);
        }
    }

    /**
     * Assign permissions to role
     * @param {string} roleId Role ID
     * @param {Array} permissions Permission IDs
     * @private
     */
    async _assignPermissionsToRole(roleId, permissions) {
        if (!this.rolePermissions.has(roleId)) {
            this.rolePermissions.set(roleId, new Set());
        }
        
        const rolePermissionSet = this.rolePermissions.get(roleId);
        rolePermissionSet.clear();
        
        for (const permissionId of permissions) {
            rolePermissionSet.add(permissionId);
        }
    }

    /**
     * Clear permission cache for users with specific role
     * @param {string} roleId Role ID
     * @private
     */
    async _clearCacheForRole(roleId) {
        const usersWithRole = await this._getUsersWithRole(roleId);
        for (const userId of usersWithRole) {
            this.permissionCache.delete(userId);
        }
    }

    /**
     * Get users with specific role
     * @param {string} roleId Role ID
     * @returns {Array} User IDs
     * @private
     */
    async _getUsersWithRole(roleId) {
        const users = [];
        for (const [userId, userRoles] of this.userRoles.entries()) {
            if (userRoles.has(roleId)) {
                users.push(userId);
            }
        }
        return users;
    }

    /**
     * Start cache cleanup process
     * @private
     */
    _startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [userId, cached] of this.permissionCache.entries()) {
                if (now - cached.timestamp > this.config.cacheTimeout) {
                    this.permissionCache.delete(userId);
                }
            }
        }, 60000); // Clean every minute
    }

    /**
     * Sanitize role object for logging
     * @param {Object} role Role object
     * @returns {Object} Sanitized role
     * @private
     */
    _sanitizeRoleForLogging(role) {
        return {
            id: role.id,
            name: role.name,
            description: role.description,
            isSystem: role.isSystem,
            permissionCount: role.permissions.size,
            parentRoleCount: role.parentRoles.size
        };
    }

    // Additional private methods for condition evaluation
    _evaluateContextCondition(field, operator, value, context) {
        const contextValue = context[field];
        switch (operator) {
            case 'equals': return contextValue === value;
            case 'not_equals': return contextValue !== value;
            case 'in': return Array.isArray(value) && value.includes(contextValue);
            case 'not_in': return Array.isArray(value) && !value.includes(contextValue);
            default: return false;
        }
    }

    _evaluateTimeCondition(field, operator, value) {
        const now = Date.now();
        switch (field) {
            case 'hour':
                const currentHour = new Date().getHours();
                return this._compareValues(currentHour, operator, value);
            case 'day_of_week':
                const dayOfWeek = new Date().getDay();
                return this._compareValues(dayOfWeek, operator, value);
            default: return true;
        }
    }

    _evaluateUserCondition(field, operator, value, userId) {
        // Implementation would check user-specific conditions
        // For now, this is a placeholder
        return true;
    }

    _compareValues(actual, operator, expected) {
        switch (operator) {
            case 'equals': return actual === expected;
            case 'not_equals': return actual !== expected;
            case 'greater_than': return actual > expected;
            case 'less_than': return actual < expected;
            case 'in': return Array.isArray(expected) && expected.includes(actual);
            default: return false;
        }
    }

    async _evaluateConditions(conditions, userId, context) {
        for (const condition of conditions) {
            const conditionMet = await this._evaluateCondition(condition, userId, context);
            if (!conditionMet) {
                return false;
            }
        }
        return true;
    }

    async _checkRoleAssignmentLimits(userId, roleId) {
        // Implementation would check various limits
        // For now, this is a placeholder
        return true;
    }

    async _removeFromHierarchy(roleId) {
        // Remove from hierarchy mappings
        this.roleHierarchy.delete(roleId);
        for (const children of this.roleHierarchy.values()) {
            children.delete(roleId);
        }
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get RBAC statistics
     * @returns {Object} RBAC statistics
     */
    getRBACStatistics() {
        return {
            totalRoles: this.roles.size,
            totalPermissions: this.permissions.size,
            totalUsers: this.userRoles.size,
            cachedPermissions: this.permissionCache.size,
            dynamicRoles: this.dynamicRoles.size,
            hierarchyEnabled: this.config.enableHierarchy,
            dynamicPermissionsEnabled: this.config.enableDynamicPermissions
        };
    }

    /**
     * Get health status
     * @returns {Object} Health status
     */
    getHealthStatus() {
        return {
            status: 'healthy',
            rolesActive: Array.from(this.roles.values()).filter(r => r.isActive).length,
            permissionsActive: Array.from(this.permissions.values()).filter(p => p.isActive).length,
            cacheSize: this.permissionCache.size,
            lastCleanup: Date.now()
        };
    }
}

// =============================================================================
// RBAC ERROR CLASS
// =============================================================================

class RBACError extends Error {
    constructor(message, code = 'RBAC_ERROR') {
        super(message);
        this.name = 'RBACError';
        this.code = code;
    }
}

module.exports = { 
    RoleBasedAccessControl, 
    RBACError 
};