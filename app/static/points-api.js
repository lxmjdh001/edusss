/**
 * 积分系统API适配器
 * 连接前端和后端API
 */

const API_BASE = '/api/points';

class PointsAPI {
  // ==================== 班级管理 ====================

  async getClasses() {
    const response = await fetch(`${API_BASE}/classes`);
    if (!response.ok) throw new Error('获取班级列表失败');
    return await response.json();
  }

  async createClass(className, gradeName = null, teacherName = null) {
    const response = await fetch(`${API_BASE}/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_name: className, grade_name: gradeName, teacher_name: teacherName })
    });
    if (!response.ok) throw new Error('创建班级失败');
    return await response.json();
  }

  async deleteClass(classId) {
    const response = await fetch(`${API_BASE}/classes/${classId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('删除班级失败');
    return await response.json();
  }

  // ==================== 学生管理 ====================

  async getStudents(classId) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students`);
    if (!response.ok) throw new Error('获取学生列表失败');
    return await response.json();
  }

  async addStudent(classId, name, studentNo = null) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, student_no: studentNo })
    });
    if (!response.ok) throw new Error('添加学生失败');
    return await response.json();
  }

  async batchAddStudents(classId, students) {
    const response = await fetch(`${API_BASE}/classes/${classId}/students/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ students })
    });
    if (!response.ok) throw new Error('批量添加学生失败');
    return await response.json();
  }

  async syncStudentsFromGrades(classId) {
    const response = await fetch(`${API_BASE}/classes/${classId}/sync-from-grades`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('同步学生失败');
    return await response.json();
  }

  async updateStudentPoints(studentId, points, reason, operator = null) {
    const response = await fetch(`${API_BASE}/students/${studentId}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, reason, operator })
    });
    if (!response.ok) throw new Error('更新学生积分失败');
    return await response.json();
  }

  async getStudentRecords(studentId, limit = 100) {
    const response = await fetch(`${API_BASE}/students/${studentId}/records?limit=${limit}`);
    if (!response.ok) throw new Error('获取学生积分记录失败');
    return await response.json();
  }

  // ==================== 小组管理 ====================

  async getGroups(classId) {
    const response = await fetch(`${API_BASE}/classes/${classId}/groups`);
    if (!response.ok) throw new Error('获取小组列表失败');
    return await response.json();
  }

  async createGroup(classId, name, memberIds = []) {
    const response = await fetch(`${API_BASE}/classes/${classId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, member_ids: memberIds })
    });
    if (!response.ok) throw new Error('创建小组失败');
    return await response.json();
  }

  async updateGroupPoints(groupId, points, reason, operator = null) {
    const response = await fetch(`${API_BASE}/groups/${groupId}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, reason, operator })
    });
    if (!response.ok) throw new Error('更新小组积分失败');
    return await response.json();
  }

  // ==================== 积分规则 ====================

  async getRules(classId, ruleType = null) {
    let url = `${API_BASE}/classes/${classId}/rules`;
    if (ruleType) url += `?rule_type=${ruleType}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('获取积分规则失败');
    return await response.json();
  }

  async createRule(classId, name, points, ruleType) {
    const response = await fetch(`${API_BASE}/classes/${classId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, points, rule_type: ruleType })
    });
    if (!response.ok) throw new Error('创建积分规则失败');
    return await response.json();
  }

  // ==================== 积分商店 ====================

  async getShopItems(classId) {
    const response = await fetch(`${API_BASE}/classes/${classId}/shop`);
    if (!response.ok) throw new Error('获取商店商品失败');
    return await response.json();
  }

  async purchaseItem(studentId, itemName, cost) {
    const response = await fetch(`${API_BASE}/students/${studentId}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_name: itemName, cost })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '购买失败');
    }
    return await response.json();
  }

  // ==================== 排行榜 ====================

  async getStudentRankings(classId, limit = 10) {
    const response = await fetch(`${API_BASE}/classes/${classId}/rankings/students?limit=${limit}`);
    if (!response.ok) throw new Error('获取学生排行榜失败');
    return await response.json();
  }

  async getGroupRankings(classId, limit = 10) {
    const response = await fetch(`${API_BASE}/classes/${classId}/rankings/groups?limit=${limit}`);
    if (!response.ok) throw new Error('获取小组排行榜失败');
    return await response.json();
  }
}

// 创建全局API实例
window.pointsAPI = new PointsAPI();
