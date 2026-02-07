/**
 * 认证守卫模块
 * 用于保护需要登录的页面，并提供统一的API请求封装
 */

class AuthGuard {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
    }

    /**
     * 初始化认证守卫
     * @param {Object} options 配置选项
     * @param {boolean} options.required 是否需要登录（默认true）
     * @param {string} options.loginUrl 登录页面URL（默认/static/login.html）
     * @param {Function} options.onAuth 认证成功回调
     * @param {Function} options.onUnauth 认证失败回调
     */
    async init(options = {}) {
        const {
            required = true,
            loginUrl = '/static/login.html',
            onAuth = null,
            onUnauth = null
        } = options;

        try {
            const user = await this.checkAuth();

            if (user) {
                this.isAuthenticated = true;
                this.currentUser = user;

                // 存储到localStorage
                localStorage.setItem('user_info', JSON.stringify(user));

                if (onAuth) {
                    onAuth(user);
                }

                return user;
            } else {
                this.isAuthenticated = false;
                this.currentUser = null;

                if (required) {
                    // 需要登录但未登录，跳转到登录页
                    window.location.href = `${loginUrl}?redirect=${encodeURIComponent(window.location.pathname)}`;
                } else if (onUnauth) {
                    onUnauth();
                }

                return null;
            }
        } catch (error) {
            console.error('认证检查失败:', error);
            this.isAuthenticated = false;
            this.currentUser = null;

            if (required) {
                window.location.href = `${loginUrl}?redirect=${encodeURIComponent(window.location.pathname)}`;
            } else if (onUnauth) {
                onUnauth();
            }

            return null;
        }
    }

    /**
     * 检查是否为桌面模式
     */
    async isDesktopMode() {
        try {
            const response = await fetch('/api/desktop-mode', {
                method: 'GET',
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                return data.desktop_mode === true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查认证状态
     */
    async checkAuth() {
        try {
            // 检查是否为桌面模式
            const desktopMode = await this.isDesktopMode();
            if (desktopMode) {
                // 桌面模式：返回默认用户，跳过认证
                return {
                    account: 'desktop_user',
                    vip_level: 10,
                    is_desktop: true
                };
            }

            const response = await fetch('/api/auth/me', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`,
                }
            });

            if (response.ok) {
                const user = await response.json();
                return user;
            } else {
                return null;
            }
        } catch (error) {
            console.error('检查认证状态失败:', error);
            return null;
        }
    }

    /**
     * 获取存储的token
     */
    getToken() {
        return localStorage.getItem('session_token') || '';
    }

    /**
     * 获取当前用户信息
     */
    getCurrentUser() {
        if (this.currentUser) {
            return this.currentUser;
        }

        const userStr = localStorage.getItem('user_info');
        if (userStr) {
            try {
                this.currentUser = JSON.parse(userStr);
                return this.currentUser;
            } catch (e) {
                return null;
            }
        }

        return null;
    }

    /**
     * 登出
     */
    async logout(redirectUrl = '/static/login.html') {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${this.getToken()}`,
                }
            });
        } catch (error) {
            console.error('登出失败:', error);
        } finally {
            // 清除本地数据
            localStorage.removeItem('session_token');
            localStorage.removeItem('user_info');
            this.currentUser = null;
            this.isAuthenticated = false;

            // 跳转到登录页
            window.location.href = redirectUrl;
        }
    }

    /**
     * 生成本地存储命名空间（用于多用户隔离）
     * @param {string} namespace 业务前缀
     */
    getStorageNamespace(namespace = 'points') {
        try {
            const user = this.getCurrentUser();
            const rawId = user && (user.account || user.username || user.name || user.phone || user.id);
            const isDesktop = user && user.is_desktop;
            const normalized = rawId ? encodeURIComponent(String(rawId).trim()) : '';
            const bucket = isDesktop ? 'offline' : (normalized || 'guest');
            return `${namespace}_${bucket}__`;
        } catch (error) {
            return `${namespace}_guest__`;
        }
    }

    /**
     * 统一的API请求方法
     * @param {string} url 请求URL
     * @param {Object} options 请求选项
     */
    async request(url, options = {}) {
        const defaultOptions = {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.getToken()}`,
                ...options.headers
            }
        };

        const finalOptions = {
            ...options,
            ...defaultOptions,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, finalOptions);

            // 处理401未认证错误
            if (response.status === 401) {
                console.warn('未认证或会话过期，跳转到登录页');
                localStorage.removeItem('session_token');
                localStorage.removeItem('user_info');
                window.location.href = '/static/login.html?redirect=' + encodeURIComponent(window.location.pathname);
                throw new Error('未认证');
            }

            // 处理403权限不足错误
            if (response.status === 403) {
                throw new Error('权限不足');
            }

            return response;
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
        }
    }

    /**
     * GET请求
     */
    async get(url, options = {}) {
        return this.request(url, {
            ...options,
            method: 'GET'
        });
    }

    /**
     * POST请求
     */
    async post(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * PUT请求
     */
    async put(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    /**
     * DELETE请求
     */
    async delete(url, options = {}) {
        return this.request(url, {
            ...options,
            method: 'DELETE'
        });
    }

    /**
     * 显示用户信息UI（可选）
     */
    renderUserInfo(containerId = 'user-info') {
        const container = document.getElementById(containerId);
        if (!container || !this.currentUser) return;

        const userInfoHTML = `
            <div class="user-info-widget">
                <span class="user-name">${this.currentUser.account}</span>
                <span class="user-vip">VIP${this.currentUser.vip_level}</span>
                <button class="btn-logout" onclick="authGuard.logout()">退出</button>
            </div>
        `;

        container.innerHTML = userInfoHTML;
    }
}

// 创建全局实例
const authGuard = new AuthGuard();

// 导出（如果使用模块系统）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthGuard;
}
