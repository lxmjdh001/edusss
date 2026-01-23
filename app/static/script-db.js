/**
 * 班级积分宠物成长系统 - 数据库版本
 * 所有数据存储在 SQLite 数据库中
 */

class ClassPointsSystem {
  constructor() {
    // API 实例
    this.api = window.pointsAPI;

    // 当前状态
    this.currentClassId = null;
    this.currentClassName = '';
    this.students = [];
    this.groups = [];
    this.rules = [];
    this.groupRules = [];
    this.shopItems = [];

    // UI 状态
    this.displayMode = 'local';
    this.currentStudent = null;
    this.currentGroup = null;

    // 宠物配置（保留在前端，因为是UI配置）
    this.petTypes = [];
    this.petStages = [];
    this.groupStages = [];

    // 初始化
    this.init();
  }

  async init() {
    console.log('🚀 初始化积分系统（数据库版本）');

    try {
      // 1. 加载班级列表
      await this.loadClasses();

      // 2. 设置事件监听
      this.setupEventListeners();

      // 3. 初始化宠物配置
      this.initializePetConfig();

      // 4. 如果有当前班级，加载数据
      if (this.currentClassId) {
        await this.loadClassData();
      }

      console.log('✅ 系统初始化完成');
    } catch (error) {
      console.error('❌ 初始化失败:', error);
      this.showNotification('系统初始化失败: ' + error.message, 'error');
    }
  }

  // ==================== 班级管理 ====================

  async loadClasses() {
    try {
      const classes = await this.api.getClasses();
      console.log('📚 加载班级列表:', classes);

      if (classes.length === 0) {
        this.showNotification('没有找到班级，请先在成绩管理系统中添加学生', 'warning');
        return;
      }

      // 默认选择第一个班级
      this.currentClassId = classes[0].id;
      this.currentClassName = classes[0].class_name;

      // 更新班级选择器
      this.updateClassSelector(classes);

    } catch (error) {
      console.error('加载班级失败:', error);
      throw error;
    }
  }

  updateClassSelector(classes) {
    const selector = document.getElementById('classSelector');
    if (!selector) return;

    selector.innerHTML = classes.map(c =>
      `<option value="${c.id}" ${c.id === this.currentClassId ? 'selected' : ''}>
        ${c.class_name} (${c.student_count}人)
      </option>`
    ).join('');

    selector.style.display = 'block';
  }

  async switchClass(classId) {
    this.currentClassId = classId;
    await this.loadClassData();
    this.showNotification('已切换班级', 'success');
  }

  // ==================== 数据加载 ====================

  async loadClassData() {
    try {
      console.log(`📖 加载班级数据: ${this.currentClassId}`);

      // 并行加载所有数据
      const [students, groups, rules, groupRules, shopItems] = await Promise.all([
        this.api.getStudents(this.currentClassId),
        this.api.getGroups(this.currentClassId),
        this.api.getRules(this.currentClassId, 'student'),
        this.api.getRules(this.currentClassId, 'group'),
        this.api.getShopItems(this.currentClassId)
      ]);

      this.students = students;
      this.groups = groups;
      this.rules = rules;
      this.groupRules = groupRules;
      this.shopItems = shopItems;

      // 渲染界面
      this.renderStudents();
      this.renderGroups();
      this.updateRankings();

      console.log('✅ 班级数据加载完成');
    } catch (error) {
      console.error('加载班级数据失败:', error);
      this.showNotification('加载数据失败: ' + error.message, 'error');
    }
  }

  // ==================== 学生管理 ====================

  async syncStudentsFromGrades() {
    if (!this.currentClassId) {
      this.showNotification('请先选择班级', 'warning');
      return;
    }

    try {
      const result = await this.api.syncStudentsFromGrades(this.currentClassId);
      this.showNotification(result.message, 'success');
      await this.loadClassData();
    } catch (error) {
      this.showNotification('同步失败: ' + error.message, 'error');
    }
  }

  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const data = await this.readExcelFile(file);
      await this.api.batchAddStudents(this.currentClassId, data);
      this.showNotification(`成功导入 ${data.length} 名学生`, 'success');
      await this.loadClassData();
    } catch (error) {
      this.showNotification('导入失败: ' + error.message, 'error');
    }
  }

  async readExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // ==================== 积分操作 ====================

  async updateStudentPoints(studentId, points, reason) {
    try {
      await this.api.updateStudentPoints(studentId, points, reason);
      await this.loadClassData();
      this.showNotification('积分更新成功', 'success');
    } catch (error) {
      this.showNotification('更新失败: ' + error.message, 'error');
    }
  }

  async updateGroupPoints(groupId, points, reason) {
    try {
      await this.api.updateGroupPoints(groupId, points, reason);
      await this.loadClassData();
      this.showNotification('小组积分更新成功', 'success');
    } catch (error) {
      this.showNotification('更新失败: ' + error.message, 'error');
    }
  }

  // ==================== 小组管理 ====================

  async createGroup(name, memberIds) {
    try {
      await this.api.createGroup(this.currentClassId, name, memberIds);
      await this.loadClassData();
      this.showNotification('小组创建成功', 'success');
    } catch (error) {
      this.showNotification('创建失败: ' + error.message, 'error');
    }
  }

  // ==================== 界面渲染 ====================

  renderStudents() {
    const container = document.getElementById('studentsGrid');
    if (!container) return;

    if (this.students.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #666;">
          <p>暂无学生数据</p>
          <button class="btn btn-primary" onclick="system.syncStudentsFromGrades()">
            从成绩系统同步学生
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = this.students.map(student => `
      <div class="student-card" data-id="${student.id}">
        <div class="student-header">
          <span class="student-name">${student.name}</span>
          <span class="student-points">${student.points}分</span>
        </div>
        <div class="student-pet">
          ${this.renderPetDisplay(student.pet_type, student.pet_level)}
        </div>
        <div class="student-actions">
          <button class="btn-sm" onclick="system.showPointsModal(${student.id})">加减分</button>
          <button class="btn-sm" onclick="system.showStudentHistory(${student.id})">历史</button>
        </div>
      </div>
    `).join('');
  }

  renderGroups() {
    const container = document.getElementById('groupsGrid');
    if (!container) return;

    if (this.groups.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #666;">
          <p>暂无小组</p>
          <button class="btn btn-primary" onclick="system.showCreateGroupModal()">
            创建小组
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = this.groups.map(group => `
      <div class="group-card" data-id="${group.id}">
        <div class="group-header">
          <span class="group-name">${group.name}</span>
          <span class="group-points">${group.points}分</span>
        </div>
        <div class="group-members">
          ${group.members.map(m => m.name).join('、')}
        </div>
        <div class="group-actions">
          <button class="btn-sm" onclick="system.showGroupPointsModal(${group.id})">加减分</button>
        </div>
      </div>
    `).join('');
  }

  renderPetDisplay(petType, petLevel) {
    // 简化的宠物显示
    const emojis = ['🥚', '🐣', '🐤', '🐦', '🕊️', '🦅'];
    return `<div class="pet-emoji">${emojis[petLevel] || '🥚'}</div>`;
  }

  async updateRankings() {
    try {
      const [studentRankings, groupRankings] = await Promise.all([
        this.api.getStudentRankings(this.currentClassId, 10),
        this.api.getGroupRankings(this.currentClassId, 10)
      ]);

      this.renderRankings('individualRanking', studentRankings);
      this.renderRankings('groupRanking', groupRankings);
    } catch (error) {
      console.error('更新排行榜失败:', error);
    }
  }

  renderRankings(containerId, rankings) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = rankings.map(item => `
      <div class="ranking-item">
        <span class="rank">${item.rank}</span>
        <span class="name">${item.name}</span>
        <span class="points">${item.points}分</span>
      </div>
    `).join('');
  }

  // ==================== 模态框 ====================

  showPointsModal(studentId) {
    this.currentStudent = this.students.find(s => s.id === studentId);
    if (!this.currentStudent) return;

    const modal = document.getElementById('pointsModal');
    const nameEl = document.getElementById('studentNameModal');
    const ruleSelect = document.getElementById('ruleSelect');

    nameEl.textContent = `学生：${this.currentStudent.name}`;

    // 渲染规则选项
    ruleSelect.innerHTML = this.rules.map(rule => `
      <button class="rule-btn" data-points="${rule.points}">
        ${rule.name} (${rule.points > 0 ? '+' : ''}${rule.points}分)
      </button>
    `).join('');

    modal.style.display = 'flex';

    // 绑定规则按钮事件
    ruleSelect.querySelectorAll('.rule-btn').forEach(btn => {
      btn.onclick = async () => {
        const points = parseInt(btn.dataset.points);
        const reason = btn.textContent.split('(')[0].trim();
        await this.updateStudentPoints(this.currentStudent.id, points, reason);
        modal.style.display = 'none';
      };
    });
  }

  showGroupPointsModal(groupId) {
    this.currentGroup = this.groups.find(g => g.id === groupId);
    if (!this.currentGroup) return;

    const modal = document.getElementById('groupPointsModal');
    const nameEl = document.getElementById('groupNameModal');
    const ruleSelect = document.getElementById('groupRuleSelect');

    nameEl.textContent = `小组：${this.currentGroup.name}`;

    // 渲染规则选项
    ruleSelect.innerHTML = this.groupRules.map(rule => `
      <button class="rule-btn" data-points="${rule.points}">
        ${rule.name} (${rule.points > 0 ? '+' : ''}${rule.points}分)
      </button>
    `).join('');

    modal.style.display = 'flex';

    // 绑定规则按钮事件
    ruleSelect.querySelectorAll('.rule-btn').forEach(btn => {
      btn.onclick = async () => {
        const points = parseInt(btn.dataset.points);
        const reason = btn.textContent.split('(')[0].trim();
        await this.updateGroupPoints(this.currentGroup.id, points, reason);
        modal.style.display = 'none';
      };
    });
  }

  // ==================== 事件监听 ====================

  setupEventListeners() {
    // 文件上传
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    }

    // 班级选择器
    const classSelector = document.getElementById('classSelector');
    if (classSelector) {
      classSelector.addEventListener('change', (e) => {
        this.switchClass(parseInt(e.target.value));
      });
    }

    // 模态框关闭按钮
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.onclick = () => {
        btn.closest('.modal').style.display = 'none';
      };
    });

    // 标签页切换
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.onclick = () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.content-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(target + 'Tab').classList.add('active');
      };
    });
  }

  // ==================== 宠物配置 ====================

  initializePetConfig() {
    // 默认宠物配置
    this.petTypes = [];

    this.petStages = [
      { name: '蛋', emoji: '🥚', minPoints: 0 },
      { name: '孵化中', emoji: '🐣', minPoints: 50 },
      { name: '幼崽', emoji: '🐤', minPoints: 100 },
      { name: '成长期', emoji: '🐦', minPoints: 200 },
      { name: '成熟期', emoji: '🕊️', minPoints: 400 },
      { name: '完全体', emoji: '🦅', minPoints: 800 }
    ];

    this.groupStages = [
      { name: '青铜', emoji: '🥉', minPoints: 0 },
      { name: '白银', emoji: '🥈', minPoints: 100 },
      { name: '黄金', emoji: '🥇', minPoints: 300 },
      { name: '铂金', emoji: '🔷', minPoints: 600 },
      { name: '钻石', emoji: '💎', minPoints: 1000 },
      { name: '王者', emoji: '👑', minPoints: 2000 }
    ];
  }

  // ==================== 工具方法 ====================

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// 初始化系统
let system;
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎮 启动班级积分系统（数据库版本）');
  system = new ClassPointsSystem();
});
