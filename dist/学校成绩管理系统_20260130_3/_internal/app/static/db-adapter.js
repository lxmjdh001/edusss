/**
 * 数据库适配层
 * 将原有的 localStorage 操作替换为数据库 API 调用
 */

class DatabaseAdapter {
  constructor(system) {
    this.system = system;
    this.api = window.pointsAPI;
    this.isLoading = false;
  }

  // ==================== 初始化和加载 ====================

  async init() {
    console.log('🔌 初始化数据库适配器');

    try {
      // 1. 加载班级列表
      await this.loadClasses();

      // 2. 如果有当前班级，加载数据
      if (this.system.currentClassId) {
        await this.loadAll();
      }

      return true;
    } catch (error) {
      console.error('❌ 数据库适配器初始化失败:', error);
      return false;
    }
  }

  async loadClasses() {
    try {
      const classes = await this.api.getClasses();
      console.log('📚 从数据库加载班级:', classes.length);

      if (classes.length === 0) {
        console.warn('⚠️ 没有找到班级数据');
        return;
      }

      // 转换班级数据格式以兼容原有的 script.js 代码
      this.system.classes = classes.map(c => ({
        id: c.id,
        name: c.class_name,
        grade: c.grade_name || '未设置',
        teacher: c.teacher_name || '未设置',
        studentCount: c.student_count,
        groupCount: c.group_count
      }));

      // 如果没有当前班级，选择第一个
      if (!this.system.currentClassId && classes.length > 0) {
        this.system.currentClassId = classes[0].id;
        this.system.currentClassName = classes[0].class_name;
      }

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
      `<option value="${c.id}" ${c.id === this.system.currentClassId ? 'selected' : ''}>
        ${c.class_name} ${c.grade_name ? '(' + c.grade_name + ')' : ''} - ${c.student_count}人
      </option>`
    ).join('');

    selector.style.display = 'block';
  }

  async loadAll() {
    if (this.isLoading) {
      console.log('⏳ 正在加载中，跳过重复请求');
      return;
    }

    this.isLoading = true;
    console.log(`📖 从数据库加载班级数据: ${this.system.currentClassId}`);

    try {
      // 并行加载所有数据
      const [students, groups, rules, groupRules, shopItems] = await Promise.all([
        this.api.getStudents(this.system.currentClassId),
        this.api.getGroups(this.system.currentClassId),
        this.api.getRules(this.system.currentClassId, 'student'),
        this.api.getRules(this.system.currentClassId, 'group'),
        this.api.getShopItems(this.system.currentClassId)
      ]);

      // 更新系统数据
      this.system.students = students || [];
      this.system.groups = groups || [];
      this.system.rules = rules || [];
      this.system.groupRules = groupRules || [];
      this.system.shopItems = shopItems || [];

      console.log('✅ 数据加载完成:', {
        students: this.system.students.length,
        groups: this.system.groups.length,
        rules: this.system.rules.length
      });

      return true;
    } catch (error) {
      console.error('❌ 加载数据失败:', error);
      this.system.showNotification('加载数据失败: ' + error.message, 'error');
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  // ==================== 学生操作 ====================

  async addStudent(name, studentNo = null) {
    try {
      await this.api.addStudent(this.system.currentClassId, name, studentNo);
      await this.loadAll();
      return true;
    } catch (error) {
      console.error('添加学生失败:', error);
      throw error;
    }
  }

  async batchAddStudents(students) {
    try {
      const result = await this.api.batchAddStudents(this.system.currentClassId, students);
      await this.loadAll();
      return result;
    } catch (error) {
      console.error('批量添加学生失败:', error);
      throw error;
    }
  }

  async syncStudentsFromGrades() {
    try {
      const result = await this.api.syncStudentsFromGrades(this.system.currentClassId);
      await this.loadAll();
      return result;
    } catch (error) {
      console.error('同步学生失败:', error);
      throw error;
    }
  }

  async updateStudentPoints(studentId, points, reason, operator = null) {
    try {
      await this.api.updateStudentPoints(studentId, points, reason, operator);
      await this.loadAll();
      return true;
    } catch (error) {
      console.error('更新学生积分失败:', error);
      throw error;
    }
  }

  async getStudentRecords(studentId, limit = 100) {
    try {
      return await this.api.getStudentRecords(studentId, limit);
    } catch (error) {
      console.error('获取学生记录失败:', error);
      return [];
    }
  }

  // ==================== 小组操作 ====================

  async createGroup(name, memberIds = []) {
    try {
      await this.api.createGroup(this.system.currentClassId, name, memberIds);
      await this.loadAll();
      return true;
    } catch (error) {
      console.error('创建小组失败:', error);
      throw error;
    }
  }

  async updateGroupPoints(groupId, points, reason, operator = null) {
    try {
      await this.api.updateGroupPoints(groupId, points, reason, operator);
      await this.loadAll();
      return true;
    } catch (error) {
      console.error('更新小组积分失败:', error);
      throw error;
    }
  }

  // ==================== 规则操作 ====================

  async createRule(name, points, ruleType) {
    try {
      await this.api.createRule(this.system.currentClassId, name, points, ruleType);
      await this.loadAll();
      return true;
    } catch (error) {
      console.error('创建规则失败:', error);
      throw error;
    }
  }

  // ==================== 排行榜 ====================

  async getStudentRankings(limit = 10) {
    try {
      return await this.api.getStudentRankings(this.system.currentClassId, limit);
    } catch (error) {
      console.error('获取学生排行榜失败:', error);
      return [];
    }
  }

  async getGroupRankings(limit = 10) {
    try {
      return await this.api.getGroupRankings(this.system.currentClassId, limit);
    } catch (error) {
      console.error('获取小组排行榜失败:', error);
      return [];
    }
  }

  // ==================== 商店操作 ====================

  async purchaseItem(studentId, itemName, cost) {
    try {
      await this.api.purchaseItem(studentId, itemName, cost);
      await this.loadAll();
      return true;
    } catch (error) {
      console.error('购买失败:', error);
      throw error;
    }
  }

  // ==================== 保存方法（兼容原有代码） ====================

  async saveAll() {
    // 数据库版本不需要手动保存，所有操作都是实时的
    console.log('💾 数据库版本：无需手动保存');
    return true;
  }

  // ==================== 班级切换 ====================

  async switchClass(classId) {
    this.system.currentClassId = classId;
    const classes = await this.api.getClasses();
    const currentClass = classes.find(c => c.id === classId);
    if (currentClass) {
      this.system.currentClassName = currentClass.class_name;
    }
    await this.loadAll();
    return true;
  }
}

// 导出到全局
window.DatabaseAdapter = DatabaseAdapter;
