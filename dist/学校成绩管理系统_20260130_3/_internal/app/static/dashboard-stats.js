/**
 * 数据统计仪表盘组件
 * 完全本地化，无外部依赖
 */

class DashboardStats {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`容器 #${containerId} 不存在`);
      return;
    }
    this.stats = [];
  }

  /**
   * 创建圆环进度SVG
   * @param {number} percentage - 进度百分比 (0-100)
   * @returns {string} SVG HTML
   */
  createCircularChart(percentage) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    return `
      <svg class="circular-chart" viewBox="0 0 120 120">
        <circle class="circle-bg" cx="60" cy="60" r="${radius}"></circle>
        <circle
          class="circle-progress"
          cx="60"
          cy="60"
          r="${radius}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"
        ></circle>
      </svg>
    `;
  }

  /**
   * 创建统计卡片
   * @param {Object} config - 配置对象
   * @returns {string} HTML
   */
  createStatCard(config) {
    const {
      label = '',
      value = 0,
      percentage = 100,
      color = 'blue',
      showPercentage = false,
      trend = null // { direction: 'up' | 'down', value: '5%' }
    } = config;

    const displayValue = showPercentage ? `${value}%` : value.toLocaleString();
    const trendHTML = trend ? `
      <div class="stat-trend ${trend.direction}">
        <span class="stat-trend-icon">${trend.direction === 'up' ? '↑' : '↓'}</span>
        <span>${trend.value}</span>
      </div>
    ` : '';

    return `
      <div class="stat-card ${color}">
        <div class="stat-content">
          <div class="stat-label">${label}</div>
          <div class="stat-value">${displayValue}</div>
          ${trendHTML}
        </div>
        <div class="stat-chart">
          ${this.createCircularChart(percentage)}
        </div>
      </div>
    `;
  }

  /**
   * 渲染仪表盘
   * @param {Array} statsData - 统计数据数组
   */
  render(statsData) {
    if (!this.container) return;

    this.stats = statsData;
    const html = statsData.map(stat => this.createStatCard(stat)).join('');
    this.container.innerHTML = html;

    // 添加动画效果
    setTimeout(() => {
      this.container.querySelectorAll('.stat-value').forEach(el => {
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 500);
      });
    }, 100);
  }

  /**
   * 更新单个统计数据
   * @param {number} index - 统计项索引
   * @param {Object} newData - 新数据
   */
  update(index, newData) {
    if (!this.stats[index]) return;

    this.stats[index] = { ...this.stats[index], ...newData };
    this.render(this.stats);
  }

  /**
   * 显示加载状态
   */
  showLoading() {
    if (!this.container) return;

    const loadingHTML = Array(4).fill(0).map(() => `
      <div class="stat-card loading">
        <div class="stat-content">
          <div class="stat-label">加载中...</div>
          <div class="stat-value">---</div>
        </div>
        <div class="stat-chart">
          ${this.createCircularChart(0)}
        </div>
      </div>
    `).join('');

    this.container.innerHTML = loadingHTML;
  }
}

// 导出到全局
window.DashboardStats = DashboardStats;
