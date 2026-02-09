class ClassPointsSystem {
	
// 增强的通用兜底方法
getStageImage(stage, index, type) {
  // 本地图片模式：有图片且确实可用
  if (this.displayMode === 'local') {
    // 检查图片是否有效（DataURL 或有效路径）
    if (stage.img && stage.img.trim() !== '') {
      // 如果是DataURL或有效图片路径，直接使用
      if (stage.img.startsWith('data:image/') || stage.img.startsWith('http') || stage.img.includes('/')) {
        return stage.img;
      }
    }
    // 兜底：使用默认本地图路径
    return `images/${type}/${index + 1}.png`;
  }
  
  // Emoji模式：优先使用stage.emoji，如果没有则根据名称生成
  if (stage.emoji) {
    return stage.emoji;
  }
  
  // 如果stage.emoji不存在，根据阶段名称返回对应的emoji
  return this.getFallbackEmoji(stage.name, type);
}



// 添加备用emoji获取方法
getFallbackEmoji(stageName, type) {
  const emojiMaps = {
    pet: {
      '蛋': '🥚', '孵化中': '🐣', '雏鸟': '🐤', '幼鸟': '🐦',
      '成长鸟': '🕊️', '雄鹰': '🦅'
    },
    group: {
      '青铜': '🥉', '白银': '🥈', '黄金': '🥇',
      '铂金': '🔷', '钻石': '💎', '王者': '👑'
    }
  };
  
  const map = emojiMaps[type] || emojiMaps.pet;
  return map[stageName] || '❓';
}

// 生成用户隔离的存储前缀
resolveStorageNamespace() {
  try {
    if (window.authGuard && typeof authGuard.getStorageNamespace === 'function') {
      return authGuard.getStorageNamespace('points');
    }
    const userStr = this._kvCache.get('user_info') || null;
    const user = this.safeJsonParse(userStr, null);
    const rawId = user && (user.account || user.username || user.name || user.phone || user.id);
    const normalized = rawId ? encodeURIComponent(String(rawId).trim()) : '';
    const bucket = (user && user.is_desktop) ? 'offline' : (normalized || 'guest');
    return `points_${bucket}__`;
  } catch (error) {
    return 'points_guest__';
  }
}

storageKey(key) {
  return `${this.storagePrefix}${key}`;
}

storageGet(key, options = {}) {
  const { fallback = true, migrate = true } = options;
  const value = this.safeLocalStorageGet(key);
  if (value === null && fallback) {
    // 检查无前缀的旧格式 key
    const legacy = this._kvCache.has(key) ? this._kvCache.get(key) : null;
    if (legacy !== null && migrate) {
      this.safeLocalStorageSet(key, legacy);
      this._kvCache.delete(key);
    }
    return legacy;
  }
  return value;
}

storageSet(key, value) {
  return this.safeLocalStorageSet(key, value);
}

storageRemove(key, includeLegacy = false) {
  try {
    this._kvCache.delete(this.storageKey(key));
    if (includeLegacy) {
      this._kvCache.delete(key);
    }
    this.queueRemoteDelete(key);
    return true;
  } catch (error) {
    console.error(`删除缓存数据失败 [${key}]:`, error);
    return false;
  }
}

async ensureStoragePrefix() {
  if (!window.USE_DATABASE) return;
  try {
    let isDesktop = false;
    if (window.authGuard && typeof authGuard.isDesktopMode === 'function') {
      isDesktop = await authGuard.isDesktopMode();
    }
    if (!isDesktop) {
      const resp = await fetch('/api/auth/me', { credentials: 'include' });
      if (resp.ok) {
        const user = await resp.json();
        this._kvCache.set('user_info', JSON.stringify(user));
      }
    } else if (!this._kvCache.has('user_info')) {
      this._kvCache.set('user_info', JSON.stringify({ account: 'offline', is_desktop: true }));
    }
  } catch (error) {
    // 忽略，使用现有前缀
  }
  const newPrefix = this.resolveStorageNamespace();
  if (newPrefix !== this.storagePrefix) {
    this.storagePrefix = newPrefix;
  }
}

async preloadRemoteStorage() {
  if (!window.USE_DATABASE) return;
  if (this.remoteStorageLoaded) return;
  console.time('[perf] preloadRemoteStorage');
  await this.ensureStoragePrefix();
  try {
    const resp = await fetch('/api/points-kv/all', { credentials: 'include' });
    if (!resp.ok) return;
    const items = await resp.json();
    if (Array.isArray(items)) {
      items.forEach(item => {
        if (!item || !item.key) return;
        this._kvCache.set(this.storageKey(item.key), item.value ?? '');
      });
    }
    this.remoteStorageLoaded = true;
  } catch (error) {
    console.error('加载远程存储失败:', error);
  }
  console.timeEnd('[perf] preloadRemoteStorage');
}

queueRemoteSet(key, value) {
  if (!window.USE_DATABASE) return;
  if (!this.remoteSyncQueue) return;
  this.remoteDeleteQueue?.delete(key);
  this.remoteSyncQueue.set(key, value);
  if (this.remoteSyncTimer) return;
  this.remoteSyncTimer = setTimeout(() => {
    this.flushRemoteQueue();
  }, 500);
}

queueRemoteDelete(key) {
  if (!window.USE_DATABASE) return;
  if (!this.remoteDeleteQueue) return;
  this.remoteSyncQueue?.delete(key);
  this.remoteDeleteQueue.add(key);
  if (this.remoteSyncTimer) return;
  this.remoteSyncTimer = setTimeout(() => {
    this.flushRemoteQueue();
  }, 500);
}

async flushRemoteQueue() {
  if (!window.USE_DATABASE) return;
  if (this.remoteSyncInFlight) return;
  const items = Array.from(this.remoteSyncQueue?.entries() || []).map(([key, value]) => ({
    key,
    value: String(value)
  }));
  const deletes = Array.from(this.remoteDeleteQueue || []);
  this.remoteSyncQueue?.clear();
  this.remoteDeleteQueue?.clear();
  if (this.remoteSyncTimer) {
    clearTimeout(this.remoteSyncTimer);
    this.remoteSyncTimer = null;
  }
  if (!items.length && !deletes.length) return;
  this.remoteSyncInFlight = true;
  try {
    if (items.length > 0) {
      await fetch('/api/points-kv/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items })
      });
    }
    if (deletes.length > 0) {
      await Promise.all(deletes.map(key => fetch(`/api/points-kv/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include'
      })));
    }
  } catch (error) {
    console.error('同步远程存储失败:', error);
    items.forEach(item => this.remoteSyncQueue.set(item.key, item.value));
    deletes.forEach(key => this.remoteDeleteQueue.add(key));
  } finally {
    this.remoteSyncInFlight = false;
  }
}

escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

formatAccountExpiry(expiresAt) {
  if (!expiresAt) {
    return { text: '永久', expired: false };
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return { text: String(expiresAt), expired: false };
  }
  const text = date.toLocaleString('zh-CN', { hour12: false });
  return { text, expired: date.getTime() < Date.now() };
}

	// 切换 emoji ↔ 本地图
toggleDisplayMode() {
  if (this.displayMode === 'emoji') {
    this.displayMode = 'local';
    if (this.toggleModeBtn) this.toggleModeBtn.textContent = '🎭 恢复默认宠物';
    this.showNotification('已切换到自定义图片模式！', 'success');
  } else {
    this.displayMode = 'emoji';
    if (this.toggleModeBtn) this.toggleModeBtn.textContent = '🖼️ 自定义宠物';
    this.showNotification('已切换到表情符号模式！', 'success');
  }
  
  console.log(`显示模式已切换为: ${this.displayMode}`);
  
  // 确保按班级保存显示模式 - 使用安全的localStorage操作
  if (this.safeLocalStorageSet) {
    this.safeLocalStorageSet(`displayMode_${this.currentClassId}`, this.displayMode);
    this.safeLocalStorageSet('displayMode', this.displayMode); // 同时保存全局显示模式
  } else {
    try {
      this.storageSet(`displayMode_${this.currentClassId}`, this.displayMode);
      this.storageSet('displayMode', this.displayMode);
    } catch (error) {
      console.error('保存显示模式失败:', error);
    }
  }
  
  this.renderStudents();
  this.renderGroups();
  this.saveAll();
}
	
  constructor(){
    this._kvCache = new Map(); // 内存缓存，替代 localStorage
    this.storagePrefix = this.resolveStorageNamespace();
    this.remoteSyncQueue = new Map();
    this.remoteDeleteQueue = new Set();
    this.remoteSyncTimer = null;
    this.remoteSyncInFlight = false;
    this.remoteStorageLoaded = false;
    this.classDataLoaded = false;
    this.petImagesLoaded = false;
    // 添加全局配置属性
    this.globalRules = []; // 全局积分规则
    this.globalShopItems = []; // 全局商店商品
    this.globalGroupRules = []; // 全局小组规则
    this.currentConfigScope = 'global'; // 当前配置范围：global 或 class

	// 显示模式：'emoji' | 'local' - 强制使用'local'模式
  this.displayMode = 'local'; // 默认值，init() 会从数据库缓存中读取并覆盖
  // 按钮 DOM 缓存（后面要改文字）
  this.toggleModeBtn = null;
	
	// 宠物相关数据结构
	// 宠物类型配置
	// 宠物类型配置 - 初始化为空数组，将在init()中根据班级ID加载
	this.petTypes = [];
	
	// 宠物阶段配置 - 初始化为空数组，将在init()中根据班级ID加载
	this.petStages = [];
	
	// 宠物图片配置（统一使用，不再区分个人和小组）
	this.petImages = {};
	
	// 小组等级配置已统一使用groupStages数据结构
	// groupLevels已废弃
	
	// 学生宠物选择记录
	this.studentPets = {};
	// 小组宠物选择记录
	this.groupPets = {};
	
	// 初始化宠物图片数据结构（合并成一次初始化，避免重复覆盖）
	this.petTypes.forEach(type => {
	  this.petImages[type.id] = {};
	  this.groupPetImages[type.id] = {};
	  for (let i = 1; i <= 6; i++) {
	    this.petImages[type.id][`level${i}`] = '';
	    this.groupPetImages[type.id][`level${i}`] = '';
	  }
	});
	
	// 宠物类型配置将在init()方法中加载，因为currentClassId此时还未设置
	
	// 学生宠物选择记录
	this.studentPets = {};
	
	  // ===== 新增状态 =====
  this.currentRankingPeriod = 'all';           // 当前时间段
  this.includeMemberPointsInGroupRank = false; // 小组是否含成员积分
  this.customRankStart = null;                 // 自定义开始日
  this.customRankEnd = null;                   // 自定义结束日
	
	// 新增：成绩积分比例
    this.scoreToPointsRatio = 10; // 默认10分=1积分
    
    // 班级相关属性
    this.classes = []; // 所有班级列表
    this.currentClassId = null; // 当前班级ID
    this.currentClassName = ''; // 当前班级名称
    
    // 原有属性保持不变
    this.students=[];
    this.groups=[];
    this.history=[];
    this.undoStack=[];
    
    // 当前使用的规则和商品（指向全局或班级配置）
    this.rules = [];
    this.shopItems = [];
    this.groupRules = [];

// ========= 个人宠物等级（可完全自定义） =========
// 宠物阶段配置将在init()方法中根据班级ID加载

// 宠物阶段配置将在init()方法中加载，因为currentClassId此时还未设置

// ========= 小组等级（可完全自定义） =========
// 小组等级配置将在init()方法中根据班级ID加载
    

    // 状态变量
    this.currentStudent=null;
    this.currentGroup=null;
    this.currentOperation=null;
    this.editingGroupIndex=null;
    this.editingStudentIndex=null;
    
    // 排序相关属性
    this.currentSortMode = 'none'; // 当前排序模式：'none', 'name_asc', 'name_desc', 'points_asc', 'points_desc'
    this.sortDirection = 'asc'; // 当前排序方向：'asc' 或 'desc'
    
    // 计时器变量
    this.stopwatchRunning = false;
    this.stopwatchElapsed = 0;
    this.stopwatchInterval = null;
    this.stopwatchLaps = [];
    
    this.countdownRunning = false;
    this.countdownTime = 5 * 60 * 1000; // 5分钟
    this.countdownInterval = null;
    
    // 随机点名变量
    this.isRandomNameRunning = false;
    this.randomNameAnimationId = null;
    this.randomNameRecords = [];
    
    // 锁定状态变量
    this.isLocked = false;
    this.lockPassword = '';
	
	// 🆕 新增：数据修复调用（在init()中执行，确保数据已加载）
    
    // 初始化宠物功能（保存promise以便外部await）
    this.petFeaturesReady = this.initializePetFeatures();

    // 设置模态框点击外部关闭功能
    this.setupModalClickOutsideClose();

    // 注意：不在构造函数中调用 init()
    // init() 需要在 preloadRemoteStorage() 之后调用，
    // 否则服务器数据还没加载到 localStorage，会导致创建新的默认班级
  }
  
  // 为所有模态框添加点击外部区域自动关闭的功能
  setupModalClickOutsideClose() {
    // 获取所有模态框
    const modals = document.querySelectorAll('.modal');
    
    modals.forEach(modal => {
      // 获取模态框内容区域
      const modalContent = modal.querySelector('.modal-content');
      if (!modalContent) return;
      
      // 添加点击事件监听器
      modal.addEventListener('click', (event) => {
        // 如果点击的是模态框背景（不是内容区域），则关闭模态框
        if (event.target === modal) {
          // 根据模态框ID确定要调用的关闭方法
          const modalId = modal.id;
          if (modalId === 'pointsModal') {
            this.closePointsModal();
          } else if (modalId === 'groupPointsModal') {
            this.closeGroupPointsModal();
          } else if (modalId === 'shopModal') {
            this.closeShopModal();
          } else if (modalId === 'studentHistoryModal') {
            this.closeStudentHistoryModal();
          } else if (modalId === 'groupHistoryModal') {
            this.closeGroupHistoryModal();
          } else if (modalId === 'settingsModal') {
            this.closeSettings();
          } else if (modalId === 'createGroupModal') {
            this.closeCreateGroupModal();
          } else if (modalId === 'editGroupModal') {
            this.closeEditGroupModal();
          } else if (modalId === 'statisticsModal') {
            this.closeStatistics();
          } else if (modalId === 'statisticsDetailModal') {
            this.closeStatisticsDetail();
          } else if (modalId === 'randomNameModal') {
            this.closeRandomNameModal();
          } else if (modalId === 'timerModal') {
            this.closeTimerModal();
          } else if (modalId === 'techSupportModal') {
            this.closeTechSupportModal();
          }
        }
      });
    });
  }
  
  // 初始化宠物功能
  async initializePetFeatures() {
    // 加载宠物图片配置（从服务器读取）
    await this.initializePetImages();
    
    // 加载学生宠物选择记录
    this.loadStudentPets();
    // 加载小组宠物选择记录
    this.loadGroupPets();
    
    // 绑定宠物选择确认按钮事件
    const confirmBtn = document.getElementById('confirmPetSelection');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const studentName = document.getElementById('petSelectionStudentName').textContent;
        const selectedPetType = document.querySelector('.pet-type-option.selected')?.dataset.type;
        if (studentName && selectedPetType) {
          this.selectPetType(studentName, selectedPetType);
          // 刷新学生卡片显示
          this.renderStudents();
          // 显示成功消息
          alert('宠物选择成功！');
        }
      });
    }
    
    // 绑定宠物配置保存按钮事件
    const saveBtn = document.getElementById('savePetConfig');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        // 使用统一保存方法
        this.saveAllPetConfig();
      });
    }
    
    // 绑定宠物配置重置按钮事件
    const resetBtn = document.getElementById('resetPetConfig');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetPetConfig();
      });
    }
  }
  
  // 🆕 新增：修复现有数据的方法
fixExistingData() {
  // 修复宠物等级数据
  this.petStages.forEach((stage, index) => {
    // 确保每个阶段都有emoji字段
    if (!stage.emoji) {
      const emojiMap = {
        '蛋': '🥚', '孵化中': '🐣', '雏鸟': '🐤', '幼鸟': '🐦',
        '成长鸟': '🕊️', '雄鹰': '🦅'
      };
      stage.emoji = emojiMap[stage.name] || '❓';
    }
  });

  // 修复小组等级数据
  if (this.groupStages && Array.isArray(this.groupStages)) {
    this.groupStages.forEach((stage, index) => {
      // 确保每个阶段都有emoji字段
      if (!stage.emoji) {
        const emojiMap = {
          '青铜': '🥉', '白银': '🥈', '黄金': '🥇',
          '铂金': '🔷', '钻石': '💎', '王者': '👑'
        };
        stage.emoji = emojiMap[stage.name] || '❓';
      }
    });
    
    // 小组等级数据会在用户修改后自动保存，此处不需要手动保存
  }
}

// ===== 宠物功能核心方法 =====

// 初始化宠物图片配置 - 从服务器文件夹读取
  async initializePetImages() {
  console.time('[perf] initializePetImages');
  // 先初始化空结构
  this.petImages = {};
  this.petTypes.forEach(type => {
    this.petImages[type.id] = {};
    for (let i = 1; i <= 6; i++) {
      this.petImages[type.id][`level${i}`] = '';
    }
  });

  try {
    const resp = await fetch('/api/pet-images/types');
    if (!resp.ok) throw new Error('获取宠物图片失败');
    const data = await resp.json();

    // 将服务器返回的宠物类型和图片URL同步到前端
    if (data.types && Array.isArray(data.types)) {
      // 默认颜色列表，用于自动分配
      const defaultColors = ['#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#feca57','#ff9ff3','#54a0ff'];

      data.types.forEach((serverType, idx) => {
        const serverName = serverType.name || serverType.id;
        // 同步 petTypes：如果前端没有这个类型，自动添加
        const exists = this.petTypes.find(t => t.id === serverType.id);
        if (!exists) {
          this.petTypes.push({
            id: serverType.id,
            name: serverName,
            emoji: '🐾',
            color: defaultColors[idx % defaultColors.length]
          });
        } else if (serverType.name && exists.name !== serverType.name) {
          // 有服务端名称时同步更新，避免一直显示ID
          exists.name = serverType.name;
        }

        // 同步图片URL
        if (!this.petImages[serverType.id]) {
          this.petImages[serverType.id] = {};
        }
        for (let i = 1; i <= 6; i++) {
          const levelKey = `level${i}`;
          if (serverType.images && serverType.images[levelKey]) {
            this.petImages[serverType.id][levelKey] = serverType.images[levelKey] + '?t=' + Date.now();
          } else if (!this.petImages[serverType.id][levelKey]) {
            this.petImages[serverType.id][levelKey] = '';
          }
        }

        // 同步等级名称（保持积分区间等结构，只替换名称）
        if (!this.petStagesByType) this.petStagesByType = {};
        if (!this.petStagesByType[serverType.id]) {
          // 即使服务器没有返回 stageNames，也要为该宠物类型初始化等级数据
          const baseStages = Array.isArray(this.petStages) && this.petStages.length > 0
            ? this.petStages
            : this.migrateStages(this.getDefaultPetStages(), 'pet');
          this.petStagesByType[serverType.id] = JSON.parse(JSON.stringify(baseStages));
        }
        if (serverType.stageNames && serverType.stageNames.length > 0) {
          const mergedStages = this.petStagesByType[serverType.id];
          serverType.stageNames.forEach((name, i) => {
            if (mergedStages[i]) mergedStages[i].name = name;
          });
        }
      });

      // 保存更新后的 petTypes / petStagesByType 到 localStorage
      if (this.currentClassId) {
        this.storageSet(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
        if (this.petStagesByType && Object.keys(this.petStagesByType).length > 0) {
          this.storageSet(`petStagesByType_${this.currentClassId}`, JSON.stringify(this.petStagesByType));
        }
      }
    }
    console.log('✅ 从服务器加载宠物图片成功');
  } catch (error) {
    console.error('从服务器加载宠物图片失败，使用空数据:', error);
  } finally {
    this.petImagesLoaded = true;
    this.maybeRefreshPetStageViews();
    console.timeEnd('[perf] initializePetImages');
  }
}

// 等待班级数据与宠物配置都准备好后刷新界面，避免使用默认名称
maybeRefreshPetStageViews() {
  if (!this.classDataLoaded || !this.petImagesLoaded) return;
  this.renderStudents();
  this.renderGroups();
  this.renderPetConfig();
}

// 渲染宠物配置界面
renderPetConfig() {
    const container = document.getElementById('petConfigContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    // 添加宠物配置说明
    const infoDiv = document.createElement('div');
    infoDiv.className = 'pet-config-info';
    infoDiv.innerHTML = `
      <div class="settings-note" style="background: #f0f9ff; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
        <p style="margin: 0; color: #0369a1; font-size: 0.9em;">为每种宠物类型设置名称、表情符号和主题颜色，并上传各成长阶段的图片</p>
      </div>
    `;
    container.appendChild(infoDiv);
    
    // 确保每个宠物类型有独立的等级名称存储
    if (!this.petStagesByType) {
      this.petStagesByType = {};
    }
    
    // 获取当前活动的标签ID（如果存在）
    const activeTabId = this.currentActivePetTab || (this.petTypes.length > 0 ? this.petTypes[0].id : null);
    
    // 创建标签导航和内容容器
    const tabsContainer = document.createElement('div');
    tabsContainer.style.marginBottom = '20px';
    
    const tabButtonsDiv = document.createElement('div');
    tabButtonsDiv.className = 'pet-config-tabs';
    
    const tabContentsDiv = document.createElement('div');
    tabContentsDiv.className = 'pet-config-tab-contents';
    
    // 渲染每个宠物类型的标签和内容
    this.petTypes.forEach((type, index) => {
      // 初始化该宠物类型的等级名称存储
      if (!this.petStagesByType[type.id]) {
        this.petStagesByType[type.id] = JSON.parse(JSON.stringify(this.petStages));
      }
      
      // 创建标签按钮
      const tabButton = document.createElement('button');
      // 使用保存的活动标签ID或默认第一个标签
      const isActive = type.id === activeTabId;
      tabButton.className = isActive ? 'pet-config-tab-btn active' : 'pet-config-tab-btn';
      tabButton.textContent = `${type.emoji} ${type.name}`;
      tabButton.dataset.petType = type.id;
      
      // 创建标签内容容器
      const tabContent = document.createElement('div');
      tabContent.className = isActive ? 'pet-config-tab-content active' : 'pet-config-tab-content';
      tabContent.dataset.petType = type.id;
      
      const configTypeDiv = document.createElement('div');
      configTypeDiv.className = 'pet-config-type';
      configTypeDiv.style.borderLeft = `4px solid ${type.color}`;
      
      // 宠物类型头部
      const headerDiv = document.createElement('div');
      headerDiv.className = 'pet-config-header';
      headerDiv.innerHTML = `
        <div class="pet-config-type-info" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <!-- 多选框 -->
            <input 
              type="checkbox" 
              class="pet-type-checkbox" 
              data-pet-type="${type.id}"
              style="width: 16px; height: 16px; cursor: pointer;"
            >
            <div class="pet-config-basic-info" style="display: flex; align-items: center; gap: 8px;">
              <div class="pet-config-emoji" style="background: ${type.color}30; color: ${type.color}; padding: 8px; border-radius: 8px; font-size: 24px; margin-right: 15px;">
                ${type.emoji}
              </div>
              <input 
                type="text" 
                class="pet-config-name-input" 
                value="${type.name}" 
                data-pet-type="${type.id}"
                placeholder="宠物名称"
                style="width: 100px; flex-shrink: 0;"
              >
              <input 
                type="text" 
                class="pet-config-emoji-input" 
                value="${type.emoji}" 
                data-pet-type="${type.id}"
                placeholder="表情符号"
                style="width: 60px; text-align: center;"
                maxlength="2"
              >
              <input 
                type="color" 
                class="pet-config-color-input" 
                value="${type.color}" 
                data-pet-type="${type.id}"
                style="width: 50px; height: 32px; cursor: pointer;"
              >
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button 
              class="btn btn-info btn-sm batch-apply-pet-btn" 
              data-pet-type="${type.id}"
              style="padding: 4px 12px; font-size: 0.8em;"
            >
              批量应用
            </button>
            <button 
              class="btn btn-danger btn-sm delete-pet-type-btn" 
              data-pet-type="${type.id}"
              style="padding: 4px 12px; font-size: 0.8em;"
            >
              删除
            </button>
          </div>
        </div>
      `;
    
    // 等级配置区域
    const levelsDiv = document.createElement('div');
    levelsDiv.className = 'pet-config-levels';
    levelsDiv.style.display = 'grid';
    levelsDiv.style.gridTemplateColumns = 'repeat(3, 1fr)';
    levelsDiv.style.gap = '15px';
    levelsDiv.style.marginTop = '15px';
    
    for (let i = 1; i <= 6; i++) {
      const levelDiv = document.createElement('div');
      levelDiv.className = 'pet-config-level';
      levelDiv.style.background = 'white';
      levelDiv.style.border = `1px solid #e2e8f0`;
      levelDiv.style.borderRadius = '8px';
      levelDiv.style.padding = '12px';
      levelDiv.style.display = 'flex';
      levelDiv.style.flexDirection = 'column';
      levelDiv.style.alignItems = 'center';
      
      const levelKey = `level${i}`;
      const stageName = this.petStagesByType[type.id][i - 1]?.name || `等级${i}`;
      const currentImage = (this.petImages[type.id] && this.petImages[type.id][levelKey]) || '';
      
      levelDiv.innerHTML = `
        <div style="width: 100%; margin-bottom: 10px; text-align: center;">
          <div style="font-weight: bold; margin-bottom: 5px; color: ${type.color};">${stageName}</div>
          <input 
            type="text" 
            class="pet-config-stage-name" 
            value="${stageName}" 
            data-stage-index="${i - 1}"
            data-pet-type="${type.id}"
            placeholder="阶段名称"
            style="width: 100%; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;"
          >
        </div>
        
        <div class="pet-config-upload" style="position: relative; width: 100px; height: 100px; margin-bottom: 10px;">
          <div style="position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; border: 2px dashed #ddd; border-radius: 8px; background: #f8fafc; cursor: pointer; transition: all 0.2s;">
            ${currentImage ? 
              `<img 
                src="${currentImage}" 
                class="pet-config-image has-image" 
                alt="${type.name} - ${stageName}"
                style="max-width: 60px; max-height: 60px; object-fit: contain;"
              >` : 
              `<span style="font-size: 0.9em; color: #64748b; font-weight: 500;">上传图片</span>`
            }
            <input 
              type="file" 
              accept="image/*" 
              data-pet-type="${type.id}" 
              data-level="${i}"
              style="position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 2;"
            >
          </div>
        </div>
        
        <button class="btn btn-small btn-danger" 
          data-pet-type="${type.id}" 
          data-level="${i}"
          ${!currentImage ? 'disabled' : ''}
          style="padding: 4px 12px; font-size: 0.8em; opacity: ${!currentImage ? '0.5' : '1'}; cursor: ${!currentImage ? 'not-allowed' : 'pointer'};"
        >移除图片</button>
      `;
      
      levelsDiv.appendChild(levelDiv);
    }
    
    configTypeDiv.appendChild(headerDiv);
    configTypeDiv.appendChild(levelsDiv);
    
    // 将配置内容添加到标签内容中
    tabContent.appendChild(configTypeDiv);
    
    // 添加标签按钮和内容到容器
    tabButtonsDiv.appendChild(tabButton);
    tabContentsDiv.appendChild(tabContent);
  });
  
  // 添加标签切换事件监听器
  tabButtonsDiv.addEventListener('click', (e) => {
    if (e.target.classList.contains('pet-config-tab-btn')) {
      const petTypeId = e.target.dataset.petType;
      
      // 保存当前活动的标签ID
      this.currentActivePetTab = petTypeId;
      
      // 切换标签按钮状态
      tabButtonsDiv.querySelectorAll('.pet-config-tab-btn').forEach(btn => {
        if (btn.dataset.petType === petTypeId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      // 切换标签内容
      tabContentsDiv.querySelectorAll('.pet-config-tab-content').forEach(content => {
        if (content.dataset.petType === petTypeId) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    }
  });
  
  // 添加到主容器
  tabsContainer.appendChild(tabButtonsDiv);
  container.appendChild(tabsContainer);
  container.appendChild(tabContentsDiv);
  
  // 添加事件监听器
  this.addPetConfigEventListeners();
  
  // 创建顶部操作栏（在宠物标签上方）
  const topActionsDiv = document.createElement('div');
  topActionsDiv.className = 'top-actions';
  topActionsDiv.style.display = 'flex';
  topActionsDiv.style.alignItems = 'center';
  topActionsDiv.style.justifyContent = 'space-between';
  topActionsDiv.style.marginBottom = '20px';
  topActionsDiv.style.padding = '15px';
  topActionsDiv.style.background = '#f8fafc';
  topActionsDiv.style.borderRadius = '8px';
  topActionsDiv.style.border = '1px solid #e2e8f0';
  
  // 左侧：添加新宠物按钮
  const leftActionsDiv = document.createElement('div');
  leftActionsDiv.style.display = 'flex';
  leftActionsDiv.style.alignItems = 'center';
  leftActionsDiv.style.gap = '15px';
  
  const addPetTypeBtn = document.createElement('button');
  addPetTypeBtn.className = 'btn btn-primary';
  addPetTypeBtn.textContent = '添加新宠物类型';
  addPetTypeBtn.addEventListener('click', () => {
    this.addNewPetType();
  });
  
  // 批量导入宠物按钮
  const importPetsBtn = document.createElement('button');
  importPetsBtn.className = 'btn btn-info';
  importPetsBtn.textContent = '批量导入宠物';
  importPetsBtn.addEventListener('click', () => {
    this.batchImportPets();
  });
  
  leftActionsDiv.appendChild(addPetTypeBtn);
  leftActionsDiv.appendChild(importPetsBtn);
  
  // 右侧：批量操作区域
  const rightActionsDiv = document.createElement('div');
  rightActionsDiv.style.display = 'flex';
  rightActionsDiv.style.alignItems = 'center';
  rightActionsDiv.style.gap = '15px';
  
  // 全选/取消全选按钮
  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'btn btn-secondary btn-sm';
  selectAllBtn.textContent = '全选';
  selectAllBtn.id = 'selectAllPetTypes';
  
  // 批量删除按钮
  const batchDeleteBtn = document.createElement('button');
  batchDeleteBtn.className = 'btn btn-danger';
  batchDeleteBtn.textContent = '批量删除 (0)';
  batchDeleteBtn.id = 'batchDeletePetTypes';
  batchDeleteBtn.disabled = true;
  
  // 选中数量显示
  const selectedCountSpan = document.createElement('span');
  selectedCountSpan.id = 'selectedPetTypesCount';
  selectedCountSpan.textContent = '已选择 0 个宠物类型';
  selectedCountSpan.style.color = '#667eea';
  selectedCountSpan.style.fontWeight = 'bold';
  
  rightActionsDiv.appendChild(selectAllBtn);
  rightActionsDiv.appendChild(batchDeleteBtn);
  rightActionsDiv.appendChild(selectedCountSpan);
  
  // 组合左右两侧
  topActionsDiv.appendChild(leftActionsDiv);
  topActionsDiv.appendChild(rightActionsDiv);
  
  // 将顶部操作栏插入到宠物标签上方
  container.insertBefore(topActionsDiv, tabsContainer);
  
  // 添加批量操作事件监听器
  this.addBatchActionsEventListeners();
}

// 添加新宠物类型
addNewPetType() {
  // 生成唯一ID
  const newId = `pet${Date.now()}`;
  // 创建新宠物类型对象
  const newPetType = {
    id: newId,
    name: `新宠物${this.petTypes.length + 1}`,
    emoji: '🐾',
    color: '#667eea'
  };
  
  // 添加到宠物类型数组
  this.petTypes.push(newPetType);
  
  // 初始化该宠物类型的等级名称存储
  if (!this.petStagesByType) {
    this.petStagesByType = {};
  }
  this.petStagesByType[newId] = JSON.parse(JSON.stringify(this.petStages));
  
  // 初始化该宠物类型的图片配置
  if (!this.petImages[newId]) {
    this.petImages[newId] = {};
    for (let i = 1; i <= 6; i++) {
      this.petImages[newId][`level${i}`] = '';
    }
  }
  
  // 保存宠物配置
  this.saveAllPetConfig();
  
  // 重新渲染宠物配置界面
  this.renderPetConfig();
}

// 删除宠物类型
deletePetType(petTypeId) {
  // 确认删除
  if (!confirm('确定要删除这个宠物类型吗？删除后相关数据将无法恢复。')) {
    return;
  }
  
  // 从宠物类型数组中删除
  const index = this.petTypes.findIndex(type => type.id === petTypeId);
  if (index === -1) {
    return;
  }
  
  // 删除宠物类型
  this.petTypes.splice(index, 1);
  
  // 删除相关的等级名称配置
  if (this.petStagesByType && this.petStagesByType[petTypeId]) {
    delete this.petStagesByType[petTypeId];
  }
  
  // 删除相关的图片配置
  if (this.petImages && this.petImages[petTypeId]) {
    delete this.petImages[petTypeId];
  }
  
  // 保存宠物配置
  this.saveAllPetConfig();
  
  // 重新渲染宠物配置界面
  this.renderPetConfig();
}

// 添加批量操作事件监听器
addBatchActionsEventListeners() {
  // 多选框选择事件
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('pet-type-checkbox')) {
      this.updateBatchActionsState();
    }
  });
  
  // 全选/取消全选按钮
  const selectAllBtn = document.getElementById('selectAllPetTypes');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      this.toggleSelectAllPetTypes();
    });
  }
  
  // 批量删除按钮
  const batchDeleteBtn = document.getElementById('batchDeletePetTypes');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', () => {
      this.batchDeletePetTypes();
    });
  }
}

// 更新批量操作状态
updateBatchActionsState() {
  const checkboxes = document.querySelectorAll('.pet-type-checkbox');
  const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  // 更新选中数量显示
  const selectedCountSpan = document.getElementById('selectedPetTypesCount');
  if (selectedCountSpan) {
    selectedCountSpan.textContent = `已选择 ${selectedCount} 个宠物类型`;
  }
  
  // 更新批量删除按钮
  const batchDeleteBtn = document.getElementById('batchDeletePetTypes');
  if (batchDeleteBtn) {
    batchDeleteBtn.textContent = `批量删除 (${selectedCount})`;
    batchDeleteBtn.disabled = selectedCount === 0;
  }
  
  // 更新全选按钮状态
  const selectAllBtn = document.getElementById('selectAllPetTypes');
  if (selectAllBtn) {
    if (selectedCount === totalCount && totalCount > 0) {
      selectAllBtn.textContent = '取消全选';
      selectAllBtn.classList.add('btn-warning');
      selectAllBtn.classList.remove('btn-secondary');
    } else {
      selectAllBtn.textContent = '全选';
      selectAllBtn.classList.remove('btn-warning');
      selectAllBtn.classList.add('btn-secondary');
    }
  }
}

// 全选/取消全选宠物类型
toggleSelectAllPetTypes() {
  const checkboxes = document.querySelectorAll('.pet-type-checkbox');
  const selectAllBtn = document.getElementById('selectAllPetTypes');
  
  if (!selectAllBtn) return;
  
  const isSelectingAll = selectAllBtn.textContent === '全选';
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = isSelectingAll;
  });
  
  this.updateBatchActionsState();
}

// 批量删除宠物类型
batchDeletePetTypes() {
  const selectedCheckboxes = document.querySelectorAll('.pet-type-checkbox:checked');
  const selectedCount = selectedCheckboxes.length;
  
  if (selectedCount === 0) {
    alert('请先选择要删除的宠物类型');
    return;
  }
  
  // 确认删除对话框
  const confirmed = confirm(`确定要删除选中的 ${selectedCount} 个宠物类型吗？此操作不可撤销`);
  if (!confirmed) {
    return;
  }
  
  try {
    // 收集要删除的宠物类型ID
    const petTypeIdsToDelete = Array.from(selectedCheckboxes).map(cb => cb.dataset.petType);
    
    // 批量删除
    petTypeIdsToDelete.forEach(petTypeId => {
      this.deletePetTypeById(petTypeId);
    });
    
    // 保存配置
    this.saveAllPetConfig();
    
    // 重新渲染界面
    this.renderPetConfig();
    
    // 显示成功提示
    alert(`成功删除 ${selectedCount} 个宠物类型`);
    
  } catch (error) {
    console.error('批量删除宠物类型失败:', error);
    alert('删除过程中出现错误，请重试');
  }
}

// 根据ID删除宠物类型（不显示确认对话框）
deletePetTypeById(petTypeId) {
  // 从宠物类型数组中删除
  const index = this.petTypes.findIndex(type => type.id === petTypeId);
  if (index === -1) {
    return;
  }
  
  this.petTypes.splice(index, 1);
  
  // 删除相关的等级名称配置
  if (this.petStagesByType && this.petStagesByType[petTypeId]) {
    delete this.petStagesByType[petTypeId];
  }
  
  // 删除相关的图片配置
  if (this.petImages && this.petImages[petTypeId]) {
    delete this.petImages[petTypeId];
  }
}

// 批量导入宠物功能
batchImportPets() {
  this.showNotification('请选择包含宠物数据的文件夹（支持单个宠物文件夹或"宠物"主文件夹）', 'info');
  
  // 创建文件夹选择对话框
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.webkitdirectory = true;
  folderInput.multiple = true;
  folderInput.style.display = 'none';
  
  folderInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) {
      this.showNotification('未选择任何文件夹', 'warning');
      return;
    }
    
    // 检测是否为单个宠物文件夹
    const isSinglePetFolder = this.isSinglePetFolder(files);
    
    if (isSinglePetFolder) {
      // 单个宠物文件夹模式：直接处理所有文件
      this.selectFolderDialog(files);
    } else {
      // 批量导入模式：验证是否选择了"宠物"文件夹
      const petFolderFiles = files.filter(file => 
        file.webkitRelativePath.includes('宠物/') || 
        file.webkitRelativePath.startsWith('宠物/')
      );
      
      if (petFolderFiles.length === 0) {
        this.showNotification('请选择名为"宠物"的主文件夹或包含1-6.jpg和等级名称.txt的单个宠物文件夹', 'error');
        return;
      }
      
      this.selectFolderDialog(petFolderFiles);
    }
  });
  
  document.body.appendChild(folderInput);
  folderInput.click();
  document.body.removeChild(folderInput);
}

// 文件夹选择对话框处理
selectFolderDialog(files) {
  // 解析文件夹结构
  const folderStructure = this.parseFolderStructure(files);
  
  // 验证宠物文件夹结构
  const validationResult = this.validatePetFolders(folderStructure);
  if (!validationResult.isValid) {
    this.showNotification(`文件夹结构验证失败: ${validationResult.message}`, 'error');
    return;
  }
  
  // 显示导入确认对话框
  this.showImportConfirmationDialog(folderStructure);
}

// 解析文件夹结构
parseFolderStructure(files) {
  const structure = {};
  
  files.forEach(file => {
    const pathParts = file.webkitRelativePath.split('/');
    const fileName = pathParts[pathParts.length - 1];
    
    // 检测是否选择了单个宠物文件夹（直接包含1-6.jpg和等级名称.txt）
    const isSinglePetFolder = this.isSinglePetFolder(files);
    
    let petName;
    
    if (isSinglePetFolder) {
      // 单个宠物文件夹模式：使用文件夹名作为宠物名
      // 对于单个文件夹，路径结构应该是 [文件夹名]/文件名
      petName = pathParts[0]; // 获取第一个路径部分（文件夹名）
      if (!petName || petName === '宠物') {
        // 如果文件夹名为"宠物"，则使用默认名称
        petName = '导入的宠物';
      }
    } else {
      // 批量导入模式：查找宠物文件夹下的子文件夹
      // 路径结构应该是 宠物/[宠物名]/文件名
      const petFolderIndex = pathParts.indexOf('宠物');
      if (petFolderIndex === -1) {
        // 如果没有找到"宠物"文件夹，跳过此文件
        return;
      }
      
      petName = pathParts[petFolderIndex + 1];
      if (!petName) {
        // 如果宠物名为空，跳过此文件
        return;
      }
    }
    
    if (!structure[petName]) {
      structure[petName] = {
        images: {},
        levelNames: null
      };
    }
    
    // 处理图片文件（严格验证命名格式）
    if (fileName.match(/^[1-6]\.jpg$/i)) {
      const level = parseInt(fileName.split('.')[0]);
      
      // 验证图片文件命名规范
      if (level < 1 || level > 6) {
        throw new Error(`图片文件名格式错误：${fileName}，应为1.jpg到6.jpg`);
      }
      
      structure[petName].images[level] = file;
    }
    
    // 处理等级名称文件（支持大小写）
    if (fileName.toLowerCase() === '等级名称.txt') {
      structure[petName].levelNames = file;
    }
  });
  
  return structure;
}

// 检测是否为单个宠物文件夹
isSinglePetFolder(files) {
  if (!files || files.length === 0) return false;
  
  // 检查是否包含宠物文件夹的必需文件：至少包含等级名称.txt和部分图片文件
  const hasLevelNamesFile = files.some(file => 
    file.name.toLowerCase() === '等级名称.txt'
  );
  
  const hasImageFiles = files.some(file => 
    /^[1-6]\.jpg$/i.test(file.name)
  );
  
  if (!hasLevelNamesFile || !hasImageFiles) return false;
  
  // 检查路径结构：单个宠物文件夹的路径应该只有一层（文件夹名/文件名）
  const hasSingleLevelPath = files.every(file => {
    const pathParts = file.webkitRelativePath.split('/');
    return pathParts.length === 2; // 只有文件夹名和文件名
  });
  
  if (!hasSingleLevelPath) return false;
  
  // 检查是否没有"宠物"文件夹路径
  const hasPetFolderPath = files.some(file => 
    file.webkitRelativePath.includes('宠物/')
  );
  
  return !hasPetFolderPath;
}

// 验证宠物文件夹结构
validatePetFolders(structure) {
  const petNames = Object.keys(structure);
  
  if (petNames.length === 0) {
    return { isValid: false, message: '未找到任何宠物数据' };
  }
  
  for (const petName of petNames) {
    const petData = structure[petName];
    
    // 验证图片文件完整性（1-6.jpg必须齐全）
    const missingImages = [];
    for (let level = 1; level <= 6; level++) {
      if (!petData.images[level]) {
        missingImages.push(`${level}.jpg`);
      }
    }
    
    if (missingImages.length > 0) {
      return { 
        isValid: false, 
        message: `宠物"${petName}"缺少以下图片文件: ${missingImages.join(', ')}` 
      };
    }
    
    // 验证等级名称文件
    if (!petData.levelNames) {
      return { 
        isValid: false, 
        message: `宠物"${petName}"缺少等级名称文件(等级名称.txt)` 
      };
    }
    
    // 验证图片文件命名规范
    for (let level = 1; level <= 6; level++) {
      const imageFile = petData.images[level];
      if (imageFile && !imageFile.name.match(/^[1-6]\.jpg$/i)) {
        return { 
          isValid: false, 
          message: `宠物"${petName}"的图片文件命名不规范: ${imageFile.name}，应为${level}.jpg` 
        };
      }
    }
  }
  
  return { isValid: true, message: '文件夹结构验证通过' };
}

// 显示导入确认对话框
showImportConfirmationDialog(structure) {
  const petNames = Object.keys(structure);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.zIndex = '1000';
  
  modal.innerHTML = `
    <div class="modal-content" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 10px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
      <h3 style="margin-bottom: 20px; color: #333;">批量导入宠物确认</h3>
      <div style="margin-bottom: 20px;">
        <p>检测到以下宠物数据，确认导入吗？</p>
        <ul style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; border-radius: 5px; padding: 10px;">
          ${petNames.map(petName => `
            <li style="padding: 5px 0; border-bottom: 1px solid #eee;">
              <strong>${petName}</strong> - 包含6张图片和等级名称文件
            </li>
          `).join('')}
        </ul>
        <p style="margin-top: 10px; color: #666;">总计: ${petNames.length} 个宠物</p>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="cancelImport" class="btn btn-secondary" style="padding: 8px 16px;">取消</button>
        <button id="confirmImport" class="btn btn-primary" style="padding: 8px 16px;">确认导入</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 绑定事件
  document.getElementById('cancelImport').addEventListener('click', () => {
    document.body.removeChild(modal);
    this.showNotification('导入已取消', 'info');
  });
  
  document.getElementById('confirmImport').addEventListener('click', () => {
    document.body.removeChild(modal);
    this.startImportProcess(structure);
  });
  
  // 点击外部关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
      this.showNotification('导入已取消', 'info');
    }
  });
}

// 开始导入过程
async startImportProcess(structure) {
  const petNames = Object.keys(structure);
  let successCount = 0;
  let failedCount = 0;
  const failedPets = []; // 记录失败的宠物和错误信息
  
  // 显示进度对话框
  const progressModal = this.showImportProgressDialog(petNames.length);
  
  try {
    for (let i = 0; i < petNames.length; i++) {
      const petName = petNames[i];
      const petData = structure[petName];
      
      // 更新进度
      this.updateImportProgress(progressModal, i + 1, petNames.length, petName);
      
      try {
        await this.importSinglePet(petName, petData);
        successCount++;
        
        // 添加短暂延迟，避免过快导入导致界面卡顿
        if (i < petNames.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.error(`导入宠物"${petName}"失败:`, error);
        failedCount++;
        failedPets.push({
          name: petName,
          error: error.message
        });
        
        // 显示当前宠物导入失败的通知
        this.showNotification(`宠物"${petName}"导入失败: ${error.message}`, 'error', 3000);
      }
    }
    
    // 关闭进度对话框
    document.body.removeChild(progressModal);
    
    // 显示导入结果（包含详细错误信息）
    this.showImportResult(successCount, failedCount, failedPets);
    
    // 🆕 新增：保存所有宠物配置数据（包括等级名称）
    if (successCount > 0) {
      this.saveAllPetConfig();
      // 刷新宠物列表
      this.renderPetConfig();
    }
    
  } catch (error) {
    console.error('导入过程出现错误:', error);
    document.body.removeChild(progressModal);
    this.showNotification(`导入过程出现错误：${error.message}`, 'error');
  }
}

// 显示导入进度对话框
showImportProgressDialog(totalCount) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.zIndex = '1000';
  
  modal.innerHTML = `
    <div class="modal-content" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 10px; max-width: 400px; width: 90%;">
      <h3 style="margin-bottom: 20px; color: #333;">正在导入宠物数据...</h3>
      <div style="margin-bottom: 15px;">
        <div id="importProgressText" style="margin-bottom: 10px; color: #666;">
          准备开始导入 (0/${totalCount})
        </div>
        <div style="width: 100%; height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden;">
          <div id="importProgressBar" style="height: 100%; background: #4CAF50; width: 0%; transition: width 0.3s;"></div>
        </div>
      </div>
      <div id="currentPetName" style="text-align: center; color: #888; font-style: italic;"></div>
    </div>
  `;
  
  document.body.appendChild(modal);
  return modal;
}

// 更新导入进度
updateImportProgress(modal, current, total, petName) {
  const progressText = modal.querySelector('#importProgressText');
  const progressBar = modal.querySelector('#importProgressBar');
  const currentPetName = modal.querySelector('#currentPetName');
  
  if (progressText) {
    progressText.textContent = `正在导入 ${current}/${total}`;
  }
  
  if (progressBar) {
    const percentage = (current / total) * 100;
    progressBar.style.width = `${percentage}%`;
  }
  
  if (currentPetName) {
    currentPetName.textContent = `当前: ${petName}`;
  }
}

// 导入单个宠物
async importSinglePet(petName, petData) {
  return new Promise(async (resolve, reject) => {
    try {
      // 读取等级名称文件
      const levelNames = await this.readLevelNamesFile(petData.levelNames);
      if (levelNames.length !== 6) {
        throw new Error('等级名称文件必须包含6行文本');
      }
      
      // 创建新的宠物类型
      const newPetType = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        name: petName,
        emoji: '🐾', // 默认表情符号
        color: this.getRandomColor() // 随机颜色
      };
      
      // 添加到宠物类型数组
      this.petTypes.push(newPetType);
      
      // 初始化该宠物类型的图片数据结构
      if (!this.petImages[newPetType.id]) {
        this.petImages[newPetType.id] = {};
      }
      
      // 初始化等级名称配置
      if (!this.petStagesByType) {
        this.petStagesByType = {};
      }
      if (!this.petStagesByType[newPetType.id]) {
        this.petStagesByType[newPetType.id] = JSON.parse(JSON.stringify(this.petStages));
      }
      
      // 更新等级名称
      for (let i = 0; i < 6; i++) {
        if (this.petStagesByType[newPetType.id][i]) {
          this.petStagesByType[newPetType.id][i].name = levelNames[i];
        }
      }
      
      // 上传图片文件
      for (let level = 1; level <= 6; level++) {
        const imageFile = petData.images[level];
        if (imageFile) {
          await this.uploadPetImageForImport(imageFile, newPetType.id, level);
        }
      }
      
      resolve();
      
    } catch (error) {
      reject(error);
    }
  });
}

// 读取等级名称文件
readLevelNamesFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        
        // 验证文件内容不为空
        if (!content || content.trim().length === 0) {
          reject(new Error('等级名称文件内容为空'));
          return;
        }
        
        // 按行分割并处理
        const lines = content.split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0); // 过滤空行
        
        // 验证行数
        if (lines.length !== 6) {
          reject(new Error(`等级名称文件必须包含6行文本，当前有${lines.length}行`));
          return;
        }
        
        // 验证每行内容不为空
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length === 0) {
            reject(new Error(`等级名称文件第${i + 1}行为空`));
            return;
          }
          
          // 验证名称长度（防止过长名称）
          if (lines[i].length > 20) {
            reject(new Error(`等级名称文件第${i + 1}行名称过长（超过20个字符）`));
            return;
          }
        }
        
        resolve(lines);
        
      } catch (error) {
        reject(new Error('读取等级名称文件失败：' + error.message));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('读取等级名称文件失败'));
    };
    
    reader.readAsText(file, 'UTF-8'); // 指定UTF-8编码
  });
}

// 为导入功能上传宠物图片
async uploadPetImageForImport(file, petTypeId, level) {
  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    throw new Error(`文件"${file.name}"不是图片格式`);
  }
  // 验证文件大小（最大5MB）
  if (file.size > 5 * 1024 * 1024) {
    throw new Error(`图片"${file.name}"过大，最大支持5MB`);
  }

  const formData = new FormData();
  formData.append('file', file);

  const resp = await fetch(`/api/pet-images/upload/${petTypeId}/${level}`, {
    method: 'POST',
    body: formData
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `上传图片"${file.name}"失败`);
  }

  const result = await resp.json();
  const levelKey = `level${level}`;
  if (!this.petImages[petTypeId]) {
    this.petImages[petTypeId] = {};
  }
  this.petImages[petTypeId][levelKey] = result.url + '?t=' + Date.now();
}

// 显示导入结果
showImportResult(successCount, failedCount, failedPets = []) {
  let message = '';
  let type = 'success';
  
  if (successCount > 0 && failedCount === 0) {
    message = `成功导入 ${successCount} 个宠物`;
  } else if (successCount > 0 && failedCount > 0) {
    message = `成功导入 ${successCount} 个宠物，失败 ${failedCount} 个`;
    type = 'warning';
    
    // 显示详细失败信息（如果失败数量较少）
    if (failedCount <= 5) {
      message += '\n失败详情：';
      failedPets.forEach(pet => {
        message += `\n• ${pet.name}: ${pet.error}`;
      });
    } else {
      message += `\n（失败数量较多，请检查控制台获取详细错误信息）`;
    }
  } else {
    message = `导入失败，所有 ${failedCount} 个宠物均未成功导入`;
    type = 'error';
    
    // 显示详细失败信息
    if (failedCount > 0) {
      message += '\n失败详情：';
      failedPets.forEach(pet => {
        message += `\n• ${pet.name}: ${pet.error}`;
      });
    }
  }
  
  this.showNotification(message, type);
}

// 生成随机颜色
getRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// 渲染小组宠物形象配置（新增）
renderGroupPetConfig() {
  // 小组宠物形象配置已与个人宠物形象配置统一，不再需要单独渲染
  // 此处保留方法定义，避免调用错误
  return;
  const container = document.getElementById('petConfigContainer');
  if (!container) return;
  
  // 确保groupPetImages数据结构完整
  if (!this.groupPetImages) {
    this.groupPetImages = {};
  }
  
  // 初始化小组宠物图片数据结构
  this.petTypes.forEach(type => {
    if (!this.groupPetImages[type.id]) {
      this.groupPetImages[type.id] = {};
    }
    for (let i = 1; i <= 6; i++) {
      const levelKey = `level${i}`;
      if (!this.groupPetImages[type.id][levelKey]) {
        this.groupPetImages[type.id][levelKey] = '';
      }
    }
  });
  
  // 添加小组宠物配置区域
  const section = document.createElement('div');
  section.className = 'pet-config-section';
  section.style.marginTop = '40px';
  section.style.paddingTop = '20px';
  section.style.borderTop = '2px solid #e2e8f0';
  section.innerHTML = `
    <h4 style="margin-bottom: 20px; color: #2d3748; display: flex; align-items: center;">
      <span style="margin-right: 10px; font-size: 1.3em;">👥</span> 小组宠物形象配置
    </h4>
    <div class="settings-note" style="background: #fff7ed; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
      <p style="margin: 0; color: #c2410c; font-size: 0.9em;">为小组设置独立的宠物形象和等级名称，与个人宠物配置互不影响</p>
    </div>
  `;
  
  // 渲染小组宠物配置
  this.petTypes.forEach(type => {
    const configTypeDiv = document.createElement('div');
    configTypeDiv.className = 'pet-config-type group-pet-config';
    configTypeDiv.style.borderLeft = `4px solid ${type.color}`;
    configTypeDiv.style.marginBottom = '20px';
    
    // 小组宠物类型头部
    const headerDiv = document.createElement('div');
    headerDiv.className = 'pet-config-header';
    headerDiv.innerHTML = `
      <div class="pet-config-type-info">
        <div class="pet-config-emoji" style="background: ${type.color}30; color: ${type.color}; padding: 8px; border-radius: 8px; font-size: 24px;">
          ${type.emoji}
        </div>
        <div class="pet-config-basic-info">
          <h5 style="margin: 0; margin-left: 10px;">小组${type.name}</h5>
        </div>
      </div>
    `;
  
    // 等级配置区域
    const levelsDiv = document.createElement('div');
    levelsDiv.className = 'pet-config-levels';
    levelsDiv.style.display = 'grid';
    levelsDiv.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
    levelsDiv.style.gap = '15px';
    levelsDiv.style.marginTop = '15px';
    
    for (let i = 1; i <= 6; i++) {
      const levelDiv = document.createElement('div');
      levelDiv.className = 'pet-config-level group-pet-level';
      levelDiv.style.background = '#f9fafb';
      levelDiv.style.border = `1px solid #e2e8f0`;
      levelDiv.style.borderRadius = '8px';
      levelDiv.style.padding = '12px';
      levelDiv.style.display = 'flex';
      levelDiv.style.flexDirection = 'column';
      levelDiv.style.alignItems = 'center';
      levelDiv.dataset.isGroupPet = 'true';
      
      const levelKey = `level${i}`;
      // 使用groupStages数据结构
      const stageName = this.groupStages[i - 1]?.name || `等级${i}`;
      // 获取小组宠物图片，如果没有则为空
      const currentImage = (this.groupPetImages[type.id] && this.groupPetImages[type.id][levelKey]) || '';
      
      levelDiv.innerHTML = `
        <div style="width: 100%; margin-bottom: 10px; text-align: center;">
          <div style="font-weight: bold; margin-bottom: 5px; color: #3b82f6;">小组${stageName}</div>
          <div 
            class="pet-config-stage-name group-stage-name" 
            data-stage-index="${i - 1}"
            data-is-group="true"
            style="width: 100%; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5; color: #666;"
          >
            ${stageName}
          </div>
        </div>
        
        <div class="pet-config-upload" style="position: relative; width: 100px; height: 100px; margin-bottom: 10px;">
          <div style="position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; border: 2px dashed #3b82f6; border-radius: 8px; background: #eff6ff; cursor: pointer; transition: all 0.2s;">
            ${currentImage && currentImage !== '' ? 
              `<img 
                src="${currentImage}" 
                class="pet-config-image has-image" 
                alt="小组${type.name} - ${stageName}"
                style="max-width: 60px; max-height: 60px; object-fit: contain; border: 2px solid #3b82f6; border-radius: 4px;"
              >` : 
              `<span style="font-size: 0.9em; color: #3b82f6; font-weight: 500;">上传图片</span>`
            }
            <input 
              type="file" 
              accept="image/*" 
              data-pet-type="${type.id}" 
              data-level="${i}"
              data-is-group="true"
              style="position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 2;"
            >
          </div>
        </div>
        
        <button class="btn btn-small btn-danger group-remove-image" 
          data-pet-type="${type.id}" 
          data-level="${i}"
          ${!currentImage || currentImage === '' ? 'disabled' : ''}
          style="padding: 4px 12px; font-size: 0.8em; opacity: ${!currentImage || currentImage === '' ? '0.5' : '1'}; cursor: ${!currentImage || currentImage === '' ? 'not-allowed' : 'pointer'};">
          移除图片
        </button>
      `;
      
      levelsDiv.appendChild(levelDiv);
    }
    
    configTypeDiv.appendChild(headerDiv);
    configTypeDiv.appendChild(levelsDiv);
    section.appendChild(configTypeDiv);
  });
  
  container.appendChild(section);
}

// 添加宠物配置事件监听器
addPetConfigEventListeners() {
  // 文件上传事件 - 使用事件委托
  document.addEventListener('change', (e) => {
    if (e.target.matches('.pet-config-upload input[type="file"]')) {
      const petType = e.target.dataset.petType;
      const level = parseInt(e.target.dataset.level);
      const isGroup = e.target.dataset.isGroup === 'true';
      const file = e.target.files[0];
      
      if (file) {
        this.uploadPetImage(file, petType, level);
      }
    }
  });
  
  // 个人宠物移除按钮事件
  document.querySelectorAll('.pet-config-level button[data-pet-type]').forEach(button => {
    button.addEventListener('click', (e) => {
      const petType = e.target.dataset.petType;
      const level = parseInt(e.target.dataset.level);
      this.removePetImage(petType, level);
    });
  });
  
  // 小组宠物移除按钮事件
  document.querySelectorAll('.group-remove-image').forEach(button => {
    button.addEventListener('click', (e) => {
      const petType = e.target.dataset.petType;
      const level = parseInt(e.target.dataset.level);
      this.removePetImage(petType, level);
    });
  });
  
  // 宠物名称修改事件
  document.querySelectorAll('.pet-config-name-input').forEach(input => {
    input.addEventListener('blur', (e) => {
      const petType = e.target.dataset.petType;
      const newName = e.target.value.trim();
      
      if (newName && newName !== '') {
        // 保存当前活动的标签ID
        this.currentActivePetTab = petType;
        
        // 更新宠物类型名称
        const type = this.petTypes.find(t => t.id === petType);
        if (type) {
          type.name = newName;
          // 保存宠物类型配置到localStorage
          this.storageSet(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
          // 更新当前界面显示
          this.renderPetConfig();
        }
      }
    });
  });
  
  // 宠物表情符号修改事件
  document.querySelectorAll('.pet-config-emoji-input').forEach(input => {
    input.addEventListener('blur', (e) => {
      const petType = e.target.dataset.petType;
      const newEmoji = e.target.value.trim();
      
      if (newEmoji && newEmoji !== '') {
        // 保存当前活动的标签ID
        this.currentActivePetTab = petType;
        
        // 更新宠物类型表情符号
        const type = this.petTypes.find(t => t.id === petType);
        if (type) {
          type.emoji = newEmoji;
          // 保存宠物类型配置到localStorage
          this.storageSet(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
          // 更新当前界面显示
          this.renderPetConfig();
        }
      }
    });
  });
  
  // 宠物颜色修改事件
  document.querySelectorAll('.pet-config-color-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const petType = e.target.dataset.petType;
      const newColor = e.target.value;
      
      if (newColor && newColor !== '') {
        // 保存当前活动的标签ID
        this.currentActivePetTab = petType;
        
        // 更新宠物类型颜色
        const type = this.petTypes.find(t => t.id === petType);
        if (type) {
          type.color = newColor;
          // 保存宠物类型配置到localStorage
          this.storageSet(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
          // 更新当前界面显示
          this.renderPetConfig();
        }
      }
    });
  });
  
  // 删除宠物类型按钮事件
  document.querySelectorAll('.delete-pet-type-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const petTypeId = e.target.dataset.petType;
      this.deletePetType(petTypeId);
    });
  });
  
  // 阶段名称修改事件
  document.querySelectorAll('.pet-config-stage-name').forEach(input => {
    input.addEventListener('blur', (e) => {
      const stageIndex = parseInt(e.target.dataset.stageIndex);
      const isGroup = e.target.dataset.isGroup === 'true';
      const newName = e.target.value.trim();
      
      if (newName && newName !== '') {
        if (isGroup) {
          // 小组阶段名称不允许修改，显示提示信息
          this.showNotification('小组阶段名称已固定，不可修改！', 'warning');
          // 恢复原始名称
          e.target.value = this.groupStages[stageIndex]?.name || `等级${i}`;
        } else {
          // 更新个人阶段名称 - 按宠物类型独立存储
          const petType = e.target.dataset.petType;
          if (petType && this.petStagesByType && this.petStagesByType[petType]) {
            if (stageIndex < this.petStagesByType[petType].length) {
              this.petStagesByType[petType][stageIndex].name = newName;
              // 保存个人阶段配置到localStorage
              this.storageSet(`petStagesByType_${this.currentClassId}`, JSON.stringify(this.petStagesByType));
              
              // 立即更新UI上的阶段名称标题
              const stageTitle = e.target.closest('.pet-config-level').querySelector('div[style*="font-weight: bold"]');
              if (stageTitle) {
                stageTitle.textContent = newName;
              }
            }
          } else {
            // 回退到原来的逻辑（兼容性处理）
            if (stageIndex < this.petStages.length) {
              this.petStages[stageIndex].name = newName;
              this.storageSet(`petStages_${this.currentClassId}`, JSON.stringify(this.petStages));
              
              const stageTitle = e.target.closest('.pet-config-level').querySelector('div[style*="font-weight: bold"]');
              if (stageTitle) {
                stageTitle.textContent = newName;
              }
            }
          }
        }
      }
    });
  });
  
  // 批量应用宠物按钮事件
  if (!this._batchApplyPetDocHandlerBound) {
    document.addEventListener('click', (e) => {
      if (e.target.matches('.batch-apply-pet-btn')) {
        const petTypeId = e.target.dataset.petType;
        this.showBatchApplyPetModal(petTypeId);
      }
    });
    this._batchApplyPetDocHandlerBound = true;
  }
  
  // 批量应用宠物模态框确认按钮事件
  const confirmBatchApplyBtn = document.getElementById('confirmBatchApplyPetBtn');
  const cancelBatchApplyBtn = document.getElementById('cancelBatchApplyPetBtn');
  const selectAllCheckbox = document.getElementById('selectAllStudents');
  
  if (confirmBatchApplyBtn) {
    confirmBatchApplyBtn.onclick = () => {
      this.confirmBatchApplyPet();
    };
  }
  
  if (cancelBatchApplyBtn) {
    cancelBatchApplyBtn.onclick = () => {
      // 用户明确取消操作，清除宠物类型选择
      this.currentBatchApplyPetTypeId = null;
      this.hideBatchApplyPetModal();
    };
  }
  
  if (selectAllCheckbox) {
    selectAllCheckbox.onchange = (e) => {
      this.toggleSelectAllStudents(e.target.checked);
    };
  }
}

// 上传宠物图片 - 上传到服务器文件夹
async uploadPetImage(file, petType, level) {
  console.log('🚀 uploadPetImage调用开始:', {file, petType, level});

  // 参数验证
  if (!file) {
    this.showNotification('请选择要上传的图片文件！', 'error');
    return;
  }
  if (!petType || typeof level === 'undefined') {
    this.showNotification('图片配置参数错误！', 'error');
    return;
  }
  if (!file.type.match('image.*')) {
    this.showNotification('请上传有效的图片文件！', 'error');
    return;
  }
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    this.showNotification('图片大小不能超过5MB！', 'error');
    return;
  }
  
  // 上传到服务器
  try {
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch(`/api/pet-images/upload/${petType}/${level}`, {
      method: 'POST',
      body: formData
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || '上传失败');
    }

    const result = await resp.json();
    const levelKey = `level${level}`;

    // 更新内存中的图片URL
    if (!this.petImages) this.petImages = {};
    if (!this.petImages[petType]) this.petImages[petType] = {};
    this.petImages[petType][levelKey] = result.url + '?t=' + Date.now();

    this.showNotification('图片上传成功！', 'success');

    // 刷新UI
    this.renderPetConfig();
    this.renderStudents();
    this.renderGroups();
    this.renderRankings();
  } catch (error) {
    console.error('上传宠物图片失败:', error);
    this.showNotification(`图片上传失败: ${error.message}`, 'error');
  }
}
// 移除宠物图片 - 从服务器文件夹删除
async removePetImage(petType, level) {
  const levelKey = `level${level}`;

  if (!this.petImages[petType] || !this.petImages[petType][levelKey]) {
    return;
  }

  if (!confirm('确定要移除这张宠物图片吗？')) {
    return;
  }

  try {
    const resp = await fetch(`/api/pet-images/delete/${petType}/${level}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('删除失败');

    this.petImages[petType][levelKey] = '';
    this.showNotification('图片已移除！', 'info');
    this.renderPetConfig();
    this.renderStudents();
    this.renderGroups();
    this.renderRankings();
  } catch (error) {
    console.error('删除宠物图片失败:', error);
    this.showNotification('删除图片失败，请重试', 'error');
  }
}

// 统一保存所有宠物相关配置
saveAllPetConfig() {
  try {
    // 验证数据完整性
    if (!this.petTypes || !Array.isArray(this.petTypes)) {
      throw new Error('宠物类型数据无效');
    }
    if (!this.petStages || !Array.isArray(this.petStages)) {
      throw new Error('宠物阶段数据无效');
    }
    if (!this.petImages || typeof this.petImages !== 'object') {
      throw new Error('宠物图片数据无效');
    }
    // groupLevels数据结构已废弃，不再验证
    if (!this.studentPets || typeof this.studentPets !== 'object') {
      throw new Error('学生宠物选择数据无效');
    }
    if (!this.groupPets || typeof this.groupPets !== 'object') {
      throw new Error('小组宠物选择数据无效');
    }
    
    // 保存各项数据
    this.storageSet(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
    this.storageSet(`petStages_${this.currentClassId}`, JSON.stringify(this.petStages));
    this.storageSet(`groupStages_${this.currentClassId}`, JSON.stringify(this.groupStages)); // 保存小组等级配置
    // petImages不再保存到localStorage，改为服务器文件夹存储
    this.storageSet(`studentPets_${this.currentClassId}`, JSON.stringify(this.studentPets));
    this.storageSet(`groupPets_${this.currentClassId}`, JSON.stringify(this.groupPets)); // 保存小组宠物选择
    
    // 🆕 新增：保存按宠物类型存储的等级名称数据
    if (this.petStagesByType && typeof this.petStagesByType === 'object') {
      this.storageSet(`petStagesByType_${this.currentClassId}`, JSON.stringify(this.petStagesByType));
    }
    
    this.showNotification('宠物配置保存成功！', 'success');
    return true;
  } catch (error) {
    console.error('保存宠物配置失败:', error);
    this.showNotification(`保存失败: ${error.message}`, 'error');
    return false;
  }
}

// 保存宠物图片配置（图片已改为服务器文件夹存储，此方法保留兼容性）
savePetImages() {
  // 图片数据不再保存到localStorage，由服务器文件夹管理
  return true;
}
  
  // 测试宠物配置的保存和加载功能
  testPetConfigSystem() {
    try {
      // 保存测试数据
      const testPetTypes = [...this.petTypes];
      testPetTypes[0].name = '测试宠物';
      const testPetStages = [...this.petStages];
      testPetStages[0].name = '测试阶段';
      
      // 临时保存当前数据
      const originalPetTypes = JSON.stringify(this.petTypes);
      const originalPetStages = JSON.stringify(this.petStages);
      
      // 设置测试数据
      this.petTypes = testPetTypes;
      this.petStages = testPetStages;
      
      // 保存到localStorage
      const saveSuccess = this.saveAllPetConfig();
      
      // 重置数据
      this.petTypes = JSON.parse(originalPetTypes);
      this.petStages = JSON.parse(originalPetStages);
      
      // 重新加载数据
      const loadSuccess = this.loadAllPetConfig();
      
      // 验证数据
      const savedNameFound = this.petTypes.some(type => type.name === '测试宠物');
      const savedStageFound = this.petStages.some(stage => stage.name === '测试阶段');
      
      if (saveSuccess && loadSuccess && savedNameFound && savedStageFound) {
        console.log('✅ 宠物配置保存加载测试通过');
        // 恢复原始数据
        this.petTypes = JSON.parse(originalPetTypes);
        this.petStages = JSON.parse(originalPetStages);
        this.saveAllPetConfig();
        return true;
      } else {
        console.error('❌ 宠物配置测试失败', { saveSuccess, loadSuccess, savedNameFound, savedStageFound });
        // 恢复原始数据
        this.petTypes = JSON.parse(originalPetTypes);
        this.petStages = JSON.parse(originalPetStages);
        this.saveAllPetConfig();
        return false;
      }
    } catch (error) {
      console.error('❌ 宠物配置测试异常:', error);
      return false;
    }
  }

  // 显示通知提示
  showNotification(message, type = 'info') {
    // 检查是否已经存在通知元素
    let notification = document.getElementById('custom-notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'custom-notification';
      notification.style.position = 'fixed';
      notification.style.top = '20px';
      notification.style.right = '20px';
      notification.style.padding = '12px 20px';
      notification.style.borderRadius = '8px';
      notification.style.color = 'white';
      notification.style.fontWeight = '500';
      notification.style.zIndex = '10000';
      notification.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
      notification.style.transition = 'all 0.3s ease';
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(-10px)';
      document.body.appendChild(notification);
    }
    
    // 设置通知类型和消息
    switch(type) {
      case 'success':
        notification.style.backgroundColor = '#10b981';
        break;
      case 'error':
        notification.style.backgroundColor = '#ef4444';
        break;
      case 'warning':
        notification.style.backgroundColor = '#f59e0b';
        break;
      case 'info':
      default:
        notification.style.backgroundColor = '#3b82f6';
        break;
    }
    
    notification.textContent = message;
    
    // 显示通知
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateY(0)';
      
      // 3秒后隐藏通知
      setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-10px)';
        setTimeout(() => {
          notification.remove();
        }, 300);
      }, 3000);
    }, 10);
  }

// 恢复默认宠物配置
resetPetConfig() {
  if (confirm('确定要恢复默认宠物配置吗？这将清空所有上传的图片！')) {
    // 重置宠物图片对象
    this.petImages = {};
    this.groupPetImages = {}; // 同时重置小组宠物图片
    
    // 初始化个人宠物图片结构
    this.petTypes.forEach(type => {
      this.petImages[type.id] = {};
      for (let i = 1; i <= 6; i++) {
        this.petImages[type.id][`level${i}`] = '';
      }
    });
    
    // 初始化小组宠物图片结构
    this.petTypes.forEach(type => {
      this.groupPetImages[type.id] = {};
      for (let i = 1; i <= 6; i++) {
        this.groupPetImages[type.id][`level${i}`] = '';
      }
    });
    
    // petImages已改为服务器文件夹存储，无需清理localStorage
    
    // 重新渲染配置界面
    this.renderPetConfig();
    
    this.showNotification('已恢复默认宠物配置！', 'success');
  }
}

// 清理旧缓存数据
// 检查localStorage是否可用
// 内存缓存始终可用
isLocalStorageAvailable() {
  return true;
}

// 安全地获取localStorage数据
safeLocalStorageGet(key) {
  const fullKey = this.storageKey(key);
  return this._kvCache.has(fullKey) ? this._kvCache.get(fullKey) : null;
}

// 设置数据到内存缓存并队列写入数据库
safeLocalStorageSet(key, value) {
  try {
    this._kvCache.set(this.storageKey(key), value);
    this.queueRemoteSet(key, value);
    return true;
  } catch (error) {
    console.error(`设置缓存数据失败 [${key}]:`, error);
    return false;
  }
}

// 安全地解析JSON数据
safeJsonParse(jsonString, defaultValue = null) {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error('JSON解析失败:', error, '原始数据:', jsonString);
    return defaultValue;
  }
}

// 安全地序列化JSON数据
safeJsonStringify(obj, defaultValue = 'null') {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    console.error('JSON序列化失败:', error, '对象:', obj);
    return defaultValue;
  }
}

// 检查数据大小（MB）
checkStorageSize(data) {
  try {
    const size = new Blob([typeof data === 'string' ? data : JSON.stringify(data)]).size;
    return size / (1024 * 1024); // 转换为MB
  } catch (error) {
    console.error('检查数据大小失败:', error);
    return 0;
  }
}

// 格式化存储大小显示
formatStorageSize(sizeInMB) {
  if (sizeInMB < 1) {
    return (sizeInMB * 1024).toFixed(2) + ' KB';
  }
  return sizeInMB.toFixed(2) + ' MB';
}

clearOldCache() {
  // 内存缓存无配额限制，无需清理
  return true;
}

// 渲染宠物选择界面
renderPetSelection(student) {
  const studentNameEl = document.getElementById('petSelectionStudentName');
  const currentPetPreview = document.getElementById('currentPetPreview');
  const petTypeGrid = document.getElementById('petTypeGrid');
  const petLevelPreviews = document.getElementById('petLevelPreviews');
  
  if (!studentNameEl || !currentPetPreview || !petTypeGrid || !petLevelPreviews) return;

  if (!this.petTypes || this.petTypes.length === 0) {
    currentPetPreview.innerHTML = '<div style="color: #94a3b8;">暂无宠物类型，请先在宠物配置中添加</div>';
    petTypeGrid.className = 'pet-type-grid';
    petTypeGrid.innerHTML = '<div style="padding: 12px; color: #94a3b8; text-align: center;">暂无可选宠物类型</div>';
    petLevelPreviews.innerHTML = '';
    return;
  }
  
  // 设置学生姓名和欢迎信息
  studentNameEl.innerHTML = `<span style="color: #3b82f6; font-weight: 600;">${student.name}</span>`;
  
  // 获取学生当前宠物选择
  const studentPet = this.studentPets[student.name] || {};
  const currentPetType = this.getValidPetTypeId(studentPet.petType);
  
  // 显示当前宠物（带样式和信息）
  const petType = this.petTypes.find(type => type.id === currentPetType);
  currentPetPreview.innerHTML = `
    <div style="position: relative; display: inline-block;">
      <div style="font-size: 2.5em; padding: 20px; background: ${petType?.color}20; border-radius: 50%;">${petType?.emoji || '🐾'}</div>
      <div style="position: absolute; bottom: 5px; right: 5px; background: ${petType?.color || '#3b82f6'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</div>
    </div>
    <div style="margin-top: 10px; font-size: 1.2em; font-weight: 500; color: ${petType?.color || '#3b82f6'};">${petType?.name || '未设置'}</div>
  `;
  
  // 渲染宠物类型选择网格
  petTypeGrid.innerHTML = '';
  // 应用CSS样式类
  petTypeGrid.className = 'pet-type-grid';
  
  this.petTypes.forEach(type => {
    const option = document.createElement('div');
    const isSelected = type.id === currentPetType;
    option.className = `pet-type-option ${isSelected ? 'selected' : ''}`;
    option.dataset.petType = type.id;
    option.style.background = isSelected ? `${type.color}15` : 'white';
    option.style.border = `2px solid ${isSelected ? type.color : '#e5e7eb'}`;
    option.style.borderRadius = '12px';
    option.style.padding = '15px 10px';
    option.style.textAlign = 'center';
    option.style.cursor = 'pointer';
    option.style.transition = 'all 0.2s ease';
    option.style.boxShadow = isSelected ? `0 4px 12px ${type.color}30` : '0 2px 4px rgba(0,0,0,0.05)';
    
    option.addEventListener('mouseenter', () => {
      if (!isSelected) {
        option.style.transform = 'translateY(-2px)';
        option.style.boxShadow = `0 6px 16px rgba(0,0,0,0.1)`;
        option.style.borderColor = type.color;
      }
    });
    
    option.addEventListener('mouseleave', () => {
      if (!isSelected) {
        option.style.transform = 'translateY(0)';
        option.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
        option.style.borderColor = '#e5e7eb';
      }
    });
    
    option.innerHTML = `
      <div class="pet-type-emoji" style="background: ${type.color}20;">${type.emoji}</div>
      <div class="pet-type-name" style="color: ${type.color};">${type.name}</div>
      ${isSelected ? '<div style="margin-top: 8px; padding: 2px 8px; background: ' + type.color + '; color: white; border-radius: 12px; font-size: 0.8em; display: inline-block;">已选择</div>' : ''}
    `;
    petTypeGrid.appendChild(option);
  });
  
  // 渲染等级预览
  this.renderPetLevelPreviews(currentPetType);
  
  // 添加事件监听器
  this.addPetSelectionEventListeners(student);
}

// 渲染宠物等级预览
renderPetLevelPreviews(petType) {
  // 统一查找预览容器，支持个人和小组预览
  const petLevelPreviews = document.getElementById('petLevelPreviews') || document.getElementById('groupPetLevelPreviews');
  if (!petLevelPreviews) return;
  if (!petType || !this.petTypes || this.petTypes.length === 0) {
    petLevelPreviews.innerHTML = '';
    return;
  }
  
  // 设置预览区域样式
  petLevelPreviews.style.display = 'flex';
  petLevelPreviews.style.overflowX = 'auto';
  petLevelPreviews.style.gap = '15px';
  petLevelPreviews.style.padding = '15px 5px';
  petLevelPreviews.style.background = '#f9fafb';
  petLevelPreviews.style.borderRadius = '12px';
  petLevelPreviews.style.border = '1px solid #e5e7eb';
  petLevelPreviews.innerHTML = '';
  
  const typeInfo = this.petTypes.find(type => type.id === petType);
  
  for (let i = 1; i <= 6; i++) {
    const levelDiv = document.createElement('div');
    levelDiv.className = 'pet-level-preview';
    levelDiv.style.flex = '0 0 auto';
    levelDiv.style.textAlign = 'center';
    levelDiv.style.minWidth = '100px';
    levelDiv.style.position = 'relative';
    
    const levelKey = `level${i}`;
    // 统一使用petStagesByType获取等级名称，不再区分个人和小组
    const stageName = this.petStagesByType[petType]?.[i - 1]?.name || this.petStages[i - 1]?.name || `等级${i}`;
    // 统一使用petImages获取图片数据，不再区分个人和小组
    const imageData = this.petImages[petType]?.[levelKey] || '';
    
    // 添加等级指示器
    const levelIndicator = document.createElement('div');
    levelIndicator.style.position = 'absolute';
    top: '-10px';
    left: '50%';
    transform: 'translateX(-50%)';
    levelIndicator.style.background = typeInfo?.color || '#3b82f6';
    levelIndicator.style.color = 'white';
    levelIndicator.style.width = '20px';
    levelIndicator.style.height = '20px';
    levelIndicator.style.borderRadius = '50%';
    levelIndicator.style.display = 'flex';
    levelIndicator.style.alignItems = 'center';
    levelIndicator.style.justifyContent = 'center';
    levelIndicator.style.fontSize = '0.8em';
    levelIndicator.style.fontWeight = 'bold';
    levelIndicator.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    levelIndicator.textContent = i;
    
    let displayContent;
    if (this.displayMode === 'local' && imageData) {
      displayContent = `
        <div style="width: 80px; height: 80px; margin: 0 auto; display: flex; align-items: center; justify-content: center; background: white; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;">
          <img src="${imageData}" style="max-width: 100%; max-height: 100%; object-fit: contain;"
               alt="${stageName}">
        </div>
      `;
    } else {
      // 使用对应的宠物等级emoji，根据宠物类型调整
      const baseEmoji = typeInfo?.emoji || '🐾';
      // 根据等级稍微调整emoji大小，显示成长效果
      const size = 2 + (i * 0.15); // 从2em到2.9em递增
      displayContent = `
        <div style="width: 80px; height: 80px; margin: 0 auto; display: flex; align-items: center; justify-content: center; background: ${typeInfo?.color || '#3b82f6'}20; border-radius: 8px;">
          <div style="font-size: ${size}em;">${baseEmoji}</div>
        </div>
      `;
    }
    
    levelDiv.innerHTML = `
      ${levelIndicator.outerHTML}
      <div style="margin-top: 15px;">
        ${displayContent}
        <div style="margin-top: 8px; font-size: 0.9em; font-weight: 500; color: ${typeInfo?.color || '#3b82f6'};">${stageName}</div>
      </div>
    `;
    
    // 添加解锁状态指示器
    const unlockIndicator = document.createElement('div');
    unlockIndicator.style.marginTop = '5px';
    unlockIndicator.style.fontSize = '0.8em';
    unlockIndicator.style.fontWeight = '500';
    
    // 检查是否是小组预览容器
    const isGroupPreview = petLevelPreviews.id === 'groupPetLevelPreviews';
    
    if (isGroupPreview) {
      // 小组预览：显示所有等级为已解锁
      unlockIndicator.style.color = '#10b981';
      unlockIndicator.innerHTML = '🔓 已解锁';
    } else {
      // 学生预览：根据当前选中的学生判断解锁状态
      const currentStudentName = document.getElementById('studentHistoryModal')?.dataset?.studentName;
      if (currentStudentName) {
        const currentStudent = this.students.find(s => s.name === currentStudentName);
        if (currentStudent) {
          const studentTotalPoints = this.getStudentTotalPoints(currentStudent);
          const currentLevel = this.getLevel(studentTotalPoints, currentStudent.name);
          
          // 判断当前等级是否已解锁
          if (i <= currentLevel) {
            unlockIndicator.style.color = '#10b981';
            unlockIndicator.innerHTML = '🔓 已解锁';
          } else {
            unlockIndicator.style.color = '#9ca3af';
            unlockIndicator.innerHTML = '🔒 待解锁';
          }
        } else {
          // 如果找不到学生，默认显示为已解锁
          unlockIndicator.style.color = '#10b981';
          unlockIndicator.innerHTML = '🔓 已解锁';
        }
      } else {
        // 如果没有当前学生，默认显示为已解锁
        unlockIndicator.style.color = '#10b981';
        unlockIndicator.innerHTML = '🔓 已解锁';
      }
    }
    
    levelDiv.appendChild(unlockIndicator);
    
    petLevelPreviews.appendChild(levelDiv);
    
    // 添加连接线（最后一个等级不需要）
    if (i < 6) {
      const connector = document.createElement('div');
      connector.style.flex = '0 0 auto';
      connector.style.width = '10px';
      connector.style.display = 'flex';
      connector.style.alignItems = 'center';
      connector.style.justifyContent = 'center';
      connector.innerHTML = `
        <div style="height: 2px; width: 100%; background: ${typeInfo?.color || '#3b82f6'}40;"></div>
      `;
      petLevelPreviews.appendChild(connector);
    }
  }
}

// 添加宠物选择事件监听器
addPetSelectionEventListeners(student) {
  // 宠物类型选择事件
  document.querySelectorAll('.pet-type-option').forEach(option => {
    option.addEventListener('click', (e) => {
      // 移除所有选中状态
      document.querySelectorAll('.pet-type-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      // 添加当前选中状态
      option.classList.add('selected');
      
      // 获取选中的宠物类型
      const petType = option.dataset.petType;
      
      // 更新等级预览
      this.renderPetLevelPreviews(petType);
      
      // 更新当前宠物显示
      const petTypeInfo = this.petTypes.find(type => type.id === petType);
      const currentPetPreview = document.getElementById('currentPetPreview');
      if (currentPetPreview && petTypeInfo) {
        currentPetPreview.innerHTML = `<span style="font-size: 2.5em;">${petTypeInfo.emoji}</span>`;
      }
    });
  });
  
  // 确认选择按钮事件
  const confirmBtn = document.getElementById('confirmPetSelection');
  if (confirmBtn) {
    // 移除之前的事件监听器
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.addEventListener('click', () => {
      const selectedOption = document.querySelector('.pet-type-option.selected');
      if (selectedOption) {
        const petType = selectedOption.dataset.petType;
        this.selectPetType(student, petType);
      }
    });
  }
}

// 学生选择宠物类型
selectPetType(student, petType) {
  // 处理不同类型的学生参数（对象或字符串）
  const studentName = typeof student === 'object' && student.name ? student.name : student;
  
  // 保存学生宠物选择
  this.studentPets[studentName] = {
    petType: petType,
    selectedAt: new Date().toISOString()
  };
  
  // 保存到本地存储
  this.saveStudentPets();
  
  // 更新学生卡片显示
  this.renderStudents();
  
  // 显示成功提示
  alert(`${student.name} 成功选择了宠物！`);
  
  // 关闭模态框
  const modal = document.getElementById('studentHistoryModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 获取学生当前宠物形象
getStudentPetImage(student) {
  const studentPet = this.studentPets[student.name] || {};
  const petType = this.getValidPetTypeId(studentPet.petType);
  if (!petType) {
    return '🐾';
  }
  
  // 计算学生当前等级 - 使用总积分以保持与等级显示一致
  const totalPoints = this.getStudentTotalPoints(student);
  const studentLevel = this.getLevel(totalPoints) - 1; // getLevel返回1-6，转为0-5
  const levelKey = `level${studentLevel + 1}`; // 0-5转为level1-level6
  
  // 根据显示模式返回对应的显示内容
  if (this.displayMode === 'local') {
    // 检查是否有图片（URL路径或base64）
    const imageData = this.petImages?.[petType]?.[levelKey];
    if (imageData) {
      return `<img src="${imageData}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
      const petStage = this.getPetStage(totalPoints, student.name);
      return petStage.emoji || '❓';
    }
  } else {
    const petStage = this.getPetStage(totalPoints, student.name);
    return petStage.emoji || '❓';
  }
}

// 获取小组当前宠物形象
getGroupPetImage(group) {
  console.log('🎨 getGroupPetImage调用开始:', { group });
  
  // 参数验证
  if (!group || typeof group.name === 'undefined') {
    console.error('❌ getGroupPetImage错误: 无效的group参数');
    return '🐾';
  }
  
  // 确保groupPets已初始化
  if (!this.groupPets) {
    this.groupPets = {};
  }
  
  const groupPet = this.groupPets[group.name] || {};
  const petType = this.getValidPetTypeId(groupPet.petType);
  if (!petType) {
    return '🐾';
  }
  console.log(`🐱 小组 ${group.name} 宠物类型: ${petType}`);
  
  // 根据小组积分计算当前等级（考虑小组选择的宠物类型）
  const groupPoints = parseInt(group.points) || 0;
  const groupStage = this.getGroupStage(groupPoints, group.name); // 传递小组名称以获取正确的等级
  const groupLevel = this.getGroupLevel(groupPoints) - 1; // 获取1-6的等级，转为0-5索引
  const validLevel = Math.max(0, Math.min(5, groupLevel)); // 确保在0-5范围内
  const levelKey = `level${validLevel + 1}`; // 0-5转为level1-level6
  console.log(`📊 小组等级计算: 积分=${groupPoints}, 等级=${groupLevel + 1}, 有效等级=${validLevel}, levelKey=${levelKey}, 等级名称=${groupStage.name}`);
  
  // 确保petImages已初始化（使用统一的petImages数据结构）
  if (!this.petImages) {
    this.petImages = {};
  }
  
  // 根据显示模式返回对应的显示内容
  if (this.displayMode === 'local') {
    const imageData = this.petImages?.[petType]?.[levelKey];
    if (imageData) {
      return `<img src="${imageData}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    }
  }
  // fallback emoji
  const emojiMap = { 0: '🥚', 1: '🐣', 2: '🐤', 3: '🐦', 4: '🕊️', 5: '🦅' };
  return emojiMap[validLevel] || '🐾';
}

// 保存学生宠物选择
saveStudentPets() {
  this.storageSet(`studentPets_${this.currentClassId}`, JSON.stringify(this.studentPets));
}

// 加载学生宠物选择
loadStudentPets() {
  const savedPets = this.storageGet(`studentPets_${this.currentClassId}`);
  if (savedPets) {
    try {
      this.studentPets = JSON.parse(savedPets);
    } catch (error) {
      console.error('加载学生宠物选择失败:', error);
      this.studentPets = {};
    }
  }
}

// 加载小组宠物选择
loadGroupPets() {
  const savedPets = this.storageGet(`groupPets_${this.currentClassId}`);
  if (savedPets) {
    try {
      this.groupPets = JSON.parse(savedPets);
    } catch (error) {
      console.error('加载小组宠物选择失败:', error);
      this.groupPets = {};
    }
  }
}
  
  testEmojiDisplay() {
  console.log('=== 测试Emoji显示 ===');
  console.log('当前displayMode:', this.displayMode);
  
  // 测试个人宠物
  this.petStages.forEach((stage, index) => {
    const emoji = this.getStageImage(stage, index, 'pet');
    console.log(`宠物 ${stage.name}:`, emoji, '原始emoji:', stage.emoji);
  });
  
  // 测试小组
  this.groupStages.forEach((stage, index) => {
    const emoji = this.getStageImage(stage, index, 'group');
    console.log(`小组 ${stage.name}:`, emoji, '原始emoji:', stage.emoji);
  });
}
  
init(){
  this.loadGlobalConfig(); // 先加载全局配置
  this.loadClassesFromLocalStorage(); // 然后加载班级列表
  
  // 先读取保存的模式（在加载班级数据之前）
  const savedMode = this.storageGet(`displayMode_${this.currentClassId}`);
  if (savedMode) {
    this.displayMode = savedMode;
  }

  this.loadFromLocalStorage(); // 最后加载当前班级数据
  this.classDataLoaded = true;
  this.maybeRefreshPetStageViews();
  
  // 🆕 新增：数据修复调用（确保数据已加载）
  this.fixExistingData();
  
  // 加载宠物类型配置（在currentClassId正确设置后）
  const savedPetTypes = this.storageGet(`petTypes_${this.currentClassId}`);
  if (savedPetTypes) {
    try {
      const parsedTypes = JSON.parse(savedPetTypes);
      if (Array.isArray(parsedTypes) && parsedTypes.length > 0) {
        this.petTypes = parsedTypes;
      }
      // 如果解析结果为空数组，保留已从服务器加载的 petTypes
    } catch (error) {
      console.error('加载宠物类型配置失败:', error);
    }
  }
  // 如果没有保存的配置，保留 initializePetImages() 已从服务器加载的公共宠物类型
  
  // 加载宠物阶段配置（在currentClassId正确设置后）
  const savedPetStages = this.storageGet(`petStages_${this.currentClassId}`);
  if (savedPetStages) {
    try {
      const parsedStages = JSON.parse(savedPetStages);
      // 合并保存的阶段名称
      parsedStages.forEach((savedStage, index) => {
        if (index < this.petStages.length && savedStage.name) {
          this.petStages[index].name = savedStage.name;
        }
      });
    } catch (error) {
      console.error('加载宠物阶段配置失败:', error);
    }
  }
  
  // 加载小组阶段配置（在currentClassId正确设置后）
  const savedGroupStages = this.storageGet(`groupStages_${this.currentClassId}`);
  if (savedGroupStages) {
    try {
      const parsedGroupStages = JSON.parse(savedGroupStages);
      // 只加载积分范围，不加载阶段名称（阶段名称已固定）
      parsedGroupStages.forEach((savedStage, index) => {
        if (index < this.groupStages.length) {
          // 只更新积分范围，不更新名称
          this.groupStages[index].minPoints = savedStage.minPoints !== undefined ? savedStage.minPoints : this.groupStages[index].minPoints;
          this.groupStages[index].maxPoints = savedStage.maxPoints !== undefined ? savedStage.maxPoints : this.groupStages[index].maxPoints;
        }
      });
    } catch (error) {
      console.error('加载小组阶段配置失败:', error);
    }
  }
  
  // 读取临时任务积分规则
  const tempRule = this.storageGet('tempTaskRule');
  if (tempRule) {
    this.applyTempTaskRule(JSON.parse(tempRule));
    this.storageRemove('tempTaskRule'); // 只用一次
  }
  
  // 初始化配置范围
  if (!this.currentConfigScope) {
    // 检查当前班级是否有自定义配置
    const data = this.storageGet(`classPointsData_${this.currentClassId}`);
    if (data) {
      const parsed = JSON.parse(data);
      const hasCustomConfig = (parsed.rules && parsed.rules.length > 0) || 
                             (parsed.shopItems && parsed.shopItems.length > 0) || 
                             (parsed.groupRules && parsed.groupRules.length > 0);
      this.currentConfigScope = hasCustomConfig ? 'class' : 'global';
    } else {
      this.currentConfigScope = 'global';
    }
  }
    
  // 新增：检查锁定状态，如果是锁定状态则立即显示解锁模态框
  if(this.isLocked){
    this.showUnlockModal();
    this.disableEditing();
  }
  
  // 创建切换按钮
  this.toggleModeBtn = document.createElement('button');
  
  // 禁用开发环境下的自动测试功能，防止测试数据覆盖真实数据
  // if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  //   setTimeout(() => {
  //     if (this.testPetConfigSystem()) {
  //       this.showNotification('宠物配置系统测试通过', 'success');
  //     } else {
  //       this.showNotification('宠物配置系统测试失败', 'warning');
  //     }
  //   }, 1000);
  // }
  this.toggleModeBtn.className = 'btn btn-info';
  this.toggleModeBtn.textContent = this.displayMode === 'emoji' ? '🖼️ 自定义宠物' : '🎭 恢复默认宠物';
  this.toggleModeBtn.style.margin = '0 8px';
  this.toggleModeBtn.addEventListener('click', () => this.toggleDisplayMode());

  // 插到控制栏第二行最右边
  const row2 = document.querySelector('.controls-row-2');
  row2.appendChild(this.toggleModeBtn);
    
  this.renderStudents();
  this.renderGroups();
  this.renderHistory();
  this.renderTaskRecords();
  this.renderRankings();
  this.setupEventListeners();
  this.updateLockButton();
  this.renderClassSelector(); // 渲染班级选择器
  // 首次加载时把当前班级写入共享键
this.storageSet('currentClassId', this.currentClassId);

// 全屏功能
const fullscreenBtn = document.getElementById('fullscreenBtn');
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    // 进入全屏
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen();
    }
  } else {
    // 退出全屏
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

// 监听全屏状态变化
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('msfullscreenchange', updateFullscreenButton);

function updateFullscreenButton() {
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (fullscreenBtn) {
    if (document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.msFullscreenElement) {
      fullscreenBtn.innerHTML = '⛶ 退出全屏';
      fullscreenBtn.classList.add('fullscreen-active');
    } else {
      fullscreenBtn.innerHTML = '⛶ 全屏';
      fullscreenBtn.classList.remove('fullscreen-active');
    }
  }
}
}
  
  // 加载全局配置
  loadGlobalConfig() {
    // 全局积分规则
    const globalRulesData = this.storageGet('classPointsGlobalRules');
    this.globalRules = globalRulesData ? JSON.parse(globalRulesData) : this.getDefaultRules();
    
    // 全局商店商品
    const globalShopData = this.storageGet('classPointsGlobalShopItems');
    this.globalShopItems = globalShopData ? JSON.parse(globalShopData) : this.getDefaultShopItems();
    
    // 全局小组规则
    const globalGroupRulesData = this.storageGet('classPointsGlobalGroupRules');
    this.globalGroupRules = globalGroupRulesData ? JSON.parse(globalGroupRulesData) : this.getDefaultGroupRules();
    
    // 初始化当前使用的配置为全局配置
    this.rules = this.globalRules;
    this.shopItems = this.globalShopItems;
    this.groupRules = this.globalGroupRules;
  }
  
  // 保存全局配置
  saveGlobalConfig() {
    this.storageSet('classPointsGlobalRules', JSON.stringify(this.globalRules));
    this.storageSet('classPointsGlobalShopItems', JSON.stringify(this.globalShopItems));
    this.storageSet('classPointsGlobalGroupRules', JSON.stringify(this.globalGroupRules));
    this.flushRemoteQueue();
  }
  
  // 渲染等级积分设置
renderLevelSettings() {
  this.renderPetLevelSettings();
  this.renderGroupLevelSettings();
  this.renderScoreRatioSettings();
// 把两个总按钮插到“等级积分设置”标签页最底部
const tab = document.getElementById('levelSettingsTab');   // 等级设置标签页

// 检查是否已经存在按钮容器，避免重复添加
let bottomBar = document.getElementById('levelSettingsBottomBar');
if (!bottomBar) {
  bottomBar = document.createElement('div');
  bottomBar.id = 'levelSettingsBottomBar'; // 添加唯一标识
  bottomBar.style.display = 'flex';           // 横向排列
  bottomBar.style.justifyContent = 'center';  // 居中
  bottomBar.style.gap = '12px';               // 按钮间距
  bottomBar.style.margin = '25px 0 10px 0';
  bottomBar.innerHTML =
    '<button class="btn btn-warning" id="resetPetBtn">🔄 恢复个人等级积分</button>' +
    '<button class="btn btn-warning" id="resetGroupBtn">🔄 恢复小组等级积分</button>';
  tab.appendChild(bottomBar);
}
}



renderPetLevelSettings() {
  const container = document.getElementById('petLevelSettings');
  container.innerHTML = '';
  this.petStages.forEach((stage, i) => {
    const minPts = parseInt(stage.minPoints) || 0;
    const next = this.petStages[i + 1];
    const nextMin = next ? parseInt(next.minPoints) : NaN;
    const maxValue = isNaN(nextMin) ? '' : nextMin - 1;
    const row = document.createElement('div');
    row.className = 'level-setting-item';

    row.innerHTML = `
      <div style="width: 80px; font-weight: bold; color: #374151;">${i + 1}级</div>
      <div>
        <input id="pet-min-${i}" type="number" value="${minPts}" min="0" style="width:70px">
        <span>-</span>
        <input id="pet-max-${i}" type="number" value="${maxValue}" ${i === this.petStages.length - 1 ? 'disabled' : ''} style="width:70px">
      </div>
    `;

    container.appendChild(row);
  });
}

// ====== 小组等级设置：读取 & 上传（整块替换） ======
renderGroupLevelSettings() {
  const container = document.getElementById('groupLevelSettings');
  container.innerHTML = '';
  this.groupStages.forEach((stage, i) => {
    const minPts = parseInt(stage.minPoints) || 0;
    const next = this.groupStages[i + 1];
    const nextMin = next ? parseInt(next.minPoints) : NaN;
    const maxValue = isNaN(nextMin) ? '' : nextMin - 1;
    const row = document.createElement('div');
    row.className = 'level-setting-item';

    row.innerHTML = `
      <div style="width: 80px; font-weight: bold; color: #374151;">${i + 1}级</div>
      <div>
        <input id="group-min-${i}" type="number" value="${minPts}" min="0" style="width:70px">
        <span>-</span>
        <input id="group-max-${i}" type="number" value="${maxValue}" ${i === this.groupStages.length - 1 ? 'disabled' : ''} style="width:70px">
      </div>
    `;

    container.appendChild(row);
  });
}

// 保存个人等级设置
savePetLevels(){
  this.petStages.forEach((s,i)=>{
    // 更新积分范围
    s.minPoints=parseInt(document.getElementById(`pet-min-${i}`).value)||0;
    const maxInput=document.getElementById(`pet-max-${i}`);
    if(!maxInput.disabled) s.maxPoints=parseInt(maxInput.value)||Infinity;
  });
  
  // 使用saveAllPetConfig确保一致性保存
  this.saveAllPetConfig();
  this.saveAll();
  alert('个人等级设置已保存！');
}

// 保存小组等级设置
saveGroupLevels(){
  this.groupStages.forEach((s,i)=>{
    s.minPoints=parseInt(document.getElementById(`group-min-${i}`).value)||0;
    const maxInput=document.getElementById(`group-max-${i}`);
    if(!maxInput.disabled) s.maxPoints=parseInt(maxInput.value)||Infinity;
  });
  
  this.saveAllPetConfig();
  this.saveAll();
  alert('小组等级设置已保存！');
}

// 渲染成绩比例设置
renderScoreRatioSettings() {
  const ratioInput = document.getElementById('scoreToPointsRatio');
  if (ratioInput) {
    ratioInput.value = this.scoreToPointsRatio;
  }
}


// 保存成绩比例设置
saveScoreRatio() {
  const ratio = parseInt(document.getElementById('scoreToPointsRatio').value);
  if (isNaN(ratio) || ratio < 1 || ratio > 100) {
    alert('请输入1-100之间的有效比例值！');
    return;
  }
  
  this.scoreToPointsRatio = ratio;
  this.saveAll();
  alert('成绩比例设置已保存！');
}

resetPetToDefault(){
  if(!confirm('确定恢复个人各等级的分值设置和成绩换算比例为默认值吗？当前宠物的图片和名称将保持不变。')) return;
  
  // 保存当前宠物的图片和名称
  const currentPetImages = this.petStages.map(stage => stage.img);
  const currentPetNames = this.petStages.map(stage => stage.name);
  
  // 1. 仅恢复默认的积分区间和成绩换算比例
  const defaultPetStages = [
    {name:'蛋',   img:'images/pet/1.png', minPoints:0,  maxPoints:20},
    {name:'孵化中',img:'images/pet/2.png', minPoints:20, maxPoints:50},
    {name:'雏鸟', img:'images/pet/3.png', minPoints:50, maxPoints:100},
    {name:'幼鸟', img:'images/pet/4.png', minPoints:100,maxPoints:200},
    {name:'成长鸟',img:'images/pet/5.png', minPoints:200,maxPoints:400},
    {name:'雄鹰', img:'images/pet/6.png', minPoints:400,maxPoints:Infinity}
  ];
  
  // 2. 恢复默认积分区间，但保持当前宠物的图片和名称
  this.petStages = defaultPetStages.map((stage, index) => ({
    name: currentPetNames[index] || stage.name,  // 保持当前名称
    img: currentPetImages[index] || stage.img,   // 保持当前图片
    minPoints: stage.minPoints,                  // 恢复默认积分区间
    maxPoints: stage.maxPoints
  }));
  
  // 3. 恢复默认成绩换算比例
  this.scoreToPointsRatio = 10;
  
  // 4. 存盘
  this.saveAll();
  // 5. 重新画界面
  this.renderPetLevelSettings();
  this.renderScoreRatioSettings();
  alert('已恢复个人等级积分默认设置！');
}

resetGroupToDefault(){
  if(!confirm('确定恢复小组各等级的分值设置为默认值吗？当前小组的图片和名称将保持不变。')) return;
  
  // 保存当前小组的图片和名称
  const currentGroupImages = this.groupStages.map(stage => stage.img);
  const currentGroupNames = this.groupStages.map(stage => stage.name);
  
  // 1. 仅恢复默认的积分区间
  const defaultGroupStages = [
    {name:'青铜',img:'images/group/1.png', minPoints:0,  maxPoints:40},
    {name:'白银',img:'images/group/2.png', minPoints:40, maxPoints:100},
    {name:'黄金',img:'images/group/3.png', minPoints:100,maxPoints:200},
    {name:'铂金',img:'images/group/4.png', minPoints:200,maxPoints:400},
    {name:'钻石',img:'images/group/5.png', minPoints:400,maxPoints:800},
    {name:'王者',img:'images/group/6.png', minPoints:800,maxPoints:Infinity}
  ];
  
  // 2. 恢复默认积分区间，但保持当前小组的图片和名称
  this.groupStages = defaultGroupStages.map((stage, index) => ({
    name: currentGroupNames[index] || stage.name,  // 保持当前名称
    img: currentGroupImages[index] || stage.img,   // 保持当前图片
    minPoints: stage.minPoints,                    // 恢复默认积分区间
    maxPoints: stage.maxPoints
  }));
  
  // 3. 存盘
  this.saveAll();
  // 4. 重新画界面
  this.renderGroupLevelSettings();
  alert('已恢复小组等级积分默认设置！');
}
    
  // 加载班级列表
  loadClassesFromLocalStorage() {
    const classesData = this.storageGet('classPointsClasses');
    if (classesData) {
      try {
        this.classes = JSON.parse(classesData);
        // 如果没有当前班级ID，设置第一个班级为当前班级
        if (this.classes.length > 0 && !this.currentClassId) {
          this.currentClassId = this.classes[0].id;
          this.currentClassName = this.classes[0].name;
        }
      } catch (e) {
        console.error('加载班级列表失败:', e);
        this.classes = [];
      }
    } else {
      // 如果没有班级数据，创建一个默认班级
      this.createDefaultClass();
    }
  }
  
  // 创建默认班级
  createDefaultClass() {
    const defaultClass = {
      id: this.generateClassId(),
      name: '我的班级',
      grade: '一年级',
      teacher: '老师',
      createTime: new Date().toISOString(),
      studentCount: 0
    };
    this.classes = [defaultClass];
    this.currentClassId = defaultClass.id;
    this.currentClassName = defaultClass.name;
    this.saveClassesToLocalStorage();
  }
  
  // 生成班级ID
  generateClassId() {
    return 'class_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  // 保存班级列表到本地存储
  saveClassesToLocalStorage() {
    this.storageSet('classPointsClasses', JSON.stringify(this.classes));
  }
  
  // ===== 新增方法：计算时间段起止日 =====
getPeriodRange(period) {
  const now = new Date();
  const formatDate = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  switch (period) {
    case 'today': {
      const d = formatDate(now);
      return { start: d, end: d };
    }
    case 'yesterday': {
      const d = formatDate(new Date(now));
      d.setDate(now.getDate() - 1);
      return { start: d, end: d };
    }
    case 'thisWeek': {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const start = formatDate(new Date(now));
      start.setDate(now.getDate() - diff);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    case 'lastWeek': {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const endOfLastWeek = formatDate(new Date(now));
      endOfLastWeek.setDate(now.getDate() - diff - 1);
      const startOfLastWeek = new Date(endOfLastWeek);
      startOfLastWeek.setDate(endOfLastWeek.getDate() - 6);
      return { start: startOfLastWeek, end: endOfLastWeek };
    }
    case 'thisMonth': {
      const start = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const end = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      return { start, end };
    }
    case 'lastMonth': {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const start = formatDate(lastMonth);
      const end = formatDate(new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0));
      return { start, end };
    }
    case 'thisYear': {
      const start = formatDate(new Date(now.getFullYear(), 0, 1));
      const end = formatDate(new Date(now.getFullYear(), 11, 31));
      return { start, end };
    }
    default:
      return { start: null, end: null };
  }
}
  
  // 在 ClassPointsSystem 类中添加
setupTimeFilterListeners() {
  // 所有带 data-period 的按钮
  document.querySelectorAll('.time-filter-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (this.isLocked) return;

      // 移除其他按钮的 active 状态
      document.querySelectorAll('.time-filter-btn.active').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 更新当前时间段
      this.currentRankingPeriod = btn.dataset.period;

      // 如果不是自定义，立即刷新排行榜
      if (btn.dataset.period !== 'custom') {
        this.renderRankings();
      }
    });
  });

  // “更多”按钮切换
  const toggleBtn = document.getElementById('toggleAdvancedPeriod');
  const advancedPanel = document.getElementById('advancedPeriodOptions');
  if (toggleBtn && advancedPanel) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = advancedPanel.style.display === 'none';
      advancedPanel.style.display = isHidden ? 'block' : 'none';
      toggleBtn.textContent = isHidden ? '↑ 收起' : '更多';
    });
  }

  // 自定义日期应用按钮
  const applyBtn = document.getElementById('applyCustomPeriod');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      if (this.isLocked) return;
      const startStr = document.getElementById('customRankStart')?.value;
      const endStr = document.getElementById('customRankEnd')?.value;

      if (!startStr || !endStr) {
        alert('请选择完整的起止日期！');
        return;
      }

      const start = new Date(startStr);
      const end = new Date(endStr);

      if (start > end) {
        alert('开始日期不能晚于结束日期！');
        return;
      }

      this.currentRankingPeriod = 'custom';
      this.customRankStart = start;
      this.customRankEnd = end;

      // 清除其他按钮的 active 状态（因为“自定义”没有专属按钮）
      document.querySelectorAll('.time-filter-btn.active').forEach(b => b.classList.remove('active'));

      this.renderRankings();
    });
  }

  // 小组积分开关（如果你有）
  const checkbox = document.getElementById('includeMemberPointsCheckbox');
  if (checkbox) {
    checkbox.addEventListener('change', (e) => {
      this.includeMemberPointsInGroupRank = e.target.checked;
      console.log('[DEBUG] includeMember changed:', e.target.checked, 'groups:', this.groups.map(g => ({name: g.name, members: g.members})));
      this.renderRankings();
    });
  }
}
  
  // 判断历史记录是否在日期范围内
isHistoryInDateRange(item, start, end) {
  if (!start || !end) return true;
  const dateStr = item.date.split(' ')[0]; // "2025-11-18 10:00" → "2025-11-18"
  const itemDate = new Date(dateStr);
  return itemDate >= start && itemDate <= end;
}

// 计算某对象在时间段内的积分总和
calculatePointsInPeriod(history, start, end) {
  if (!start || !end) {
    return history.reduce((sum, h) => sum + h.points, 0);
  }
  return history
    .filter(h => this.isHistoryInDateRange(h, start, end))
    .reduce((sum, h) => sum + h.points, 0);
}
  
  // 把用户选的图片存成本地文件（浏览器自动下载到 images 文件夹）
// 把用户选的文件直接变成 DataURL，存盘即可
saveImageFile(file, path) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      // e.target.result 就是 DataURL，直接当图片地址用
      resolve(e.target.result);
    };
    reader.readAsDataURL(file);
  });
}
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  updateExportProgress(message, percent = 0) {
    let overlay = document.getElementById('export-progress-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'export-progress-overlay';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = 'rgba(0, 0, 0, 0.45)';
      overlay.style.zIndex = '10001';

      const box = document.createElement('div');
      box.style.width = '320px';
      box.style.background = '#ffffff';
      box.style.borderRadius = '12px';
      box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
      box.style.padding = '18px 20px';
      box.innerHTML = `
        <div id="export-progress-title" style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 10px;">正在导出...</div>
        <div style="width: 100%; height: 10px; background: #e5e7eb; border-radius: 999px; overflow: hidden;">
          <div id="export-progress-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #10b981, #34d399); transition: width 0.2s ease;"></div>
        </div>
        <div id="export-progress-text" style="margin-top: 8px; font-size: 12px; color: #6b7280;">准备中...</div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }

    overlay.style.display = 'flex';
    const titleEl = document.getElementById('export-progress-title');
    const textEl = document.getElementById('export-progress-text');
    const barEl = document.getElementById('export-progress-bar');
    if (titleEl) titleEl.textContent = '导出进度';
    if (textEl) textEl.textContent = message || '处理中...';
    if (barEl) barEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }

  hideExportProgress(delay = 3000) {
    const overlay = document.getElementById('export-progress-overlay');
    if (!overlay) return;
    setTimeout(() => {
      overlay.style.display = 'none';
    }, delay);
  }

  sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') return 'export';
    const cleaned = filename
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'export';
  }

  async exportFile(filename, data, mime = 'application/octet-stream', options = {}) {
    const safeFilename = this.sanitizeFilename(filename);
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const { preferBackend = false } = options || {};
    const api = window.pywebview && window.pywebview.api;
    const notifySaved = (result, fallbackName) => {
      if (!result || typeof result !== 'object') return;
      if (!result.saved) return;
      const path = result.path || fallbackName;
      if (typeof this.showNotification === 'function') {
        this.showNotification(`已保存到: ${path}`, 'success');
      } else {
        alert(`已保存到: ${path}`);
      }
    };
    const saveViaBackend = async () => {
      try {
        let payload = { filename: safeFilename };
        if (typeof data === 'string') {
          payload.content = data;
          payload.encoding = 'utf-8';
        } else {
          const dataUrl = await this.blobToDataUrl(blob);
          const base64 = dataUrl.split(',')[1] || '';
          payload.data_base64 = base64;
        }
        const res = await fetch('/api/desktop/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) return false;
        const result = await res.json();
        if (result && result.saved) {
          notifySaved(result, safeFilename);
          return true;
        }
      } catch (error) {
        console.error('Backend export failed:', error);
      }
      return false;
    };
    let backendTried = false;
    const tryBackend = async () => {
      backendTried = true;
      return await saveViaBackend();
    };
    this.updateExportProgress('准备导出文件...', 10);
    if (preferBackend) {
      this.updateExportProgress('Saving...', 35);
      if (await tryBackend()) {
        this.updateExportProgress('Export complete', 100);
        this.hideExportProgress();
        return;
      }
    }
    if (api) {
      this.updateExportProgress('打开保存对话框...', 35);
      if (typeof data === 'string' && typeof api.save_text_file === 'function') {
        try {
          const saved = await api.save_text_file(safeFilename, data);
          if (saved === true) return;
          if (saved && typeof saved === 'object') {
            if (saved.saved) {
              notifySaved(saved, safeFilename);
              this.updateExportProgress('导出完成', 100);
              this.hideExportProgress();
              return;
            }
          }
        } catch (error) {
          console.error('Desktop text save failed:', error);
        }
      }
      if (typeof api.save_file === 'function') {
        try {
          const dataUrl = await this.blobToDataUrl(blob);
          const saved = await api.save_file(safeFilename, dataUrl);
          if (saved === true) return;
          if (saved && typeof saved === 'object') {
            if (saved.saved) {
              notifySaved(saved, safeFilename);
              this.updateExportProgress('导出完成', 100);
              this.hideExportProgress();
              return;
            }
          }
        } catch (error) {
          console.error('Desktop save failed:', error);
        }
      }
    }
    this.updateExportProgress('正在写入本地文件...', 70);
    if (!backendTried && await tryBackend()) {
      this.updateExportProgress('导出完成', 100);
      this.hideExportProgress();
      return;
    }
    this.updateExportProgress('正在生成下载文件...', 85);
    this.downloadBlob(blob, safeFilename);
    this.updateExportProgress('导出完成', 100);
    this.hideExportProgress();
    if (api && typeof this.showNotification === 'function') {
      this.showNotification('导出未弹窗，请检查导出目录或日志', 'warning');
    }
  }

  
  // 修改原有的保存方法，按班级ID存储数据
saveAll(){
  if (!this.currentClassId) return;
  
  const data={
    students:this.students,
    groups: this.groups,
    history:this.history,
    rules: this.currentConfigScope === 'class' ? this.rules : [],
    shopItems: this.currentConfigScope === 'class' ? this.shopItems : [],
    groupRules: this.currentConfigScope === 'class' ? this.groupRules : [],
    randomNameRecords: this.randomNameRecords || [],
    lockPassword: this.lockPassword,
    isLocked: this.isLocked,
    className: this.currentClassName,
    scoreToPointsRatio: this.scoreToPointsRatio
    // 注意：宠物阶段数据已独立存储，不再保存到主存储中
  };
  this.storageSet(`classPointsData_${this.currentClassId}`, JSON.stringify(data));
  
  // 保存小组等级数据到单独的存储（只保存积分范围，不保存名称）
  if (this.groupStages && Array.isArray(this.groupStages)) {
    // 创建只包含积分范围的数据对象，不包含自定义名称
    const groupStagesData = this.groupStages.map(stage => ({
      minPoints: stage.minPoints,
      maxPoints: stage.maxPoints,
      img: stage.img,
      emoji: stage.emoji
      // 不包含name字段，因为名称已固定
    }));
    this.storageSet(`groupStages_${this.currentClassId}`, JSON.stringify(groupStagesData));
  }
  
  // 保存学生宠物选择数据（关键修复：确保批量应用宠物数据持久化）
  if (this.studentPets && Object.keys(this.studentPets).length > 0) {
    this.storageSet(`studentPets_${this.currentClassId}`, JSON.stringify(this.studentPets));
  }
  
  this.updateClassStudentCount();
  this.flushRemoteQueue();
}
  
  // 更新班级学生数量
  updateClassStudentCount() {
    const classIndex = this.classes.findIndex(c => c.id === this.currentClassId);
    if (classIndex !== -1) {
      this.classes[classIndex].studentCount = this.students.length;
      this.saveClassesToLocalStorage();
    }
  }
  
  // 加载所有宠物相关配置
loadAllPetConfig(preventPetStagesByTypeOverride = true) {
  try {
    if (!this.currentClassId) return false;
    
    // 加载按宠物类型存储的等级数据（关键修复）
    // 总是优先从localStorage加载petStagesByType数据，确保数据一致性
    const savedPetStagesByType = this.storageGet(`petStagesByType_${this.currentClassId}`);
    if (savedPetStagesByType && (!this.petStagesByType || Object.keys(this.petStagesByType).length === 0)) {
      try {
        const parsedPetStagesByType = JSON.parse(savedPetStagesByType);
        if (parsedPetStagesByType && typeof parsedPetStagesByType === 'object') {
          // 如果从按类型存储加载成功，使用按类型存储的数据
          this.petStagesByType = {};
          for (const petType in parsedPetStagesByType) {
            this.petStagesByType[petType] = this.migrateStages(parsedPetStagesByType[petType], 'pet');
          }
          // 使用第一个宠物类型的等级作为默认显示（兼容性）
          const firstPetType = Object.keys(this.petStagesByType)[0];
          this.petStages = this.petStagesByType[firstPetType] || this.migrateStages(this.getDefaultPetStages(), 'pet');
        }
      } catch (error) {
        console.error('加载按类型存储的个人等级配置失败:', error);
      }
    }
    
    // 加载宠物类型配置
    const savedPetTypes = this.storageGet(`petTypes_${this.currentClassId}`);
    if (savedPetTypes) {
      try {
        const parsedTypes = JSON.parse(savedPetTypes);
        if (Array.isArray(parsedTypes)) {
          if (!this.petTypes || this.petTypes.length === 0) {
            this.petTypes = parsedTypes;
          } else {
            // 合并保存的宠物类型数据，保留默认类型的结构
            parsedTypes.forEach(savedType => {
              const existingType = this.petTypes.find(t => t.id === savedType.id);
              if (existingType) {
                Object.assign(existingType, savedType);
              }
            });
          }
        }
      } catch (error) {
        console.error('加载宠物类型配置失败:', error);
        this.showNotification('宠物类型配置加载失败', 'warning');
      }
    }
    
    // 加载个人宠物阶段配置（仅在需要时覆盖）
    // 只有当明确允许覆盖且petStagesByType为空时才加载旧的个人宠物阶段配置
    if (preventPetStagesByTypeOverride === false && (!this.petStagesByType || Object.keys(this.petStagesByType).length === 0)) {
      const savedPetStages = this.storageGet(`petStages_${this.currentClassId}`);
      if (savedPetStages) {
        try {
          const parsedStages = JSON.parse(savedPetStages);
          if (Array.isArray(parsedStages)) {
            this.petStages = this.migrateStages(parsedStages, 'pet');
          }
        } catch (error) {
          console.error('加载个人宠物阶段配置失败:', error);
          this.showNotification('个人宠物阶段配置加载失败', 'warning');
        }
      }
    }
    
    // 加载小组阶段配置
    const savedGroupStages = this.storageGet(`groupStages_${this.currentClassId}`);
    if (savedGroupStages) {
      try {
        const parsedGroupStages = JSON.parse(savedGroupStages);
        if (Array.isArray(parsedGroupStages)) {
          // 获取默认小组等级配置
          const defaultGroupStages = this.getDefaultGroupStages();
          // 只加载积分范围，不加载名称（名称已固定）
          this.groupStages = defaultGroupStages.map((defaultStage, index) => {
            const savedStage = parsedGroupStages[index];
            return {
              name: defaultStage.name, // 保持默认名称不变
              minPoints: savedStage ? savedStage.minPoints : defaultStage.minPoints,
              maxPoints: savedStage ? savedStage.maxPoints : defaultStage.maxPoints,
              img: savedStage ? savedStage.img : defaultStage.img,
              emoji: savedStage ? savedStage.emoji : defaultStage.emoji
            };
          });
        }
      } catch (error) {
        console.error('加载小组阶段配置失败:', error);
        this.showNotification('小组阶段配置加载失败', 'warning');
        this.groupStages = this.migrateStages(this.getDefaultGroupStages(), 'group');
      }
    } else {
      // 如果没有保存的小组阶段配置，使用默认配置
      this.groupStages = this.migrateStages(this.getDefaultGroupStages(), 'group');
    }
    
    // 宠物图片已改为从服务器文件夹加载，由 initializePetImages() 处理
    
    // 加载小组宠物图片配置（新增）
    // 小组宠物图片已改为从服务器文件夹加载（与学生宠物共用同一套图片）

    // groupLevels数据结构已废弃，所有功能都基于groupStages
    // 注意：小组等级配置已在loadFromLocalStorage()中加载，此处不再重复加载
    
    // 加载学生宠物选择数据
    const savedStudentPets = this.storageGet(`studentPets_${this.currentClassId}`);
    if (savedStudentPets) {
      try {
        const parsedStudentPets = JSON.parse(savedStudentPets);
        if (typeof parsedStudentPets === 'object') {
          this.studentPets = parsedStudentPets;
        }
      } catch (error) {
        console.error('加载学生宠物选择失败:', error);
        this.showNotification('学生宠物选择数据加载失败', 'warning');
      }
    }
    
    // 加载小组宠物选择数据（新增）
    const savedGroupPets = this.storageGet(`groupPets_${this.currentClassId}`);
    if (savedGroupPets) {
      try {
        const parsedGroupPets = JSON.parse(savedGroupPets);
        if (typeof parsedGroupPets === 'object') {
          this.groupPets = parsedGroupPets;
        }
      } catch (error) {
        console.error('加载小组宠物选择失败:', error);
        this.showNotification('小组宠物选择数据加载失败', 'warning');
      }
    }
    
    // 加载小组头像数据（新增）
    const savedGroupAvatars = this.storageGet(`groupAvatars_${this.currentClassId}`);
    if (savedGroupAvatars) {
      try {
        const parsedGroupAvatars = JSON.parse(savedGroupAvatars);
        if (typeof parsedGroupAvatars === 'object') {
          this.groupAvatars = parsedGroupAvatars;
        }
      } catch (error) {
        console.error('加载小组头像数据失败:', error);
        this.showNotification('小组头像数据加载失败', 'warning');
      }
    }
    
    return true;
  } catch (error) {
    console.error('加载宠物配置失败:', error);
    this.showNotification('宠物配置加载失败', 'error');
    return false;
  }
}

// 从旧存储方式加载个人等级数据
loadPetStagesFromLegacyStorage() {
  const savedPetStages = this.storageGet(`petStages_${this.currentClassId}`);
  if (savedPetStages) {
    try {
      const parsedPetStages = JSON.parse(savedPetStages);
      if (Array.isArray(parsedPetStages)) {
        this.petStages = this.migrateStages(parsedPetStages, 'pet');
      } else {
        this.petStages = this.migrateStages(this.getDefaultPetStages(), 'pet');
      }
    } catch (error) {
      console.error('加载个人等级配置失败:', error);
      this.petStages = this.migrateStages(this.getDefaultPetStages(), 'pet');
    }
  } else {
    this.petStages = this.migrateStages(this.getDefaultPetStages(), 'pet');
  }
  
  // 初始化按类型存储的数据结构
  if (!this.petStagesByType) {
    this.petStagesByType = {};
  }
  
  // 为每个宠物类型复制一份等级数据（不覆盖已从服务器加载的数据）
  this.petTypes.forEach(type => {
    if (!this.petStagesByType[type.id]) {
      this.petStagesByType[type.id] = JSON.parse(JSON.stringify(this.petStages));
    }
  });
}

// 修改原有的加载方法，按班级ID加载数据
loadFromLocalStorage(){
  if (!this.currentClassId) return;
  
  const data = this.storageGet(`classPointsData_${this.currentClassId}`);
  if(data){
    try{
      const parsed = JSON.parse(data);
      this.students = parsed.students || [];
      this.groups = parsed.groups || [];
      this.history = parsed.history || [];
      // 加载成绩比例设置
      this.scoreToPointsRatio = parsed.scoreToPointsRatio || 10;
      
      // 优先从按宠物类型独立存储的petStagesByType加载个人等级数据
      const savedPetStagesByType = this.storageGet(`petStagesByType_${this.currentClassId}`);
      if (savedPetStagesByType) {
        try {
          const parsedPetStagesByType = JSON.parse(savedPetStagesByType);
          if (parsedPetStagesByType && typeof parsedPetStagesByType === 'object') {
            // 如果从按类型存储加载成功，使用按类型存储的数据
            this.petStagesByType = {};
            for (const petType in parsedPetStagesByType) {
              this.petStagesByType[petType] = this.migrateStages(parsedPetStagesByType[petType], 'pet');
            }
            // 使用第一个宠物类型的等级作为默认显示（兼容性）
            const firstPetType = Object.keys(this.petStagesByType)[0];
            this.petStages = this.petStagesByType[firstPetType] || this.migrateStages(this.getDefaultPetStages(), 'pet');
          } else {
            // 如果按类型存储数据格式错误，回退到原来的存储方式
            this.loadPetStagesFromLegacyStorage();
          }
        } catch (error) {
          console.error('加载按类型存储的个人等级配置失败:', error);
          // 如果按类型存储加载失败，回退到原来的存储方式
          this.loadPetStagesFromLegacyStorage();
        }
      } else {
        // 如果没有按类型存储，使用原来的存储方式
        this.loadPetStagesFromLegacyStorage();
      }
      
      // 优先从单独的groupStages存储加载小组等级数据
      const savedGroupStages = this.storageGet(`groupStages_${this.currentClassId}`);
      if (savedGroupStages) {
        try {
          const parsedGroupStages = JSON.parse(savedGroupStages);
          if (Array.isArray(parsedGroupStages)) {
            // 如果从单独存储加载成功，只加载积分范围，不加载名称（名称已固定）
            const defaultGroupStages = this.getDefaultGroupStages();
            this.groupStages = defaultGroupStages.map((defaultStage, index) => {
              const savedStage = parsedGroupStages[index];
              return {
                name: defaultStage.name, // 保持默认名称不变
                minPoints: savedStage ? savedStage.minPoints : defaultStage.minPoints,
                maxPoints: savedStage ? savedStage.maxPoints : defaultStage.maxPoints,
                img: savedStage ? savedStage.img : defaultStage.img,
                emoji: savedStage ? savedStage.emoji : defaultStage.emoji
              };
            });
          } else {
            // 如果单独存储数据格式错误，尝试从主存储加载
            this.groupStages = parsed.groupStages && Array.isArray(parsed.groupStages) 
              ? this.migrateStages(parsed.groupStages, 'group')
              : this.migrateStages(this.getDefaultGroupStages(), 'group');
          }
        } catch (error) {
          console.error('加载小组等级配置失败:', error);
          // 如果单独存储加载失败，尝试从主存储加载
          this.groupStages = parsed.groupStages && Array.isArray(parsed.groupStages) 
            ? this.migrateStages(parsed.groupStages, 'group')
            : this.migrateStages(this.getDefaultGroupStages(), 'group');
        }
      } else {
        // 如果没有单独存储，尝试从主存储加载
        if (parsed.groupStages && Array.isArray(parsed.groupStages)) {
          // 从主存储加载时，也只加载积分范围，不加载名称（名称已固定）
          const defaultGroupStages = this.getDefaultGroupStages();
          this.groupStages = defaultGroupStages.map((defaultStage, index) => {
            const savedStage = parsed.groupStages[index];
            return {
              name: defaultStage.name, // 保持默认名称不变
              minPoints: savedStage ? savedStage.minPoints : defaultStage.minPoints,
              maxPoints: savedStage ? savedStage.maxPoints : defaultStage.maxPoints,
              img: savedStage ? savedStage.img : defaultStage.img,
              emoji: savedStage ? savedStage.emoji : defaultStage.emoji
            };
          });
        } else {
          this.groupStages = this.migrateStages(this.getDefaultGroupStages(), 'group');
        }
      }
      
      // 使用全局配置，如果班级有自定义配置则使用班级的
      this.rules = parsed.rules && parsed.rules.length > 0 ? parsed.rules : this.globalRules;
      this.shopItems = parsed.shopItems && parsed.shopItems.length > 0 ? parsed.shopItems : this.globalShopItems;
      this.groupRules = parsed.groupRules && parsed.groupRules.length > 0 ? parsed.groupRules : this.globalGroupRules;
      
      this.randomNameRecords = parsed.randomNameRecords || [];
      this.lockPassword = parsed.lockPassword || '';
      this.isLocked = parsed.isLocked || false;
      this.currentClassName = parsed.className || this.getCurrentClassName();
      
      // 应用锁定状态
    if(this.isLocked){
        this.disableEditing();
      }
    }catch(e){
      console.error('加载班级数据失败:', e);
      this.initializeClassData();
    }
  } else {
    this.initializeClassData();
  }
  
  // 加载学生宠物分配数据（无论是否有班级数据）
  const savedStudentPets = this.storageGet(`studentPets_${this.currentClassId}`);
  if (savedStudentPets) {
    try {
      const parsedStudentPets = JSON.parse(savedStudentPets);
      if (typeof parsedStudentPets === 'object') {
        this.studentPets = parsedStudentPets;
      }
    } catch (error) {
      console.error('加载学生宠物选择失败:', error);
      this.studentPets = {};
    }
  }
  
  // 无论是否找到班级数据，都加载宠物配置（但避免覆盖已加载的petStagesByType数据）
  // 使用true参数，防止覆盖已加载的按宠物类型存储的等级数据
  this.loadAllPetConfig(true);
  
  const title = this.storageGet(`mainTitle_${this.currentClassId}`) || 
                this.storageGet('mainTitle') || 
                `${this.currentClassName} - 班级积分宠物成长系统`;
  document.getElementById('mainTitle').textContent = title;
}
  
  // 🆕 新增：迁移等级数据的方法
// 迁移等级数据的方法
migrateStages(stages, type) {
  const emojiMaps = {
    pet: {
      '蛋': '🥚', '孵化中': '🐣', '雏鸟': '🐤', '幼鸟': '🐦',
      '成长鸟': '🕊️', '雄鹰': '🦅'
    },
    group: {
      '青铜': '🥉', '白银': '🥈', '黄金': '🥇',
      '铂金': '🔷', '钻石': '💎', '王者': '👑'
    }
  };
  
  const emojiMap = emojiMaps[type];
  
  return stages.map(stage => {
    // 如果stage已经有emoji字段，保持不变
    if (stage.emoji) {
      return stage;
    }
    
    // 否则添加emoji字段
    // 对于小组等级，保持名称不变，只添加emoji
    if (type === 'group') {
      return {
        ...stage,
        emoji: emojiMap[stage.name] || '❓'
      };
    }
    
    // 对于个人等级，保持原有逻辑
    return {
      ...stage,
      emoji: emojiMap[stage.name] || '❓'
    };
  });
}
  
// 更新默认宠物等级方法
getDefaultPetStages() {
  return [
    {name:'蛋', emoji:'🥚', img:'images/pet/1.png', minPoints:0, maxPoints:20},
    {name:'孵化中', emoji:'🐣', img:'images/pet/2.png', minPoints:20, maxPoints:50},
    {name:'雏鸟', emoji:'🐤', img:'images/pet/3.png', minPoints:50, maxPoints:100},
    {name:'幼鸟', emoji:'🐦', img:'images/pet/4.png', minPoints:100, maxPoints:200},
    {name:'成长鸟', emoji:'🕊️', img:'images/pet/5.png', minPoints:200, maxPoints:400},
    {name:'雄鹰', emoji:'🦅', img:'images/pet/6.png', minPoints:400, maxPoints:Infinity}
  ];
}

// 更新默认小组等级方法
getDefaultGroupStages() {
  return [
    {name:'青铜', emoji:'🥉', img:'images/group/1.png', minPoints:0, maxPoints:40},
    {name:'白银', emoji:'🥈', img:'images/group/2.png', minPoints:40, maxPoints:100},
    {name:'黄金', emoji:'🥇', img:'images/group/3.png', minPoints:100, maxPoints:200},
    {name:'铂金', emoji:'🔷', img:'images/group/4.png', minPoints:200, maxPoints:400},
    {name:'钻石', emoji:'💎', img:'images/group/5.png', minPoints:400, maxPoints:800},
    {name:'王者', emoji:'👑', img:'images/group/6.png', minPoints:800, maxPoints:Infinity}
  ];
}

// groupLevels数据结构已废弃，所有功能都基于groupStages
  
  // 获取默认规则（避免在构造函数中重复定义）
  getDefaultRules() {
    return [
      {name:'作业优秀', points:5},
      {name:'课堂表现好', points:3},
      {name:'迟到', points:-2},
      {name:'未交作业', points:-5}
    ];
  }
  
  getDefaultShopItems() {
    return [
      {name:'小奖品', cost:10, stock:null},
      {name:'免作业券', cost:20, stock:5},
      {name:'座位选择权', cost:15, stock:null}
    ];
  }
  
  getDefaultGroupRules() {
    return [
      {name:'小组合作优秀', points:10},
      {name:'小组项目完成', points:15},
      {name:'小组纪律问题', points:-5}
    ];
  }
  
  // 初始化班级数据
  initializeClassData() {
    this.students = [];
    this.groups = [];
    this.history = [];
    this.undoStack = [];
    this.randomNameRecords = [];
    // 初始化学生宠物分配数据
    this.studentPets = {};
    // 使用全局配置
    this.rules = this.globalRules;
    this.shopItems = this.globalShopItems;
    this.groupRules = this.globalGroupRules;
    this.lockPassword = '';
    this.isLocked = false;
    
    // 初始化宠物阶段配置
    this.petStages = this.migrateStages(this.getDefaultPetStages(), 'pet');
    this.groupStages = this.migrateStages(this.getDefaultGroupStages(), 'group');
  }
  
  // 获取当前班级名称
  getCurrentClassName() {
    const currentClass = this.classes.find(c => c.id === this.currentClassId);
    return currentClass ? currentClass.name : '未知班级';
  }
  
  // 渲染班级选择器
  renderClassSelector() {
    const selector = document.getElementById('classSelector');
    if (this.classes.length <= 1) {
      selector.style.display = 'none';
    } else {
      selector.style.display = 'inline-block';
      selector.innerHTML = this.classes.map(cls => 
        `<option value="${cls.id}" ${cls.id === this.currentClassId ? 'selected' : ''}>${cls.name}</option>`
      ).join('');
    }
    
    // 更新当前班级指示器
    this.updateCurrentClassIndicator();
  }
  
// 更新当前班级指示器 - 简洁水平布局
updateCurrentClassIndicator() {
  const title = document.getElementById('mainTitle');
  const existingIndicator = document.querySelector('.current-class-indicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  if (this.classes.length > 0) {
    const currentClass = this.classes.find(c => c.id === this.currentClassId);
    if (currentClass) {
      const indicator = document.createElement('span');
      indicator.className = 'current-class-indicator';
      
      indicator.innerHTML = `
        <span class="class-badge">
           ${currentClass.name} 
          <span class="badge-separator">|</span>
           ${this.students.length}人
          <span class="badge-separator">|</span>
           ${this.groups.length}组
        </span>
      `;
      
      title.parentNode.insertBefore(indicator, title.nextSibling);
    }
  }
}
  
  // 切换班级
switchClass(classId) {
  // 保存当前班级数据
  this.saveAll();
  
  // 切换到新班级
  this.currentClassId = classId;
  const newClass = this.classes.find(c => c.id === classId);
  this.currentClassName = newClass ? newClass.name : '未知班级';
  
  // 加载新班级数据
  this.loadFromLocalStorage();
  
  // 加载宠物配置
  this.loadAllPetConfig();
  
  // 加载新班级的显示模式
  const savedMode = this.storageGet(`displayMode_${this.currentClassId}`);
  if (savedMode) {
    this.displayMode = savedMode;
  }
  
  // 更新按钮文字
  if (this.toggleModeBtn) {
    if (this.displayMode === 'emoji') {
      this.toggleModeBtn.textContent = '🖼️ 自定义宠物';
    } else {
      this.toggleModeBtn.textContent = '🎭 恢复默认宠物';
    }
  }
  
  // 重新渲染所有组件
  this.renderStudents();
  this.renderGroups();
  this.renderRankings();
  this.renderHistory();
  this.renderClassSelector();
  this.updateCurrentClassIndicator();
  
  // 更新锁定状态
  this.updateLockButton();
  if (this.isLocked) {
    this.disableEditing();
  } else {
    this.enableEditing();
  }
  
  console.log(`已切换到班级: ${this.currentClassName}, 显示模式: ${this.displayMode}`);
  // 把当前班级 ID 写入全局缓存，供其他页面实时读取
this.storageSet('currentClassId', classId);
}
  
  // 打开班级管理模态框
  openClassManager() {
    this.renderClassList();
    document.getElementById('classManagerModal').style.display = 'flex';
  }
  
  // 渲染班级列表
  renderClassList() {
    const classList = document.getElementById('classList');
    if (this.classes.length === 0) {
      classList.innerHTML = '<div style="text-align: center; padding: 20px; color: #718096;">暂无班级，请创建新班级</div>';
      return;
    }
    
    classList.innerHTML = this.classes.map(cls => `
      <div class="class-item ${cls.id === this.currentClassId ? 'active' : ''}">
        <div class="class-info">
          <div class="class-name">${cls.name}</div>
          <div class="class-details">${cls.grade} • ${cls.teacher} • ${cls.studentCount}名学生</div>
        </div>
        <div class="class-actions">
          ${cls.id !== this.currentClassId ? 
            `<button class="class-switch-btn" data-id="${cls.id}">切换</button>` : 
            '<button class="class-switch-btn" disabled>当前</button>'
          }
          <button class="class-edit-btn" data-id="${cls.id}">编辑</button>
          ${this.classes.length > 1 ? `<button class="class-delete-btn" data-id="${cls.id}">删除</button>` : ''}
        </div>
      </div>
    `).join('');
    
    // 添加事件监听
    this.attachClassListEvents();
  }
  
  // 附加班级列表事件
  attachClassListEvents() {
    // 切换班级
    document.querySelectorAll('.class-switch-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const classId = e.target.getAttribute('data-id');
        this.switchClass(classId);
        this.closeClassManager();
      });
    });
    
// 编辑班级
document.querySelectorAll('.class-edit-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const classId = e.target.getAttribute('data-id');
    this.editClass(classId);  // 确保调用的是 editClass 方法
  });
});
    
    // 删除班级
    document.querySelectorAll('.class-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const classId = e.target.getAttribute('data-id');
        this.deleteClass(classId);
      });
    });
  }
  
  // 创建新班级
  createNewClass() {
    const name = document.getElementById('newClassName').value.trim();
    const grade = document.getElementById('newClassGrade').value.trim();
    const teacher = document.getElementById('newClassTeacher').value.trim();
    
    if (!name) {
      alert('请输入班级名称！');
      return;
    }
    
    // 检查班级名称是否重复
    if (this.classes.find(c => c.name === name)) {
      alert('班级名称已存在！');
      return;
    }
    
    const newClass = {
      id: this.generateClassId(),
      name: name,
      grade: grade || '未设置',
      teacher: teacher || '未设置',
      createTime: new Date().toISOString(),
      studentCount: 0
    };
    
    this.classes.push(newClass);
    this.saveClassesToLocalStorage();
    
    // 清空输入框
    document.getElementById('newClassName').value = '';
    document.getElementById('newClassGrade').value = '';
    document.getElementById('newClassTeacher').value = '';
    
    // 切换到新班级
    this.switchClass(newClass.id);
    
    this.renderClassList();
    this.renderClassSelector();
    
    alert(`班级 "${name}" 创建成功！`);
  }
  
// 编辑班级
editClass(classId) {
  const cls = this.classes.find(c => c.id === classId);
  if (!cls) return;
  
  // 编辑班级名称
  const newName = prompt('请输入新的班级名称：', cls.name);
  if (newName === null) return;
  
  if (!newName.trim()) {
    alert('班级名称不能为空！');
    return;
  }
  
  // 编辑年级
  const newGrade = prompt('请输入新的年级：', cls.grade);
  if (newGrade === null) return;
  
  // 编辑班主任
  const newTeacher = prompt('请输入新的班主任姓名：', cls.teacher);
  if (newTeacher === null) return;
  
  // 检查班级名称是否重复（排除自身）
  if (this.classes.find(c => c.id !== classId && c.name === newName.trim())) {
    alert('班级名称已存在！');
    return;
  }
  
  // 更新所有班级信息
  cls.name = newName.trim();
  cls.grade = newGrade.trim() || '未设置';
  cls.teacher = newTeacher.trim() || '未设置';
  this.saveClassesToLocalStorage();
  
  // 如果编辑的是当前班级，更新当前班级名称
  if (classId === this.currentClassId) {
    this.currentClassName = cls.name;
    this.saveAll(); // 更新存储的班级名称
  }
  
  this.renderClassList();
  this.renderClassSelector();
  
  alert('班级信息更新成功！');
}
  
  // 删除班级
  deleteClass(classId) {
    if (this.classes.length <= 1) {
      alert('至少需要保留一个班级！');
      return;
    }
    
    const cls = this.classes.find(c => c.id === classId);
    if (!cls) return;
    
    if (!confirm(`确定要删除班级 "${cls.name}" 吗？此操作将永久删除该班级的所有数据，且不可恢复！`)) {
      return;
    }
    
    // 如果要删除的是当前班级，先切换到其他班级
    if (classId === this.currentClassId) {
      const otherClass = this.classes.find(c => c.id !== classId);
      if (otherClass) {
        this.switchClass(otherClass.id);
      }
    }
    
    // 从列表中移除
    this.classes = this.classes.filter(c => c.id !== classId);
    this.saveClassesToLocalStorage();
    
    // 删除本地存储中的数据
    this.storageRemove(`classPointsData_${classId}`);
    this.storageRemove(`mainTitle_${classId}`);
    
    this.renderClassList();
    this.renderClassSelector();
    
    alert('班级删除成功！');
  }
  
  // 关闭班级管理模态框
  closeClassManager() {
    document.getElementById('classManagerModal').style.display = 'none';
  }

  setupEventListeners(){
    console.log('设置事件监听器...');
    
    // 积分历史折叠功能
    const historyToggleBtn = document.getElementById('historyToggleBtn');
    const historyList = document.getElementById('historyList');
    
    if (historyToggleBtn && historyList) {
      // 初始化折叠状态（从localStorage读取）
      const isCollapsed = this.storageGet('historyCollapsed') === 'true';
      if (isCollapsed) {
        historyList.classList.add('collapsed');
        historyToggleBtn.classList.add('collapsed');
        historyToggleBtn.querySelector('.toggle-text').textContent = '展开';
      }
      
      historyToggleBtn.addEventListener('click', () => {
        const isCurrentlyCollapsed = historyList.classList.contains('collapsed');
        
        if (isCurrentlyCollapsed) {
          // 展开
          historyList.classList.remove('collapsed');
          historyToggleBtn.classList.remove('collapsed');
          historyToggleBtn.querySelector('.toggle-text').textContent = '折叠';
          this.storageSet('historyCollapsed', 'false');
        } else {
          // 折叠
          historyList.classList.add('collapsed');
          historyToggleBtn.classList.add('collapsed');
          historyToggleBtn.querySelector('.toggle-text').textContent = '展开';
          this.storageSet('historyCollapsed', 'true');
        }
      });
    }
    
    // 添加全局事件委托处理积分历史按钮点击
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-btn')) {
        console.log('积分历史按钮被点击（事件委托）', e.target);
        e.stopPropagation();
        
        const card = e.target.closest('.student-card, .group-card');
        if (!card) return;
        
        let index;
        if (card.classList.contains('student-card')) {
          index = parseInt(e.target.dataset.index);
        } else if (card.classList.contains('group-card')) {
          index = parseInt(e.target.dataset.group);
        }
        
        if (isNaN(index)) return;
        
        if (this.isLocked) {
          console.log('系统已锁定，无法操作');
          return;
        }
        
        if (card.classList.contains('student-card')) {
          console.log('打开学生历史记录', index);
          this.openStudentHistory(index);
        } else if (card.classList.contains('group-card')) {
          console.log('打开小组历史记录', index);
          this.openGroupHistory(index);
        }
      }
    });
    
	// 成绩比例保存按钮
	document.getElementById('saveScoreRatioBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.saveScoreRatio();
	});
	
	// 总恢复按钮事件
document.addEventListener('click',e=>{
  if(e.target.id==='resetPetBtn')   this.resetPetToDefault();
  if(e.target.id==='resetGroupBtn') this.resetGroupToDefault();
});
	
	// 恢复默认按钮事件
document.getElementById('resetPetBtn')  && document.getElementById('resetPetBtn').addEventListener('click',()=>this.resetPetToDefault());
document.getElementById('resetGroupBtn')&& document.getElementById('resetGroupBtn').addEventListener('click',()=>this.resetGroupToDefault());
	
	// 等级设置保存按钮事件
	document.getElementById('savePetLevelsBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.savePetLevels();
	});
	document.getElementById('saveGroupLevelsBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.saveGroupLevels();
	});

	document.getElementById('saveScoreRatioBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.saveScoreRatio();
	});
    
    // 班级相关事件
    document.getElementById('classManagerBtn').addEventListener('click', () => {
      if(this.isLocked) return;
      this.openClassManager();
    });
    
    document.getElementById('classSelector').addEventListener('change', (e) => {
      if(this.isLocked) return;
      this.switchClass(e.target.value);
    });
    
    document.getElementById('createClassBtn').addEventListener('click', () => {
      if(this.isLocked) return;
      this.createNewClass();
    });
    
    document.getElementById('closeClassManagerBtn').addEventListener('click', () => {
      this.closeClassManager();
    });
	
    // 解锁相关
    document.getElementById('confirmUnlockBtn').addEventListener('click',()=>this.unlockSystem());
    document.getElementById('emergencyResetBtn').addEventListener('click',()=>this.emergencyReset());
	
	// 临时规则按钮事件
	document.getElementById('addTempRuleBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.applyTempRule();
	});

	document.getElementById('addTempGroupRuleBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.applyTempGroupRule();
	});

	document.getElementById('addTempBatchRuleBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.applyTempBatchRule();
	});

	document.getElementById('addTempBatchGroupRuleBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.applyTempBatchGroupRule();
	});

	// 清空积分按钮事件
	document.getElementById('clearStudentsPointsBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.clearSelectedStudentsPoints();
	});

	document.getElementById('clearGroupsPointsBtn').addEventListener('click', () => {
	  if(this.isLocked) return;
	  this.clearSelectedGroupsPoints();
	});

    // 紧急重置按钮事件监听
    document.getElementById('emergencyResetBtn').addEventListener('click',()=>{
      this.emergencyReset();
    });
    
    // 文件上传
    document.getElementById('fileInput').addEventListener('change',e=>{
      if(this.isLocked) return;
      const file=e.target.files[0];
      if(file) {
        this.readExcel(file);
        e.target.value = '';
      }
    });
    
    // 备份上传
    document.getElementById('backupInput').addEventListener('change',e=>{
      if(this.isLocked) return;
      const file=e.target.files[0];
      if(file) this.importBackupFile(file);
    });
    
    // 主按钮事件
    document.getElementById('settingsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openSettings();
    });
    document.getElementById('exportBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.exportBackup();
    });
    document.getElementById('statisticsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openStatistics();
    });
    document.getElementById('randomNameBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openRandomName();
    });
    document.getElementById('timerBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openTimer();
    });
    document.getElementById('clearBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.clearData();
    });
    document.getElementById('lockBtn')?.addEventListener('click',()=>this.toggleLock());
    // 远程锁屏按钮事件
    document.getElementById('remoteLockBtn')?.addEventListener('click',()=>this.showRemoteLockModal());
    document.getElementById('confirmRemoteLockBtn').addEventListener('click',()=>this.doRemoteLock());
    document.getElementById('cancelRemoteLockBtn').addEventListener('click',()=>{
      document.getElementById('remoteLockModal').style.display='none';
    });
    document.getElementById('confirmRemoteUnlockBtn').addEventListener('click',()=>this.doRemoteUnlock());
    this.initRemoteLockFeature();
    document.getElementById('batchBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openBatchModal();
    });
    document.getElementById('techSupportBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openTechSupportModal();
    });
    
    // 积分操作模态框
    document.getElementById('confirmPointsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.addPoints();
    });
    document.getElementById('cancelPointsBtn').addEventListener('click',()=>this.closePointsModal());
    
    // 商店模态框
    document.getElementById('closeShopBtn').addEventListener('click',()=>this.closeShopModal());
    
    // 小组积分模态框
    document.getElementById('confirmGroupPointsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.addGroupPoints();
    });
    document.getElementById('cancelGroupPointsBtn').addEventListener('click',()=>this.closeGroupPointsModal());
    
    // 系统配置相关
    document.getElementById('addRuleBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.addRule();
    });
    document.getElementById('addItemBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.addShopItem();
    });
    document.getElementById('addGroupRuleBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.addGroupRule();
    });
    document.getElementById('closeSettingsBtn').addEventListener('click',()=>this.closeSettings());
    document.getElementById('globalCloseSettingsBtn').addEventListener('click',()=>this.closeSettings());
    document.getElementById('savePasswordBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.savePassword();
    });
    
    // 小组相关
    document.getElementById('createGroupBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.createGroup();
    });
    document.getElementById('closeCreateGroupBtn').addEventListener('click',()=>this.closeCreateGroupModal());
    document.getElementById('saveGroupBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.saveGroup();
    });
    document.getElementById('cancelEditGroupBtn').addEventListener('click',()=>this.closeEditGroupModal());
    
    // 历史记录相关
    document.getElementById('closeHistoryBtn').addEventListener('click',()=>this.closeStudentHistoryModal());
    document.getElementById('closeGroupHistoryBtn').addEventListener('click',()=>this.closeGroupHistoryModal());
    
    // 统计相关
    document.getElementById('closeStatisticsBtn').addEventListener('click',()=>this.closeStatistics());
    document.getElementById('exportStatisticsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.exportStatistics();
    });
    document.getElementById('generateCustomStats').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.generateCustomStatistics();
    });
    
    // 随机点名相关
    document.getElementById('closeRandomNameBtn').addEventListener('click',()=>this.closeRandomNameModal());
    
    // 计时器相关
    document.getElementById('closeTimerBtn').addEventListener('click',()=>this.closeTimerModal());
    document.getElementById('startStopwatch').addEventListener('click',()=>this.startStopwatch());
    document.getElementById('pauseStopwatch').addEventListener('click',()=>this.pauseStopwatch());
    document.getElementById('resetStopwatch').addEventListener('click',()=>this.resetStopwatch());
    document.getElementById('lapStopwatch').addEventListener('click',()=>this.lapStopwatch());
    document.getElementById('startCountdown').addEventListener('click',()=>this.startCountdown());
    document.getElementById('pauseCountdown').addEventListener('click',()=>this.pauseCountdown());
    document.getElementById('resetCountdown').addEventListener('click',()=>this.resetCountdown());
    
    // 批量操作相关
    document.getElementById('confirmBatchStudentsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.executeBatchStudents();
    });
    document.getElementById('cancelBatchBtn').addEventListener('click',()=>this.closeBatchModal());
    document.getElementById('confirmBatchGroupsBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.executeBatchGroups();
    });
    document.getElementById('cancelBatchGroupBtn').addEventListener('click',()=>this.closeBatchModal());
    
    // 技术支持模态框按钮事件
    document.getElementById('closeTechSupportBtn').addEventListener('click',()=>this.closeTechSupportModal());
    
    // 内容标签页切换
    document.querySelectorAll('.content-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.switchContentTab(e.target.getAttribute('data-tab'));
      });
    });
    
	document.getElementById('goToTaskBtn').addEventListener('click', () => {
	  if (this.students.length === 0) {
		alert('当前班级没有学生数据！');
		return;
	  }

	  // 添加加载提示，提升用户体验
	  const originalButtonText = document.getElementById('goToTaskBtn').textContent;
	  document.getElementById('goToTaskBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> 准备中...';
	  document.getElementById('goToTaskBtn').disabled = true;

	  // 延迟执行跳转，让用户看到加载状态
	  setTimeout(() => {
		const studentData = this.students.map(stu => {
		  const totalPoints = stu.points + (stu.purchases || []).reduce((sum, p) => sum + p.cost, 0);
		  const stage = this.getStudentPetStage(stu);
		  return {
			name: stu.name,
			avatar: stage.emoji
		  };
		});

		const query = new URLSearchParams({
		  students: encodeURIComponent(JSON.stringify(studentData)),
		  className: encodeURIComponent(this.currentClassName || ''),
		  timestamp: Date.now() // 添加时间戳避免缓存问题
		});

		window.location.href = `/static/renwu.html?${query.toString()}`;
	  }, 500);
	});
	
	// 模态框标签页切换
	document.addEventListener('click', (e) => {
	  if (e.target.classList.contains('modal-tab')) {
		const tabName = e.target.getAttribute('data-tab');
		const modal = e.target.closest('.modal-content');
		if (modal) {
		  this.switchModalTab(modal, tabName);
		  
		  // 批量操作模态框的特殊处理 - 切换标签页时刷新规则显示
		  const modalElement = modal.parentElement;
		  if (modalElement.id === 'batchModal') {
			if (tabName === 'batchStudents') {
			  // 切换到学生批量操作时，刷新学生规则显示
			  setTimeout(() => {
				this.renderBatchStudentsList();
			  }, 50);
			} else if (tabName === 'batchGroups') {
			  // 切换到小组批量操作时，刷新小组规则显示
			  setTimeout(() => {
				this.renderBatchGroupsList();
			  }, 50);
			}
		  }
		  
		  // 学生历史记录模态框的特殊处理
		  if (modalElement.id === 'studentHistoryModal') {
			if (tabName === 'studentHistory') {
			  this.renderStudentHistory();
			} else if (tabName === 'studentPurchases') {
			  this.renderStudentPurchases();
			} else if (tabName === 'petSelection') {
			  const student = this.students[this.editingStudentIndex];
			  this.renderPetSelection(student);
			}
		  }
		  
		  // 小组历史记录模态框的特殊处理
		  if (modalElement.id === 'groupHistoryModal') {
			if (tabName === 'groupHistory') {
			  // 历史记录已经在openGroupHistory中渲染
			} else if (tabName === 'groupPetSelection') {
			  const group = this.groups[this.editingGroupIndex];
			  this.renderGroupPetSelection(group);
			}
		  }
		  
		  // 设置模态框的特殊处理
		  if (modalElement.id === 'settingsModal') {
			if (tabName === 'petConfig') {
			  this.renderPetConfig();
			} else if (tabName === 'security') {
			  this.renderSecuritySettings();
			} else if (tabName === 'account') {
			  this.renderAccountSettings();
			}
		  }
		}
	  }
	});

    // 统计标签页切换
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('statistics-tab')) {
        const tabName = e.target.getAttribute('data-tab');
        this.switchStatisticsTab(tabName);
      }
    });

    // 计时器标签页切换
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('timer-tab')) {
        const tabName = e.target.getAttribute('data-tab');
        this.switchTimerTab(tabName);
      }
    });
    
    // 标题保存
    document.getElementById('mainTitle').addEventListener('blur',()=>{
      if(this.isLocked) return;
      if (this.currentClassId) {
        this.storageSet(`mainTitle_${this.currentClassId}`, document.getElementById('mainTitle').textContent);
      } else {
        this.storageSet('mainTitle', document.getElementById('mainTitle').textContent);
      }
    });
    
    console.log('事件监听器设置完成');
	
	// 个人规则 txt 导入
document.getElementById('ruleTxtImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = reader.result.split(/\r?\n/).filter(Boolean);
      const newRules = [];
      for (const ln of lines) {
        const [name, pts] = ln.split('|').map(s => s.trim());
        if (!name || isNaN(pts)) continue;
        newRules.push({ name, points: Number(pts) });
      }
      if (!newRules.length) throw '没有有效规则';
      // 当前配置范围决定写到哪里
      const target = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
      target.push(...newRules);
      if (this.currentConfigScope === 'global') this.saveGlobalConfig();
      this.saveAll();
      this.renderRuleList();
      alert(`已成功导入 ${newRules.length} 条个人规则！`);
    } catch (err) {
      alert('导入失败：' + err);
    } finally {
      e.target.value = '';          // 允许重复导入同一文件
    }
  };
  reader.readAsText(file, 'utf-8');
});

// 个人规则 Excel 导入
document.getElementById('ruleExcelImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const newRules = [];
      rows.forEach(row => {
        const name = row && row[0] != null ? String(row[0]).trim() : '';
        const ptsRaw = row && row[1] != null ? String(row[1]).trim() : '';
        if (!name) return;
        const pts = Number(ptsRaw);
        if (Number.isNaN(pts)) return;
        newRules.push({ name, points: pts });
      });
      if (!newRules.length) throw '没有有效规则';
      const target = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
      target.push(...newRules);
      if (this.currentConfigScope === 'global') this.saveGlobalConfig();
      this.saveAll();
      this.renderRuleList();
      alert(`已成功导入 ${newRules.length} 条个人规则！`);
    } catch (err) {
      alert('导入失败：' + err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
});

// 个人规则 txt 导出
document.getElementById('ruleTxtExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
  if (!target.length) return alert('当前没有个人规则可导出');
  const content = target.map(r => `${r.name}|${r.points}`).join('\n');
  const filename = `个人积分规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.txt`;
  this.exportFile(filename, content, 'text/plain;charset=utf-8');
});

// 个人规则 Excel 导出
document.getElementById('ruleExcelExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
  if (!target.length) return alert('当前没有个人规则可导出');
  const excelData = target.map(r => [r.name, r.points]);
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '个人规则');
  const filename = `个人积分规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
});
	
// 小组规则 txt 导入
document.getElementById('groupRuleTxtImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = reader.result.split(/\r?\n/).filter(Boolean);
      const newRules = [];
      for (const ln of lines) {
        const [name, pts] = ln.split('|').map(s => s.trim());
        if (!name || isNaN(pts)) continue;
        newRules.push({ name, points: Number(pts) });
      }
      if (!newRules.length) throw '没有有效规则';
      const target = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
      target.push(...newRules);
      if (this.currentConfigScope === 'global') this.saveGlobalConfig();
      this.saveAll();
      this.renderGroupRuleList();
      alert(`已成功导入 ${newRules.length} 条小组规则！`);
    } catch (err) {
      alert('导入失败：' + err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file, 'utf-8');
});

// 小组规则 Excel 导入
document.getElementById('groupRuleExcelImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const newRules = [];
      rows.forEach(row => {
        const name = row && row[0] != null ? String(row[0]).trim() : '';
        const ptsRaw = row && row[1] != null ? String(row[1]).trim() : '';
        if (!name) return;
        const pts = Number(ptsRaw);
        if (Number.isNaN(pts)) return;
        newRules.push({ name, points: pts });
      });
      if (!newRules.length) throw '没有有效规则';
      const target = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
      target.push(...newRules);
      if (this.currentConfigScope === 'global') this.saveGlobalConfig();
      this.saveAll();
      this.renderGroupRuleList();
      alert(`已成功导入 ${newRules.length} 条小组规则！`);
    } catch (err) {
      alert('导入失败：' + err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
});

// 小组规则 txt 导出
document.getElementById('groupRuleTxtExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
  if (!target.length) return alert('当前没有小组规则可导出');
  const content = target.map(r => `${r.name}|${r.points}`).join('\n');
  const filename = `小组积分规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.txt`;
  this.exportFile(filename, content, 'text/plain;charset=utf-8');
});

// 商店规则 TXT 导入
document.getElementById('shopRuleTxtImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = reader.result.split(/\r?\n/).filter(Boolean);
      const newItems = [];
      for (const ln of lines) {
        const line = ln.trim();
        if (!line) continue;
        const parts = line.includes('|')
          ? line.split('|').map(s => s.trim())
          : line.split(/\s+/).map(s => s.trim());
        const name = parts[0] || '';
        const costRaw = parts[1] || '';
        const stockRaw = parts[2] || '';
        if (!name) continue;
        const cost = Number(costRaw);
        if (Number.isNaN(cost) || cost <= 0) continue;
        let stock = null;
        if (stockRaw && stockRaw !== '无限' && stockRaw !== '无限库存') {
          const stockNum = Number(stockRaw);
          if (!Number.isNaN(stockNum) && stockNum >= 0) {
            stock = stockNum;
          }
        }
        newItems.push({ name, cost, stock });
      }
      if (!newItems.length) throw '没有有效的商品数据';
      const targetArray = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
      const shouldReplace = confirm(`检测到 ${newItems.length} 个有效商品。\n\n选择"确定"将替换现有商品，选择"取消"将追加到现有商品列表。`);
      if (shouldReplace) {
        targetArray.length = 0;
        targetArray.push(...newItems);
      } else {
        targetArray.push(...newItems);
      }
      if (this.currentConfigScope === 'global') {
        this.saveGlobalConfig();
      }
      this.saveAll();
      this.renderShopList();
      alert(`成功导入 ${newItems.length} 个商品！`);
    } catch (err) {
      alert('导入失败：' + err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file, 'utf-8');
});

// 商店规则 Excel 导入
document.getElementById('shopRuleExcelImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const newItems = [];
      rows.forEach(row => {
        const name = row && row[0] != null ? String(row[0]).trim() : '';
        const costRaw = row && row[1] != null ? String(row[1]).trim() : '';
        const stockRaw = row && row[2] != null ? String(row[2]).trim() : '';
        if (!name) return;
        const cost = Number(costRaw);
        if (Number.isNaN(cost) || cost <= 0) return;
        let stock = null;
        if (stockRaw && stockRaw !== '无限' && stockRaw !== '无限库存') {
          const stockNum = Number(stockRaw);
          if (!Number.isNaN(stockNum) && stockNum >= 0) {
            stock = stockNum;
          }
        }
        newItems.push({ name, cost, stock });
      });
      if (!newItems.length) throw '没有有效的商品数据';
      const targetArray = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
      const shouldReplace = confirm(`检测到 ${newItems.length} 个有效商品。\n\n选择"确定"将替换现有商品，选择"取消"将追加到现有商品列表。`);
      if (shouldReplace) {
        targetArray.length = 0;
        targetArray.push(...newItems);
      } else {
        targetArray.push(...newItems);
      }
      if (this.currentConfigScope === 'global') {
        this.saveGlobalConfig();
      }
      this.saveAll();
      this.renderShopList();
      alert(`成功导入 ${newItems.length} 个商品！`);
    } catch (err) {
      alert('导入失败：' + err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
});

// 商店规则 TXT 导出
document.getElementById('shopRuleTxtExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
  if (!target.length) return alert('当前没有商品可导出');
  const content = target.map(item => {
    const stock = item.stock === null || item.stock === undefined ? '无限' : item.stock;
    return `${item.name}|${item.cost}|${stock}`;
  }).join('\n');
  const filename = `商店商品规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.txt`;
  this.exportFile(filename, content, 'text/plain;charset=utf-8');
});

// 商店规则 Excel 导出
document.getElementById('shopRuleExcelExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
  if (!target.length) return alert('当前没有商品可导出');
  const excelData = target.map(item => {
    const stock = item.stock === null || item.stock === undefined ? '无限' : item.stock;
    return [item.name, item.cost, stock];
  });
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '商店商品');
  const filename = `商店商品规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
});

// 小组规则 Excel 导出
document.getElementById('groupRuleExcelExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
  if (!target.length) return alert('当前没有小组规则可导出');
  const excelData = target.map(r => [r.name, r.points]);
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '小组规则');
  const filename = `小组积分规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
});

// 个人规则清空
document.getElementById('clearRulesBtn')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
  if (!target.length) return alert('当前没有个人规则可清空');
  
  const confirmed = confirm(`确定要清空所有个人规则吗？\n\n此操作将删除 ${target.length} 条规则，且无法恢复！`);
  if (!confirmed) return;
  
  // 清空规则
  target.length = 0;
  
  // 保存数据
  if (this.currentConfigScope === 'global') {
    this.saveGlobalConfig();
  }
  this.saveAll();
  this.renderRuleList();
  
  alert('个人规则已成功清空！');
});

// 小组规则清空
document.getElementById('clearGroupRulesBtn')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
  if (!target.length) return alert('当前没有小组规则可清空');
  
  const confirmed = confirm(`确定要清空所有小组规则吗？\n\n此操作将删除 ${target.length} 条规则，且无法恢复！`);
  if (!confirmed) return;
  
  // 清空规则
  target.length = 0;
  
  // 保存数据
  if (this.currentConfigScope === 'global') {
    this.saveGlobalConfig();
  }
  this.saveAll();
  this.renderGroupRuleList();
  
  alert('小组规则已成功清空！');
});

// 商店规则清空
document.getElementById('clearShopRulesBtn')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
  if (!target.length) return alert('当前没有商品可清空');
  
  const confirmed = confirm(`确定要清空所有商品规则吗？\n\n此操作将删除 ${target.length} 个商品，且无法恢复！`);
  if (!confirmed) return;
  
  // 清空商品
  target.length = 0;
  
  // 保存数据
  if (this.currentConfigScope === 'global') {
    this.saveGlobalConfig();
  }
  this.saveAll();
  this.renderShopList();
  
  alert('商店商品规则已成功清空！');
});	
	
  }
  
  // 切换内容标签页
  switchContentTab(tab) {
    document.querySelectorAll('.content-tab').forEach(t => {
      t.classList.remove('active');
    });
    document.querySelector(`.content-tab[data-tab="${tab}"]`).classList.add('active');
    
    document.querySelectorAll('.content-tab-content').forEach(c => {
      c.classList.remove('active');
    });
    document.getElementById(`${tab}Tab`).classList.add('active');
  }
  
  // 切换模态框标签页
  switchModalTab(modal, tab) {
    const tabs = modal.querySelectorAll('.modal-tab');
    
    // 移除所有标签按钮的active状态
    tabs.forEach(t => t.classList.remove('active'));
    
    // 激活选中的标签按钮
    const activeTab = modal.querySelector(`.modal-tab[data-tab="${tab}"]`);
    if (activeTab) activeTab.classList.add('active');
    
    // 获取所有标签页内容元素
    const allTabContents = modal.querySelectorAll('.modal-tab-content');
    
    // 隐藏所有标签页内容
    allTabContents.forEach(content => {
      content.classList.remove('active');
      content.style.display = 'none';
    });
    
    // 显示选中的标签页内容
    const activeContent = document.getElementById(`${tab}Tab`);
    if (activeContent) {
      activeContent.classList.add('active');
      activeContent.style.display = 'block';
      
      // 特殊处理安全标签页，确保内容被渲染
      if (tab === 'security') {
        this.renderSecuritySettings();
      }
	  if (tab === 'account') {
		this.renderAccountSettings();
	  }
    }
  }

  // 切换统计标签页
  switchStatisticsTab(tab) {
    console.log('切换统计标签页:', tab);
    
    document.querySelectorAll('.statistics-tab').forEach(t => {
      t.classList.remove('active');
    });
    document.querySelectorAll('.statistics-content').forEach(c => {
      c.classList.remove('active');
    });
    
    const activeTab = document.querySelector(`.statistics-tab[data-tab="${tab}"]`);
    const activeContent = document.getElementById(`${tab}Tab`);
    
    if (activeTab) activeTab.classList.add('active');
    if (activeContent) activeContent.classList.add('active');

    // 自动生成对应时间段的统计
    if(tab === 'today') {
      this.generateTodayStatistics();
    } else if(tab === 'yesterday') {
      this.generateYesterdayStatistics();
    } else if(tab === 'lastWeek') {
      this.generateLastWeekStatistics();
    } else if(tab === 'lastMonth') {
      this.generateLastMonthStatistics();
    }
  }

  // 切换计时器标签页
  switchTimerTab(tab) {
    document.querySelectorAll('.timer-tab').forEach(t => {
      t.classList.remove('active');
    });
    document.querySelectorAll('.timer-tab-content').forEach(c => {
      c.classList.remove('active');
    });
    
    const activeTab = document.querySelector(`.timer-tab[data-tab="${tab}"]`);
    const activeContent = document.getElementById(`${tab}Tab`);
    
    if (activeTab) activeTab.classList.add('active');
    if (activeContent) activeContent.classList.add('active');
  }
  
	readExcel(file){
	  const reader=new FileReader();
	  reader.onload=(e)=>{
		const data=new Uint8Array(e.target.result);
		const workbook=XLSX.read(data,{type:'array'});
		const sheet=workbook.Sheets[workbook.SheetNames[0]];
		const json=XLSX.utils.sheet_to_json(sheet);
		
		let importedCount = 0;
		let newStudents = 0;
		
		json.forEach(row=>{
		  const name=row['姓名']||row['name']||row['Name']||row['学生姓名']||row['学生'];
		  const score=row['成绩']||row['score']||row['Score']||row['分数']||row['总分'];
		  
		  if(name){
			// 查找现有学生
			const existingStudent = this.students.find(s=>s.name===name);
			
			// 计算积分：使用设置的比例
			let pointsToAdd = 0;
			if(score && !isNaN(parseFloat(score))){
			  pointsToAdd = Math.floor(parseFloat(score) / this.scoreToPointsRatio);
			}
			
			if(existingStudent){
			// 确保现有积分是有效数字
			existingStudent.points = parseInt(existingStudent.points) || 0;
			// 累加到现有学生积分
			existingStudent.points += pointsToAdd;
			existingStudent.history.push({
			  date: new Date().toLocaleString('zh-CN'),
			  rule: '成绩导入',
			  points: pointsToAdd
			});
			importedCount++;
		  } else {
			// 创建新学生，确保points是有效数字
			this.students.push({
			  name,
			  points: pointsToAdd,
			  history: [{
				date: new Date().toLocaleString('zh-CN'),
				rule: '成绩导入',
				points: pointsToAdd
			  }],
			  purchases: []
			});
			newStudents++;
			importedCount++;
		  }
		  }
		});
		
		this.saveAll();
		this.renderStudents();
		this.renderRankings();
		
		let message = `导入成功！`;
		if (newStudents > 0) {
		  message += ` 新增了 ${newStudents} 名学生。`;
		}
		if (importedCount > newStudents) {
		  message += ` 更新了 ${importedCount - newStudents} 名学生的积分。`;
		}
		if(json.some(row => row['成绩'] || row['score'] || row['分数'])){
		  message += ` 已根据成绩按${this.scoreToPointsRatio}:1比例换算为积分。`;
		}
		alert(message);
		
		this.updateCurrentClassIndicator();
	  };
	  reader.readAsArrayBuffer(file);
	}
  
// 在 renderStudents 方法中修改学生卡片的显示
renderStudents() {
  const grid = document.getElementById('studentsGrid');
  grid.innerHTML = '';

  this.students.forEach((stu, i) => {
    const totalPoints = this.getStudentTotalPoints(stu);
    const stage = this.getStudentPetStage(stu);
    const level = this.getLevel(totalPoints);

    // 获取学生选择的宠物形象
    const petImageHTML = this.getStudentPetImage(stu);
    
    // 只返回内容，不带 <div class="pet-circle">
    let showContent = petImageHTML;

    const card = document.createElement('div');
    card.className = 'student-card';
    card.innerHTML = `
      <div class="student-name">${stu.name}</div>
      <div class="pet-container-large">
        <div class="pet-circle-large" style="background:${this.getPetColor(totalPoints)}">
          ${showContent}
        </div>
      </div>
      <div class="points-info" style="color: #000000;">
        <div>总积分: ${totalPoints}</div>
        <div>可兑换: ${stu.points}</div>
      </div>
      <div class="level-info">${stage.name} (Lv.${level})</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${this.getStageProgress(totalPoints, stu.name)}%;background:${this.getPetColor(totalPoints, stu.name)}"></div>
      </div>
      <div class="student-actions">
        <button class="action-btn add-btn" data-index="${i}">+</button>
        <button class="action-btn subtract-btn" data-index="${i}">-</button>
        <button class="action-btn history-btn" data-index="${i}" id="history-btn-${i}">📊</button>
        <button class="action-btn shop-btn" data-index="${i}">🛒</button>
        <button class="action-btn delete-btn" data-index="${i}">🗑️</button>
      </div>
    `;

    // 事件绑定
    const addBtn = card.querySelector('.add-btn');
    const subBtn = card.querySelector('.subtract-btn');
    const hisBtn = card.querySelector('.history-btn');
    const shopBtn = card.querySelector('.shop-btn');
    const delBtn = card.querySelector('.delete-btn');
    
    console.log('学生卡片按钮元素检查:', { 
      addBtn: !!addBtn, 
      subBtn: !!subBtn, 
      hisBtn: !!hisBtn, 
      shopBtn: !!shopBtn, 
      delBtn: !!delBtn 
    });
    
    addBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.openPointsModal(i, 'add'); });
    subBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.openPointsModal(i, 'subtract'); });
    hisBtn.addEventListener('click', e => { 
      console.log('积分历史按钮被点击', { index: i, isLocked: this.isLocked });
      e.stopPropagation(); 
      if (this.isLocked) return; 
      this.openStudentHistory(i); 
    });
    shopBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.openShopModal(i); });
    delBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.deleteStudent(i); });

    grid.appendChild(card);
  });
}
  
renderGroups() {
  const grid = document.getElementById('groupsGrid');
  grid.innerHTML = '';

  // 新建小组卡片
  const createCard = document.createElement('div');
  createCard.className = 'group-card';
  createCard.style.cursor = 'pointer';
  createCard.innerHTML = `
    <div class="group-name" style="color:#667eea;">➕ 创建新小组</div>
    <div class="points-info">点击创建新小组</div>
  `;
  createCard.addEventListener('click', () => {
    if (this.isLocked) return;
    this.openCreateGroupModal();
  });
  grid.appendChild(createCard);

  // 已有小组
  const groupAvatars = this.loadGroupAvatars();
  this.groups.forEach((group, i) => {
    const stage = this.getGroupStage(group.points, group.name);
    const level = this.getGroupLevel(group.points, group.name);

    // 显示小组头像（优先显示自定义emoji头像，其次显示宠物形象）
    let showContent;
    const customAvatar = groupAvatars[group.name];
    
    if (customAvatar) {
      // 显示自定义emoji头像
      showContent = `<span style="font-size: 2em;">${customAvatar}</span>`;
    } else if (this.displayMode === 'local') {
      // 使用getGroupPetImage获取小组宠物图片，确保显示已配置的宠物形象
      const groupPetImage = this.getGroupPetImage(group);
      // 如果是img标签，提取src并重新包装；如果是emoji，直接使用
      if (groupPetImage.includes('<img')) {
        const srcMatch = groupPetImage.match(/src="([^"]+)"/);
        if (srcMatch) {
          showContent = `<img src="${srcMatch[1]}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
          showContent = groupPetImage;
        }
      } else {
        showContent = groupPetImage;
      }
    } else {
      showContent = stage.emoji;
    }

    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div class="group-name">${group.name}</div>
      <div class="pet-container">
        <div class="pet-circle" style="background:${this.getGroupColor(group.points, group.name)}">
          ${showContent}
        </div>
      </div>
      <div class="points-info">积分: ${group.points}</div>
      <div class="level-info">${stage.name} (Lv.${level})</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${this.getGroupStageProgress(group.points, group.name)}%;background:${this.getGroupColor(group.points, group.name)}"></div>
      </div>
      <div class="group-members">成员: ${group.members.join(', ')}</div>
      <div class="student-actions">
        <button class="action-btn add-btn" data-group="${i}">+</button>
        <button class="action-btn subtract-btn" data-group="${i}">-</button>
        <button class="action-btn history-btn" data-group="${i}" id="group-history-btn-${i}">📊</button>
        <button class="action-btn edit-group-btn" data-group="${i}">✏️</button>
        <button class="action-btn delete-btn" data-group="${i}">🗑️</button>
      </div>
    `;

    // 事件绑定
    const addBtn = card.querySelector('.add-btn');
    const subBtn = card.querySelector('.subtract-btn');
    const hisBtn = card.querySelector('.history-btn');
    const editBtn = card.querySelector('.edit-group-btn');
    const delBtn = card.querySelector('.delete-btn');
    
    console.log('小组卡片按钮元素检查:', { 
      addBtn: !!addBtn, 
      subBtn: !!subBtn, 
      hisBtn: !!hisBtn, 
      editBtn: !!editBtn, 
      delBtn: !!delBtn 
    });
    
    addBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.openGroupPointsModal(i, 'add'); });
    subBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.openGroupPointsModal(i, 'subtract'); });
    hisBtn.addEventListener('click', e => { 
      console.log('小组积分历史按钮被点击', { index: i, isLocked: this.isLocked });
      e.stopPropagation(); 
      if (this.isLocked) return; 
      this.openGroupHistory(i); 
    });
    editBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.openEditGroupModal(i); });
    delBtn.addEventListener('click', e => { e.stopPropagation(); if (this.isLocked) return; this.deleteGroup(i); });

    grid.appendChild(card);
  });
}
  
  renderRankings(){
    this.renderIndividualRanking();
    this.renderGroupRanking();
  }
  
renderIndividualRanking() {
  const rankingList = document.getElementById('individualRanking');
  rankingList.innerHTML = '';

  // 获取当前时间段的起止日期
  let start = null, end = null;
  if (this.currentRankingPeriod === 'custom') {
    start = this.customRankStart;
    end = this.customRankEnd;
  } else if (this.currentRankingPeriod !== 'all') {
    const range = this.getPeriodRange(this.currentRankingPeriod);
    start = range.start;
    end = range.end;
  }

  // 辅助函数：判断历史记录是否在时间段内
  const isInPeriod = (item) => {
    if (!start || !end) return true;
    if (!item.date) return false; // 确保有日期字段
    
    try {
      const dateStr = item.date.split(' ')[0];
      const itemDate = new Date(dateStr);
      return itemDate >= start && itemDate <= end;
    } catch (error) {
      console.error('日期解析错误:', error, item);
      return false;
    }
  };

  // 计算每个学生在时间段内的总积分
  const studentsWithTotalPoints = this.students.map(student => {
    let totalPoints;
    
    // 如果指定了时间段（如"今天"），需要筛选该时间段内的积分
    if (start && end) {
      // 时间段内的总积分 = 时间段内获得的历史积分（不扣除兑换积分）
      const periodHistoryPoints = (student.history || [])
        .filter(isInPeriod)
        .reduce((sum, h) => {
          const pointsValue = parseInt(h.points) || 0;
          return sum + pointsValue;
        }, 0);
      
      totalPoints = periodHistoryPoints;
    } else {
      // 总榜使用学生的总积分（包括所有历史积分和兑换记录）
      totalPoints = this.getStudentTotalPoints(student);
    }

    // 确保totalPoints是有效数字
    if (isNaN(totalPoints)) {
      console.error('计算积分时出现NaN:', {
        student: student.name,
        totalPoints: totalPoints,
        purchases: student.purchases
      });
      totalPoints = 0;
    }

    return {
      ...student,
      totalPoints: totalPoints
    };
  });

  // 过滤掉积分为0的学生，并排序
  const sortedStudents = studentsWithTotalPoints
    .filter(s => !s.deleted) // 可选
    .sort((a, b) => b.totalPoints - a.totalPoints);

  if (sortedStudents.length === 0) {
    rankingList.innerHTML = '<div class="ranking-item">暂无数据</div>';
    return;
  }

  // 渲染排行榜
  sortedStudents.forEach((student, index) => {
    const item = document.createElement('div');
    item.className = 'ranking-item';

    // 前三名特殊样式
    if (index === 0) {
      item.classList.add('gold');
    } else if (index === 1) {
      item.classList.add('silver');
    } else if (index === 2) {
      item.classList.add('bronze');
    }

    item.innerHTML = `
      <div class="ranking-position">${index + 1}</div>
      <div class="ranking-name">${student.name}</div>
      <div class="ranking-points">${student.totalPoints}</div>
    `;
    rankingList.appendChild(item);
  });
}
  
renderGroupRanking() {
  const rankingList = document.getElementById('groupRanking');
  rankingList.innerHTML = '';

  let start = null, end = null;
  if (this.currentRankingPeriod === 'custom') {
    start = this.customRankStart;
    end = this.customRankEnd;
  } else if (this.currentRankingPeriod !== 'all') {
    const range = this.getPeriodRange(this.currentRankingPeriod);
    start = range.start;
    end = range.end;
  }

  const isInPeriodAndEarned = (item) => {
    if (!start || !end) return true;
    const dateStr = item.date.split(' ')[0];
    const itemDate = new Date(dateStr);
    return itemDate >= start && itemDate <= end;
  };

  const includeMember = this.includeMemberPointsInGroupRank;

  const groupsWithPoints = this.groups.map(group => {
    // 小组自身获得的积分
    let points = (group.history || [])
      .filter(isInPeriodAndEarned)
      .reduce((sum, h) => {
        const pointsValue = parseInt(h.points) || 0;
        return sum + pointsValue;
      }, 0);

    // 如果开启“含成员积分”，加上成员获得的积分并扣除兑换花费
    if (includeMember) {
      const members = new Set(group.members || []);
      this.students.forEach(student => {
        if (members.has(student.name)) {
          // 成员在时间段内获得的积分
          const memberEarnedPoints = (student.history || [])
            .filter(isInPeriodAndEarned)
            .reduce((sum, h) => {
              const pointsValue = parseInt(h.points) || 0;
              return sum + pointsValue;
            }, 0);
          
          // 成员在时间段内兑换花费的积分
          const memberSpentPoints = (student.purchases || [])
            .filter(isInPeriodAndEarned)
            .reduce((sum, p) => {
              const costValue = parseInt(p.cost) || 0;
              return sum + costValue;
            }, 0);
          
          // 积分 = 获得的积分（不扣除兑换花费）
          points += memberEarnedPoints;
        }
      });
    }

    // 确保points是有效数字
    if (isNaN(points)) {
      console.error('小组积分计算出现NaN:', {
        group: group.name,
        points: points,
        includeMember: includeMember
      });
      points = 0;
    }

    return { ...group, totalPoints: points };
  });

  const sortedGroups = groupsWithPoints
    // 显示所有小组
    .sort((a, b) => b.totalPoints - a.totalPoints);

  if (sortedGroups.length === 0) {
    rankingList.innerHTML = '<div class="ranking-item">暂无数据</div>';
    return;
  }

  sortedGroups.forEach((group, index) => {
    const item = document.createElement('div');
    item.className = 'ranking-item';

    if (index === 0) {
      item.classList.add('gold');
    } else if (index === 1) {
      item.classList.add('silver');
    } else if (index === 2) {
      item.classList.add('bronze');
    }

    item.innerHTML = `
      <div class="ranking-position">${index + 1}</div>
      <div class="ranking-name">${group.name}</div>
      <div class="ranking-points">${group.totalPoints}</div>
    `;
    rankingList.appendChild(item);
  });
}
  
  renderHistory(){
    const list=document.getElementById('historyList');
    list.innerHTML='';
    
    this.history.slice(0,50).forEach(h=>{
      const item=document.createElement('div');
      item.className='history-item';
      
      if(h.type === 'student') {
        item.innerHTML=`<span>${h.date}</span><span>${h.name} ${h.rule} ${h.points > 0 ? '+' : ''}${h.points}积分</span>`;
      } else if(h.type === 'group') {
        item.innerHTML=`<span>${h.date}</span><span>${h.group} ${h.rule} ${h.points > 0 ? '+' : ''}${h.points}积分</span>`;
      } else if(h.type === 'purchase') {
        item.innerHTML=`<span>${h.date}</span><span>${h.name} 兑换了 ${h.item} (花费${h.cost}积分)</span>`;
      }
      
      list.appendChild(item);
    });
  }
  
  renderTaskRecords() {
  const container = document.getElementById('taskRecordsList');
  if (!container) return;
  container.innerHTML = '';

  if (!this.taskRecords || this.taskRecords.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;">暂无任务记录</div>';
    return;
  }

  [...this.taskRecords].reverse().forEach((rec, idx) => {
    const realIndex = this.taskRecords.length - 1 - idx;
    const div = document.createElement('div');
    div.className = 'history-item';
    div.style.cursor = 'pointer';
    div.dataset.index = realIndex;
    div.innerHTML = `
      <span>${rec.taskName || '未命名任务'} - ${rec.date}</span>
      <span>✅${rec.completedCount}/${rec.totalStudents}</span>
      <button onclick="pointsSystem.deleteTaskRecord(${realIndex})" style="float:right;">删除</button>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      this.loadTaskRecordFromRenwu(realIndex);
    });
    container.appendChild(div);
  });
}
  
	openPointsModal(index, operation){
	  this.currentStudent = index;
	  this.currentOperation = operation;
	  const stu = this.students[index];
	  document.getElementById('studentNameModal').textContent = `学生: ${stu.name}`;
	  
	  const container = document.getElementById('ruleSelect');
	  
	  // 根据操作类型过滤规则
	  const filteredRules = this.rules.filter(rule => 
		operation === 'add' ? rule.points > 0 : rule.points < 0
	  );
	  
	  if(filteredRules.length === 0) {
		alert(`没有找到${operation === 'add' ? '加分' : '减分'}规则，请在系统配置中添加`);
		return;
	  }
	  
	  // 创建平铺规则选择器
	  container.innerHTML = `
		<div class="rules-grid">
		  ${filteredRules.map((r, i) => `
			<div class="rule-option" data-index="${i}">
			  <input type="checkbox" id="rule-${i}" value="${r.name}">
			  <label for="rule-${i}">
				<span class="rule-name">${r.name}</span>
				<span class="rule-points">${r.points > 0 ? '+' : ''}${r.points}积分</span>
			  </label>
			</div>
		  `).join('')}
		</div>
		<div class="selected-rules-summary" style="margin-top: 10px; padding: 10px; background: #f7fafc; border-radius: 5px; display: none;">
		  <strong>已选择规则:</strong>
		  <span id="selectedRulesList"></span>
		  <div>总计积分: <span id="totalPoints">0</span></div>
		</div>
	  `;
	  
	  // 添加规则选择事件
	  container.querySelectorAll('.rule-option input').forEach(checkbox => {
		checkbox.addEventListener('change', () => this.updateSelectedRules());
	  });
	  
	  document.getElementById('pointsModal').style.display = 'flex';
	  document.getElementById('tempRuleName').value = '';
	  document.getElementById('tempRulePoints').value = '';
	}
  
	addPoints(){
	  if(this.currentStudent === null) return;
	  
	  const container = document.getElementById('ruleSelect');
	  const selectedRules = [];
	  
	  // 获取所有选中的规则
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.rules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		}
	  });
	  
	  if(selectedRules.length === 0){
		alert('请至少选择一条规则！');
		return;
	  }
	  
	  const stu = this.students[this.currentStudent];
	  // 确保学生积分是有效数字
	  stu.points = parseInt(stu.points) || 0;
	  let totalPoints = 0;
	  
	  // 记录撤销信息
	  this.undoStack.push({
		type: 'points',
		index: this.currentStudent,
		points: totalPoints,
		stu: {...stu, history: [...stu.history]}
	  });
	  
	  // 应用所有选中的规则
	  selectedRules.forEach(rule => {
		stu.points += rule.points;
		totalPoints += rule.points;
		stu.history.push({
		  date: new Date().toLocaleString('zh-CN'),
		  rule: rule.name,
		  points: rule.points
		});
		
		this.history.unshift({
		  date: new Date().toLocaleString('zh-CN'),
		  type: 'student',
		  name: stu.name,
		  rule: rule.name,
		  points: rule.points
		});
	  });
	  
	  this.saveAll();
	  this.renderStudents();
	  this.renderRankings();
	  this.renderHistory();
	  this.closePointsModal();
	  
	  alert(`成功应用 ${selectedRules.length} 条规则，总计 ${totalPoints > 0 ? '+' : ''}${totalPoints} 积分！`);
	}
  
  openShopModal(index){
    this.currentStudent=index;
    const stu=this.students[index];
    document.getElementById('shopStudentName').textContent=`学生: ${stu.name} (${stu.points}积分)`;
    
    const shopItems = document.getElementById('shopItems');
    shopItems.innerHTML = '';
    
    this.shopItems.forEach((item, i) => {
      const canAfford = stu.points >= item.cost;
      const hasStock = item.stock === null || item.stock > 0;
      
      const shopItem = document.createElement('div');
      shopItem.className = 'shop-item';
      shopItem.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-name">${item.name}</div>
          <div class="shop-item-cost">${item.cost}积分</div>
          ${item.stock !== null ? `<span class="shop-item-stock">库存: ${item.stock}</span>` : ''}
        </div>
        <button class="buy-btn" data-index="${i}" ${!canAfford || !hasStock ? 'disabled' : ''}>兑换</button>
      `;
      
      const buyBtn = shopItem.querySelector('.buy-btn');
      buyBtn.addEventListener('click', () => {
        this.purchaseItem(i);
      });
      
      shopItems.appendChild(shopItem);
    });
    
    document.getElementById('shopModal').style.display='flex';
  }
  
  purchaseItem(itemIndex){
    const stu=this.students[this.currentStudent];
    const item=this.shopItems[itemIndex];
    
    // 确保学生积分是有效数字
    stu.points = parseInt(stu.points) || 0;
    
    if(stu.points < item.cost){
      alert('积分不足！');
      this.closeShopModal(); // 积分不足时关闭模态框
      return;
    }
    
    if(item.stock !== null && item.stock <= 0){
      alert('该商品已售罄！');
      this.closeShopModal(); // 商品售罄时关闭模态框
      return;
    }
    
    if(confirm(`确定要用 ${item.cost} 积分兑换 ${item.name} 吗？`)){
      // 记录购买前的状态用于撤销
      this.undoStack.push({
        type:'purchase',
        index:this.currentStudent,
        itemIndex,
        stu:{...stu,points:stu.points,history:[...stu.history]},
        itemStock:item.stock
      });
      
      stu.points -= item.cost;
      const purchaseRecord = {
        date: new Date().toLocaleString('zh-CN'),
        type: 'purchase',
        item: item.name,
        cost: item.cost,
        received: false // 默认未领取
      };
      stu.history.push(purchaseRecord);
      stu.purchases.push(purchaseRecord);
      
      if(item.stock !== null){
        item.stock--;
      }
      
      this.history.unshift({
        date:new Date().toLocaleString('zh-CN'),
        type: 'purchase',
        name:stu.name,
        item: item.name,
        cost: item.cost
      });
      
      this.saveAll();
      this.renderStudents();
      this.renderRankings();
      this.renderHistory();
      this.closeShopModal();
      alert('兑换成功！');
    }
  }
  
  openCreateGroupModal(){
    this.renderAvailableStudents();
    document.getElementById('createGroupModal').style.display='flex';
  }
  
	renderAvailableStudents(){
	  const availableStudents = document.getElementById('availableStudents');
	  availableStudents.innerHTML = '';
	  
	  // 严格找出未分组的学生
	  const allStudentNames = this.students.map(student => student.name);
	  const allGroupedStudentNames = [];
	  
	  this.groups.forEach(group => {
		group.members.forEach(member => {
		  if (!allGroupedStudentNames.includes(member)) {
			allGroupedStudentNames.push(member);
		  }
		});
	  });
	  
	  console.log('所有学生:', allStudentNames);
	  console.log('所有已分组学生:', allGroupedStudentNames);
	  
	  const availableStudentNames = allStudentNames.filter(name => 
		!allGroupedStudentNames.includes(name)
	  );
	  
	  console.log('最终可用的学生:', availableStudentNames);
	  
	  if(availableStudentNames.length === 0) {
		availableStudents.innerHTML = '<div style="text-align: center; color: #718096; padding: 20px;">所有学生都已分组，请先创建新学生或从其他小组移除</div>';
		return;
	  }
	  
	  availableStudentNames.forEach(name => {
		const checkbox = document.createElement('div');
		checkbox.className = 'student-checkbox';
		checkbox.innerHTML = `
		  <input type="checkbox" id="student-${name}" value="${name}">
		  <label for="student-${name}">${name}</label>
		`;
		availableStudents.appendChild(checkbox);
	  });
	}
  
  createGroup(){
    const groupName = document.getElementById('newGroupName').value.trim();
    
    if(!groupName){
      alert('请输入小组名称！');
      return;
    }
    
    if(this.groups.find(g => g.name === groupName)){
      alert('小组名称已存在！');
      return;
    }
    
    // 获取选中的学生
    const selectedStudents = [];
    document.querySelectorAll('#availableStudents input:checked').forEach(checkbox => {
      selectedStudents.push(checkbox.value);
    });
    
    if(selectedStudents.length === 0){
      alert('请至少选择一名学生！');
      return;
    }
    
    this.groups.push({
      name: groupName,
      points: 0, // 默认积分设置为0
      members: selectedStudents,
      history: []
    });
    
    document.getElementById('newGroupName').value = '';
    
    this.saveAll();
    this.renderGroups();
    this.renderRankings();
    this.closeCreateGroupModal();
    alert('小组创建成功！');
	this.updateCurrentClassIndicator();
  }
	  
	openGroupPointsModal(groupIndex, operation){
	  this.currentGroup = groupIndex;
	  this.currentOperation = operation;
	  const group = this.groups[groupIndex];
	  document.getElementById('groupNameModal').textContent = `小组: ${group.name}`;
	  
	  const container = document.getElementById('groupRuleSelect');
	  
	  // 根据操作类型过滤规则
	  const filteredRules = this.groupRules.filter(rule => 
		operation === 'add' ? rule.points > 0 : rule.points < 0
	  );
	  
	  if(filteredRules.length === 0) {
		alert(`没有找到${operation === 'add' ? '加分' : '减分'}规则，请在系统配置中添加`);
		return;
	  }
	  
	  // 创建平铺规则选择器
	  container.innerHTML = `
		<div class="rules-grid">
		  ${filteredRules.map((r, i) => `
			<div class="rule-option" data-index="${i}">
			  <input type="checkbox" id="group-rule-${i}" value="${r.name}">
			  <label for="group-rule-${i}">
				<span class="rule-name">${r.name}</span>
				<span class="rule-points">${r.points > 0 ? '+' : ''}${r.points}积分</span>
			  </label>
			</div>
		  `).join('')}
		</div>
		<div class="selected-rules-summary" style="margin-top: 10px; padding: 10px; background: #f7fafc; border-radius: 5px; display: none;">
		  <strong>已选择规则:</strong>
		  <span id="selectedGroupRulesList"></span>
		  <div>总计积分: <span id="totalGroupPoints">0</span></div>
		</div>
	  `;
	  
	  // 添加规则选择事件
	  container.querySelectorAll('.rule-option input').forEach(checkbox => {
		checkbox.addEventListener('change', () => this.updateSelectedGroupRules());
	  });
	  
	  document.getElementById('groupPointsModal').style.display = 'flex';
	  document.getElementById('tempGroupRuleName').value = '';
	  document.getElementById('tempGroupRulePoints').value = '';
	}
  
	addGroupPoints(){
	  if(this.currentGroup === null) return;
	  
	  const container = document.getElementById('groupRuleSelect');
	  const selectedRules = [];
	  
	  // 获取所有选中的规则
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.groupRules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		}
	  });
	  
	  if(selectedRules.length === 0){
		alert('请至少选择一条规则！');
		return;
	  }
	  
	  const group = this.groups[this.currentGroup];
	  let totalPoints = 0;
	  
	  // 记录撤销信息
	  this.undoStack.push({
		type: 'groupPoints',
		index: this.currentGroup,
		points: totalPoints,
		group: {...group, history: [...group.history]}
	  });
	  
	  // 应用所有选中的规则
	  selectedRules.forEach(rule => {
		group.points += rule.points;
		totalPoints += rule.points;
		group.history.push({
		  date: new Date().toLocaleString('zh-CN'),
		  rule: rule.name,
		  points: rule.points
		});
		
		this.history.unshift({
		  date: new Date().toLocaleString('zh-CN'),
		  type: 'group',
		  group: group.name,
		  rule: rule.name,
		  points: rule.points
		});
	  });
	  
	  this.saveAll();
	  this.renderGroups();
	  this.renderRankings();
	  this.renderHistory();
	  this.closeGroupPointsModal();
	  
	  alert(`成功应用 ${selectedRules.length} 条规则，总计 ${totalPoints > 0 ? '+' : ''}${totalPoints} 积分！`);
	}
  
  openEditGroupModal(index){
    this.editingGroupIndex = index;
    const group = this.groups[index];
    
    document.getElementById('editGroupName').value = group.name;
    
    // 移除了头像初始化代码
    
    const studentsContainer = document.getElementById('editGroupStudents');
    studentsContainer.innerHTML = '';
    
    // 找出还未分到任何小组的学生和当前小组成员
    const groupedStudentNames = new Set();
    this.groups.forEach((g, i) => {
      if(i !== index) { // 排除当前编辑的小组
        g.members.forEach(member => groupedStudentNames.add(member));
      }
    });
    
    const availableStudentNames = this.students
      .filter(student => !groupedStudentNames.has(student.name) || group.members.includes(student.name))
      .map(student => student.name);
    
    if(availableStudentNames.length === 0) {
      studentsContainer.innerHTML = '<div>没有可用的学生</div>';
    } else {
      availableStudentNames.forEach(name => {
        const isInGroup = group.members.includes(name);
        const checkbox = document.createElement('div');
        checkbox.className = 'student-checkbox';
        checkbox.innerHTML = `
          <input type="checkbox" id="edit-student-${name}" value="${name}" ${isInGroup ? 'checked' : ''}>
          <label for="edit-student-${name}">${name}</label>
        `;
        studentsContainer.appendChild(checkbox);
      });
    }
    
    document.getElementById('editGroupModal').style.display = 'flex';
  }
  
  saveGroup(){
    if(this.editingGroupIndex === null) return;
    
    const groupName = document.getElementById('editGroupName').value.trim();
    
    if(!groupName){
      alert('请输入小组名称！');
      return;
    }
    
    // 检查小组名称是否重复（排除当前编辑的小组）
    const duplicateGroup = this.groups.find((g, i) => i !== this.editingGroupIndex && g.name === groupName);
    if(duplicateGroup){
      alert('小组名称已存在！');
      return;
    }
    
    const group = this.groups[this.editingGroupIndex];
    group.name = groupName;
    
    // 更新小组成员
    const selectedStudents = [];
    document.querySelectorAll('#editGroupStudents input:checked').forEach(checkbox => {
      selectedStudents.push(checkbox.value);
    });
    
    group.members = selectedStudents;
    
    this.saveAll();
    this.renderGroups();
    this.renderRankings();
    this.closeEditGroupModal();
    alert('小组更新成功！');
	this.updateCurrentClassIndicator();
  }
  
  // 学生历史记录功能
  openStudentHistory(index){
    console.log('openStudentHistory被调用', { index, student: this.students[index] });
    this.editingStudentIndex = index;
    const student = this.students[index];
    
    document.getElementById('historyStudentName').textContent = `学生: ${student.name} (${student.points}积分)`;
    document.getElementById('purchasesStudentName').textContent = `学生: ${student.name} (${student.points}积分)`;
    
    this.renderStudentHistory();
    this.renderStudentPurchases();
    this.renderPetSelection(student); // 新增：渲染宠物选择界面
    
    const modal = document.getElementById('studentHistoryModal');
    // 设置学生名称到dataset，供renderPetLevelPreviews使用
    modal.dataset.studentName = student.name;
    console.log('准备显示学生历史模态框', { modal: !!modal, display: modal.style.display, studentName: modal.dataset.studentName });
    modal.style.display = 'flex';
    console.log('学生历史模态框已显示', { display: modal.style.display });
  }
  
  renderStudentHistory(){
    const student = this.students[this.editingStudentIndex];
    const historyContainer = document.getElementById('studentHistoryItems');
    historyContainer.innerHTML = '';
    
    if(student.history.length === 0) {
      historyContainer.innerHTML = '<div class="history-record">暂无历史记录</div>';
    } else {
      // 按时间倒序显示
      const sortedHistory = [...student.history].reverse();
      
      sortedHistory.forEach((record, recordIndex) => {
        const originalIndex = student.history.length - 1 - recordIndex;
        const historyItem = document.createElement('div');
        historyItem.className = 'history-record';
        
        let actionText = '';
        if(record.rule) {
          actionText = `${record.rule} ${record.points > 0 ? '+' : ''}${record.points}积分`;
        } else if(record.type === 'purchase') {
          actionText = `兑换 ${record.item} -${record.cost}积分`;
        }
        
        historyItem.innerHTML = `
          <div class="history-details">
            <div class="history-date">${record.date}</div>
            <div class="history-action">${actionText}</div>
          </div>
          <button class="undo-history-btn" data-index="${originalIndex}">撤回</button>
        `;
        
        const undoBtn = historyItem.querySelector('.undo-history-btn');
        undoBtn.addEventListener('click', (e) => {
          if(this.isLocked) return;
          this.undoStudentHistory(parseInt(e.target.getAttribute('data-index')));
        });
        
        historyContainer.appendChild(historyItem);
      });
    }
  }
  
  renderStudentPurchases(){
    const student = this.students[this.editingStudentIndex];
    const purchasesContainer = document.getElementById('studentPurchasedItems');
    purchasesContainer.innerHTML = '';
    
    if(student.purchases.length === 0) {
      purchasesContainer.innerHTML = '<div class="purchased-item">暂无兑换记录</div>';
    } else {
      // 按时间倒序显示
      const sortedPurchases = [...student.purchases].reverse();
      
      sortedPurchases.forEach((purchase, purchaseIndex) => {
        const originalIndex = student.purchases.length - 1 - purchaseIndex;
        const purchaseItem = document.createElement('div');
        purchaseItem.className = 'purchased-item';
        
        purchaseItem.innerHTML = `
          <div class="purchase-details">
            <div class="purchase-date">${purchase.date}</div>
            <div class="purchase-item">${purchase.item} -${purchase.cost}积分</div>
          </div>
          <button class="receive-btn ${purchase.received ? 'received' : ''}" data-index="${originalIndex}">
            ${purchase.received ? '已领取' : '领取'}
          </button>
        `;
        
        const receiveBtn = purchaseItem.querySelector('.receive-btn');
        if(!purchase.received) {
          receiveBtn.addEventListener('click', (e) => {
            if(this.isLocked) return;
            this.receiveItem(parseInt(e.target.getAttribute('data-index')));
          });
        }
        
        purchasesContainer.appendChild(purchaseItem);
      });
    }
  }
  
  receiveItem(purchaseIndex){
    const student = this.students[this.editingStudentIndex];
    student.purchases[purchaseIndex].received = true;
    
    // 更新对应的历史记录
    const purchaseRecord = student.purchases[purchaseIndex];
    const historyIndex = student.history.findIndex(h => 
      h.date === purchaseRecord.date && 
      h.type === 'purchase' && 
      h.item === purchaseRecord.item
    );
    
    if(historyIndex !== -1) {
      student.history[historyIndex].received = true;
    }
    
    this.saveAll();
    this.renderStudentPurchases();
    alert('商品已标记为已领取！');
  }
  
  // 小组历史记录功能
  openGroupHistory(index){
    console.log('🔍 openGroupHistory调用开始:', {index, group: this.groups[index]});
    this.editingGroupIndex = index;
    const group = this.groups[index];
    
    // 获取小组宠物形象
    const groupPetImage = this.getGroupPetImage(group);
    // 显示小组名称和宠物（在自定义宠物模式下隐藏宠物图片）
    if (this.displayMode === 'local') {
      // 自定义宠物模式：只显示小组名称和积分，不显示宠物图片
      document.getElementById('historyGroupName').innerHTML = `小组: ${group.name} (${group.points}积分)`;
    } else {
      // 默认模式：显示小组名称、宠物图片和积分
      document.getElementById('historyGroupName').innerHTML = `小组: ${group.name} <span style="margin: 0 10px;">${groupPetImage}</span> (${group.points}积分)`;
    }
    document.getElementById('petSelectionGroupName').innerHTML = `<span style="color: #3b82f6; font-weight: 600;">${group.name}</span>`;
    
    // 渲染历史记录
    const historyContainer = document.getElementById('groupHistoryItems');
    historyContainer.innerHTML = '';
    
    if(group.history.length === 0) {
      historyContainer.innerHTML = '<div class="history-record">暂无历史记录</div>';
    } else {
      // 按时间倒序显示
      const sortedHistory = [...group.history].reverse();
      
      sortedHistory.forEach((record, recordIndex) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-record';
        
        const actionText = `${record.rule} ${record.points > 0 ? '+' : ''}${record.points}积分`;
        
        historyItem.innerHTML = `
          <div class="history-details">
            <div class="history-date">${record.date}</div>
            <div class="history-action">${actionText}</div>
          </div>
        `;
        
        historyContainer.appendChild(historyItem);
      });
    }
    
    // 渲染宠物选择界面
    this.renderGroupPetSelection(group);
    
    // 添加标签页切换功能
console.log('➕ 添加标签页切换功能');

// 获取模态框和内容区域
const modal = document.getElementById('groupHistoryModal');
const modalContent = modal ? modal.querySelector('.modal-content') : null;

console.log('🔍 模态框查找结果:', { 
  modal: !!modal,
  modalContent: !!modalContent
});

if (!modalContent) {
  console.error('❌ 未找到模态框内容区域');
  return;
}

// 获取标签按钮 - 通过data-tab属性获取
const historyTabBtn = modalContent.querySelector('.modal-tab[data-tab="groupHistory"]');
const petTabBtn = modalContent.querySelector('.modal-tab[data-tab="groupPetSelection"]');

console.log('🔍 标签按钮查找结果:', { 
  historyTabBtn: !!historyTabBtn, 
  petTabBtn: !!petTabBtn
});

// 调试：检查模态框内的所有.modal-tab元素
const allModalTabs = modalContent.querySelectorAll('.modal-tab');
console.log('🔍 模态框内所有标签按钮:', allModalTabs.length);
allModalTabs.forEach((tab, index) => {
  console.log(`🔍 标签按钮 ${index}:`, {
    text: tab.textContent,
    dataTab: tab.getAttribute('data-tab'),
    className: tab.className
  });
});

// 初始化第一个标签页
this.switchModalTab(modalContent, 'groupHistory');

// 克隆按钮移除旧的事件监听
if (historyTabBtn && petTabBtn) {
  // 克隆并替换按钮以移除所有事件监听器
  const newHistoryTabBtn = historyTabBtn.cloneNode(true);
  const newPetTabBtn = petTabBtn.cloneNode(true);
  
  historyTabBtn.parentNode.replaceChild(newHistoryTabBtn, historyTabBtn);
  petTabBtn.parentNode.replaceChild(newPetTabBtn, petTabBtn);
  
  // 添加新的事件监听
  newHistoryTabBtn.addEventListener('click', () => {
    console.log('📋 切换到历史记录标签');
    this.switchModalTab(modalContent, 'groupHistory');
  });
  
  newPetTabBtn.addEventListener('click', () => {
    console.log('🐱 切换到宠物标签');
    this.switchModalTab(modalContent, 'groupPetSelection');
  });
  
  console.log('✅ 标签页事件监听添加成功');
}
	
    // 为标签按钮添加事件监听（已在上方通过克隆按钮实现）
    
    console.log('准备显示小组历史模态框', { modal: !!modal, display: modal.style.display });
    modal.style.display = 'flex';
    console.log('小组历史模态框已显示', { display: modal.style.display });
  }
  
  // 渲染小组宠物选择界面
  renderGroupPetSelection(group) {
    const currentPetPreview = document.getElementById('groupCurrentPetPreview');
    const petTypeGrid = document.getElementById('groupPetTypeGrid');
    const petLevelPreviews = document.getElementById('groupPetLevelPreviews');
    
    if (!currentPetPreview || !petTypeGrid || !petLevelPreviews) return;

    if (!this.petTypes || this.petTypes.length === 0) {
      currentPetPreview.innerHTML = '<div style="color: #94a3b8;">暂无宠物类型，请先在宠物配置中添加</div>';
      petTypeGrid.className = 'pet-type-grid';
      petTypeGrid.innerHTML = '<div style="padding: 12px; color: #94a3b8; text-align: center;">暂无可选宠物类型</div>';
      petLevelPreviews.innerHTML = '';
      return;
    }
    
    // 获取小组当前宠物选择
    const groupPet = this.groupPets[group.name] || {};
    const currentPetType = this.getValidPetTypeId(groupPet.petType);
    
    // 为当前宠物预览添加与个人中心一致的容器样式
    currentPetPreview.parentNode.style.margin = '20px 0';
    currentPetPreview.parentNode.style.padding = '15px';
    currentPetPreview.parentNode.style.background = '#f0f9ff';
    currentPetPreview.parentNode.style.borderRadius = '10px';
    currentPetPreview.parentNode.style.textAlign = 'center';
    
    // 添加当前宠物标题（与个人中心保持一致）
    const existingH4 = currentPetPreview.parentNode.querySelector('h4');
    if (!existingH4) {
      const h4 = document.createElement('h4');
      h4.textContent = '当前宠物';
      h4.style.marginBottom = '10px';
      h4.style.color = '#2d3748';
      currentPetPreview.parentNode.insertBefore(h4, currentPetPreview);
    }
    
    // 显示当前宠物（带样式和信息）
    const petType = this.petTypes.find(type => type.id === currentPetType);
    currentPetPreview.innerHTML = `
      <div style="position: relative; display: inline-block;">
        <div style="font-size: 2.5em; padding: 20px; background: ${petType?.color}20; border-radius: 50%;">${petType?.emoji || '🐾'}</div>
        <div style="position: absolute; bottom: 5px; right: 5px; background: ${petType?.color || '#3b82f6'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</div>
      </div>
      <div style="margin-top: 10px; font-size: 1.2em; font-weight: 500; color: ${petType?.color || '#3b82f6'};">${petType?.name || '未设置'}</div>
    `;
    
    // 渲染宠物类型选择网格
    petTypeGrid.innerHTML = '';
    // 应用CSS样式类
    petTypeGrid.className = 'pet-type-grid';
    
    this.petTypes.forEach(type => {
      const option = document.createElement('div');
      const isSelected = type.id === currentPetType;
      option.className = `pet-type-option ${isSelected ? 'selected' : ''}`;
      option.dataset.petType = type.id;
      
      option.innerHTML = `
        <div class="pet-type-emoji">${type.emoji}</div>
        <div class="pet-type-name" style="color: ${type.color};">${type.name}</div>
        ${isSelected ? '<div style="margin-top: 8px; padding: 2px 8px; background: ' + type.color + '; color: white; border-radius: 12px; font-size: 0.8em; display: inline-block;">已选择</div>' : ''}
      `;
      petTypeGrid.appendChild(option);
    });
    
    // 为宠物选择和等级预览部分添加标题（与个人中心保持一致）
    const petTypeGridParent = petTypeGrid.parentNode;
    const petLevelPreviewsParent = petLevelPreviews.parentNode;
    
    // 添加宠物类型选择标题
    if (!petTypeGridParent.querySelector('h4')) {
      const h4 = document.createElement('h4');
      h4.textContent = '选择宠物类型';
      petTypeGridParent.insertBefore(h4, petTypeGrid);
    }
    
    // 添加等级预览标题
    if (!petLevelPreviewsParent.querySelector('h4')) {
      const h4 = document.createElement('h4');
      h4.textContent = '成长等级预览';
      h4.style.marginBottom = '15px';
      petLevelPreviewsParent.insertBefore(h4, petLevelPreviews);
    }
    
    // 渲染等级预览
    this.renderPetLevelPreviews(currentPetType);
    
    // 为确认按钮添加容器样式（与个人中心保持一致）
    const confirmBtn = document.getElementById('confirmGroupPetSelection');
    if (confirmBtn) {
      const confirmBtnParent = confirmBtn.parentNode;
      confirmBtnParent.style.marginTop = '20px';
      confirmBtnParent.style.display = 'flex';
      confirmBtnParent.style.justifyContent = 'center';
      confirmBtnParent.style.gap = '10px';
    }
    
    // 添加事件监听器
    this.addGroupPetSelectionEventListeners(group);
  }
  
  // 添加小组宠物选择事件监听器
  addGroupPetSelectionEventListeners(group) {
    // 宠物类型选择事件
    document.querySelectorAll('.pet-type-option').forEach(option => {
      // 移除之前的事件监听器，避免重复绑定
      const newOption = option.cloneNode(true);
      option.parentNode.replaceChild(newOption, option);
      
      newOption.addEventListener('click', (e) => {
        // 阻止事件冒泡，避免触发其他元素的事件
        e.stopPropagation();
        
        // 获取选中的宠物类型
        const petType = newOption.dataset.petType;
        
        // 保存选中的宠物类型到groupPets数据结构
        if (!this.groupPets[group.name]) {
          this.groupPets[group.name] = {};
        }
        this.groupPets[group.name].petType = petType;
        // 保存到本地存储
        this.saveAllPetConfig();
        
        // 更新等级预览
        this.renderPetLevelPreviews(petType);
        
        // 更新当前宠物显示（使用完整样式）
        const petTypeInfo = this.petTypes.find(type => type.id === petType);
        const currentPetPreview = document.getElementById('groupCurrentPetPreview');
        if (currentPetPreview && petTypeInfo) {
          currentPetPreview.innerHTML = `
            <div style="position: relative; display: inline-block;">
              <div style="font-size: 2.5em; padding: 20px; background: ${petTypeInfo?.color}20; border-radius: 50%;">${petTypeInfo?.emoji || '🐾'}</div>
              <div style="position: absolute; bottom: 5px; right: 5px; background: ${petTypeInfo?.color || '#3b82f6'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</div>
            </div>
            <div style="margin-top: 10px; font-size: 1.2em; font-weight: 500; color: ${petTypeInfo?.color || '#3b82f6'};">${petTypeInfo?.name || '未设置'}</div>
          `;
        }
        
        // 添加选中状态的视觉反馈（统一处理）
        document.querySelectorAll('.pet-type-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        newOption.classList.add('selected');
      });
    });
    
    // 确认选择按钮事件
    const confirmBtn = document.getElementById('confirmGroupPetSelection');
    if (confirmBtn) {
      // 移除之前的事件监听器
      const newConfirmBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
      
      newConfirmBtn.addEventListener('click', () => {
        const selectedOption = document.querySelector('.pet-type-option.selected');
        if (selectedOption) {
          const petType = selectedOption.dataset.petType;
          this.selectGroupPetType(group, petType);
        }
      });
    }
  }
  
  // 小组选择宠物类型
  selectGroupPetType(group, petType) {
    // 处理不同类型的小组参数（对象或字符串）
    const groupName = typeof group === 'object' && group.name ? group.name : group;
    
    // 保存小组宠物选择
    this.groupPets[groupName] = {
      petType: petType,
      selectedAt: new Date().toISOString()
    };
    
    // 保存到本地存储
    this.saveAllPetConfig();
    
    // 更新小组卡片显示
    this.renderGroups();
    
    // 关闭模态框
    document.getElementById('groupHistoryModal').style.display = 'none';
    
    alert(`小组宠物已成功设置为${this.petTypes.find(type => type.id === petType)?.name || '未设置'}！`);
  }
  
  undoStudentHistory(historyIndex){
    const student = this.students[this.editingStudentIndex];
    const record = student.history[historyIndex];
    
    if(confirm(`确定要撤回这条记录吗？${record.rule || record.item}`)){
      // 撤回积分
      if(record.rule) {
        student.points -= record.points;
      } else if(record.type === 'purchase') {
        student.points += record.cost;
        // 恢复商品库存
        const item = this.shopItems.find(item => item.name === record.item);
        if(item && item.stock !== null) {
          item.stock++;
        }
        // 移除购买记录
        const purchaseIndex = student.purchases.findIndex(p => 
          p.date === record.date && p.item === record.item
        );
        if(purchaseIndex !== -1) {
          student.purchases.splice(purchaseIndex, 1);
        }
      }
      
      // 移除历史记录
      student.history.splice(historyIndex, 1);
      
      // 更新全局历史
      const globalHistoryIndex = this.history.findIndex(h => 
        h.date === record.date && 
        ((h.type === 'student' && h.name === student.name && h.rule === record.rule) ||
         (h.type === 'purchase' && h.name === student.name && h.item === record.item))
      );
      
      if(globalHistoryIndex !== -1) {
        this.history.splice(globalHistoryIndex, 1);
      }
      
      this.saveAll();
      this.renderStudents();
      this.renderRankings();
      this.renderHistory();
      this.renderStudentHistory();
      this.renderStudentPurchases();
      
      alert('记录已撤回！');
    }
  }
  
	// 在 openSettings 方法中确保正确初始化
		openSettings(){
		  this.renderRuleList();
		  this.renderShopList();
		  this.renderGroupRuleList();
		  // 移除这行：this.renderGlobalConfigTab();
		  this.renderSecuritySettings();
		  this.renderConfigScopeSelector();
		   // 新增：渲染等级积分设置
		  this.renderLevelSettings();
		  
		  // 强制刷新配置范围显示
		  document.getElementById('globalConfig').checked = this.currentConfigScope === 'global';
		  document.getElementById('classConfig').checked = this.currentConfigScope === 'class';
		  
		  document.getElementById('settingsModal').style.display='flex';
		}
  
	// 新增渲染全局配置标签页的方法
	renderGlobalConfigTab() {
	  const globalConfigTab = document.getElementById('globalConfigTab');
	  if (!globalConfigTab) return;
	  
	  globalConfigTab.innerHTML = `
		<div class="global-config-section">
		  <h4>全局配置管理</h4>
		  <div style="margin-bottom: 15px;">
			<p style="color: #718096; margin-bottom: 10px;">
			  全局配置将应用于所有班级。导出/导入积分规则、商店商品、小组规则等系统配置。
			</p>
		  </div>
		  <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
			<button class="btn btn-primary" id="exportGlobalConfigBtn">导出全局配置</button>
			<button class="btn btn-secondary" id="importGlobalConfigBtn">导入全局配置</button>
			<input type="file" id="globalConfigInput" accept=".json" style="display:none;">
		  </div>
		  <div style="margin-top: 15px; padding: 15px; background: #f7fafc; border-radius: 8px;">
			<h5>配置范围说明</h5>
			<p style="font-size: 0.9em; color: #718096; margin: 5px 0;">
			  • <strong>全局配置</strong>: 所有班级共享相同的规则和商品配置<br>
			  • <strong>班级配置</strong>: 每个班级可以有自己的独立配置
			</p>
		  </div>
		</div>
	  `;
	  
	  // 绑定全局配置事件
	  this.attachGlobalConfigEvents();
	}
  
	// 新增：渲染配置范围选择器
	renderConfigScopeSelector() {
	  const settingsHeader = document.querySelector('#settingsModal .modal-header');
	  const existingSelector = document.querySelector('.config-scope-selector');
	  
	  if (existingSelector) {
		existingSelector.remove();
	  }
	  
	  const scopeSelector = document.createElement('div');
	  scopeSelector.className = 'config-scope-selector';
	  
	  scopeSelector.innerHTML = `
		<label style="margin-right: 10px;">配置范围:</label>
		<input type="radio" id="globalConfig" name="configScope" value="global" ${this.currentConfigScope === 'global' ? 'checked' : ''}>
		<label for="globalConfig" style="margin-right: 15px;">全局配置（所有班级）</label>
		<input type="radio" id="classConfig" name="configScope" value="class" ${this.currentConfigScope === 'class' ? 'checked' : ''}>
		<label for="classConfig">班级配置（仅当前班级）</label>
	  `;
	  
	  settingsHeader.parentNode.insertBefore(scopeSelector, settingsHeader.nextSibling);
	  
	  // 添加事件监听
	  document.getElementById('globalConfig').addEventListener('change', () => {
		this.switchConfigScope('global');
	  });
	  
	  document.getElementById('classConfig').addEventListener('change', () => {
		this.switchConfigScope('class');
	  });
	}
  
	// 修复 switchConfigScope 方法
	switchConfigScope(scope) {
	  this.currentConfigScope = scope;
	  
	  if (scope === 'global') {
		// 使用全局配置
		this.rules = this.globalRules;
		this.shopItems = this.globalShopItems;
		this.groupRules = this.globalGroupRules;
	  } else {
		// 使用班级配置
		// 如果班级有自定义配置则使用，否则使用全局配置
		const data = this.storageGet(`classPointsData_${this.currentClassId}`);
		if (data) {
		  const parsed = JSON.parse(data);
		  this.rules = parsed.rules && parsed.rules.length > 0 ? parsed.rules : this.globalRules;
		  this.shopItems = parsed.shopItems && parsed.shopItems.length > 0 ? parsed.shopItems : this.globalShopItems;
		  this.groupRules = parsed.groupRules && parsed.groupRules.length > 0 ? parsed.groupRules : this.globalGroupRules;
		} else {
		  // 如果没有班级数据，使用全局配置
		  this.rules = this.globalRules;
		  this.shopItems = this.globalShopItems;
		  this.groupRules = this.globalGroupRules;
		}
	  }
	  
	  // 重新渲染列表
	  this.renderRuleList();
	  this.renderShopList();
	  this.renderGroupRuleList();
	  
	  // 确保保存当前配置状态
	  this.saveAll();
	}
  
  savePassword(){
    const password = document.getElementById('lockPassword').value;
    this.lockPassword = password;
    this.saveAll();
    alert('密码保存成功！');
  }
  
  closeSettings(){
    // 检查是否有未保存的配置变更
    if (this.hasUnsavedChanges()) {
      if (confirm('您有未保存的配置变更，确定要关闭吗？未保存的变更将丢失。')) {
        document.getElementById('settingsModal').style.display='none';
      }
    } else {
      document.getElementById('settingsModal').style.display='none';
    }
  }
  
  // 检查是否有未保存的配置变更
  hasUnsavedChanges() {
    // 这里可以添加更复杂的逻辑来检测具体的配置变更
    // 目前先返回false，后续可以根据需要增强
    return false;
  }
  
	// 修复 renderRuleList 方法
	renderRuleList(){
	  const list = document.getElementById('ruleList');
	  
	  // 根据当前配置范围选择目标数组
	  const targetArray = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
	  
	  if (targetArray.length === 0) {
		list.innerHTML = '<div style="text-align: center; padding: 20px; color: #718096;">暂无规则</div>';
		return;
	  }
	  
	  list.innerHTML = targetArray.map((r, i) => `
		<div class="rule-item">
		  <div class="editable-item rule-name" data-index="${i}" data-field="name">${r.name}</div>
		  <div class="editable-item rule-points" data-index="${i}" data-field="points">${r.points > 0 ? '+' : ''}${r.points}积分</div>
		  <button class="delete-btn" data-index="${i}">删除</button>
		</div>
	  `).join('');
	  
	  // 添加编辑事件监听
	  this.makeItemsEditable('.rule-name', 'name', targetArray);
	  this.makeItemsEditable('.rule-points', 'points', targetArray);
	  
	  // 删除按钮事件
	  const deleteButtons = list.querySelectorAll('.delete-btn');
	  deleteButtons.forEach(btn => {
		btn.addEventListener('click', (e) => {
		  const index = parseInt(e.target.getAttribute('data-index'));
		  this.removeRule(index, targetArray);
		});
	  });
	}
  
	renderShopList(){
	  const list = document.getElementById('shopList');
	  
	  // 根据当前配置范围选择目标数组
	  const targetArray = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
	  
	  if (targetArray.length === 0) {
		list.innerHTML = '<div style="text-align: center; padding: 20px; color: #718096;">暂无商品</div>';
		return;
	  }
	  
	  list.innerHTML = targetArray.map((item, i) => `
		<div class="shop-item-config">
		  <div class="editable-item item-name" data-index="${i}" data-field="name">${item.name}</div>
		  <div class="editable-item item-cost" data-index="${i}" data-field="cost">${item.cost}积分</div>
		  <div class="editable-item item-stock" data-index="${i}" data-field="stock">${item.stock !== null ? `库存: ${item.stock}` : '无限库存'}</div>
		  <button class="delete-btn" data-index="${i}">删除</button>
		</div>
	  `).join('');
	  
	  // 添加编辑事件监听
	  this.makeItemsEditable('.item-name', 'name', targetArray);
	  this.makeItemsEditable('.item-cost', 'cost', targetArray);
	  this.makeItemsEditable('.item-stock', 'stock', targetArray);
	  
	  // 删除按钮事件
	  const deleteButtons = list.querySelectorAll('.delete-btn');
	  deleteButtons.forEach(btn => {
		btn.addEventListener('click', (e) => {
		  const index = parseInt(e.target.getAttribute('data-index'));
		  this.removeShopItem(index, targetArray);
		});
	  });
	}
	
	// 在 ClassPointsSystem 类中添加这个方法
// 修改 renderSecuritySettings 方法
	renderSecuritySettings() {
	  const securityTab = document.getElementById('securityTab');
	  if (!securityTab) return;
	  
	  securityTab.innerHTML = `
		<div class="security-section">
		  <h4>系统锁定</h4>
		  <div style="margin-bottom: 15px;">
			<label>设置锁定密码:</label>
			<input type="password" id="lockPassword" placeholder="输入锁定密码" value="${this.lockPassword || ''}" style="width: 200px; margin: 0 10px;">
			<button class="btn btn-primary" id="savePasswordBtn">保存密码</button>
		  </div>
		  <div style="color: #718096; font-size: 0.9em;">
			<p>设置密码后可以锁定系统，防止误操作</p>
		  </div>
		</div>
		
		<div class="security-section" style="margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
		  <h4>紧急重置</h4>
		  <div style="margin-bottom: 15px;">
			<p style="color: #e53e3e; margin-bottom: 10px;">如果忘记密码导致系统无法使用，可以使用紧急重置功能</p>
			<button class="btn btn-danger" id="emergencyResetBtn">紧急重置系统</button>
		  </div>
		</div>
	  `;
	  
	  // 重新绑定安全设置相关事件（只保留安全相关事件）
	  this.attachSecurityEvents();
	}

	async renderAccountSettings() {
	  const accountTab = document.getElementById('accountTab');
	  if (!accountTab) return;

	  let user = (window.authGuard && typeof authGuard.getCurrentUser === 'function')
		? authGuard.getCurrentUser()
		: null;
	  if (!user && window.authGuard && typeof authGuard.checkAuth === 'function') {
		try {
		  user = await authGuard.checkAuth();
		  if (user && typeof authGuard.getCurrentUser === 'function') {
			authGuard.currentUser = user;
			this._kvCache.set('user_info', JSON.stringify(user));
		  }
		} catch (e) {
		  user = null;
		}
	  }
	  if (!user) {
		try {
		  const resp = await fetch('/api/auth/me', { credentials: 'include' });
		  if (resp.ok) {
			user = await resp.json();
			if (window.authGuard && typeof authGuard.getCurrentUser === 'function') {
			  authGuard.currentUser = user;
			  this._kvCache.set('user_info', JSON.stringify(user));
			}
		  }
		} catch (e) {
		  user = null;
		}
	  }
	  let isDesktop = !!(user && user.is_desktop);

	  if (!isDesktop && window.authGuard && typeof authGuard.isDesktopMode === 'function') {
		try {
		  isDesktop = await authGuard.isDesktopMode();
		} catch (e) {
		  isDesktop = false;
		}
	  }

	  const rawName = user && (user.account || user.username || user.name || user.phone || user.id);
	  const username = rawName ? String(rawName) : '未登录';

	  const expiryInfo = this.formatAccountExpiry(user ? user.expires_at : null);
	  const expiryText = isDesktop ? '' : (expiryInfo.expired
		? `<span style="color:#e53e3e;font-weight:600;">${this.escapeHtml(expiryInfo.text)}（已过期）</span>`
		: this.escapeHtml(expiryInfo.text));

	  accountTab.innerHTML = `
		<div class="account-section">
		  <h4>我的账户</h4>
		  <div class="account-info-grid">
			<div class="label">用户名</div>
			<div>${this.escapeHtml(isDesktop ? '离线版' : username)}</div>
			${isDesktop || !user ? '' : `
			<div class="label">到期时间</div>
			<div>${expiryText}</div>
			`}
		  </div>
		  ${isDesktop ? '' : `
		  <div class="account-renew">
			<div class="account-renew-title">自动续期</div>
			<div class="account-renew-form">
			  <input type="text" id="accountInviteCode" class="account-renew-input" placeholder="输入激活码">
			  <button class="btn btn-primary account-renew-btn" id="accountRedeemBtn">自动续期</button>
			</div>
			<div class="account-renew-hint">续期后有效期将立即叠加</div>
		  </div>
		  <div class="account-password">
			<div class="account-password-title">修改密码</div>
			<div class="account-password-form">
			  <input type="password" id="accountNewPassword" class="account-password-input" placeholder="输入新密码（至少6位）">
			  <button class="btn btn-primary account-password-btn" id="accountChangePasswordBtn">确认修改</button>
			</div>
			<div class="account-password-hint">建议使用字母+数字组合，至少6位</div>
		  </div>
		  `}
		  ${isDesktop ? `<div style="margin-top: 10px;"><span class="account-badge">离线版</span></div>` : ''}
		  <div class="account-actions">
			<button class="btn btn-secondary" id="accountLogoutBtn">退出</button>
		  </div>
		</div>
	  `;

	  this.attachAccountEvents();
	}

  attachAccountEvents() {
    const logoutBtn = document.getElementById('accountLogoutBtn');
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', async () => {
      if (window.authGuard && typeof authGuard.logout === 'function') {
        await authGuard.logout('/static/points-login.html');
        return;
      }
      try {
        localStorage.setItem('force_logout', '1');
        this.storageRemove('session_token', true);
        this.storageRemove('user_info', true);
      } finally {
        window.location.href = '/static/points-login.html?logout=1';
      }
    });

    const changeBtn = document.getElementById('accountChangePasswordBtn');
    const pwdInput = document.getElementById('accountNewPassword');
    if (changeBtn && pwdInput) {
      changeBtn.addEventListener('click', async () => {
        const newPassword = pwdInput.value.trim();
        if (!newPassword || newPassword.length < 6) {
          this.showNotification('密码至少6位', 'error');
          return;
        }
        changeBtn.disabled = true;
        try {
          const payload = JSON.stringify({ password: newPassword });
          let resp;
          if (window.authGuard && typeof authGuard.request === 'function') {
            resp = await authGuard.request('/api/auth/change-password', {
              method: 'POST',
              body: payload,
            });
          } else {
            const token = localStorage.getItem('session_token') || '';
            resp = await fetch('/api/auth/change-password', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              credentials: 'include',
              body: payload,
            });
          }
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || '修改失败');
          }
          alert('密码修改成功');
          pwdInput.value = '';
        } catch (error) {
          alert(`修改失败：${error.message}`);
        } finally {
          changeBtn.disabled = false;
        }
      });
    }

    const redeemBtn = document.getElementById('accountRedeemBtn');
    const inviteInput = document.getElementById('accountInviteCode');
    if (redeemBtn && inviteInput) {
      redeemBtn.addEventListener('click', async () => {
        const code = inviteInput.value.trim();
        if (!code) {
          alert('请输入激活码');
          return;
        }
        redeemBtn.disabled = true;
        try {
          const payload = JSON.stringify({ code });
          let resp;
          if (window.authGuard && typeof authGuard.request === 'function') {
            resp = await authGuard.request('/api/auth/redeem-invite', {
              method: 'POST',
              body: payload,
            });
          } else {
            const token = localStorage.getItem('session_token') || '';
            resp = await fetch('/api/auth/redeem-invite', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              credentials: 'include',
              body: payload,
            });
          }
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || '续期失败');
          }
          const data = await resp.json().catch(() => ({}));
          if (window.authGuard && authGuard.currentUser) {
            authGuard.currentUser.expires_at = data.expires_at || authGuard.currentUser.expires_at;
            if (data.vip_level) authGuard.currentUser.vip_level = data.vip_level;
          }
          alert('续期成功');
          inviteInput.value = '';
          await this.renderAccountSettings();
        } catch (error) {
          alert(`续期失败：${error.message}`);
        } finally {
          redeemBtn.disabled = false;
        }
      });
    }
  }

	// 修改 attachSecurityEvents 方法，只保留安全相关事件
	attachSecurityEvents() {
	  const savePasswordBtn = document.getElementById('savePasswordBtn');
	  const emergencyResetBtn = document.getElementById('emergencyResetBtn');
	  
	  if (savePasswordBtn) {
		savePasswordBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  this.savePassword();
		});
	  }
	  
	  if (emergencyResetBtn) {
		emergencyResetBtn.addEventListener('click', () => {
		  this.emergencyReset();
		});
	  }
	}

// 添加安全相关事件绑定方法
	attachSecurityEvents() {
	  const savePasswordBtn = document.getElementById('savePasswordBtn');
	  const emergencyResetBtn = document.getElementById('emergencyResetBtn');
	  const exportGlobalConfigBtn = document.getElementById('exportGlobalConfigBtn');
	  const importGlobalConfigBtn = document.getElementById('importGlobalConfigBtn');
	  const globalConfigInput = document.getElementById('globalConfigInput');
	  
	  if (savePasswordBtn) {
		savePasswordBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  this.savePassword();
		});
	  }
	  
	  if (emergencyResetBtn) {
		emergencyResetBtn.addEventListener('click', () => {
		  this.emergencyReset();
		});
	  }
	  
	  if (exportGlobalConfigBtn) {
		exportGlobalConfigBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  this.exportGlobalConfig();
		});
	  }
	  
	  if (importGlobalConfigBtn) {
		importGlobalConfigBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  globalConfigInput.click();
		});
	  }
	  
	  if (globalConfigInput) {
		globalConfigInput.addEventListener('change', (e) => {
		  if(this.isLocked) return;
		  const file = e.target.files[0];
		  if(file) this.importGlobalConfig(file);
		  e.target.value = '';
		});
	  }
	}
  
	// 修复 renderGroupRuleList 方法
	renderGroupRuleList(){
	  const list = document.getElementById('groupRuleList');
	  
	  // 根据当前配置范围选择目标数组
	  const targetArray = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
	  
	  if (targetArray.length === 0) {
		list.innerHTML = '<div style="text-align: center; padding: 20px; color: #718096;">暂无小组规则</div>';
		return;
	  }
	  
	  list.innerHTML = targetArray.map((r, i) => `
		<div class="rule-item">
		  <div class="editable-item rule-name" data-index="${i}" data-field="name">${r.name}</div>
		  <div class="editable-item rule-points" data-index="${i}" data-field="points">${r.points > 0 ? '+' : ''}${r.points}积分</div>
		  <button class="delete-btn" data-index="${i}">删除</button>
		</div>
	  `).join('');
	  
	  // 添加编辑事件监听
	  this.makeItemsEditable('.rule-name', 'name', targetArray);
	  this.makeItemsEditable('.rule-points', 'points', targetArray);
	  
	  // 删除按钮事件
	  const deleteButtons = list.querySelectorAll('.delete-btn');
	  deleteButtons.forEach(btn => {
		btn.addEventListener('click', (e) => {
		  const index = parseInt(e.target.getAttribute('data-index'));
		  this.removeGroupRule(index, targetArray);
		});
	  });
	}
  
  // 通用的可编辑项目方法
  makeItemsEditable(selector, field, dataArray) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(element => {
      element.addEventListener('click', (e) => {
        if(this.isLocked) return;
        const index = parseInt(e.target.getAttribute('data-index'));
        const currentValue = dataArray[index][field];
        
        const input = document.createElement('input');
        input.type = field === 'name' ? 'text' : 'number';
        input.value = currentValue;
        input.className = 'edit-input';
        
        e.target.innerHTML = '';
        e.target.appendChild(input);
        input.focus();
        
		const saveEdit = () => {
		  let newValue = input.value;
		  if (field === 'points' || field === 'cost' || field === 'stock') {
			newValue = field === 'stock' && newValue === '' ? null : parseInt(newValue);
			if (isNaN(newValue)) {
			  alert('请输入有效的数字！');
			  return;
			}
		  }
		  
		  dataArray[index][field] = newValue;
		  
		  // 保存配置 - 根据当前配置范围决定保存方式
		  if (this.currentConfigScope === 'global') {
			this.saveGlobalConfig();
			this.updateAllClassesWithGlobalConfig();
		  } else {
			this.saveAll();
		  }
		  
		  // 重新渲染对应的列表
		  if (dataArray === this.globalRules || dataArray === this.rules) {
			this.renderRuleList();
		  } else if (dataArray === this.globalShopItems || dataArray === this.shopItems) {
			this.renderShopList();
		  } else if (dataArray === this.globalGroupRules || dataArray === this.groupRules) {
			this.renderGroupRuleList();
		  }
		};
        
        input.addEventListener('blur', saveEdit);
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            saveEdit();
          }
        });
      });
    });
  }
  
	addRule(){
	  const nameInput = document.getElementById('newRuleName');
	  const pointsInput = document.getElementById('newRulePoints');
	  
	  const name = nameInput.value.trim();
	  const points = parseInt(pointsInput.value);
	  
	  if(!name){
		alert('请输入规则名称！');
		return;
	  }
	  
	  if(isNaN(points)){
		alert('请输入有效的积分值！');
		return;
	  }
	  
	  // 检查当前配置范围
	  const isGlobal = this.currentConfigScope === 'global';
	  const targetArray = isGlobal ? this.globalRules : this.rules;
	  
	  if(targetArray.find(r => r.name === name)){
		alert('规则已存在！');
		return;
	  }
	  
	  targetArray.push({name, points});
	  
	  // 保存配置
	  if (isGlobal) {
		this.saveGlobalConfig();
		this.updateAllClassesWithGlobalConfig();
	  } else {
		this.saveAll();
	  }
	  
	  nameInput.value = '';
	  pointsInput.value = '';
	  
	  this.renderRuleList();
	  
	  // === 新增：刷新所有规则显示 ===
	  this.refreshAllRulesDisplay();
	}
  
	removeRule(index, targetArray){
	  if(confirm(`确定删除规则 ${targetArray[index].name} 吗？`)){
		targetArray.splice(index, 1);
		
		// 保存配置
		if (this.currentConfigScope === 'global') {
		  this.saveGlobalConfig();
		  this.updateAllClassesWithGlobalConfig();
		} else {
		  this.saveAll();
		}
		
		this.renderRuleList();
		
		// === 新增：刷新所有规则显示 ===
		this.refreshAllRulesDisplay();
	  }
	}
  
	addShopItem(){
	  const nameInput = document.getElementById('newItemName');
	  const costInput = document.getElementById('newItemCost');
	  const stockInput = document.getElementById('newItemStock');
	  
	  const name = nameInput.value.trim();
	  const cost = parseInt(costInput.value);
	  const stock = stockInput.value ? parseInt(stockInput.value) : null;
	  
	  if(!name){
		alert('请输入商品名称！');
		return;
	  }
	  
	  if(isNaN(cost) || cost <= 0){
		alert('请输入有效的积分值！');
		return;
	  }
	  
	  if(stock !== null && (isNaN(stock) || stock < 0)){
		alert('请输入有效的库存数量！');
		return;
	  }
	  
	  // 检查当前配置范围
	  const isGlobal = this.currentConfigScope === 'global';
	  const targetArray = isGlobal ? this.globalShopItems : this.shopItems;
	  
	  if(targetArray.find(item => item.name === name)){
		alert('商品已存在！');
		return;
	  }
	  
	  targetArray.push({name, cost, stock});
	  
	  // 保存配置
	  if (isGlobal) {
		this.saveGlobalConfig();
		this.updateAllClassesWithGlobalConfig();
	  } else {
		this.saveAll();
	  }
	  
	  nameInput.value = '';
	  costInput.value = '';
	  stockInput.value = '';
	  
	  this.renderShopList();
	}
  
	removeShopItem(index, targetArray){
	  if(confirm(`确定删除商品 ${targetArray[index].name} 吗？`)){
		targetArray.splice(index, 1);
		
		// 保存配置
		if (this.currentConfigScope === 'global') {
		  this.saveGlobalConfig();
		  this.updateAllClassesWithGlobalConfig();
		} else {
		  this.saveAll();
		}
		
		this.renderShopList();
	  }
	}
  
	addGroupRule(){
	  const nameInput = document.getElementById('newGroupRuleName');
	  const pointsInput = document.getElementById('newGroupRulePoints');
	  
	  const name = nameInput.value.trim();
	  const points = parseInt(pointsInput.value);
	  
	  if(!name){
		alert('请输入规则名称！');
		return;
	  }
	  
	  if(isNaN(points)){
		alert('请输入有效的积分值！');
		return;
	  }
	  
	  // 检查当前配置范围
	  const isGlobal = this.currentConfigScope === 'global';
	  const targetArray = isGlobal ? this.globalGroupRules : this.groupRules;
	  
	  if(targetArray.find(r => r.name === name)){
		alert('规则已存在！');
		return;
	  }
	  
	  targetArray.push({name, points});
	  
	  // 保存配置
	  if (isGlobal) {
		this.saveGlobalConfig();
		this.updateAllClassesWithGlobalConfig();
	  } else {
		this.saveAll();
	  }
	  
	  nameInput.value = '';
	  pointsInput.value = '';
	  
	  this.renderGroupRuleList();
	  
	  // === 新增：刷新所有规则显示 ===
	  this.refreshAllRulesDisplay();
	}
  
	removeGroupRule(index, targetArray){
	  if(confirm(`确定删除规则 ${targetArray[index].name} 吗？`)){
		targetArray.splice(index, 1);
		
		// 保存配置
		if (this.currentConfigScope === 'global') {
		  this.saveGlobalConfig();
		  this.updateAllClassesWithGlobalConfig();
		} else {
		  this.saveAll();
		}
		
		this.renderGroupRuleList();
		
		// === 新增：刷新所有规则显示 ===
		this.refreshAllRulesDisplay();
	  }
	}
  
  // 新增：导出全局配置
	exportGlobalConfig() {
	  const globalData = {
		type: "global_config",
		exportTime: new Date().toLocaleString('zh-CN'),
		globalRules: this.globalRules,  // 使用全局规则，不是当前规则
		globalShopItems: this.globalShopItems,  // 使用全局商品，不是当前商品
		globalGroupRules: this.globalGroupRules  // 使用全局小组规则，不是当前小组规则
	  };
	  
	  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
	  const filename = `班级积分系统_全局配置备份_${timestamp}.json`;
	  
	  const content = JSON.stringify(globalData, null, 2);
  this.exportFile(filename, content, 'application/json');
	  
	  alert('全局配置导出成功！');
	}
  
  // 新增：导入全局配置
  importGlobalConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (data.type !== 'global_config') {
              alert('这不是有效的全局配置文件！');
              return;
            }
            
            if (confirm('确定要导入全局配置吗？这将覆盖现有的全局规则、商品和小组规则！')) {
              this.globalRules = data.globalRules || this.getDefaultRules();
              this.globalShopItems = data.globalShopItems || this.getDefaultShopItems();
              this.globalGroupRules = data.globalGroupRules || this.getDefaultGroupRules();
              
              this.saveGlobalConfig();
              this.updateAllClassesWithGlobalConfig();
              
              // 刷新当前显示
              if (this.currentConfigScope === 'global') {
                this.rules = this.globalRules;
                this.shopItems = this.globalShopItems;
                this.groupRules = this.globalGroupRules;
                this.renderRuleList();
                this.renderShopList();
                this.renderGroupRuleList();
              }
              
              alert('全局配置导入成功！');
            }
          } catch (err) {
            alert('配置文件格式错误！');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }
  
  // 新增：当全局配置改变时，更新所有使用全局配置的班级
  updateAllClassesWithGlobalConfig() {
    this.classes.forEach(cls => {
      const classData = this.storageGet(`classPointsData_${cls.id}`);
      if (classData) {
        const data = JSON.parse(classData);
        // 如果班级没有自定义配置，则更新为最新的全局配置
        if (!data.rules || data.rules.length === 0) {
          data.rules = this.globalRules;
        }
        if (!data.shopItems || data.shopItems.length === 0) {
          data.shopItems = this.globalShopItems;
        }
        if (!data.groupRules || data.groupRules.length === 0) {
          data.groupRules = this.globalGroupRules;
        }
        
        this.storageSet(`classPointsData_${cls.id}`, JSON.stringify(data));
      }
    });
  }
  
  // 统计功能
  openStatistics(){
    document.getElementById('statisticsModal').style.display='flex';
    this.generateTodayStatistics();
  }
  
  // 生成今日统计
  generateTodayStatistics(){
    const today = new Date();
    const todayStr = today.toLocaleDateString('zh-CN');
    
    const todayHistory = this.history.filter(record => {
      const recordDate = new Date(record.date.split(' ')[0]).toLocaleDateString('zh-CN');
      return recordDate === todayStr;
    });
    
    this.renderStatistics(todayHistory, 'todayStats', `今天(${todayStr})积分统计`);
  }
  
  generateYesterdayStatistics(){
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('zh-CN');
    
    const yesterdayHistory = this.history.filter(record => {
      const recordDate = new Date(record.date.split(' ')[0]).toLocaleDateString('zh-CN');
      return recordDate === yesterdayStr;
    });
    
    this.renderStatistics(yesterdayHistory, 'yesterdayStats', `昨天(${yesterdayStr})积分统计`);
  }
  
  generateLastWeekStatistics(){
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    const lastWeekHistory = this.history.filter(record => {
      const recordDate = new Date(record.date.split(' ')[0]);
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    this.renderStatistics(lastWeekHistory, 'lastWeekStats', 
      `上周(${startDate.toLocaleDateString('zh-CN')} - ${endDate.toLocaleDateString('zh-CN')})积分统计`);
  }
  
  generateLastMonthStatistics(){
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);
    
    const lastMonthHistory = this.history.filter(record => {
      const recordDate = new Date(record.date.split(' ')[0]);
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    this.renderStatistics(lastMonthHistory, 'lastMonthStats', 
      `上月(${startDate.toLocaleDateString('zh-CN')} - ${endDate.toLocaleDateString('zh-CN')})积分统计`);
  }
  
  generateCustomStatistics(){
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    
    if(isNaN(startDate.getTime()) || isNaN(endDate.getTime())){
      alert('请选择有效的日期范围！');
      return;
    }
    
    const customHistory = this.history.filter(record => {
      const recordDate = new Date(record.date.split(' ')[0]);
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    this.renderStatistics(customHistory, 'customStats', 
      `自定义时间段(${startDate.toLocaleDateString('zh-CN')} - ${endDate.toLocaleDateString('zh-CN')})积分统计`);
  }
  
  renderStatistics(history, containerId, title){
    const container = document.getElementById(containerId);
    container.innerHTML = '<div class="loading-spinner">加载统计数据中...</div>';
    
    // 使用requestAnimationFrame优化渲染性能
    requestAnimationFrame(() => {
      // 使用Map优化性能，按学生/小组统计
      const studentStats = new Map();
      const groupStats = new Map();
      let totalPoints = 0;
      let totalRecords = history.length;
      
      history.forEach(record => {
        if(record.type === 'student') {
          if(!studentStats.has(record.name)) {
            studentStats.set(record.name, { points: 0, records: [] });
          }
          const stats = studentStats.get(record.name);
          stats.points += record.points;
          stats.records.push(record);
          totalPoints += record.points;
        } else if(record.type === 'group') {
          if(!groupStats.has(record.group)) {
            groupStats.set(record.group, { points: 0, records: [] });
          }
          const stats = groupStats.get(record.group);
          stats.points += record.points;
          stats.records.push(record);
          totalPoints += record.points;
        } else if(record.type === 'purchase') {
          // 购买记录不计入总积分变化
          if(!studentStats.has(record.name)) {
            studentStats.set(record.name, { points: 0, records: [] });
          }
          const stats = studentStats.get(record.name);
          stats.points -= record.cost;
          stats.records.push(record);
          totalPoints -= record.cost;
        }
      });
      
      // 统计概览卡片数据
      const studentCount = studentStats.size;
      const groupCount = groupStats.size;
      const avgPointsPerStudent = studentCount > 0 ? Math.round(totalPoints / studentCount) : 0;
      const avgRecordsPerStudent = studentCount > 0 ? Math.round(totalRecords / studentCount) : 0;
      
      let html = `
        <div class="statistics-overview">
          <div class="statistics-card">
            <div class="card-value">${totalPoints > 0 ? '+' : ''}${totalPoints}</div>
            <div class="card-label">总积分变化</div>
          </div>
          <div class="statistics-card">
            <div class="card-value">${totalRecords}</div>
            <div class="card-label">记录总数</div>
          </div>
          <div class="statistics-card">
            <div class="card-value">${studentCount}</div>
            <div class="card-label">涉及学生</div>
          </div>
          <div class="statistics-card">
            <div class="card-value">${groupCount}</div>
            <div class="card-label">涉及小组</div>
          </div>
        </div>
        <div class="statistics-summary">
          <h4>${title}</h4>
          <p>平均每人积分: ${avgPointsPerStudent > 0 ? '+' : ''}${avgPointsPerStudent}</p>
          <p>平均每人记录: ${avgRecordsPerStudent}</p>
        </div>
      `;
      
      // 存储统计信息用于后续排序和详情展示
      this.currentStatistics = {
        studentStats: Array.from(studentStats.entries()).map(([name, stats]) => ({ name, ...stats })),
        groupStats: Array.from(groupStats.entries()).map(([group, stats]) => ({ group, ...stats })),
        containerId: containerId
      };
      
      // 渲染个人积分统计表格（带排序功能）
      if(studentStats.size > 0) {
        html += `
          <h4>个人积分统计</h4>
          <div class="statistics-table-container">
            <table class="statistics-table" data-type="student" data-sort="points" data-sort-direction="desc">
              <thead>
                <tr>
                  <th data-sort="name">姓名 <span class="sort-indicator">↕</span></th>
                  <th data-sort="points">积分变化 <span class="sort-indicator">↓</span></th>
                  <th data-sort="records">记录数 <span class="sort-indicator">↕</span></th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${this.currentStatistics.studentStats.sort((a, b) => b.points - a.points).map(stat => `
                  <tr data-name="${stat.name}">
                    <td>${stat.name}</td>
                    <td>${stat.points > 0 ? '+' : ''}${stat.points}</td>
                    <td>${stat.records.length}</td>
                    <td><button class="btn btn-sm btn-info view-detail-btn" data-type="student" data-target="${stat.name}">查看详情</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
      
      // 渲染小组积分统计表格（带排序功能）
      if(groupStats.size > 0) {
        html += `
          <h4>小组积分统计</h4>
          <div class="statistics-table-container">
            <table class="statistics-table" data-type="group" data-sort="points" data-sort-direction="desc">
              <thead>
                <tr>
                  <th data-sort="group">小组 <span class="sort-indicator">↕</span></th>
                  <th data-sort="points">积分变化 <span class="sort-indicator">↓</span></th>
                  <th data-sort="records">记录数 <span class="sort-indicator">↕</span></th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${this.currentStatistics.groupStats.sort((a, b) => b.points - a.points).map(stat => `
                  <tr data-group="${stat.group}">
                    <td>${stat.group}</td>
                    <td>${stat.points > 0 ? '+' : ''}${stat.points}</td>
                    <td>${stat.records.length}</td>
                    <td><button class="btn btn-sm btn-info view-detail-btn" data-type="group" data-target="${stat.group}">查看详情</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
      
      if(studentStats.size === 0 && groupStats.size === 0) {
        html += '<p style="text-align: center; padding: 40px; color: #718096;">该时间段内无积分记录</p>';
      }
      
      container.innerHTML = html;
      
      // 初始化表格交互功能
      this.initStatisticsTableInteraction(container);
    });
  }
  
  initStatisticsTableInteraction(container) {
    // 表格排序功能
    const tables = container.querySelectorAll('.statistics-table');
    tables.forEach(table => {
      const headers = table.querySelectorAll('th[data-sort]');
      headers.forEach(header => {
        header.style.cursor = 'pointer';
        header.onclick = () => {
          const sortBy = header.getAttribute('data-sort');
          const type = table.getAttribute('data-type');
          this.handleTableSort(sortBy, type, table);
        };
      });
    });
    
    // 详情查看功能
    const detailBtns = container.querySelectorAll('.view-detail-btn');
    detailBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.getAttribute('data-type');
        const target = btn.getAttribute('data-target');
        this.showStatisticsDetail(type, target);
      });
    });
    
    // 行点击事件（查看详情）
    const rows = container.querySelectorAll('.statistics-table tbody tr');
    rows.forEach(row => {
      row.addEventListener('click', (e) => {
        if (!e.target.closest('.view-detail-btn')) {
          const type = row.closest('table').getAttribute('data-type');
          const target = type === 'student' ? row.getAttribute('data-name') : row.getAttribute('data-group');
          this.showStatisticsDetail(type, target);
        }
      });
    });
  }
  
  handleTableSort(sortBy, type, table) {
    const stats = type === 'student' ? this.currentStatistics.studentStats : this.currentStatistics.groupStats;
    const tbody = table.querySelector('tbody');
    
    // 切换排序方向
    const currentSort = table.getAttribute('data-sort');
    const currentDirection = table.getAttribute('data-sort-direction') || 'asc';
    const newDirection = currentSort === sortBy && currentDirection === 'asc' ? 'desc' : 'asc';
    
    // 更新排序状态
    table.setAttribute('data-sort', sortBy);
    table.setAttribute('data-sort-direction', newDirection);
    
    // 更新表头指示器
    const headers = table.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
      const indicator = header.querySelector('.sort-indicator');
      // 移除所有样式类
      indicator.classList.remove('asc', 'desc');
      
      if (header.getAttribute('data-sort') === sortBy) {
        // 当前排序列添加对应样式类
        indicator.classList.add(newDirection === 'asc' ? 'asc' : 'desc');
        indicator.textContent = newDirection === 'asc' ? '↑' : '↓';
      } else {
        // 非当前排序列显示默认指示器
        indicator.textContent = '↕';
      }
    });
    
    // 排序数据
    const sortedStats = [...stats].sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];
      
      if (sortBy === 'records') {
        aValue = a.records ? a.records.length : 0;
        bValue = b.records ? b.records.length : 0;
      }

      if (sortBy === 'name') {
        // 按姓氏首字母排序（支持中文拼音排序）
        const getSurnamePinyin = (name) => {
          // 处理中文姓名：取第一个字符作为姓氏，并转换为拼音
          if (/[\u4e00-\u9fff]/.test(name)) {
            const surname = name.charAt(0);
            // 简单的拼音映射表（常用姓氏）
            const pinyinMap = {
              '赵': 'zhao', '钱': 'qian', '孙': 'sun', '李': 'li', '周': 'zhou',
              '吴': 'wu', '郑': 'zheng', '王': 'wang', '冯': 'feng', '陈': 'chen',
              '褚': 'chu', '卫': 'wei', '蒋': 'jiang', '沈': 'shen', '韩': 'han',
              '杨': 'yang', '朱': 'zhu', '秦': 'qin', '尤': 'you', '许': 'xu',
              '何': 'he', '吕': 'lv', '施': 'shi', '张': 'zhang', '孔': 'kong',
              '曹': 'cao', '严': 'yan', '华': 'hua', '金': 'jin', '魏': 'wei',
              '陶': 'tao', '姜': 'jiang', '戚': 'qi', '谢': 'xie', '邹': 'zou',
              '喻': 'yu', '柏': 'bai', '水': 'shui', '窦': 'dou', '章': 'zhang',
              '云': 'yun', '苏': 'su', '潘': 'pan', '葛': 'ge', '奚': 'xi',
              '范': 'fan', '彭': 'peng', '郎': 'lang', '鲁': 'lu', '韦': 'wei',
              '昌': 'chang', '马': 'ma', '苗': 'miao', '凤': 'feng', '花': 'hua',
              '方': 'fang', '俞': 'yu', '任': 'ren', '袁': 'yuan', '柳': 'liu',
              '唐': 'tang', '罗': 'luo', '薛': 'xue', '贺': 'he', '常': 'chang',
              '黄': 'huang', '萧': 'xiao', '姚': 'yao', '邵': 'shao', '汪': 'wang',
              '毛': 'mao', '狄': 'di', '米': 'mi', '贝': 'bei', '明': 'ming',
              '计': 'ji', '伏': 'fu', '成': 'cheng', '戴': 'dai', '谈': 'tan',
              '宋': 'song', '茅': 'mao', '庞': 'pang', '熊': 'xiong', '纪': 'ji',
              '舒': 'shu', '屈': 'qu', '项': 'xiang', '祝': 'zhu', '董': 'dong',
              '梁': 'liang', '杜': 'du', '阮': 'ruan', '蓝': 'lan', '闵': 'min',
              '席': 'xi', '季': 'ji', '麻': 'ma', '强': 'qiang', '贾': 'jia',
              '路': 'lu', '娄': 'lou', '危': 'wei', '江': 'jiang', '童': 'tong',
              '颜': 'yan', '郭': 'guo', '梅': 'mei', '盛': 'sheng', '林': 'lin',
              '刁': 'diao', '钟': 'zhong', '徐': 'xu', '邱': 'qiu', '骆': 'luo',
              '高': 'gao', '夏': 'xia', '蔡': 'cai', '田': 'tian', '樊': 'fan',
              '胡': 'hu', '凌': 'ling', '霍': 'huo', '虞': 'yu', '万': 'wan',
              '支': 'zhi', '柯': 'ke', '昝': 'zan', '管': 'guan', '卢': 'lu',
              '莫': 'mo', '经': 'jing', '房': 'fang', '裘': 'qiu', '缪': 'miao',
              '干': 'gan', '解': 'xie', '应': 'ying', '宗': 'zong', '丁': 'ding',
              '宣': 'xuan', '贲': 'ben', '邓': 'deng', '郁': 'yu', '单': 'shan',
              '杭': 'hang', '洪': 'hong', '包': 'bao', '诸': 'zhu', '左': 'zuo',
              '石': 'shi', '崔': 'cui', '吉': 'ji', '钮': 'niu', '龚': 'gong',
              '程': 'cheng', '嵇': 'ji', '邢': 'xing', '滑': 'hua', '裴': 'pei',
              '陆': 'lu', '荣': 'rong', '翁': 'weng', '荀': 'xun', '羊': 'yang',
              '於': 'yu', '惠': 'hui', '甄': 'zhen', '曲': 'qu', '家': 'jia',
              '封': 'feng', '芮': 'rui', '羿': 'yi', '储': 'chu', '靳': 'jin',
              '汲': 'ji', '邴': 'bing', '糜': 'mi', '松': 'song', '井': 'jing',
              '段': 'duan', '富': 'fu', '巫': 'wu', '乌': 'wu', '焦': 'jiao',
              '巴': 'ba', '弓': 'gong', '牧': 'mu', '隗': 'wei', '山': 'shan',
              '谷': 'gu', '车': 'che', '侯': 'hou', '宓': 'mi', '蓬': 'peng',
              '全': 'quan', '郗': 'xi', '班': 'ban', '仰': 'yang', '秋': 'qiu',
              '仲': 'zhong', '伊': 'yi', '宫': 'gong', '宁': 'ning', '仇': 'qiu',
              '栾': 'luan', '暴': 'bao', '甘': 'gan', '钭': 'tou', '厉': 'li',
              '戎': 'rong', '祖': 'zu', '武': 'wu', '符': 'fu', '刘': 'liu',
              '景': 'jing', '詹': 'zhan', '束': 'shu', '龙': 'long', '叶': 'ye',
              '幸': 'xing', '司': 'si', '韶': 'shao', '郜': 'gao', '黎': 'li',
              '蓟': 'ji', '薄': 'bo', '印': 'yin', '宿': 'su', '白': 'bai',
              '怀': 'huai', '蒲': 'pu', '邰': 'tai', '从': 'cong', '鄂': 'e',
              '索': 'suo', '咸': 'xian', '籍': 'ji', '赖': 'lai', '卓': 'zhuo',
              '蔺': 'lin', '屠': 'tu', '蒙': 'meng', '池': 'chi', '乔': 'qiao',
              '阴': 'yin', '鬱': 'yu', '胥': 'xu', '能': 'neng', '苍': 'cang',
              '双': 'shuang', '闻': 'wen', '莘': 'shen', '党': 'dang', '翟': 'zhai',
              '谭': 'tan', '贡': 'gong', '劳': 'lao', '逄': 'pang', '姬': 'ji',
              '申': 'shen', '扶': 'fu', '堵': 'du', '冉': 'ran', '宰': 'zai',
              '郦': 'li', '雍': 'yong', '郤': 'xi', '璩': 'qu', '桑': 'sang',
              '桂': 'gui', '濮': 'pu', '牛': 'niu', '寿': 'shou', '通': 'tong',
              '边': 'bian', '扈': 'hu', '燕': 'yan', '冀': 'ji', '郏': 'jia',
              '浦': 'pu', '尚': 'shang', '农': 'nong', '温': 'wen', '别': 'bie',
              '庄': 'zhuang', '晏': 'yan', '柴': 'chai', '瞿': 'qu', '阎': 'yan',
              '充': 'chong', '慕': 'mu', '连': 'lian', '茹': 'ru', '习': 'xi',
              '宦': 'huan', '艾': 'ai', '鱼': 'yu', '容': 'rong', '向': 'xiang',
              '古': 'gu', '易': 'yi', '慎': 'shen', '戈': 'ge', '廖': 'liao',
              '庾': 'yu', '终': 'zhong', '暨': 'ji', '居': 'ju', '衡': 'heng',
              '步': 'bu', '都': 'du', '耿': 'geng', '满': 'man', '弘': 'hong',
              '匡': 'kuang', '国': 'guo', '文': 'wen', '寇': 'kou', '广': 'guang',
              '禄': 'lu', '阙': 'que', '东': 'dong', '欧': 'ou', '殳': 'shu',
              '沃': 'wo', '利': 'li', '蔚': 'wei', '越': 'yue', '夔': 'kui',
              '隆': 'long', '师': 'shi', '巩': 'gong', '厍': 'she', '聂': 'nie',
              '晁': 'chao', '勾': 'gou', '敖': 'ao', '融': 'rong', '冷': 'leng',
              '訾': 'zi', '辛': 'xin', '阚': 'kan', '那': 'na', '简': 'jian',
              '饶': 'rao', '空': 'kong', '曾': 'zeng', '毋': 'wu', '沙': 'sha',
              '乜': 'nie', '养': 'yang', '鞠': 'ju', '须': 'xu', '丰': 'feng',
              '关': 'guan', '蒯': 'kuai', '相': 'xiang', '查': 'zha', '后': 'hou',
              '荆': 'jing', '红': 'hong', '游': 'you', '竺': 'zhu', '权': 'quan',
              '逯': 'lu', '盖': 'ge', '益': 'yi', '桓': 'huan', '公': 'gong',
              '万俟': 'moqi', '司马': 'sima', '上官': 'shangguan', '欧阳': 'ouyang',
              '夏侯': 'xiahou', '诸葛': 'zhuge', '闻人': 'wenren', '东方': 'dongfang',
              '赫连': 'helian', '皇甫': 'huangfu', '尉迟': 'yuchi', '公羊': 'gongyang',
              '澹台': 'tantai', '公冶': 'gongye', '宗政': 'zongzheng', '濮阳': 'puyang',
              '淳于': 'chunyu', '单于': 'chanyu', '太叔': 'taishu', '申屠': 'shentu',
              '公孙': 'gongsun', '仲孙': 'zhongsun', '轩辕': 'xuanyuan', '令狐': 'linghu',
              '钟离': 'zhongli', '宇文': 'yuwen', '长孙': 'zhangsun', '慕容': 'murong',
              '司徒': 'situ', '司空': 'sikong', '亓官': 'qiguan', '司寇': 'sikou',
              '仉': 'zhang', '督': 'du', '子车': 'ziju', '颛孙': 'zhuansun',
              '端木': 'duanmu', '巫马': 'wuma', '公西': 'gongxi', '漆雕': 'qidiao',
              '乐正': 'yuezheng', '壤驷': 'rangsi', '公良': 'gongliang', '拓跋': 'tuoba',
              '夹谷': 'jiagu', '宰父': 'zaifu', '谷梁': 'guliang', '晋': 'jin',
              '楚': 'chu', '闫': 'yan', '法': 'fa', '汝': 'ru', '鄢': 'yan',
              '涂': 'tu', '钦': 'qin', '段干': 'duangan', '百里': 'baili',
              '东郭': 'dongguo', '南门': 'nanmen', '呼延': 'huyan', '归': 'gui',
              '海': 'hai', '羊舌': 'yangshe', '微生': 'weisheng', '岳': 'yue',
              '帅': 'shuai', '缑': 'gou', '亢': 'kang', '况': 'kuang', '后': 'hou',
              '有': 'you', '琴': 'qin', '梁丘': 'liangqiu', '左丘': 'zuoqiu',
              '东门': 'dongmen', '西门': 'ximen', '商': 'shang', '牟': 'mou',
              '佘': 'she', '佴': 'nai', '伯': 'bo', '赏': 'shang', '南宫': 'nangong',
              '墨': 'mo', '哈': 'ha', '谯': 'qiao', '笪': 'da', '年': 'nian',
              '爱': 'ai', '阳': 'yang', '佟': 'tong', '第五': 'diwu', '言': 'yan',
              '福': 'fu'
            };
            return pinyinMap[surname] || surname;
          }
          // 处理英文姓名：取第一个单词作为姓氏
          return name.split(' ')[0].toLowerCase();
        };
        
        const aSurnamePinyin = getSurnamePinyin(aValue);
        const bSurnamePinyin = getSurnamePinyin(bValue);
        
        // 按姓氏拼音排序
        if (aSurnamePinyin < bSurnamePinyin) return newDirection === 'asc' ? -1 : 1;
        if (aSurnamePinyin > bSurnamePinyin) return newDirection === 'asc' ? 1 : -1;
        
        // 如果姓氏相同，按完整姓名排序
        if (aValue < bValue) return newDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return newDirection === 'asc' ? 1 : -1;
        return 0;
      } else if (sortBy === 'group') {
        // 小组名称排序
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
        
        if (aValue < bValue) return newDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return newDirection === 'asc' ? 1 : -1;
        return 0;
      } else {
        // 数字字段排序（积分、记录数）
        if (aValue < bValue) return newDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return newDirection === 'asc' ? 1 : -1;
        return 0;
      }
    });
    
    // 重新渲染表格
    const rowsHtml = sortedStats.map(stat => {
      if (type === 'student') {
        return `
          <tr data-name="${stat.name}">
            <td>${stat.name}</td>
            <td>${stat.points > 0 ? '+' : ''}${stat.points}</td>
            <td>${stat.records.length}</td>
            <td><button class="btn btn-sm btn-info view-detail-btn" data-type="student" data-target="${stat.name}">查看详情</button></td>
          </tr>
        `;
      } else {
        return `
          <tr data-group="${stat.group}">
            <td>${stat.group}</td>
            <td>${stat.points > 0 ? '+' : ''}${stat.points}</td>
            <td>${stat.records.length}</td>
            <td><button class="btn btn-sm btn-info view-detail-btn" data-type="group" data-target="${stat.group}">查看详情</button></td>
          </tr>
        `;
      }
    }).join('');
    
    tbody.innerHTML = rowsHtml;
    
    // 重新绑定事件
    this.initStatisticsTableInteraction(document.getElementById(this.currentStatistics.containerId));
  }
  
  showStatisticsDetail(type, target) {
    // 独立获取学生/小组的完整积分记录，不受统计页面时间筛选条件影响
    
    // 根据类型调用不同的API获取完整数据
    if (type === 'student') {
      // 先获取班级列表，找到当前班级对应的数字ID
      fetch('/api/points/classes')
        .then(response => response.json())
        .then(classes => {
          // 查找当前班级对应的数字ID
          const currentClass = classes.find(c => c.class_name === this.currentClassName);
          if (!currentClass) {
            console.error('Current class not found in backend:', this.currentClassName);
            this.showStatisticsDetailFallback(type, target);
            return;
          }
          
          const numericClassId = currentClass.id;
          
          // 获取学生列表，找到对应学生的ID
          fetch(`/api/points/classes/${numericClassId}/students`)
            .then(response => response.json())
            .then(students => {
              // 查找目标学生
              const targetStudent = students.find(s => s.name === target);
              if (!targetStudent) {
                console.error('Student not found:', target);
                this.showStatisticsDetailFallback(type, target);
                return;
              }
              
              // 存储当前详情信息，用于时间筛选
              this.currentDetail = {
                type: type,
                target: target,
                studentId: targetStudent.id,
                className: this.currentClassName,
                classId: numericClassId
              };
              
              // 获取学生完整积分记录（不受统计页面筛选影响）
              this.loadDetailRecords();
            })
            .catch(error => {
              console.error('Error loading students list:', error);
              this.showStatisticsDetailFallback(type, target);
            });
        })
        .catch(error => {
          console.error('Error loading classes list:', error);
          this.showStatisticsDetailFallback(type, target);
        });
    } else {
      // 获取小组完整积分记录（暂时使用回退方法，因为小组历史记录API可能不存在）
      console.log('Group history API not available, using fallback');
      this.showStatisticsDetailFallback(type, target);
    }
  }
  
  // 加载详情页面的记录数据
  loadDetailRecords() {
    if (!this.currentDetail) return;
    
    const { studentId } = this.currentDetail;
    
    // 构建查询参数
    const url = `/api/points/students/${studentId}/records`;
    
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch student records');
        }
        return response.json();
      })
      .then(records => {
        // 转换后端数据格式为前端期望的格式
        const formattedRecords = records.map(record => ({
          ...record,
          date: record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
          rule: record.reason || record.rule || '-',
          item: record.item || '-'
        }));
        
        // 构建完整的统计信息
        const targetStat = {
          name: this.currentDetail.target,
          points: formattedRecords.reduce((sum, record) => sum + (record.points || 0), 0),
          records: formattedRecords
        };
        
        // 创建或更新详情模态框
        if (!document.getElementById('statisticsDetailModal')) {
          this.createStatisticsDetailModal(targetStat, this.currentDetail.type);
        } else {
          this.updateDetailModal(targetStat);
        }
        
        // 更新统计概览卡片
        this.updateStatisticsOverview(targetStat);
      })
      .catch(error => {
        console.error('Error fetching student records:', error);
        this.showStatisticsDetailFallback(this.currentDetail.type, this.currentDetail.target);
      });
  }
  
  // 根据时间段筛选记录
  filterRecordsByPeriod(records, period) {
    const today = new Date();
    
    switch(period) {
      case 'today':
        const todayStr = today.toISOString().split('T')[0];
        return records.filter(record => {
          const recordDate = record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0];
          return recordDate === todayStr;
        });
        
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        return records.filter(record => {
          const recordDate = record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0];
          return recordDate === yesterdayStr;
        });
        
      case 'thisWeek':
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        return records.filter(record => {
          const recordDate = new Date(record.created_at || new Date());
          return recordDate >= startOfWeek && recordDate <= endOfWeek;
        });
        
      case 'lastWeek':
        const startOfLastWeek = new Date(today);
        startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
        const endOfLastWeek = new Date(startOfLastWeek);
        endOfLastWeek.setDate(startOfLastWeek.getDate() + 6);
        return records.filter(record => {
          const recordDate = new Date(record.created_at || new Date());
          return recordDate >= startOfLastWeek && recordDate <= endOfLastWeek;
        });
        
      case 'thisMonth':
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return records.filter(record => {
          const recordDate = new Date(record.created_at || new Date());
          return recordDate >= startOfMonth && recordDate <= endOfMonth;
        });
        
      case 'lastMonth':
        const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
        return records.filter(record => {
          const recordDate = new Date(record.created_at || new Date());
          return recordDate >= startOfLastMonth && recordDate <= endOfLastMonth;
        });
        
      default:
        return records;
    }
  }
  
  // 回退方法：使用当前统计数据（保持原有逻辑作为备选）
  showStatisticsDetailFallback(type, target) {
    console.log('Using fallback method for statistics detail');
    
    // 查找包含统计数据的容器（todayStats, yesterdayStats等）
    const container = document.getElementById(this.currentStatistics.containerId);
    if (!container) {
      console.error('Statistics container not found');
      return;
    }
    
    // 获取统计数据
    const stats = type === 'student' ? this.currentStatistics.studentStats : this.currentStatistics.groupStats;
    const targetStat = stats.find(stat => (type === 'student' ? stat.name === target : stat.group === target));
    
    if (!targetStat) {
      console.error('Statistics data not found for:', target);
      return;
    }
    
    this.createStatisticsDetailModal(targetStat, type);
  }
  
  createStatisticsDetailModal(stat, type) {
    // 计算统计信息
    const totalPoints = stat.points;
    const totalRecords = stat.records.length;
    const positiveRecords = stat.records.filter(r => r.points > 0).length;
    const negativeRecords = stat.records.filter(r => r.points < 0 || r.type === 'purchase').length;
    const avgPointsPerRecord = totalRecords > 0 ? Math.round(totalPoints / totalRecords) : 0;
    
    // 创建详情模态框HTML
    const modalHtml = `
      <div id="statisticsDetailModal" class="modal" style="display: flex;">
        <div class="modal-content statistics-detail-modal" style="max-width: 900px;">
          <div class="modal-header">
            <h3>📊 ${type === 'student' ? '学生' : '小组'}积分详情 - ${type === 'student' ? stat.name : stat.group}</h3>
            <button class="close-btn" onclick="app.closeStatisticsDetail()">&times;</button>
          </div>
          <div class="modal-body">
            <!-- 统计概览卡片 -->
            <div class="statistics-overview">
              <div class="statistics-card">
                <div class="card-value">${totalPoints > 0 ? '+' : ''}${totalPoints}</div>
                <div class="card-label">总积分变化</div>
              </div>
              <div class="statistics-card">
                <div class="card-value">${totalRecords}</div>
                <div class="card-label">记录总数</div>
              </div>
              <div class="statistics-card">
                <div class="card-value">${positiveRecords}</div>
                <div class="card-label">加分记录</div>
              </div>
              <div class="statistics-card">
                <div class="card-value">${negativeRecords}</div>
                <div class="card-label">减分记录</div>
              </div>
            </div>
            
            <!-- 积分记录详情区域 -->
            <div class="detail-records">
              <div class="records-header">
                <h4>📋 积分记录详情</h4>
                <div class="records-filter">
                  <button class="filter-btn active" data-filter="all">全部</button>
                  <button class="filter-btn" data-filter="positive">加分</button>
                  <button class="filter-btn" data-filter="negative">扣分</button>
                </div>
              </div>
              
              <div class="records-table-container">
                <table class="detail-table">
                  <thead>
                    <tr>
                      <th>📅 日期</th>
                      <th>📝 类型</th>
                      <th>🏷️ 规则/商品</th>
                      <th>💰 积分变化</th>
                    </tr>
                  </thead>
                  <tbody id="detailRecordsBody">
                    ${stat.records.map(record => {
                      // 确定操作类型：加分、扣分、兑换
                      let operationType = 'exchange';
                      if (record.type === 'purchase') {
                        operationType = 'exchange';
                      } else if (record.points > 0) {
                        operationType = 'add';
                      } else if (record.points < 0) {
                        operationType = 'deduct';
                      }
                      
                      return `
                        <tr class="record-${record.type} operation-${operationType}" data-type="${record.type}" data-operation="${operationType}" data-date="${record.date}">
                          <td>${record.date}</td>
                          <td>${operationType === 'add' ? '加分' : operationType === 'deduct' ? '扣分' : '兑换'}</td>
                          <td>${record.rule || record.item || '-'}</td>
                          <td class="${operationType === 'add' ? 'positive' : operationType === 'deduct' ? 'negative' : 'exchange'}">
                            ${record.type === 'purchase' ? '-' : ''}${record.points > 0 ? '+' : ''}${record.points || record.cost}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
    
    // 移除已存在的详情模态框
    const existingModal = document.getElementById('statisticsDetailModal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // 添加新的详情模态框到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 显示模态框
    const modal = document.getElementById('statisticsDetailModal');
    modal.style.display = 'flex';
    
    // 绑定关闭事件
    modal.querySelector('.close-btn').onclick = () => this.closeStatisticsDetail();
    
    // 初始化筛选功能
    this.initStatisticsDetailFilter();
  }
  
  initStatisticsDetailFilter() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    if (!filterBtns.length) return;
    
    filterBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        // 移除所有按钮的active类
        filterBtns.forEach(b => b.classList.remove('active'));
        // 为当前按钮添加active类
        this.classList.add('active');
        
        const filter = this.dataset.filter;
        const rows = document.querySelectorAll('#detailRecordsBody tr');
        
        // 性能优化：直接操作CSS类，避免DOM重排
        rows.forEach(row => {
          const operationType = row.dataset.operation;
          
          let show = false;
          
          switch(filter) {
            case 'all':
              show = true;
              break;
            case 'positive':
              // 显示所有加分类型的记录
              show = operationType === 'add';
              break;
            case 'negative':
              // 显示所有扣分类型的记录
              show = operationType === 'deduct';
              break;
          }
          
          // 使用CSS类控制显示/隐藏，避免重排
          if (show) {
            row.classList.remove('hidden');
          } else {
            row.classList.add('hidden');
          }
        });
      });
    });
  }
  
  // 更新详情模态框内容
  updateDetailModal(stat) {
    const modal = document.getElementById('statisticsDetailModal');
    if (!modal) return;
    
    // 更新统计概览卡片
    const totalPoints = stat.points;
    const totalRecords = stat.records.length;
    const positiveRecords = stat.records.filter(r => r.points > 0).length;
    const negativeRecords = stat.records.filter(r => r.points < 0 || r.type === 'purchase').length;
    
    const statisticsCards = modal.querySelectorAll('.statistics-card');
    if (statisticsCards.length >= 4) {
      statisticsCards[0].querySelector('.card-value').textContent = totalPoints > 0 ? '+' + totalPoints : totalPoints;
      statisticsCards[1].querySelector('.card-value').textContent = totalRecords;
      statisticsCards[2].querySelector('.card-value').textContent = positiveRecords;
      statisticsCards[3].querySelector('.card-value').textContent = negativeRecords;
    }
    
    // 更新积分记录表格
    const tbody = modal.querySelector('#detailRecordsBody');
    if (tbody) {
      const rowsHtml = stat.records.map(record => {
        // 确定操作类型：加分、扣分、兑换
        let operationType = 'exchange';
        if (record.type === 'purchase') {
          operationType = 'exchange';
        } else if (record.points > 0) {
          operationType = 'add';
        } else if (record.points < 0) {
          operationType = 'deduct';
        }
        
        return `
          <tr class="record-${record.type} operation-${operationType}" data-type="${record.type}" data-operation="${operationType}" data-date="${record.date}">
            <td>${record.date}</td>
            <td>${operationType === 'add' ? '加分' : operationType === 'deduct' ? '扣分' : '兑换'}</td>
            <td>${record.rule || record.item || '-'}</td>
            <td class="${operationType === 'add' ? 'positive' : operationType === 'deduct' ? 'negative' : 'exchange'}">
              ${record.type === 'purchase' ? '-' : ''}${record.points > 0 ? '+' : ''}${record.points || record.cost}
            </td>
          </tr>
        `;
      }).join('');
      
      tbody.innerHTML = rowsHtml;
    }
  }
  
  // 更新统计概览卡片
  updateStatisticsOverview() {
    const visibleRows = document.querySelectorAll('#detailRecordsBody tr:not(.hidden)');
    
    let totalPoints = 0;
    let totalRecords = visibleRows.length;
    let positiveRecords = 0;
    let negativeRecords = 0;
    
    visibleRows.forEach(row => {
      const pointsText = row.querySelector('td:nth-child(4)').textContent;
      const points = parseInt(pointsText.replace(/[+-]/g, '')) || 0;
      
      if (pointsText.includes('+')) {
        totalPoints += points;
        positiveRecords++;
      } else if (pointsText.includes('-')) {
        totalPoints -= points;
        negativeRecords++;
      }
    });
    
    // 更新统计概览卡片
    const overviewCards = document.querySelectorAll('.statistics-card');
    if (overviewCards.length >= 4) {
      overviewCards[0].querySelector('.card-value').textContent = 
        totalPoints > 0 ? '+' + totalPoints : totalPoints;
      overviewCards[1].querySelector('.card-value').textContent = totalRecords;
      overviewCards[2].querySelector('.card-value').textContent = positiveRecords;
      overviewCards[3].querySelector('.card-value').textContent = negativeRecords;
    }
  }

  // 测试用例：验证筛选逻辑正确性
  testFilterLogic(filter, rows) {
    console.log(`=== 筛选测试: ${filter} ===`);
    let addCount = 0;
    let deductCount = 0;
    let exchangeCount = 0;
    let totalCount = 0;
    
    rows.forEach(row => {
      const operationType = row.dataset.operation;
      
      if (operationType === 'add') addCount++;
      if (operationType === 'deduct') deductCount++;
      if (operationType === 'exchange') exchangeCount++;
      totalCount++;
    });
    
    console.log(`总记录数: ${totalCount}`);
    console.log(`加分记录: ${addCount}`);
    console.log(`扣分记录: ${deductCount}`);
    console.log(`兑换记录: ${exchangeCount}`);
    
    // 验证筛选逻辑
    let expectedCount = 0;
    switch(filter) {
      case 'all':
        expectedCount = totalCount;
        break;
      case 'positive':
        expectedCount = addCount;
        break;
      case 'negative':
        expectedCount = deductCount;
        break;
    }
    
    console.log(`预期显示记录数: ${expectedCount}`);
    console.log('=== 测试完成 ===');
  }
  
  closeStatisticsDetail() {
    const modal = document.getElementById('statisticsDetailModal');
    if (modal) {
      modal.style.display = 'none';
      setTimeout(() => {
        if (modal && modal.parentNode) {
          modal.remove();
        }
      }, 300);
    }
  }
  
  exportDetailStatistics(type, target) {
    const stats = type === 'student' ? this.currentStatistics.studentStats : this.currentStatistics.groupStats;
    const targetStat = stats.find(stat => (type === 'student' ? stat.name === target : stat.group === target));
    
    if (!targetStat) {
      alert('统计数据不存在！');
      return;
    }
    
    const excelData = [
      ['日期', '类型', '规则/商品', '积分变化', '备注']
    ];
    
    targetStat.records.forEach(record => {
      // 确定操作类型：加分、扣分、兑换
      const operationType = record.type === 'purchase' ? 'exchange' : 
                           (record.points > 0 ? 'add' : 'deduct');
      
      excelData.push([
        record.date,
        operationType === 'add' ? '加分' : operationType === 'deduct' ? '扣分' : '兑换',
        record.rule || record.item || '-',
        record.type === 'purchase' ? `-${record.cost}` : (record.points > 0 ? `+${record.points}` : record.points),
        record.note || '-'
      ]);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '积分详情');
    
    const filename = `${type === 'student' ? '学生' : '小组'}积分详情_${target}.xlsx`;
    XLSX.writeFile(wb, filename);
    alert('详情导出成功！');
  }
  
  exportStatistics(){
    // 获取当前激活的统计标签页
    const activeTab = document.querySelector('.statistics-tab.active').getAttribute('data-tab');
    let history = [];
    let filename = '';
    
    if(activeTab === 'today') {
      const today = new Date();
      const todayStr = today.toLocaleDateString('zh-CN');
      history = this.history.filter(record => {
        const recordDate = new Date(record.date.split(' ')[0]).toLocaleDateString('zh-CN');
        return recordDate === todayStr;
      });
      filename = `今日统计_${todayStr}.xlsx`;
    } else if(activeTab === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('zh-CN');
      history = this.history.filter(record => {
        const recordDate = new Date(record.date.split(' ')[0]).toLocaleDateString('zh-CN');
        return recordDate === yesterdayStr;
      });
      filename = `昨日统计_${yesterdayStr}.xlsx`;
    } else if(activeTab === 'lastWeek') {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      history = this.history.filter(record => {
        const recordDate = new Date(record.date.split(' ')[0]);
        return recordDate >= startDate && recordDate <= endDate;
      });
      filename = `上周统计_${startDate.toLocaleDateString('zh-CN')}_${endDate.toLocaleDateString('zh-CN')}.xlsx`;
    } else if(activeTab === 'lastMonth') {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      history = this.history.filter(record => {
        const recordDate = new Date(record.date.split(' ')[0]);
        return recordDate >= startDate && recordDate <= endDate;
      });
      filename = `上月统计_${startDate.toLocaleDateString('zh-CN')}_${endDate.toLocaleDateString('zh-CN')}.xlsx`;
    } else if(activeTab === 'custom') {
      const startDate = new Date(document.getElementById('startDate').value);
      const endDate = new Date(document.getElementById('endDate').value);
      history = this.history.filter(record => {
        const recordDate = new Date(record.date.split(' ')[0]);
        return recordDate >= startDate && recordDate <= endDate;
      });
      filename = `自定义统计_${startDate.toLocaleDateString('zh-CN')}_${endDate.toLocaleDateString('zh-CN')}.xlsx`;
    }
    
    if(history.length === 0) {
      alert('没有数据可导出！');
      return;
    }
    
    const excelData = [
      ['日期', '类型', '名称', '规则/商品', '积分变化']
    ];
    
    history.forEach(record => {
      if(record.type === 'student') {
        excelData.push([
          record.date,
          '个人',
          record.name,
          record.rule,
          record.points > 0 ? `+${record.points}` : record.points
        ]);
      } else if(record.type === 'group') {
        excelData.push([
          record.date,
          '小组',
          record.group,
          record.rule,
          record.points > 0 ? `+${record.points}` : record.points
        ]);
      } else if(record.type === 'purchase') {
        excelData.push([
          record.date,
          '兑换',
          record.name,
          record.item,
          `-${record.cost}`
        ]);
      }
    });
    
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '积分统计');
    
    XLSX.writeFile(wb, filename);
    alert('统计导出成功！');
  }
  
// 随机点名功能
openRandomName(){
  document.getElementById('randomNameModal').style.display='flex';
  this.renderRandomNameInterface();
  
  // 重置选中状态
  const selectedNameDiv = document.getElementById('selectedName');
  if (selectedNameDiv) {
    selectedNameDiv.textContent = '';
    selectedNameDiv.style.background = '#f7fafc';
    selectedNameDiv.style.color = 'inherit';
  }
}

closeRandomNameModal(){
  document.getElementById('randomNameModal').style.display='none';
  this.stopRandomName();
}

renderRandomNameInterface(){
  const container = document.getElementById('randomNameContainer');
  container.innerHTML = '';
  
  // 初始化随机点名记录
  if(!this.randomNameRecords) {
    this.randomNameRecords = [];
  }
  
  const html = `
    <div style="display: flex; height: 500px;">
      <div style="flex: 3; position: relative; border: 2px dashed #e2e8f0; border-radius: 15px; overflow: hidden; margin-right: 20px;" id="nameBubblesContainer">
        <!-- 名字泡泡将在这里动态生成 -->
      </div>
      <div style="flex: 2; display: flex; flex-direction: column;">
        <div style="text-align: center; margin-bottom: 20px;">
          <button class="btn btn-primary" id="startRandomBtn">开始点名</button>
          <button class="btn btn-secondary" id="stopRandomBtn" style="display: none;">停止</button>
        </div>
        <div id="selectedName" style="text-align: center; font-size: 2em; font-weight: bold; margin: 20px 0; min-height: 60px; display: flex; align-items: center; justify-content: center; background: #f7fafc; border-radius: 10px; padding: 20px;"></div>
        <div style="flex: 1; overflow-y: auto; background: #f7fafc; border-radius: 10px; padding: 15px;">
          <h4>抽取记录</h4>
          <div id="randomRecordsList" style="max-height: 200px; overflow-y: auto;"></div>
          <div style="margin-top: 10px;">
            <button class="btn btn-info" id="exportRandomRecordsBtn" style="width: 100%; margin-bottom: 5px;">导出记录</button>
            <button class="btn btn-secondary" id="clearRandomRecordsBtn" style="width: 100%;">清空记录</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  container.innerHTML = html;
  
  this.createRandomNameBubbles();
  this.renderRandomRecords();
  
  // 重新绑定事件
  document.getElementById('startRandomBtn').addEventListener('click', () => this.startRandomName());
  document.getElementById('stopRandomBtn').addEventListener('click', () => this.stopRandomName());
  document.getElementById('exportRandomRecordsBtn').addEventListener('click', () => this.exportRandomRecords());
  document.getElementById('clearRandomRecordsBtn').addEventListener('click', () => this.clearRandomRecords());
  
  // 确保停止按钮初始状态是隐藏的
  document.getElementById('stopRandomBtn').style.display = 'none';
  document.getElementById('startRandomBtn').style.display = 'inline-block';
}

createRandomNameBubbles(){
  const container = document.getElementById('nameBubblesContainer');
  if (!container) {
    console.error('名字泡泡容器未找到');
    return;
  }
  
  container.innerHTML = '';
  this.randomNameBubbles = [];
  
  // 确保有学生数据
  if (this.students.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 50px; color: #718096;">暂无学生数据</div>';
    return;
  }
  
  this.students.forEach((student, index) => {
    const bubble = document.createElement('div');
    bubble.textContent = student.name;
    bubble.className = 'name-bubble-random';
    
    // 随机颜色
    const hue = Math.floor(Math.random() * 360);
    bubble.style.background = `linear-gradient(135deg, hsl(${hue}, 80%, 60%), hsl(${hue}, 80%, 40%))`;
    
    // 随机位置
    const left = Math.random() * 75;
    const top = Math.random() * 75;
    bubble.style.left = `${left}%`;
    bubble.style.top = `${top}%`;
    
    bubble.addEventListener('click', () => {
      if (!this.isRandomNameRunning) {
        document.getElementById('selectedName').textContent = `选中: ${student.name}`;
        document.getElementById('selectedName').style.background = `linear-gradient(135deg, hsl(${hue}, 80%, 90%), hsl(${hue}, 80%, 70%))`;
        document.getElementById('selectedName').style.color = `hsl(${hue}, 80%, 30%)`;
      }
    });
    
    container.appendChild(bubble);
    this.randomNameBubbles.push({
      element: bubble,
      name: student.name,
      hue: hue
    });
  });
}

startRandomName(){
  // 重置所有泡泡的样式
  if (this.randomNameBubbles) {
    this.randomNameBubbles.forEach(bubble => {
      bubble.element.style.transform = '';
      bubble.element.style.opacity = '';
      bubble.element.style.zIndex = '';
      bubble.element.style.boxShadow = '';
    });
  }
  
  this.isRandomNameRunning = true;
  document.getElementById('startRandomBtn').style.display = 'none';
  document.getElementById('stopRandomBtn').style.display = 'inline-block';
  document.getElementById('selectedName').textContent = '';
  document.getElementById('selectedName').style.background = '#f7fafc';
  document.getElementById('selectedName').style.color = 'inherit';
  
  this.randomNameStartTime = Date.now();
  
  this.animateRandomName();
}

animateRandomName(){
  if (!this.isRandomNameRunning) return;
  
  const elapsed = Date.now() - this.randomNameStartTime;
  const speed = Math.max(0.1, 1 - elapsed / 5000); // 5秒内逐渐变慢
  
  this.randomNameBubbles.forEach(bubble => {
    const moveX = (Math.random() - 0.5) * 25 * speed;
    const moveY = (Math.random() - 0.5) * 25 * speed;
    const currentLeft = parseFloat(bubble.element.style.left);
    const currentTop = parseFloat(bubble.element.style.top);
    
    bubble.element.style.left = `${Math.max(0, Math.min(85, currentLeft + moveX))}%`;
    bubble.element.style.top = `${Math.max(0, Math.min(85, currentTop + moveY))}%`;
    
    // 随机大小变化
    const scale = 0.8 + Math.random() * 0.4;
    bubble.element.style.transform = `scale(${scale})`;
  });
  
  this.randomNameAnimationId = requestAnimationFrame(() => this.animateRandomName());
  
  // 5秒后自动停止
  if (elapsed > 5000) {
    this.stopRandomName();
  }
}

stopRandomName(){
  // 如果没有在运行，直接返回
  if (!this.isRandomNameRunning) return;
  
  this.isRandomNameRunning = false;
  if (this.randomNameAnimationId) {
    cancelAnimationFrame(this.randomNameAnimationId);
  }
  
  document.getElementById('startRandomBtn').style.display = 'inline-block';
  document.getElementById('stopRandomBtn').style.display = 'none';
  
  // 只有在真正进行了随机点名过程后才记录结果
  const elapsed = Date.now() - this.randomNameStartTime;
  
  // 只有当动画运行了至少一段时间（比如500ms）才认为是有效的随机点名
  if (elapsed >= 500 && this.randomNameBubbles.length > 0) {
    // 获取未被点名的学生列表
    const unselectedBubbles = this.randomNameBubbles.filter(bubble => 
      !this.randomNameRecords.some(record => record.name === bubble.name)
    );
    
    let selectedBubble;
    
    if (unselectedBubbles.length > 0) {
      // 从未被点名的学生中随机选择
      const randomIndex = Math.floor(Math.random() * unselectedBubbles.length);
      selectedBubble = unselectedBubbles[randomIndex];
    } else {
      // 如果所有学生都被点过了，重置记录并重新选择
      const randomIndex = Math.floor(Math.random() * this.randomNameBubbles.length);
      selectedBubble = this.randomNameBubbles[randomIndex];
      // 可以选择清空记录或保留完整记录
      // this.randomNameRecords = [];
    }
    
    // 高亮显示选中的名字
    this.randomNameBubbles.forEach(bubble => {
      if (bubble === selectedBubble) {
        bubble.element.style.transform = 'scale(1.5)';
        bubble.element.style.zIndex = '1000';
        bubble.element.style.boxShadow = '0 0 30px rgba(0,0,0,0.7)';
      } else {
        bubble.element.style.opacity = '0.3';
      }
    });
    
    const selectedNameDiv = document.getElementById('selectedName');
    selectedNameDiv.textContent = `选中: ${selectedBubble.name}`;
    selectedNameDiv.style.background = `linear-gradient(135deg, hsl(${selectedBubble.hue}, 80%, 90%), hsl(${selectedBubble.hue}, 80%, 70%))`;
    selectedNameDiv.style.color = `hsl(${selectedBubble.hue}, 80%, 30%)`;
    
    // 添加选中动画
    selectedNameDiv.style.animation = 'pulse 0.5s ease-in-out';
    setTimeout(() => {
      selectedNameDiv.style.animation = '';
    }, 500);
    
    // 记录抽取历史
    this.addRandomNameRecord(selectedBubble.name);
  } else {
    // 如果只是点击停止但没有真正运行，清空显示
    const selectedNameDiv = document.getElementById('selectedName');
    selectedNameDiv.textContent = '';
    selectedNameDiv.style.background = '#f7fafc';
    selectedNameDiv.style.color = 'inherit';
    
    // 恢复所有泡泡的样式
    this.randomNameBubbles.forEach(bubble => {
      bubble.element.style.transform = '';
      bubble.element.style.opacity = '';
      bubble.element.style.zIndex = '';
      bubble.element.style.boxShadow = '';
    });
  }
}

addRandomNameRecord(name){
  if(!this.randomNameRecords) {
    this.randomNameRecords = [];
  }
  
  const record = {
    name: name,
    time: new Date().toLocaleString('zh-CN')
  };
  
  this.randomNameRecords.unshift(record);
  
  // 最多保存50条记录
  if(this.randomNameRecords.length > 50) {
    this.randomNameRecords.pop();
  }
  
  this.saveAll();
  this.renderRandomRecords();
}

renderRandomRecords(){
  const container = document.getElementById('randomRecordsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  if(!this.randomNameRecords || this.randomNameRecords.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #718096; padding: 20px;">暂无抽取记录</div>';
    return;
  }
  
  this.randomNameRecords.forEach((record, index) => {
    const recordItem = document.createElement('div');
    recordItem.style.padding = '8px';
    recordItem.style.margin = '4px 0';
    recordItem.style.background = 'white';
    recordItem.style.borderRadius = '5px';
    recordItem.style.fontSize = '0.9em';
    recordItem.style.display = 'flex';
    recordItem.style.justifyContent = 'space-between';
    recordItem.style.alignItems = 'center';
    
    recordItem.innerHTML = `
      <div>
        <strong>${record.name}</strong>
        <div style="font-size: 0.8em; color: #718096;">${record.time}</div>
      </div>
      <div style="background: #667eea; color: white; border-radius: 12px; padding: 2px 8px; font-size: 0.8em;">${index + 1}</div>
    `;
    
    container.appendChild(recordItem);
  });
}

exportRandomRecords(){
  if(!this.randomNameRecords || this.randomNameRecords.length === 0) {
    alert('没有记录可导出！');
    return;
  }
  
  let csvContent = "序号,姓名,时间\n";
  
  this.randomNameRecords.forEach((record, index) => {
    csvContent += `${index + 1},${record.name},${record.time}\n`;
  });
  
  const filename = `随机点名记录_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
  this.exportFile(filename, csvContent, 'text/csv;charset=utf-8');
}

clearRandomRecords(){
  if(this.randomNameRecords && this.randomNameRecords.length > 0 && confirm('确定要清空所有抽取记录吗？')) {
    this.randomNameRecords = [];
    this.saveAll();
    this.renderRandomRecords();
    alert('记录已清空！');
  }
}
  
  // 计时器功能
  openTimer(){
    document.getElementById('timerModal').style.display='flex';
    this.resetStopwatch();
    this.resetCountdown();
  }
  
  closeTimerModal(){
    document.getElementById('timerModal').style.display='none';
    this.pauseStopwatch();
    this.pauseCountdown();
  }
  
  // 秒表功能
  startStopwatch(){
    if(!this.stopwatchRunning){
      this.stopwatchStartTime = Date.now() - (this.stopwatchElapsed || 0);
      this.stopwatchRunning = true;
      this.stopwatchInterval = setInterval(() => {
        this.stopwatchElapsed = Date.now() - this.stopwatchStartTime;
        this.updateStopwatchDisplay();
      }, 10);
    }
  }
  
  pauseStopwatch(){
    if(this.stopwatchRunning){
      clearInterval(this.stopwatchInterval);
      this.stopwatchRunning = false;
    }
  }
  
  resetStopwatch(){
    this.pauseStopwatch();
    this.stopwatchElapsed = 0;
    this.stopwatchLaps = [];
    this.updateStopwatchDisplay();
    const lapsContainer = document.getElementById('stopwatchLaps');
    if (lapsContainer) lapsContainer.innerHTML = '';
  }
  
  lapStopwatch(){
    if(this.stopwatchRunning){
      if(!this.stopwatchLaps) this.stopwatchLaps = [];
      this.stopwatchLaps.push(this.stopwatchElapsed);
      const lapItem = document.createElement('div');
      lapItem.className = 'lap-item';
      
      const totalSeconds = Math.floor(this.stopwatchElapsed / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const milliseconds = Math.floor((this.stopwatchElapsed % 1000) / 10);
      
      lapItem.innerHTML = `
        <span>计次 ${this.stopwatchLaps.length}</span>
        <span>${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}</span>
      `;
      const lapsContainer = document.getElementById('stopwatchLaps');
      if (lapsContainer) lapsContainer.appendChild(lapItem);
    }
  }
  
  updateStopwatchDisplay(){
    const totalSeconds = Math.floor(this.stopwatchElapsed / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((this.stopwatchElapsed % 1000) / 10);
    
    const display = document.getElementById('stopwatchDisplay');
    if (display) {
      display.textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }
  }
  
  // 倒计时功能
  startCountdown(){
    if(!this.countdownRunning && this.countdownTime > 0){
      this.countdownRunning = true;
      const display = document.getElementById('countdownDisplay');
      if (display) display.style.color = '#2d3748';
      
      this.countdownInterval = setInterval(() => {
        this.countdownTime -= 1000;
        if(this.countdownTime <= 0){
          this.countdownTime = 0;
          this.updateCountdownDisplay();
          clearInterval(this.countdownInterval);
          this.countdownRunning = false;
          const display = document.getElementById('countdownDisplay');
          if (display) {
            display.textContent = "时间到！";
            display.style.color = '#f56565';
          }
          // 时间到提示音
          try {
            const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
            audio.play();
          } catch(e) {}
        }
        this.updateCountdownDisplay();
      }, 1000);
    }
  }
  
  pauseCountdown(){
    if(this.countdownRunning){
      clearInterval(this.countdownInterval);
      this.countdownRunning = false;
    }
  }
  
  resetCountdown(){
    this.pauseCountdown();
    const hours = parseInt(document.getElementById('hoursInput').value) || 0;
    const minutes = parseInt(document.getElementById('minutesInput').value) || 5;
    const seconds = parseInt(document.getElementById('secondsInput').value) || 0;
    this.countdownTime = (hours * 3600 + minutes * 60 + seconds) * 1000;
    const display = document.getElementById('countdownDisplay');
    if (display) display.style.color = '#2d3748';
    this.updateCountdownDisplay();
  }
  
  updateCountdownDisplay(){
    const totalSeconds = Math.floor(this.countdownTime / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const display = document.getElementById('countdownDisplay');
    if (display) {
      if(hours > 0){
        display.textContent = 
          `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      } else {
        display.textContent = 
          `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }
  }
  
  // 锁定功能
  toggleLock(){
    if(this.isLocked){
      this.showUnlockModal();
    } else {
      this.lockSystem();
    }
  }
  
  lockSystem(){
    if(this.lockPassword){
      this.isLocked = true;
      this.updateLockButton();
      this.disableEditing();
      alert('系统已锁定！');
    } else {
      alert('请先在系统配置中设置锁定密码！');
    }
  }
  
  unlockSystem(){
    const password = document.getElementById('unlockPassword').value;
    if(password === this.lockPassword){
      this.isLocked = false;
      this.updateLockButton();
      this.enableEditing();
      document.getElementById('unlockModal').style.display = 'none';
      document.getElementById('unlockPassword').value = '';
      alert('系统已解锁！');
    } else {
      alert('密码错误！');
    }
  }
  
  // 紧急重置方法
  emergencyReset(){
    const adminCode = prompt('请输入管理员重置代码（请联系系统管理员获取）：');
    // 这里可以设置一个管理员代码，比如班级名称+年份
    const validAdminCode = 'class2025'; // 修改为实际的管理员代码

    if(adminCode === validAdminCode){
      this.lockPassword = '';
      this.isLocked = false;
      this.saveAll();
      this.updateLockButton();
      this.enableEditing();
      document.getElementById('unlockModal').style.display = 'none';
      alert('系统已通过管理员权限解锁！');
    } else {
      alert('管理员代码错误！');
    }
  }

  // ========== 远程锁屏功能 ==========

  initRemoteLockFeature(){
    const isMobile = window.innerWidth <= 768;
    const remoteLockBtn = document.getElementById('remoteLockBtn');
    if(remoteLockBtn){
      remoteLockBtn.style.display = isMobile ? '' : 'none';
    }
    // 非手机端启动轮询
    if(!isMobile){
      this._remoteLockPollTimer = setInterval(()=>this.pollRemoteLockStatus(), 3000);
    }
  }

  showRemoteLockModal(){
    document.getElementById('remoteLockPassword').value = '';
    document.getElementById('remoteLockModal').style.display = 'flex';
    document.getElementById('remoteLockPassword').focus();
  }

  async doRemoteLock(){
    const pwd = document.getElementById('remoteLockPassword').value;
    if(!pwd.trim()){
      alert('请输入锁屏密码');
      return;
    }
    try{
      const resp = await fetch('/api/auth/remote-lock',{
        method:'POST',
        credentials:'include',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+(localStorage.getItem('session_token')||'')
        },
        body:JSON.stringify({lock_password:pwd})
      });
      const data = await resp.json();
      if(resp.ok){
        alert('远程锁定已生效！电脑端将被锁定');
        document.getElementById('remoteLockModal').style.display='none';
      } else {
        alert(data.detail||'锁定失败');
      }
    }catch(e){
      console.error('远程锁定失败:',e);
      alert('网络错误，请重试');
    }
  }

  async pollRemoteLockStatus(){
    try{
      const resp = await fetch('/api/auth/lock-status',{
        method:'GET',
        credentials:'include',
        headers:{
          'Authorization':'Bearer '+(localStorage.getItem('session_token')||'')
        }
      });
      if(resp.ok){
        const data = await resp.json();
        if(data.locked){
          this.showRemoteLockOverlay();
        }
      }
    }catch(e){
      // 静默忽略轮询错误
    }
  }

  showRemoteLockOverlay(){
    // 停止轮询，避免重复弹窗
    if(this._remoteLockPollTimer){
      clearInterval(this._remoteLockPollTimer);
      this._remoteLockPollTimer = null;
    }
    document.getElementById('remoteUnlockPassword').value = '';
    document.getElementById('remoteUnlockError').style.display = 'none';
    document.getElementById('remoteLockOverlay').style.display = 'flex';
    document.getElementById('remoteUnlockPassword').focus();
    document.body.style.overflow = 'hidden';
  }

  async doRemoteUnlock(){
    const pwd = document.getElementById('remoteUnlockPassword').value;
    const errEl = document.getElementById('remoteUnlockError');
    if(!pwd.trim()){
      errEl.textContent = '请输入密码';
      errEl.style.display = 'block';
      return;
    }
    try{
      const resp = await fetch('/api/auth/remote-unlock',{
        method:'POST',
        credentials:'include',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+(localStorage.getItem('session_token')||'')
        },
        body:JSON.stringify({password:pwd})
      });
      const data = await resp.json();
      if(resp.ok && data.success){
        document.getElementById('remoteLockOverlay').style.display='none';
        document.body.style.overflow='';
        errEl.style.display='none';
        // 恢复轮询
        this._remoteLockPollTimer = setInterval(()=>this.pollRemoteLockStatus(), 3000);
      } else {
        errEl.textContent = data.detail||'密码错误';
        errEl.style.display = 'block';
      }
    }catch(e){
      errEl.textContent = '网络错误，请重试';
      errEl.style.display = 'block';
    }
  }
  
  showUnlockModal(){
    document.getElementById('unlockModal').style.display = 'flex';
    document.getElementById('unlockPassword').focus();
    
    // 为解锁模态框内的管理员重置按钮添加事件监听器
    const emergencyResetInUnlockBtn = document.getElementById('emergencyResetInUnlockBtn');
    if (emergencyResetInUnlockBtn) {
      emergencyResetInUnlockBtn.addEventListener('click', () => {
        this.emergencyReset();
      });
    }
  }
  
  updateLockButton(){
    const lockBtn = document.getElementById('lockBtn');
    if (!lockBtn) return;
    if(this.isLocked){
      lockBtn.innerHTML = '🔒 解锁页面';
      lockBtn.classList.remove('btn-warning');
      lockBtn.classList.add('btn-success');
      // 确保锁定按钮在锁定状态下仍然可见且可点击
      lockBtn.style.opacity = '1';
      lockBtn.style.pointerEvents = 'auto';
    } else {
      lockBtn.innerHTML = '🔓 锁定页面';
      lockBtn.classList.remove('btn-success');
      lockBtn.classList.add('btn-warning');
    }
  }
  
  // === 新增：刷新所有规则显示方法 ===
refreshAllRulesDisplay() {
  // 如果当前打开了学生积分模态框，刷新它
  if (document.getElementById('pointsModal').style.display === 'flex' && this.currentStudent !== null) {
    this.openPointsModal(this.currentStudent, this.currentOperation);
  }
  
  // 如果当前打开了小组积分模态框，刷新它
  if (document.getElementById('groupPointsModal').style.display === 'flex' && this.currentGroup !== null) {
    this.openGroupPointsModal(this.currentGroup, this.currentOperation);
  }
  
  // 如果当前打开了批量操作模态框，刷新规则显示
  if (document.getElementById('batchModal').style.display === 'flex') {
    const activeTab = document.querySelector('#batchModal .modal-tab.active');
    if (activeTab) {
      const tabName = activeTab.getAttribute('data-tab');
      if (tabName === 'batchStudents') {
        this.renderBatchStudentsList();
      } else if (tabName === 'batchGroups') {
        this.renderBatchGroupsList();
      }
    }
  }
}
  
	  // 更新学生积分模态框中选中的规则
	updateSelectedRules() {
	  const container = document.getElementById('ruleSelect');
	  const selectedRules = [];
	  let totalPoints = 0;
	  
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.rules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		  totalPoints += rule.points;
		}
	  });
	  
	  const summary = container.querySelector('.selected-rules-summary');
	  const rulesList = container.querySelector('#selectedRulesList');
	  const totalPointsSpan = container.querySelector('#totalPoints');
	  
	  if (selectedRules.length > 0) {
		summary.style.display = 'block';
		rulesList.textContent = selectedRules.map(r => r.name).join(', ');
		totalPointsSpan.textContent = totalPoints > 0 ? `+${totalPoints}` : totalPoints;
	  } else {
		summary.style.display = 'none';
	  }
	}

	// 更新小组积分模态框中选中的规则
	updateSelectedGroupRules() {
	  const container = document.getElementById('groupRuleSelect');
	  const selectedRules = [];
	  let totalPoints = 0;
	  
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.groupRules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		  totalPoints += rule.points;
		}
	  });
	  
	  const summary = container.querySelector('.selected-rules-summary');
	  const rulesList = container.querySelector('#selectedGroupRulesList');
	  const totalPointsSpan = container.querySelector('#totalGroupPoints');
	  
	  if (selectedRules.length > 0) {
		summary.style.display = 'block';
		rulesList.textContent = selectedRules.map(r => r.name).join(', ');
		totalPointsSpan.textContent = totalPoints > 0 ? `+${totalPoints}` : totalPoints;
	  } else {
		summary.style.display = 'none';
	  }
	}

	// 更新批量学生操作选中的规则
	updateSelectedBatchStudentRules() {
	  const container = document.getElementById('batchStudentRuleSelect');
	  const selectedRules = [];
	  let totalPoints = 0;
	  
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.rules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		  totalPoints += rule.points;
		}
	  });
	  
	  const summary = container.querySelector('.selected-rules-summary');
	  const rulesList = container.querySelector('#selectedBatchStudentRulesList');
	  const totalPointsSpan = container.querySelector('#totalBatchStudentPoints');
	  
	  if (selectedRules.length > 0) {
		summary.style.display = 'block';
		rulesList.textContent = selectedRules.map(r => r.name).join(', ');
		totalPointsSpan.textContent = totalPoints > 0 ? `+${totalPoints}` : totalPoints;
	  } else {
		summary.style.display = 'none';
	  }
	}

	// 更新批量小组操作选中的规则
	updateSelectedBatchGroupRules() {
	  const container = document.getElementById('batchGroupRuleSelect');
	  const selectedRules = [];
	  let totalPoints = 0;
	  
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.groupRules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		  totalPoints += rule.points;
		}
	  });
	  
	  const summary = container.querySelector('.selected-rules-summary');
	  const rulesList = container.querySelector('#selectedBatchGroupRulesList');
	  const totalPointsSpan = container.querySelector('#totalBatchGroupPoints');
	  
	  if (selectedRules.length > 0) {
		summary.style.display = 'block';
		rulesList.textContent = selectedRules.map(r => r.name).join(', ');
		totalPointsSpan.textContent = totalPoints > 0 ? `+${totalPoints}` : totalPoints;
	  } else {
		summary.style.display = 'none';
	  }
	}
	
	// 应用临时个人规则（单个学生）
	applyTempRule() {
	  if (this.currentStudent === null) return;
	  
	  const ruleName = document.getElementById('tempRuleName').value.trim();
	  const points = parseInt(document.getElementById('tempRulePoints').value);
	  
	  if (!ruleName) {
		alert('请输入规则名称！');
		return;
	  }
	  
	  if (isNaN(points)) {
		alert('请输入有效的积分值！');
		return;
	  }
	  
	  // 根据操作类型调整积分值：减分操作时，正数表示扣除
	  const adjustedPoints = this.currentOperation === 'subtract' ? -Math.abs(points) : points;
	  
	  this.applyRuleToStudent(this.currentStudent, ruleName, adjustedPoints);
	  this.closePointsModal();
	}

	// 应用临时小组规则（单个小组）
	applyTempGroupRule() {
	  if (this.currentGroup === null) return;
	  
	  const ruleName = document.getElementById('tempGroupRuleName').value.trim();
	  const points = parseInt(document.getElementById('tempGroupRulePoints').value);
	  
	  if (!ruleName) {
		alert('请输入规则名称！');
		return;
	  }
	  
	  if (isNaN(points)) {
		alert('请输入有效的积分值！');
		return;
	  }
	  
	  // 根据操作类型调整积分值：减分操作时，正数表示扣除
	  const adjustedPoints = this.currentOperation === 'subtract' ? -Math.abs(points) : points;
	  
	  this.applyRuleToGroup(this.currentGroup, ruleName, adjustedPoints);
	  this.closeGroupPointsModal();
	}

	// 应用临时规则到批量学生
	applyTempBatchRule() {
	  const selectedIndexes = [];
	  document.querySelectorAll('#batchStudentsList input[type="checkbox"]').forEach(checkbox => {
		// 排除全选复选框本身，但包括被全选选中的学生
		if (checkbox.id !== 'batch-select-all-students' && checkbox.checked) {
		  const index = parseInt(checkbox.value);
		  if (!isNaN(index)) {
			selectedIndexes.push(index);
		  }
		}
	  });
	  
	  if (selectedIndexes.length === 0) {
		alert('请至少选择一名学生！');
		return;
	  }
	  
	  const ruleName = document.getElementById('tempBatchRuleName').value.trim();
	  const points = parseInt(document.getElementById('tempBatchRulePoints').value);
	  
	  if (!ruleName) {
		alert('请输入规则名称！');
		return;
	  }
	  
	  if (isNaN(points)) {
		alert('请输入有效的积分值！');
		return;
	  }
	  
	  // 批量操作中，临时规则输入正数表示加分，负数表示减分
	  // 用户需要明确输入正数或负数来指定操作类型
	  const adjustedPoints = points;
	  
	  // 应用规则到所有选中的学生
	  selectedIndexes.forEach(index => {
		this.applyRuleToStudent(index, ruleName, adjustedPoints);
	  });
	  
	  this.closeBatchModal();
	  alert(`已对 ${selectedIndexes.length} 名学生应用临时规则 "${ruleName}"！`);
	}

// 应用临时规则到批量小组
applyTempBatchGroupRule() {
  const selectedIndexes = [];
  document.querySelectorAll('#batchGroupsList input[type="checkbox"]').forEach(checkbox => {
    // 排除全选复选框本身，但包括被全选选中的小组
    if (checkbox.id !== 'batch-select-all-groups' && checkbox.checked) {
      const index = parseInt(checkbox.value);
      if (!isNaN(index)) {
        selectedIndexes.push(index);
      }
    }
  });
  
  if (selectedIndexes.length === 0) {
    alert('请至少选择一个小组！');
    return;
  }
  
  const ruleName = document.getElementById('tempBatchGroupRuleName').value.trim();
  const points = parseInt(document.getElementById('tempBatchGroupRulePoints').value);
  
  if (!ruleName) {
    alert('请输入规则名称！');
    return;
  }
  
  if (isNaN(points)) {
    alert('请输入有效的积分值！');
    return;
  }
  
  // 批量操作中，临时规则输入正数表示加分，负数表示减分
  // 用户需要明确输入正数或负数来指定操作类型
  const adjustedPoints = points;
  
  // 应用规则到所有选中的小组
  selectedIndexes.forEach(index => {
    this.applyRuleToGroup(index, ruleName, adjustedPoints);
  });
  
  this.closeBatchModal();
  alert(`已对 ${selectedIndexes.length} 个小组应用临时规则 "${ruleName}"！`);
}

// 执行批量小组操作
executeBatchGroups(){
  const selectedIndexes = [];
  document.querySelectorAll('#batchGroupsList input[type="checkbox"]').forEach(checkbox => {
    // 排除全选复选框本身，但包括被全选选中的小组
    if (checkbox.id !== 'batch-select-all-groups' && checkbox.checked) {
      const index = parseInt(checkbox.value);
      if (!isNaN(index)) {
        selectedIndexes.push(index);
      }
    }
  });
  
  if(selectedIndexes.length === 0) {
    alert('请至少选择一个小组！');
    return;
  }
  
  const container = document.getElementById('batchGroupRuleSelect');
  const selectedRules = [];
  
	  // 获取所有选中的规则
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.groupRules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		}
	  });
	  
	  if(selectedRules.length === 0){
		alert('请至少选择一条规则！');
		return;
	  }
	  
	  let totalPointsPerGroup = 0;
	  selectedRules.forEach(rule => {
		totalPointsPerGroup += rule.points;
	  });
	  
	  if(confirm(`确定要对 ${selectedIndexes.length} 个小组执行 ${selectedRules.length} 条规则吗？每个小组将获得 ${totalPointsPerGroup > 0 ? '+' : ''}${totalPointsPerGroup} 积分`)){
		
		selectedIndexes.forEach(index => {
		  const group = this.groups[index];
		  
		  // 记录撤销信息
		  this.undoStack.push({
			type: 'groupPoints',
			index: index,
			points: totalPointsPerGroup,
			group: {...group, history: [...group.history]}
		  });
		  
		  // 应用所有选中的规则
		  selectedRules.forEach(rule => {
			group.points += rule.points;
			group.history.push({
			  date: new Date().toLocaleString('zh-CN'),
			  rule: rule.name,
			  points: rule.points
			});
			
			this.history.unshift({
			  date: new Date().toLocaleString('zh-CN'),
			  type: 'group',
			  group: group.name,
			  rule: rule.name,
			  points: rule.points
			});
		  });
		});
		
		this.saveAll();
		this.renderGroups();
		this.renderRankings();
		this.renderHistory();
		//this.updateUndoButton();
		this.closeBatchModal();
		alert(`批量操作完成！共影响 ${selectedIndexes.length} 个小组，应用了 ${selectedRules.length} 条规则`);
	  }
	}

	// 通用的应用规则到学生方法
	applyRuleToStudent(studentIndex, ruleName, points) {
	  const student = this.students[studentIndex];
	  
	  // 记录撤销信息
	  this.undoStack.push({
		type: 'points',
		index: studentIndex,
		points: points,
		stu: {...student, history: [...student.history]}
	  });
	  
	  // 应用积分
	  student.points += points;
	  student.history.push({
		date: new Date().toLocaleString('zh-CN'),
		rule: ruleName,
		points: points
	  });
	  
	  // 添加到历史记录
	  this.history.unshift({
		date: new Date().toLocaleString('zh-CN'),
		type: 'student',
		name: student.name,
		rule: ruleName,
		points: points
	  });
	  
	  this.saveAll();
	  this.renderStudents();
	  this.renderRankings();
	  this.renderHistory();
	  //this.updateUndoButton();
	}
	
	applyTempTaskRule(rule) {
  const { taskName, points, completedStudents } = rule;

  const newStudents = completedStudents.filter(name => {
    const student = this.students.find(s => s.name === name);
    if (!student) return false;
    const already = student.history.some(h => h.rule === taskName && h.type === 'task');
    return !already;
  });

  if (newStudents.length === 0) {
    alert('该任务中所有学生已同步过积分，跳过。');
    return;
  }

  newStudents.forEach(name => {
    const student = this.students.find(s => s.name === name);
    student.points += points;
    student.history.push({
      date: new Date().toLocaleString('zh-CN'),
      rule: taskName,
      points: points,
      type: 'task'
    });
    this.history.unshift({
      date: new Date().toLocaleString('zh-CN'),
      type: 'student',
      name: student.name,
      rule: taskName,
      points: points
    });
  });

  this.saveAll();
  this.renderStudents();
  this.renderRankings();
  this.renderHistory();
  alert(`已为 ${newStudents.length} 名同学增加 ${points} 积分（任务：${taskName}）`);
}

	// 通用的应用规则到小组方法
	applyRuleToGroup(groupIndex, ruleName, points) {
	  const group = this.groups[groupIndex];
	  
	  // 记录撤销信息
	  this.undoStack.push({
		type: 'groupPoints',
		index: groupIndex,
		points: points,
		group: {...group, history: [...group.history]}
	  });
	  
	  // 应用积分
	  group.points += points;
	  group.history.push({
		date: new Date().toLocaleString('zh-CN'),
		rule: ruleName,
		points: points
	  });
	  
	  // 添加到历史记录
	  this.history.unshift({
		date: new Date().toLocaleString('zh-CN'),
		type: 'group',
		group: group.name,
		rule: ruleName,
		points: points
	  });
	  
	  this.saveAll();
	  this.renderGroups();
	  this.renderRankings();
	  this.renderHistory();
	  //this.updateUndoButton();
	}
	
	// 清空所选学生积分
	clearSelectedStudentsPoints() {
	  const selectedIndexes = [];
	  document.querySelectorAll('#batchStudentsList input:checked').forEach(checkbox => {
		if (checkbox.id !== 'batch-select-all-students') {
		  selectedIndexes.push(parseInt(checkbox.value));
		}
	  });
	  
	  if (selectedIndexes.length === 0) {
		alert('请至少选择一名学生！');
		return;
	  }
	  
	  // 二次确认 - 输入验证
	  const studentNames = selectedIndexes.map(index => this.students[index].name).join(', ');
	  const confirmMessage = `您即将清空以下学生的所有积分：\n${studentNames}\n\n此操作不可撤销！\n\n请输入"确认"以继续：`;
	  const userInput = prompt(confirmMessage);
	  
	  if (userInput !== '确认') {
		if (userInput !== null) {
		  alert('输入不正确，操作已取消。');
		}
		return;
	  }
	  
	  // 最终确认
	  if (confirm(`最后确认：确定要清空 ${selectedIndexes.length} 名学生的所有积分吗？`)) {
		selectedIndexes.forEach(index => {
		  const student = this.students[index];
		  
		  // 记录撤销信息
		  this.undoStack.push({
			type: 'clearPoints',
			index: index,
			student: {...student},
			oldPoints: student.points,
			oldHistory: [...student.history],
			oldPurchases: [...student.purchases]
		  });
		  
		  // 清空积分和相关记录
		  student.points = 0;
		  student.history = student.history.filter(record => record.type === 'purchase'); // 保留购买记录
		  // 注意：购买记录保留，但积分已清空
		});
		
		this.saveAll();
		this.renderStudents();
		this.renderRankings();
		this.renderHistory();
		
		alert(`已清空 ${selectedIndexes.length} 名学生的积分！`);
	  }
	}

	// 清空所选小组积分
	clearSelectedGroupsPoints() {
	  const selectedIndexes = [];
	  document.querySelectorAll('#batchGroupsList input:checked').forEach(checkbox => {
		if (checkbox.id !== 'batch-select-all-groups') {
		  selectedIndexes.push(parseInt(checkbox.value));
		}
	  });
	  
	  if (selectedIndexes.length === 0) {
		alert('请至少选择一个小组！');
		return;
	  }
	  
	  // 二次确认 - 输入验证
	  const groupNames = selectedIndexes.map(index => this.groups[index].name).join(', ');
	  const confirmMessage = `您即将清空以下小组的所有积分：\n${groupNames}\n\n此操作不可撤销！\n\n请输入"确认"以继续：`;
	  const userInput = prompt(confirmMessage);
	  
	  if (userInput !== '确认') {
		if (userInput !== null) {
		  alert('输入不正确，操作已取消。');
		}
		return;
	  }
	  
	  // 最终确认
	  if (confirm(`最后确认：确定要清空 ${selectedIndexes.length} 个小组的所有积分吗？`)) {
		selectedIndexes.forEach(index => {
		  const group = this.groups[index];
		  
		  // 记录撤销信息
		  this.undoStack.push({
			type: 'clearGroupPoints',
			index: index,
			group: {...group},
			oldPoints: group.points,
			oldHistory: [...group.history]
		  });
		  
		  // 清空积分和相关记录
		  group.points = 0;
		  group.history = [];
		});
		
		this.saveAll();
		this.renderGroups();
		this.renderRankings();
		this.renderHistory();
		
		alert(`已清空 ${selectedIndexes.length} 个小组的积分！`);
	  }
	}
  
  // 修改 disableEditing 方法，确保关闭按钮可用
  disableEditing(){
    // 禁用所有可编辑元素
    document.getElementById('mainTitle').setAttribute('contenteditable', 'false');
    
    // 禁用特定按钮（上传学生信息、导入备份）
    document.getElementById('fileInput').disabled = true;
    document.getElementById('backupInput').disabled = true;
    document.querySelector('label[for="fileInput"]').classList.add('disabled');
    document.querySelector('label[for="backupInput"]').classList.add('disabled');
    
    // 禁用除积分历史记录外的所有内容区域的交互
    const contentAreas = document.querySelectorAll('#studentsContainer, #groupsContainer, #systemConfigContainer');
    contentAreas.forEach(area => {
      area.style.pointerEvents = 'none';
      area.style.opacity = '0.6';
    });
    
    // 确保积分历史记录区域可正常查看
    const historyArea = document.getElementById('historyContainer');
    if(historyArea) {
      historyArea.style.pointerEvents = 'auto';
      historyArea.style.opacity = '1';
    }
    
    // 禁用所有操作按钮（除了锁定按钮、解锁相关按钮和模态框关闭按钮）
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(btn => {
      if(!btn.id.includes('lockBtn') && !btn.classList.contains('modal-close-btn') && !btn.classList.contains('unlock-btn') && !btn.id.includes('confirmUnlockBtn') && !btn.id.includes('emergencyResetBtn')) {
        btn.disabled = true;
        btn.classList.add('disabled');
      }
    });
    
    // 添加锁定覆盖层，应用已定义的CSS样式
    const overlay = document.createElement('div');
    overlay.id = 'lockOverlay';
    overlay.className = 'lockOverlay'; // 应用CSS样式类
    
    // 添加锁定提示信息
    const lockInfo = document.createElement('div');
    lockInfo.style.textAlign = 'center';
    lockInfo.style.color = 'white';
    lockInfo.style.marginBottom = '20px';
    lockInfo.style.fontSize = '18px';
    lockInfo.style.fontWeight = 'bold';
    lockInfo.textContent = '系统已锁定，请点击页面上的解锁按钮解除锁定';
    
    // 添加解锁按钮到覆盖层
    const overlayUnlockBtn = document.createElement('button');
    overlayUnlockBtn.className = 'unlock-btn'; // 应用CSS样式类
    overlayUnlockBtn.textContent = '立即解锁';
    overlayUnlockBtn.onclick = () => this.showUnlockModal();
    
    overlay.appendChild(lockInfo);
    overlay.appendChild(overlayUnlockBtn);
    document.body.appendChild(overlay);
    
    // 禁用页面滚动
    document.body.style.overflow = 'hidden';
  }

  // 修改 enableEditing 方法
  enableEditing(){
    // 启用所有可编辑元素
    document.getElementById('mainTitle').setAttribute('contenteditable', 'true');
    
    // 启用特定按钮
    document.getElementById('fileInput').disabled = false;
    document.getElementById('backupInput').disabled = false;
    document.querySelector('label[for="fileInput"]').classList.remove('disabled');
    document.querySelector('label[for="backupInput"]').classList.remove('disabled');
    
    // 恢复所有内容区域的交互
    const contentAreas = document.querySelectorAll('#studentsContainer, #groupsContainer, #systemConfigContainer, #historyContainer');
    contentAreas.forEach(area => {
      area.style.pointerEvents = 'auto';
      area.style.opacity = '1';
    });
    
    // 启用所有操作按钮
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.classList.remove('disabled');
    });
    
    // 移除锁定覆盖层
    const overlay = document.getElementById('lockOverlay');
    if(overlay){
      overlay.remove();
    }
    
    // 启用页面滚动
    document.body.style.overflow = '';
  
  // 启用页面滚动
  document.body.classList.remove('locked');
  
  // 恢复刷新快捷键
  this.restoreRefreshShortcuts();
}

// 防止刷新快捷键的方法
preventRefreshShortcuts(){
  // 阻止 F5 刷新
  document.addEventListener('keydown', this.preventRefreshHandler);
  
  // 阻止 Ctrl+R 刷新
  document.addEventListener('keydown', this.preventCtrlRHandler);
  
  // 阻止右键菜单
  document.addEventListener('contextmenu', this.preventContextMenuHandler);
}

// 恢复刷新快捷键的方法
restoreRefreshShortcuts(){
  document.removeEventListener('keydown', this.preventRefreshHandler);
  document.removeEventListener('keydown', this.preventCtrlRHandler);
  document.removeEventListener('contextmenu', this.preventContextMenuHandler);
}

// 刷新阻止处理函数
preventRefreshHandler = (e) => {
  if(e.key === 'F5') {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}

// Ctrl+R 阻止处理函数
preventCtrlRHandler = (e) => {
  if(e.key === 'r' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}

// 右键菜单阻止处理函数
preventContextMenuHandler = (e) => {
  e.preventDefault();
  return false;
}
  
  // 批量操作功能
	openBatchModal(){
	  this.renderBatchStudentsList();
	  this.renderBatchGroupsList();
	  
	  // 确保切换到学生批量操作标签页
	  this.switchModalTab(document.getElementById('batchModal').querySelector('.modal-content'), 'batchStudents');
	  
	  document.getElementById('batchModal').style.display='flex';
	  // === 新增：清空批量操作临时规则输入 ===
	  document.getElementById('tempBatchRuleName').value = '';
	  document.getElementById('tempBatchRulePoints').value = '';
	  document.getElementById('tempBatchGroupRuleName').value = '';
	  document.getElementById('tempBatchGroupRulePoints').value = '';
	}
  
	closeBatchModal(){
	  document.getElementById('batchModal').style.display='none';
	  
	  // 清空规则选择
	  const ruleContainers = [
		'batchStudentRuleSelect',
		'batchGroupRuleSelect'
	  ];
	  
	  ruleContainers.forEach(containerId => {
		const container = document.getElementById(containerId);
		if (container) {
		  container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
			checkbox.checked = false;
		  });
		  const summary = container.querySelector('.selected-rules-summary');
		  if (summary) {
			summary.style.display = 'none';
		  }
		}
	  });
	}
  
// 在 renderBatchStudentsList 方法中添加全选功能
renderBatchStudentsList(){
  const list = document.getElementById('batchStudentsList');
  list.innerHTML = '';
  
  if(this.students.length === 0) {
    list.innerHTML = '<div>暂无学生数据</div>';
    return;
  }
  
  // 添加全选复选框
  const selectAllContainer = document.createElement('div');
  selectAllContainer.className = 'select-all-container';
  selectAllContainer.innerHTML = `
    <input type="checkbox" id="batch-select-all-students">
    <label for="batch-select-all-students" style="font-weight: bold; color: #667eea;">全选/取消全选</label>
  `;
  list.appendChild(selectAllContainer);
  
  // 全选事件监听 - 修复可能的问题
  const selectAllCheckbox = document.getElementById('batch-select-all-students');
  selectAllCheckbox.addEventListener('change', (e) => {
    const checkboxes = list.querySelectorAll('input[type="checkbox"]:not(#batch-select-all-students)');
    checkboxes.forEach(checkbox => {
      checkbox.checked = e.target.checked;
    });
  });
  
  // 渲染学生列表 - 确保每个复选框都有正确的value
  this.students.forEach((student, index) => {
    const checkbox = document.createElement('div');
    checkbox.className = 'student-checkbox';
    checkbox.innerHTML = `
      <input type="checkbox" id="batch-student-${index}" value="${index}">
      <label for="batch-student-${index}">${student.name} (${student.points}积分)</label>
    `;
    list.appendChild(checkbox);
  });
	  
	  // 渲染规则选择器 - 改为平铺多选，显示所有规则
	  const ruleSelect = document.getElementById('batchStudentRuleSelect');
	  const allRules = this.rules; // 批量操作显示所有规则

	  ruleSelect.innerHTML = `
		<div class="rules-grid">
		  ${allRules.map((r, i) => `
			<div class="rule-option" data-index="${i}">
			  <input type="checkbox" id="batch-student-rule-${i}" value="${r.name}">
			  <label for="batch-student-rule-${i}">
				<span class="rule-name">${r.name}</span>
				<span class="rule-points ${r.points > 0 ? 'positive' : 'negative'}">${r.points > 0 ? '+' : ''}${r.points}积分</span>
			  </label>
			</div>
		  `).join('')}
		</div>
		<div class="selected-rules-summary" style="margin-top: 10px; padding: 10px; background: #f7fafc; border-radius: 5px; display: none;">
		  <strong>已选择规则:</strong>
		  <span id="selectedBatchStudentRulesList"></span>
		  <div>总计积分: <span id="totalBatchStudentPoints">0</span></div>
		</div>
	  `;

	  ruleSelect.querySelectorAll('.rule-option input').forEach(checkbox => {
		checkbox.addEventListener('change', () => this.updateSelectedBatchStudentRules());
	  });
}

	// 在 renderBatchGroupsList 方法中添加全选功能
  
	renderBatchGroupsList(){
	  const list = document.getElementById('batchGroupsList');
	  list.innerHTML = '';
	  
	  if(this.groups.length === 0) {
		list.innerHTML = '<div>暂无小组数据</div>';
		return;
	  }
	  
	  // 添加全选复选框
	  const selectAllContainer = document.createElement('div');
	  selectAllContainer.className = 'select-all-container';
	  selectAllContainer.innerHTML = `
		<input type="checkbox" id="batch-select-all-groups">
		<label for="batch-select-all-groups" style="font-weight: bold; color: #667eea;">全选/取消全选</label>
	  `;
	  list.appendChild(selectAllContainer);
	  
	  // 全选事件监听
	  const selectAllCheckbox = document.getElementById('batch-select-all-groups');
	  selectAllCheckbox.addEventListener('change', (e) => {
		const checkboxes = document.querySelectorAll('#batchGroupsList input[type="checkbox"]:not(#batch-select-all-groups)');
		checkboxes.forEach(checkbox => {
		  checkbox.checked = e.target.checked;
		});
	  });
	  
	  // 渲染小组列表
	  this.groups.forEach((group, index) => {
		const checkbox = document.createElement('div');
		checkbox.className = 'student-checkbox';
		checkbox.innerHTML = `
		  <input type="checkbox" id="batch-group-${index}" value="${index}">
		  <label for="batch-group-${index}">${group.name} (${group.points}积分)</label>
		`;
		list.appendChild(checkbox);
	  });
	  
	  // 渲染规则选择器 - 显示所有小组规则（平铺多选）
	  const ruleSelect = document.getElementById('batchGroupRuleSelect');
	  const allGroupRules = this.groupRules;

	  ruleSelect.innerHTML = `
		<div class="rules-grid batch-rules-grid">
		  ${allGroupRules.map((r, i) => `
			<div class="rule-option" data-index="${i}">
			  <input type="checkbox" id="batch-group-rule-${i}" value="${r.name}">
			  <label for="batch-group-rule-${i}">
				<span class="rule-name">${r.name}</span>
				<span class="rule-points ${r.points > 0 ? 'positive' : 'negative'}">${r.points > 0 ? '+' : ''}${r.points}积分</span>
			  </label>
			</div>
		  `).join('')}
		</div>
		<div class="selected-rules-summary" style="margin-top: 10px; padding: 10px; background: #f7fafc; border-radius: 5px; display: none;">
		  <strong>已选择规则:</strong>
		  <span id="selectedBatchGroupRulesList"></span>
		  <div>总计积分: <span id="totalBatchGroupPoints">0</span></div>
		</div>
	  `;

	  // 添加规则选择事件
	  ruleSelect.querySelectorAll('.rule-option input').forEach(checkbox => {
		checkbox.addEventListener('change', () => this.updateSelectedBatchGroupRules());
	  });
	}
  
	executeBatchStudents(){
	  const selectedIndexes = [];
	  document.querySelectorAll('#batchStudentsList input[type="checkbox"]').forEach(checkbox => {
		// 排除全选复选框本身，但包括被全选选中的学生
		if (checkbox.id !== 'batch-select-all-students' && checkbox.checked) {
		  const index = parseInt(checkbox.value);
		  if (!isNaN(index)) {
			selectedIndexes.push(index);
		  }
		}
	  });
	  
	  if(selectedIndexes.length === 0) {
		alert('请至少选择一名学生！');
		return;
	  }
	  
	  const container = document.getElementById('batchStudentRuleSelect');
	  const selectedRules = [];
	  
	  // 获取所有选中的规则
	  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
		const ruleName = checkbox.value;
		const rule = this.rules.find(r => r.name === ruleName);
		if (rule) {
		  selectedRules.push(rule);
		}
	  });
	  
	  if(selectedRules.length === 0){
		alert('请至少选择一条规则！');
		return;
	  }
	  
	  let totalPointsPerStudent = 0;
	  selectedRules.forEach(rule => {
		totalPointsPerStudent += rule.points;
	  });
	  
	  if(confirm(`确定要对 ${selectedIndexes.length} 名学生执行 ${selectedRules.length} 条规则吗？每名学生将获得 ${totalPointsPerStudent > 0 ? '+' : ''}${totalPointsPerStudent} 积分`)){
		
		selectedIndexes.forEach(index => {
		  const student = this.students[index];
		  
		  // 记录撤销信息
		  this.undoStack.push({
			type: 'points',
			index: index,
			points: totalPointsPerStudent,
			stu: {...student, history: [...student.history]}
		  });
		  
		  // 应用所有选中的规则
		  selectedRules.forEach(rule => {
			student.points += rule.points;
			student.history.push({
			  date: new Date().toLocaleString('zh-CN'),
			  rule: rule.name,
			  points: rule.points
			});
			
			this.history.unshift({
			  date: new Date().toLocaleString('zh-CN'),
			  type: 'student',
			  name: student.name,
			  rule: rule.name,
			  points: rule.points
			});
		  });
		});
		
		this.saveAll();
		this.renderStudents();
		this.renderRankings();
		this.renderHistory();
		//this.updateUndoButton();
		this.closeBatchModal();
		alert(`批量操作完成！共影响 ${selectedIndexes.length} 名学生，应用了 ${selectedRules.length} 条规则`);
	  }
	}
  
		executeBatchGroups(){
		  const selectedIndexes = [];
		  document.querySelectorAll('#batchGroupsList input:checked').forEach(checkbox => {
			// 排除全选复选框
			if (checkbox.id !== 'batch-select-all-groups') {
			  selectedIndexes.push(parseInt(checkbox.value));
			}
		  });
		  
		  if(selectedIndexes.length === 0) {
			alert('请至少选择一个小组！');
			return;
		  }
		  
		  const container = document.getElementById('batchGroupRuleSelect');
		  const selectedRules = [];
		  
		  // 获取所有选中的规则
		  container.querySelectorAll('.rule-option input:checked').forEach(checkbox => {
			const ruleName = checkbox.value;
			const rule = this.groupRules.find(r => r.name === ruleName);
			if (rule) {
			  selectedRules.push(rule);
			}
		  });
		  
		  if(selectedRules.length === 0){
			alert('请至少选择一条规则！');
			return;
		  }
		  
		  // 计算每个小组获得的总积分
		  let totalPointsPerGroup = 0;
		  selectedRules.forEach(rule => {
			totalPointsPerGroup += rule.points;
		  });
		  
		  if(confirm(`确定要对 ${selectedIndexes.length} 个小组执行 ${selectedRules.length} 条规则吗？每个小组将获得 ${totalPointsPerGroup > 0 ? '+' : ''}${totalPointsPerGroup} 积分`)){
			
			selectedIndexes.forEach(index => {
			  const group = this.groups[index];
			  
			  // 记录撤销信息 - 修复：记录正确的总积分
			  this.undoStack.push({
				type: 'groupPoints',
				index: index,
				points: totalPointsPerGroup,
				group: {...group, history: [...group.history]}
			  });
			  
			  // 应用所有选中的规则 - 修复：移除重复的积分累加
			  selectedRules.forEach(rule => {
				group.points += rule.points;
				group.history.push({
				  date: new Date().toLocaleString('zh-CN'),
				  rule: rule.name,
				  points: rule.points
				});
				
				this.history.unshift({
				  date: new Date().toLocaleString('zh-CN'),
				  type: 'group',
				  group: group.name,
				  rule: rule.name,
				  points: rule.points
				});
			  });
			});
			
			this.saveAll();
			this.renderGroups();
			this.renderRankings();
			this.renderHistory();
			this.closeBatchModal();
			alert(`批量操作完成！共影响 ${selectedIndexes.length} 个小组，应用了 ${selectedRules.length} 条规则`);
		  }
		}
  
  // 删除功能
deleteStudent(index){
  const student = this.students[index];
  if(confirm(`确定要删除学生 ${student.name} 吗？此操作不可撤销！`)){
    // 从小组中移除该学生
    this.groups.forEach(group => {
      const memberIndex = group.members.indexOf(student.name);
      if(memberIndex !== -1) {
        group.members.splice(memberIndex, 1);
      }
    });
    
    // 删除学生
    this.students.splice(index, 1);
    
    this.saveAll();
    this.renderStudents();
    this.renderGroups();
    this.renderRankings();
    
    // 添加这一行：更新班级指示器
    this.updateCurrentClassIndicator();
    
    alert('学生删除成功！');
  }
}
  
deleteGroup(index){
  const group = this.groups[index];
  if(confirm(`确定要删除小组 ${group.name} 吗？此操作不可撤销！`)){
    this.groups.splice(index, 1);
    
    this.saveAll();
    this.renderGroups();
    this.renderRankings();
    
    // 添加这一行：更新班级指示器
    this.updateCurrentClassIndicator();
    
    alert('小组删除成功！');
  }
}
  
  // 等级制度方法
  getPetStage(points, studentName = null){
    // 根据学生名称获取对应的宠物类型（与 getStudentPetImage 保持一致的回退逻辑）
    let petType = null;
    if (studentName && this.studentPets && this.studentPets[studentName]) {
      petType = this.studentPets[studentName].petType;
    }
    if (!petType && this.petTypes && this.petTypes.length > 0) {
      petType = this.petTypes[0].id;
    }

    // 如果该宠物类型有独立的等级名称存储，使用对应的等级数据
    let stagesToUse = this.petStages;
    if (petType && this.petStagesByType && this.petStagesByType[petType]) {
      stagesToUse = this.petStagesByType[petType];
    }

    for(let i = stagesToUse.length - 1; i >= 0; i--){
      if(points >= stagesToUse[i].minPoints){
        // 根据显示模式返回不同的等级名称和emoji
        const stage = {...stagesToUse[i]};
        if (this.displayMode === 'emoji') {
          // emoji模式下使用默认等级名称和emoji
          const defaultStages = this.getDefaultPetStages();
          if (defaultStages[i]) {
            stage.name = defaultStages[i].name;
            stage.emoji = defaultStages[i].emoji;
          }
        } else {
          // 自定义模式下使用自定义等级名称，保持原有emoji
          stage.name = stagesToUse[i].name;
          stage.emoji = stagesToUse[i].emoji;
        }
        return stage;
      }
    }
    // 返回最低等级
    const stage = {...stagesToUse[0]};
    if (this.displayMode === 'emoji') {
      const defaultStages = this.getDefaultPetStages();
      if (defaultStages[0]) {
        stage.name = defaultStages[0].name;
        stage.emoji = defaultStages[0].emoji;
      }
    } else {
      // 自定义模式下使用自定义等级名称，保持原有emoji
      stage.name = stagesToUse[0].name;
      stage.emoji = stagesToUse[0].emoji;
    }
    return stage;
  }
  
  // 新增方法：计算学生总积分（用于等级显示）
getStudentTotalPoints(student) {
  // 确保student.points是有效数字
  let currentPoints = parseInt(student.points) || 0;
  
  // 计算已花费的积分（兑换商品）
  let spent = 0;
  if (student.purchases && student.purchases.length) {
    spent = student.purchases.reduce((sum, p) => {
      const costValue = parseInt(p.cost) || 0;
      return sum + costValue;
    }, 0);
  }
  
  // 总积分 = 当前剩余积分 + 已花费积分
  const totalPoints = currentPoints + spent;
  
  // 确保返回有效数字
  return isNaN(totalPoints) ? 0 : totalPoints;
}

// 获取学生宠物阶段（包含学生名称参数）
getStudentPetStage(student) {
  const totalPoints = this.getStudentTotalPoints(student);
  return this.getPetStage(totalPoints, student.name);
}

// 获取学生宠物名称
getStudentPetName(student) {
  // 检查学生是否已分配宠物
  if (student.name && this.studentPets && this.studentPets[student.name] && this.studentPets[student.name].petType) {
    const petTypeId = this.studentPets[student.name].petType;
    // 在宠物类型配置中查找对应的宠物名称
    const petConfig = this.petTypes.find(pet => pet.id === petTypeId);
    if (petConfig) {
      return petConfig.name; // 返回宠物名称，如"小猫"、"小狗"等
    }
  }
  return '未分配'; // 如果没有分配宠物
}
  
  getStageProgress(points, studentName = null){
    const stage = this.getPetStage(points, studentName);
    
    // 处理特殊情况：最高等级（无限大）直接返回100%
    if (stage.maxPoints === Infinity) return 100;
    
    // 处理负分情况：当分数小于当前阶段的最小分数时，进度条显示为0%
    if (points < stage.minPoints) return 0;
    
    // 计算当前等级内的进度百分比
    const current = points - stage.minPoints;
    const total = stage.maxPoints - stage.minPoints;
    
    // 确保百分比在0-100范围内
    const progress = (current / total) * 100;
    return Math.max(0, Math.min(100, progress));
  }
  
  getLevel(points, studentName = null){
    const stage=this.getPetStage(points, studentName);
    const stagesToUse = studentName && this.petStagesByType && this.studentPets[studentName] 
      ? this.petStagesByType[this.studentPets[studentName].type] || this.petStages
      : this.petStages;
    const index = stagesToUse.findIndex(s => s.minPoints === stage.minPoints && s.maxPoints === stage.maxPoints);
    return index >= 0 ? index + 1 : 1;
  }

  getGroupStage(points, groupName = null){
    // 如果提供了小组名称，尝试使用该小组选择的宠物类型
    if (groupName && this.groupPets && this.groupPets[groupName] && this.groupPets[groupName].petType) {
      const petType = this.groupPets[groupName].petType;
      
      // 检查是否有该宠物类型的特定等级配置
      if (this.petStagesByType && this.petStagesByType[petType]) {
        const typeStages = this.petStagesByType[petType];
        
        // 使用宠物类型特定的等级配置
        for(let i = typeStages.length - 1; i >= 0; i--){
          if(points >= typeStages[i].minPoints){
            const stage = {...typeStages[i]};
            // 根据显示模式返回不同的等级名称
            if (this.displayMode === 'emoji') {
              // emoji模式下使用默认等级名称
              const defaultStages = this.getDefaultPetStages();
              if (defaultStages[i]) {
                stage.name = defaultStages[i].name;
              }
            } else {
              // 自定义模式下使用自定义等级名称
              stage.name = typeStages[i].name;
            }
            return stage;
          }
        }
        
        // 如果没有找到匹配的等级，返回该宠物类型的最低等级
        const stage = {...typeStages[0]};
        // 根据显示模式返回不同的等级名称
        if (this.displayMode === 'emoji') {
          // emoji模式下使用默认等级名称
          const defaultStages = this.getDefaultPetStages();
          if (defaultStages[0]) {
            stage.name = defaultStages[0].name;
          }
        } else {
          // 自定义模式下使用自定义等级名称
          stage.name = typeStages[0].name;
        }
        return stage;
      }
    }
    
    // 如果没有指定小组名称或小组没有选择宠物类型，使用groupStages数据结构
    for(let i = this.groupStages.length - 1; i >= 0; i--){
      if(points >= this.groupStages[i].minPoints){
        // 根据显示模式返回不同的等级名称
        const stage = {...this.groupStages[i]};
        if (this.displayMode === 'emoji') {
          // emoji模式下使用默认小组等级名称
          const defaultStages = this.getDefaultGroupStages();
          if (defaultStages[i]) {
            stage.name = defaultStages[i].name;
          }
        } else {
          // 自定义模式下使用自定义等级名称
          stage.name = this.groupStages[i].name;
        }
        return stage;
      }
    }
    // 返回最低等级
    const stage = {...this.groupStages[0]};
    // 根据显示模式返回不同的等级名称
    if (this.displayMode === 'emoji') {
      // emoji模式下使用默认小组等级名称
      const defaultStages = this.getDefaultGroupStages();
      if (defaultStages[0]) {
        stage.name = defaultStages[0].name;
      }
    } else {
      // 自定义模式下使用自定义等级名称
      stage.name = this.groupStages[0].name;
    }
    return stage;
  }
  
  getGroupStageProgress(points, groupName = null){
    const stage = this.getGroupStage(points, groupName);
    
    // 处理特殊情况：最高等级（无限大）直接返回100%
    if (stage.maxPoints === Infinity) return 100;
    
    // 处理负分情况：当分数小于当前阶段的最小分数时，进度条显示为0%
    if (points < stage.minPoints) return 0;
    
    // 计算当前等级内的进度百分比
    const current = points - stage.minPoints;
    const total = stage.maxPoints - stage.minPoints;
    
    // 确保百分比在0-100范围内
    const progress = (current / total) * 100;
    return Math.max(0, Math.min(100, progress));
  }
  
  getGroupLevel(points, groupName = null){
    const stage = this.getGroupStage(points, groupName);
    
    // 如果小组选择了宠物类型且有特定等级配置，使用该配置
    if (groupName && this.groupPets && this.groupPets[groupName] && this.groupPets[groupName].petType) {
      const petType = this.groupPets[groupName].petType;
      
      // 检查是否有该宠物类型的特定等级配置
      if (this.petStagesByType && this.petStagesByType[petType]) {
        const typeStages = this.petStagesByType[petType];
        const index = typeStages.findIndex(s => s.minPoints === stage.minPoints && s.maxPoints === stage.maxPoints);
        return index >= 0 ? index + 1 : 1;
      }
    }
    
    // 默认使用groupStages数据结构
    const index = this.groupStages.findIndex(s => s.minPoints === stage.minPoints && s.maxPoints === stage.maxPoints);
    return index >= 0 ? index + 1 : 1;
  }
  
  // 获取宠物颜色
  getPetColor(points, studentName = null) {
    const stage = this.getPetStage(points, studentName);
    
    // 根据显示模式使用对应的颜色
    if (this.displayMode === 'emoji') {
      // emoji模式下使用默认颜色
      const colors = {
        '蛋': '#FF6B6B',
        '孵化中': '#FFD93D',
        '雏鸟': '#6BCF7F',
        '幼鸟': '#4ECDC4',
        '成长鸟': '#45B7D1',
        '雄鹰': '#96CEB4'
      };
      return colors[stage.name] || '#667eea';
    } else {
      // 自定义模式下使用自定义颜色或默认颜色
      const colors = {
        '蛋': '#FF6B6B',
        '孵化中': '#FFD93D',
        '雏鸟': '#6BCF7F',
        '幼鸟': '#4ECDC4',
        '成长鸟': '#45B7D1',
        '雄鹰': '#96CEB4'
      };
      return colors[stage.name] || '#667eea';
    }
  }
  
  // 获取小组颜色
  getGroupColor(points, groupName = null) {
    const stage = this.getGroupStage(points, groupName);
    
    // 如果小组选择了宠物类型且有特定等级配置，使用该配置
    if (groupName && this.groupPets && this.groupPets[groupName] && this.groupPets[groupName].petType) {
      const petType = this.groupPets[groupName].petType;
      
      // 检查是否有该宠物类型的特定等级配置
      if (this.petStagesByType && this.petStagesByType[petType]) {
        const typeStages = this.petStagesByType[petType];
        const currentStageIndex = typeStages.findIndex(s => s.minPoints === stage.minPoints && s.maxPoints === stage.maxPoints);
        
        if (currentStageIndex >= 0) {
          // 使用宠物类型特定的颜色
          const colors = {
            '蛋': '#FF6B6B',
            '孵化中': '#FFD93D',
            '雏鸟': '#6BCF7F',
            '幼鸟': '#4ECDC4',
            '成长鸟': '#45B7D1',
            '雄鹰': '#96CEB4'
          };
          return colors[stage.name] || '#667eea';
        }
      }
    }
    
    // 默认使用小组等级颜色
    // 根据显示模式使用对应的颜色
    if (this.displayMode === 'emoji') {
      // emoji模式下使用默认颜色
      const colors = {
        '青铜': '#CD7F32',
        '白银': '#C0C0C0',
        '黄金': '#FFD700',
        '铂金': '#E5E4E2',
        '钻石': '#B9F2FF',
        '王者': '#FF6B6B'
      };
      return colors[stage.name] || '#667eea';
    } else {
      // 自定义模式下使用自定义颜色或默认颜色
      const colors = {
        '青铜': '#CD7F32',
        '白银': '#C0C0C0',
        '黄金': '#FFD700',
        '铂金': '#E5E4E2',
        '钻石': '#B9F2FF',
        '王者': '#FF6B6B'
      };
      return colors[stage.name] || '#667eea';
    }
  }
  
  // 关闭模态框方法
  closePointsModal(){
    document.getElementById('pointsModal').style.display='none';
    this.currentStudent=null;
  }
  
  closeShopModal(){
    document.getElementById('shopModal').style.display='none';
    this.currentStudent=null;
  }
  
  closeGroupPointsModal(){
    document.getElementById('groupPointsModal').style.display='none';
    this.currentGroup=null;
  }
  
  closeCreateGroupModal(){
    document.getElementById('createGroupModal').style.display='none';
  }
  
  // 初始化小组头像（emoji版本）
  initGroupAvatarEmoji(group) {
    const avatarEmoji = document.getElementById('groupAvatarEmoji');
    
    // 检查是否有保存的头像emoji
    const groupAvatars = this.loadGroupAvatars();
    const avatarData = groupAvatars[group.name];
    
    if (avatarData) {
      // 显示保存的emoji
      avatarEmoji.textContent = avatarData;
    } else {
      // 显示默认emoji
      avatarEmoji.textContent = '👥';
    }
    
    // 添加emoji选择事件监听
    this.addGroupAvatarEmojiEventListeners(group);
  }
  
  // 添加小组头像emoji事件监听器
  addGroupAvatarEmojiEventListeners(group) {
    const avatarOptions = document.querySelectorAll('.avatar-option');
    
    avatarOptions.forEach(option => {
      const newOption = option.cloneNode(true);
      option.parentNode.replaceChild(newOption, option);
      
      newOption.addEventListener('click', (e) => {
        e.preventDefault();
        
        // 移除所有选中状态
        document.querySelectorAll('.avatar-option').forEach(opt => {
          opt.classList.remove('btn-secondary');
          opt.classList.add('btn-outline');
        });
        
        // 添加当前选中状态
        newOption.classList.remove('btn-outline');
        newOption.classList.add('btn-secondary');
        
        // 获取选中的emoji
        const selectedEmoji = newOption.dataset.emoji;
        
        // 更新头像显示
        const avatarEmoji = document.getElementById('groupAvatarEmoji');
        avatarEmoji.textContent = selectedEmoji;
        
        // 保存头像数据
        this.saveGroupAvatarEmoji(group.name, selectedEmoji);
      });
    });
    
    // 初始化选中状态
    this.updateAvatarOptionSelection(group);
  }
  
  // 更新头像选项选中状态
  updateAvatarOptionSelection(group) {
    const groupAvatars = this.loadGroupAvatars();
    const avatarData = groupAvatars[group.name];
    const currentEmoji = avatarData || '👥';
    
    // 设置对应的选项为选中状态
    document.querySelectorAll('.avatar-option').forEach(option => {
      if (option.dataset.emoji === currentEmoji) {
        option.classList.remove('btn-outline');
        option.classList.add('btn-secondary');
      } else {
        option.classList.remove('btn-secondary');
        option.classList.add('btn-outline');
      }
    });
  }
  
  // 保存小组头像emoji
  saveGroupAvatarEmoji(groupName, emoji) {
    const groupAvatars = this.loadGroupAvatars();
    groupAvatars[groupName] = emoji;
    
    // 保存到本地存储
    this.storageSet(`groupAvatars_${this.currentClassId}`, JSON.stringify(groupAvatars));
  }
  
  // 加载小组头像数据
  loadGroupAvatars() {
    try {
      const data = this.storageGet(`groupAvatars_${this.currentClassId}`);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('加载小组头像数据失败:', error);
      return {};
    }
  }
  
  closeEditGroupModal(){
    document.getElementById('editGroupModal').style.display='none';
    this.editingGroupIndex=null;
  }
  
  closeStudentHistoryModal(){
    document.getElementById('studentHistoryModal').style.display='none';
    this.editingStudentIndex=null;
  }

  closeGroupHistoryModal(){
    document.getElementById('groupHistoryModal').style.display='none';
    this.editingGroupIndex=null;
  }

  closeStatistics(){
    document.getElementById('statisticsModal').style.display='none';
  }
  
  // 修改清空数据方法，只清空当前班级数据
	clearData(){
	  if(confirm('确定要清空当前班级的所有数据吗？此操作不可撤销！')){
		this.initializeClassData();
		this.saveAll();
		
		if (this.currentClassId) {
		  this.storageRemove(`mainTitle_${this.currentClassId}`);
		}
		
		this.renderStudents();
		this.renderGroups();
		this.renderRankings();
		this.renderHistory();
		this.updateClassStudentCount();
		
		// 添加这一行：更新班级指示器
		this.updateCurrentClassIndicator();
		
		alert('当前班级数据已清空！');
	  }
	}
  
	// 修改导出备份方法，包含班级信息
exportBackup(){
  try {
    const safeGroupStages = Array.isArray(this.groupStages) ? this.groupStages : [];
    const safePetStages = Array.isArray(this.petStages) ? this.petStages : [];
    const safePetTypes = Array.isArray(this.petTypes) ? this.petTypes : [];
    const className = this.currentClassName || '班级';
    const data = {
      classId: this.currentClassId,
      className,
      students: this.students || [],
      groups: this.groups || [],
      history: this.history || [],
      
      // 🔧 修复：添加等级积分设置
      scoreToPointsRatio: this.scoreToPointsRatio,
      
      // 🐾 新增：完整的宠物配置信息
      petTypes: safePetTypes,
      petStages: safePetStages,
      petStagesByType: this.petStagesByType || {},
      petImages: this.petImages || {},
      groupPetImages: this.groupPetImages || {},
      studentPets: this.studentPets || {},
      groupPets: this.groupPets || {},
      displayMode: this.displayMode || 'local',
      
      // 导出小组等级时只包含积分范围，不包含自定义名称
      groupStages: safeGroupStages.map(stage => ({
        minPoints: stage.minPoints,
        maxPoints: stage.maxPoints,
        img: stage.img,
        emoji: stage.emoji
        // 不包含name字段，因为名称已固定
      })),
      
      // 配置范围信息
      configScope: this.currentConfigScope,
      currentConfigScope: this.currentConfigScope,
      
      // 当前使用的规则和商品配置（无论是全局还是班级配置）
      rules: this.rules || [],
      shopItems: this.shopItems || [],
      groupRules: this.groupRules || [],
      
      // 如果是班级配置，也保存班级的自定义配置
      usesCustomRules: this.currentConfigScope === 'class',
      usesCustomShopItems: this.currentConfigScope === 'class',
      usesCustomGroupRules: this.currentConfigScope === 'class',
      
      // 如果是班级配置且使用了自定义配置，保存班级的配置数据
      classRules: this.currentConfigScope === 'class' ? (this.rules || []) : [],
      classShopItems: this.currentConfigScope === 'class' ? (this.shopItems || []) : [],
      classGroupRules: this.currentConfigScope === 'class' ? (this.groupRules || []) : [],
      
      // 🔧 修复：导出完整的全局配置信息
      globalRules: this.globalRules || [],
      globalShopItems: this.globalShopItems || [],
      globalGroupRules: this.globalGroupRules || [],
      
      // 其他数据
      randomNameRecords: this.randomNameRecords || [],
      lockPassword: this.lockPassword,
      isLocked: this.isLocked,
      
      // 系统信息
      exportTime: new Date().toLocaleString('zh-CN'),
      systemVersion: '2.0',
      dataType: 'class_backup'
    };
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
    const filename = `${className}_班级完整数据备份_${timestamp}.json`;
    
    const content = JSON.stringify(data, null, 2);
    this.exportFile(filename, content, 'application/json', { preferBackend: true });
    
    let exportMessage = `备份导出成功！\n包含：\n- ${(this.students || []).length} 名学生\n- ${(this.groups || []).length} 个小组\n- ${(this.rules || []).length} 条个人规则\n- ${(this.groupRules || []).length} 条小组规则\n- ${(this.shopItems || []).length} 个商店商品`;
    exportMessage += `\n- 个人等级配置（${safePetStages.length}个等级）`;
    exportMessage += `\n- 小组等级配置（${safeGroupStages.length}个等级）`;
    exportMessage += `\n- 成绩积分比例：${this.scoreToPointsRatio}:1`;
    exportMessage += `\n- 使用${this.currentConfigScope}配置`;
    
    // 🐾 新增：宠物配置信息统计
    exportMessage += `\n- 宠物类型配置（${safePetTypes.length}种宠物）`;
    exportMessage += `\n- 个人宠物图片配置（${Object.keys(this.petImages || {}).length}种类型）`;
    exportMessage += `\n- 小组宠物图片配置（${Object.keys(this.groupPetImages || {}).length}种类型）`;
    exportMessage += `\n- 学生宠物选择记录（${Object.keys(this.studentPets || {}).length}名学生）`;
    exportMessage += `\n- 小组宠物选择记录（${Object.keys(this.groupPets || {}).length}个小组）`;
    exportMessage += `\n- 显示模式：${this.displayMode}`;
    
    alert(exportMessage);
  } catch (error) {
    console.error('导出备份失败:', error);
    if (typeof this.showNotification === 'function') {
      this.showNotification(`导出备份失败：${error.message || error}`, 'error');
    } else {
      alert(`导出备份失败：${error.message || error}`);
    }
  }
}
  
	// 修改导入备份方法，支持导入到新班级或当前班级
	importBackupFile(file){
	  const reader = new FileReader();
	  reader.onload = (e) => {
		try{
		  const data = JSON.parse(e.target.result);
		  
		  // 询问导入方式
		  const importOption = confirm(`备份文件来自班级: ${data.className || '未知班级'}\n\n点击"确定"创建新班级导入，点击"取消"导入到当前班级`);
		  
		  if (importOption) {
			// 创建新班级导入
			const newClass = {
			  id: this.generateClassId(),
			  name: data.className || '导入的班级',
			  grade: '导入',
			  teacher: '导入',
			  createTime: new Date().toISOString(),
			  studentCount: data.students ? data.students.length : 0
			};
			
			this.classes.push(newClass);
			this.saveClassesToLocalStorage();
			this.switchClass(newClass.id);
		  }
		  
		  // 导入基础数据到当前班级
		  this.students = data.students || [];
		  this.groups = data.groups || [];
		  this.history = data.history || [];
		  
		  // 🔧 修复：导入等级积分设置
		  this.scoreToPointsRatio = data.scoreToPointsRatio || 10;
		  this.petStages = data.petStages || this.getDefaultPetStages();

		  // 🐾 恢复宠物配置
		  if (data.petTypes && Array.isArray(data.petTypes) && data.petTypes.length > 0) {
		    this.petTypes = data.petTypes;
		  }
		  if (data.petStagesByType && typeof data.petStagesByType === 'object') {
		    this.petStagesByType = data.petStagesByType;
		  }
		  if (data.studentPets && typeof data.studentPets === 'object') {
		    this.studentPets = data.studentPets;
		  }
		  if (data.groupPets && typeof data.groupPets === 'object') {
		    this.groupPets = data.groupPets;
		  }
		  if (data.displayMode) {
		    this.displayMode = data.displayMode;
		  }

		  // 处理小组等级导入：只导入积分范围，不导入名称（名称已固定）
		  if (data.groupStages && Array.isArray(data.groupStages)) {
		    const defaultGroupStages = this.getDefaultGroupStages();
		    this.groupStages = defaultGroupStages.map((defaultStage, index) => {
		      const importedStage = data.groupStages[index];
		      return {
		        name: defaultStage.name, // 保持默认名称不变
		        minPoints: importedStage ? importedStage.minPoints : defaultStage.minPoints,
		        maxPoints: importedStage ? importedStage.maxPoints : defaultStage.maxPoints,
		        img: importedStage ? importedStage.img : defaultStage.img,
		        emoji: importedStage ? importedStage.emoji : defaultStage.emoji
		      };
		    });
		  } else {
		    this.groupStages = this.getDefaultGroupStages();
		  }
		  
		  // 🔧 修复：导入全局配置（如果备份中包含）
		  if (data.globalRules) {
			this.globalRules = data.globalRules;
		  }
		  if (data.globalShopItems) {
			this.globalShopItems = data.globalShopItems;
		  }
		  if (data.globalGroupRules) {
			this.globalGroupRules = data.globalGroupRules;
		  }
		  
		  // 保存全局配置（如果导入了新的全局配置）
		  if (data.globalRules || data.globalShopItems || data.globalGroupRules) {
			this.saveGlobalConfig();
		  }
		  
		  // 关键修复：正确恢复配置信息
		  const hasCustomRules = (data.rules && data.rules.length > 0) || 
								(data.classRules && data.classRules.length > 0);
		  const hasCustomShopItems = (data.shopItems && data.shopItems.length > 0) || 
									(data.classShopItems && data.classShopItems.length > 0);
		  const hasCustomGroupRules = (data.groupRules && data.groupRules.length > 0) || 
									 (data.classGroupRules && data.classGroupRules.length > 0);
		  
		  // 确定是否使用自定义配置
		  const shouldUseClassConfig = hasCustomRules || hasCustomShopItems || hasCustomGroupRules;
		  
		  // 🔧 修复：优先使用备份中的配置范围设置
		  if (data.currentConfigScope) {
			this.currentConfigScope = data.currentConfigScope;
		  } else {
			this.currentConfigScope = shouldUseClassConfig ? 'class' : 'global';
		  }
		  
		  if (this.currentConfigScope === 'class') {
			// 使用班级自定义配置
			// 优先使用新的配置字段，回退到旧字段
			this.rules = data.rules || data.classRules || [];
			this.shopItems = data.shopItems || data.classShopItems || [];
			this.groupRules = data.groupRules || data.classGroupRules || [];
			
			console.log('导入班级自定义配置:', {
			  rules: this.rules.length,
			  shopItems: this.shopItems.length, 
			  groupRules: this.groupRules.length
			});
		  } else {
			// 使用全局配置
			this.rules = this.globalRules;
			this.shopItems = this.globalShopItems;
			this.groupRules = this.globalGroupRules;
		  }
		  
		  this.randomNameRecords = data.randomNameRecords || [];
		  this.lockPassword = data.lockPassword || '';
		  this.isLocked = data.isLocked || false;
		  
		  this.saveAll();
		  this.renderStudents();
		  this.renderGroups();
		  this.renderRankings();
		  this.renderHistory();
		  this.updateLockButton();
		  
		  // 刷新配置显示
		  this.refreshConfigDisplay();
		  
		  // 🔧 修复：重新渲染等级设置界面
		  this.renderLevelSettings();
		  
		  // 应用锁定状态
		  if(this.isLocked){
			this.disableEditing();
		  } else {
			this.enableEditing();
		  }
		  
		  let message = '备份导入成功！';
		  message += `\n- 导入了 ${this.students.length} 名学生`;
		  message += `\n- 导入了 ${this.groups.length} 个小组`;
		  message += `\n- 导入了 ${this.history.length} 条历史记录`;
		  
		  if (hasCustomRules) {
			message += `\n- 导入了 ${this.rules.length} 条个人规则`;
		  }
		  if (hasCustomGroupRules) {
			message += `\n- 导入了 ${this.groupRules.length} 条小组规则`;
		  }
		  if (hasCustomShopItems) {
			message += `\n- 导入了 ${this.shopItems.length} 个商店商品`;
		  }
		  
		  // 🔧 新增：显示等级设置信息
		  if (data.petStages) {
			message += `\n- 导入了个人等级配置（${this.petStages.length}个等级）`;
		  }
		  if (data.groupStages) {
			message += `\n- 导入了小组等级配置（${this.groupStages.length}个等级）`;
		  }
		  if (data.scoreToPointsRatio) {
			message += `\n- 成绩积分比例：${this.scoreToPointsRatio}:1`;
		  }
		  
		  message += `\n- 使用${this.currentConfigScope === 'class' ? '班级' : '全局'}配置`;
		  
		  alert(message);
		}catch(err){
		  console.error('导入错误:', err);
		  alert('备份文件格式错误！\n错误信息：' + err.message);
		}
	  };
	  reader.onerror = () => {
		alert('文件读取失败！');
	  };
	  reader.readAsText(file);
	}
  
  // 其他方法
  undo(){
    if(this.undoStack.length===0){
      alert('没有可撤销的操作！');
      return;
    }
    
    const last=this.undoStack.pop();
    
    if(last.type==='points'){
      const stu=this.students[last.index];
      // 确保撤销后的积分是有效数字
      stu.points = parseInt(last.stu.points) || 0;
      stu.history = last.stu.history;
      
      this.history.shift();
      this.saveAll();
      this.renderStudents();
      this.renderRankings();
      this.renderHistory();
      alert('已撤销！');
    } else if(last.type==='groupPoints'){
      const group=this.groups[last.index];
      // 确保撤销后的积分是有效数字
      group.points = parseInt(last.group.points) || 0;
      group.history = last.group.history;
      
      this.history.shift();
      this.saveAll();
      this.renderGroups();
      this.renderRankings();
      this.renderHistory();
      alert('已撤销！');
    } else if(last.type==='purchase'){
      const stu=this.students[last.index];
      // 确保撤销后的积分是有效数字
      stu.points = parseInt(last.stu.points) || 0;
      stu.history = last.stu.history;
	  
	  // 在 undo 方法中添加对清空积分操作的支持
	if(last.type === 'clearPoints') {
	  const student = this.students[last.index];
	  student.points = last.oldPoints;
	  student.history = last.oldHistory;
	  student.purchases = last.oldPurchases;
	  
	  this.saveAll();
	  this.renderStudents();
	  this.renderRankings();
	  alert('已恢复学生积分！');
	} else if(last.type === 'clearGroupPoints') {
	  const group = this.groups[last.index];
	  group.points = last.oldPoints;
	  group.history = last.oldHistory;
	  
	  this.saveAll();
	  this.renderGroups();
	  this.renderRankings();
	  alert('已恢复小组积分！');
	}
      
      // 恢复商品库存
      if(this.shopItems[last.itemIndex].stock !== null){
        this.shopItems[last.itemIndex].stock = last.itemStock;
      }
      
      this.history.shift();
      this.saveAll();
      this.renderStudents();
      this.renderRankings();
      this.renderHistory();
      alert('已撤销！');
    }
  }
  
	// 确保配置正确刷新的方法
	refreshConfigDisplay() {
	  // 强制刷新配置范围选择器
	  this.renderConfigScopeSelector();
	  
	  // 刷新所有配置列表
	  this.renderRuleList();
	  this.renderShopList();
	  this.renderGroupRuleList();
	  
	  console.log('配置刷新完成:', {
		configScope: this.currentConfigScope,
		rules: this.rules.length,
		shopItems: this.shopItems.length,
		groupRules: this.groupRules.length
	  });
	}
  
	// 修复 importGlobalConfig 方法
	importGlobalConfig(file) {
	  const reader = new FileReader();
	  reader.onload = (e) => {
		try {
		  const data = JSON.parse(e.target.result);
		  
		  // 验证文件格式
		  if (data.type !== 'global_config') {
			alert('这不是有效的全局配置文件！');
			return;
		  }
		  
		  if (confirm('确定要导入全局配置吗？这将覆盖现有的全局规则、商品和小组规则！')) {
			// 更新全局配置
			this.globalRules = data.globalRules || this.getDefaultRules();
			this.globalShopItems = data.globalShopItems || this.getDefaultShopItems();
			this.globalGroupRules = data.globalGroupRules || this.getDefaultGroupRules();
			
			// 保存全局配置
			this.saveGlobalConfig();
			
			// 更新所有使用全局配置的班级
			this.updateAllClassesWithGlobalConfig();
			
			// 刷新当前显示
			if (this.currentConfigScope === 'global') {
			  // 如果当前使用全局配置，更新当前使用的配置
			  this.rules = this.globalRules;
			  this.shopItems = this.globalShopItems;
			  this.groupRules = this.globalGroupRules;
			}
			
			// 重新渲染所有列表
			this.renderRuleList();
			this.renderShopList();
			this.renderGroupRuleList();
			
			alert('全局配置导入成功！');
		  }
		} catch (err) {
		  console.error('导入全局配置错误:', err);
		  alert('配置文件格式错误！');
		}
	  };
	  reader.onerror = () => {
		alert('文件读取失败！');
	  };
	  reader.readAsText(file);
	}

	// 确保全局配置更新方法正确
	updateAllClassesWithGlobalConfig() {
	  this.classes.forEach(cls => {
		const classData = this.storageGet(`classPointsData_${cls.id}`);
		if (classData) {
		  try {
			const data = JSON.parse(classData);
			// 如果班级没有自定义配置，则更新为最新的全局配置
			if (!data.rules || data.rules.length === 0) {
			  data.rules = this.globalRules;
			}
			if (!data.shopItems || data.shopItems.length === 0) {
			  data.shopItems = this.globalShopItems;
			}
			if (!data.groupRules || data.groupRules.length === 0) {
			  data.groupRules = this.globalGroupRules;
			}
			
			this.storageSet(`classPointsData_${cls.id}`, JSON.stringify(data));
		  } catch (e) {
			console.error(`更新班级 ${cls.name} 配置失败:`, e);
		  }
		}
	  });
	}

	// 修复安全设置的事件绑定
	attachSecurityEvents() {
	  const savePasswordBtn = document.getElementById('savePasswordBtn');
	  const emergencyResetBtn = document.getElementById('emergencyResetBtn');
	  const exportGlobalConfigBtn = document.getElementById('exportGlobalConfigBtn');
	  const importGlobalConfigBtn = document.getElementById('importGlobalConfigBtn');
	  const globalConfigInput = document.getElementById('globalConfigInput');
	  
	  if (savePasswordBtn) {
		savePasswordBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  this.savePassword();
		});
	  }
	  
	  if (emergencyResetBtn) {
		emergencyResetBtn.addEventListener('click', () => {
		  this.emergencyReset();
		});
	  }
	  
	  if (exportGlobalConfigBtn) {
		exportGlobalConfigBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  this.exportGlobalConfig();
		});
	  }
	  
	  if (importGlobalConfigBtn) {
		importGlobalConfigBtn.addEventListener('click', () => {
		  if(this.isLocked) return;
		  // 确保文件输入元素存在
		  let fileInput = document.getElementById('globalConfigInput');
		  if (!fileInput) {
			// 如果不存在，创建文件输入元素
			fileInput = document.createElement('input');
			fileInput.type = 'file';
			fileInput.id = 'globalConfigInput';
			fileInput.accept = '.json';
			fileInput.style.display = 'none';
			document.body.appendChild(fileInput);
			
			// 添加事件监听
			fileInput.addEventListener('change', (e) => {
			  if(this.isLocked) return;
			  const file = e.target.files[0];
			  if(file) this.importGlobalConfig(file);
			  e.target.value = '';
			});
		  }
		  fileInput.click();
		});
	  }
	  
	  // 确保文件输入事件监听
	  if (globalConfigInput) {
		globalConfigInput.addEventListener('change', (e) => {
		  if(this.isLocked) return;
		  const file = e.target.files[0];
		  if(file) this.importGlobalConfig(file);
		  e.target.value = '';
		});
	  }
	}

// 修改 renderSecuritySettings 方法
renderSecuritySettings() {
  const securityTab = document.getElementById('securityTab');
  if (!securityTab) return;
  
  securityTab.innerHTML = `
    <div class="security-section">
      <h4>系统锁定</h4>
      <div style="margin-bottom: 15px;">
        <label>设置锁定密码:</label>
        <input type="password" id="lockPassword" placeholder="输入锁定密码" value="${this.lockPassword || ''}" style="width: 200px; margin: 0 10px;">
        <button class="btn btn-primary" id="savePasswordBtn">保存密码</button>
      </div>
      <div style="color: #718096; font-size: 0.9em;">
        <p>设置密码后可以锁定系统，防止误操作</p>
      </div>
    </div>
    
    <div class="security-section" style="margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
      <h4>紧急重置</h4>
      <div style="margin-bottom: 15px;">
        <p style="color: #e53e3e; margin-bottom: 10px;">如果忘记密码导致系统无法使用，可以使用紧急重置功能</p>
        <button class="btn btn-danger" id="emergencyResetBtn">紧急重置系统</button>
      </div>
    </div>
  `;
  
  // 重新绑定安全设置相关事件（只保留安全相关事件）
  this.attachSecurityEvents();
}

// 修改 attachSecurityEvents 方法，只保留安全相关事件
attachSecurityEvents() {
  const savePasswordBtn = document.getElementById('savePasswordBtn');
  const emergencyResetBtn = document.getElementById('emergencyResetBtn');
  
  if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', () => {
      if(this.isLocked) return;
      this.savePassword();
    });
  }
  
  if (emergencyResetBtn) {
    emergencyResetBtn.addEventListener('click', () => {
      this.emergencyReset();
    });
  }
}
  
// 修复 renderGlobalConfig 方法
renderGlobalConfig(){
  const securityTab = document.getElementById('securityTab');
  
  // 先检查是否已经存在全局配置部分，如果存在则移除
  const existingGlobalConfig = securityTab.querySelector('.global-config-section');
  if (existingGlobalConfig) {
    existingGlobalConfig.remove();
  }
  
  // 创建新的全局配置部分 - 修复字符串模板语法
  const globalConfigHtml = `
    <div class="global-config-section" style="margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
      <h4>全局配置管理</h4>
      <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
        <button class="btn btn-primary" id="exportGlobalConfigBtn">导出全局配置</button>
        <button class="btn btn-secondary" id="importGlobalConfigBtn">导入全局配置</button>
        <input type="file" id="globalConfigInput" accept=".json" style="display:none;">
      </div>
      <div style="margin-top: 10px; color: #718096; font-size: 0.9em;">
        <p>导出/导入积分规则、商店商品、小组规则等系统配置</p>
      </div>
    </div>
  `;
  
  securityTab.insertAdjacentHTML('beforeend', globalConfigHtml);
  
  // 添加事件监听
  this.attachGlobalConfigEvents();
}
		

	// 附加全局配置事件
	attachGlobalConfigEvents() {
	  const exportBtn = document.getElementById('exportGlobalConfigBtn');
	  const importBtn = document.getElementById('importGlobalConfigBtn');
	  const fileInput = document.getElementById('globalConfigInput');
	  
	  if (exportBtn) {
		exportBtn.addEventListener('click', () => {
		  if (this.isLocked) return;
		  this.exportGlobalConfig();
		});
	  }
	  
	  if (importBtn) {
		importBtn.addEventListener('click', () => {
		  if (this.isLocked) return;
		  fileInput.click();
		});
	  }
	  
	  if (fileInput) {
		fileInput.addEventListener('change', (e) => {
		  if (this.isLocked) return;
		  const file = e.target.files[0];
		  if (file) this.importGlobalConfig(file);
		  e.target.value = '';
		});
	  }
	}

// 导出全局配置
exportGlobalConfig(){
  const config = {
    rules: this.rules,
    shopItems: this.shopItems,
    groupRules: this.groupRules,
    petStages: this.petStages,
    groupStages: this.groupStages,
    exportTime: new Date().toLocaleString('zh-CN')
  };
  
  const content = JSON.stringify(config, null, 2);
  const filename = `系统配置_${new Date().toISOString().split('T')[0]}.json`;
  this.exportFile(filename, content, 'application/json');
  
  alert('全局配置导出成功！');
}

// 导入全局配置
importGlobalConfig(file){
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const config = JSON.parse(e.target.result);
      
      if(confirm('确定要导入全局配置吗？这将覆盖当前的积分规则、商店商品和小组规则！')){
        this.rules = config.rules || this.rules;
        this.shopItems = config.shopItems || this.shopItems;
        this.groupRules = config.groupRules || this.groupRules;
        this.petStages = config.petStages || this.petStages;
        this.groupStages = config.groupStages || this.groupStages;
        
        this.saveAll();
        this.renderRuleList();
        this.renderShopList();
        this.renderGroupRuleList();
        
        alert('全局配置导入成功！');
      }
    } catch(err) {
      alert('配置文件格式错误！');
    }
  };
  reader.readAsText(file);
}

loadTaskRecordFromRenwu(recordIndex) {
  const rec = this.taskRecords[recordIndex];
  if (!rec) return;

  const studentData = rec.students.map(s => ({
    name: s.name,
    avatar: this.getPetStage(s.completed ? 50 : 0, s.name).emoji
  }));

  const query = new URLSearchParams({
    students: JSON.stringify(studentData),
    className: this.currentClassName,
    recordIndex: recordIndex
  });

  window.location.href = `/static/renwu.html?${query.toString()}`;
}

deleteTaskRecord(recordIndex) {
  if (!confirm('确定删除这条任务记录吗？')) return;
  this.taskRecords.splice(recordIndex, 1);
  this.saveAll();
  this.renderTaskRecords();
  alert('记录已删除');
}

// 显示批量应用宠物模态框
showBatchApplyPetModal(petTypeId) {
  const modal = document.getElementById('batchApplyPetModal');
  const petNameElement = document.getElementById('batchApplyPetName');
  
  if (!modal || !petNameElement) {
    console.error('批量应用宠物模态框元素未找到');
    return;
  }
  
  // 获取宠物类型信息
  const petType = this.petTypes.find(t => t.id === petTypeId);
  if (!petType) {
    console.error('未找到宠物类型:', petTypeId);
    return;
  }
  
  // 更新宠物名称显示
  petNameElement.textContent = `选择要应用"${petType.name}"宠物形象的学生`;
  
  // 保存当前选择的宠物类型（修复变量名一致性问题）
  this.currentBatchApplyPetTypeId = petTypeId;
  
  // 渲染学生卡片
  this.renderBatchApplyStudentsList();
  
  // 显示模态框并确保居中显示
  modal.style.display = 'flex';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.zIndex = '1000';
}

// 隐藏批量应用宠物模态框
hideBatchApplyPetModal() {
  const modal = document.getElementById('batchApplyPetModal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // 注意：不要清除currentBatchApplyPetTypeId，以便下次点击时仍然有效
  // 只有在用户明确取消或关闭模态框时才需要清除
}

// 渲染批量应用学生列表 - 优化版本
renderBatchApplyStudentsList() {
  const container = document.getElementById('batchApplyStudentsList');
  if (!container) {
    console.error('批量应用学生列表容器未找到');
    return;
  }
  
  // 检查是否有学生数据
  if (!this.students || this.students.length === 0) {
    container.innerHTML = '<div class="no-data-message">暂无学生数据</div>';
    return;
  }
  
  // 使用文档片段提高性能
  const fragment = document.createDocumentFragment();
  
  // 渲染每个学生卡片
  this.students.forEach((student, index) => {
    const studentCard = this.createBatchApplyStudentCard(student, index);
    fragment.appendChild(studentCard);
  });
  
  // 一次性添加到容器
  container.innerHTML = '';
  container.appendChild(fragment);
  
  // 更新已选择学生数量显示
  this.updateSelectedCount();
}

// 创建批量应用学生卡片 - 优化版本
createBatchApplyStudentCard(student, index) {
  const card = document.createElement('div');
  card.className = 'student-card';
  
  // 获取学生宠物信息
  const petName = this.getStudentPetName(student);
  const hasPet = petName !== '未分配';
  
  // 创建卡片内容 - 所有元素在同一行水平排列
  card.innerHTML = `
    <div class="student-checkbox">
      <input type="checkbox" class="batch-apply-student-checkbox" data-student-index="${index}" id="student-${index}">
      <label for="student-${index}"></label>
    </div>
    
    <div class="student-name">${student.name}</div>
    <div class="student-points">积分: ${student.points || 0}</div>
    <div class="pet-section ${hasPet ? 'has-pet' : 'no-pet'}">
      <div class="pet-name">${petName}</div>
    </div>
  `;
  
  // 如果没有宠物，隐藏宠物信息区域
  if (!hasPet) {
    const petSection = card.querySelector('.pet-section');
    petSection.style.display = 'none';
  }
  
  // 添加点击事件（点击卡片切换复选框）
  card.addEventListener('click', (e) => {
    if (!e.target.matches('input[type="checkbox"], label')) {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  
  // 添加复选框变化事件
  const checkbox = card.querySelector('input[type="checkbox"]');
  checkbox.addEventListener('change', () => {
    this.updateBatchApplySelection();
  });
  
  return card;
}

// 更新批量应用选择状态
updateBatchApplySelection() {
  const checkboxes = document.querySelectorAll('.batch-apply-student-checkbox');
  const selectAllCheckbox = document.getElementById('selectAllStudents');
  
  if (!selectAllCheckbox) return;
  
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  // 更新全选复选框状态
  selectAllCheckbox.checked = checkedCount === totalCount;
  selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < totalCount;
  
  // 更新确认按钮状态
  const confirmBtn = document.getElementById('confirmBatchApplyPetBtn');
  if (confirmBtn) {
    confirmBtn.disabled = checkedCount === 0;
  }
  
  // 更新已选择学生数量显示
  this.updateSelectedCount();
}

// 更新已选择学生数量显示
updateSelectedCount() {
  const checkboxes = document.querySelectorAll('.batch-apply-student-checkbox');
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const totalCount = checkboxes.length;
  
  const selectedCountElement = document.getElementById('selectedCount');
  if (selectedCountElement) {
    selectedCountElement.textContent = `已选择 ${checkedCount}/${totalCount} 名学生`;
  }
}

// 全选/取消全选学生
toggleSelectAllStudents(selectAll) {
  const checkboxes = document.querySelectorAll('.batch-apply-student-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = selectAll;
    // 触发change事件以更新UI状态
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  
  // 更新确认按钮状态
  const confirmBtn = document.getElementById('confirmBatchApplyPetBtn');
  if (confirmBtn) {
    confirmBtn.disabled = !selectAll && checkboxes.length > 0;
  }
  
  // 更新已选择学生数量显示
  this.updateSelectedCount();
}

// 获取宠物配置数据
getPetConfigs() {
  // 确保宠物类型数据存在
  if (!this.petTypes || this.petTypes.length === 0) {
    return [];
  }
  
  return this.petTypes;
}

getValidPetTypeId(preferredId) {
  if (preferredId && this.petTypes && this.petTypes.some(t => t.id === preferredId)) {
    return preferredId;
  }
  if (this.petTypes && this.petTypes.length > 0) {
    return this.petTypes[0].id;
  }
  return '';
}

// 应用宠物到单个学生
applyPetToStudent(studentName, petConfig) {
  // 确保学生宠物数据结构存在
  if (!this.studentPets) {
    this.studentPets = {};
  }
  
  // 如果学生还没有宠物数据，创建一个
  if (!this.studentPets[studentName]) {
    this.studentPets[studentName] = {};
  }
  
  // 更新宠物类型
  this.studentPets[studentName].petType = petConfig.id;
  
  // 记录应用时间
  this.studentPets[studentName].appliedAt = new Date().toISOString();
  
  console.log(`应用宠物到学生: ${studentName}, 宠物类型: ${petConfig.name}`);
}

// 确认批量应用宠物
confirmBatchApplyPet() {
  const selectedStudents = this.getSelectedBatchApplyStudents();
  const petTypeId = this.currentBatchApplyPetTypeId;
  
  if (selectedStudents.length === 0) {
    this.showNotification('请至少选择一个学生！', 'error');
    return;
  }
  
  if (!petTypeId) {
    this.showNotification('请先选择要应用的宠物类型！', 'error');
    return;
  }
  
  // 获取宠物配置数据
  const petConfigs = this.getPetConfigs();
  const petConfig = petConfigs.find(pet => pet.id === petTypeId);
  
  if (!petConfig) {
    this.showNotification('未找到对应的宠物配置！', 'error');
    return;
  }
  
  if (confirm(`确定要将"${petConfig.name}"宠物形象应用到 ${selectedStudents.length} 个学生吗？`)) {
    // 批量应用宠物形象
    selectedStudents.forEach(studentName => {
      // 应用宠物到学生
      this.applyPetToStudent(studentName, petConfig);
    });
    
    // 保存数据
    this.saveAll();
    
    // 更新界面
    this.renderStudents();
    this.renderRankings();
    
    // 隐藏模态框
    this.hideBatchApplyPetModal();
    
    this.showNotification(`成功为 ${selectedStudents.length} 个学生应用宠物形象！`, 'success');
  }
}

// 获取选中的批量应用学生
getSelectedBatchApplyStudents() {
  const checkboxes = document.querySelectorAll('.batch-apply-student-checkbox:checked');
  const selectedStudents = [];
  
  checkboxes.forEach(checkbox => {
    const studentIndex = parseInt(checkbox.dataset.studentIndex);
    if (this.students[studentIndex]) {
      selectedStudents.push(this.students[studentIndex].name);
    }
  });
  
  return selectedStudents;
}

// 获取姓氏拼音首字母
getSurnamePinyin(name) {
  if (!name || typeof name !== 'string') return '';
  
  // 提取姓氏（第一个字符）
  const surname = name.charAt(0);
  
  // 常见姓氏拼音映射（包含多音字处理）
  const surnamePinyinMap = {
    '赵': 'Z', '钱': 'Q', '孙': 'S', '李': 'L', '周': 'Z', '吴': 'W', '郑': 'Z', '王': 'W',
    '冯': 'F', '陈': 'C', '褚': 'C', '卫': 'W', '蒋': 'J', '沈': 'S', '韩': 'H', '杨': 'Y',
    '朱': 'Z', '秦': 'Q', '尤': 'Y', '许': 'X', '何': 'H', '吕': 'L', '施': 'S', '张': 'Z',
    '孔': 'K', '曹': 'C', '严': 'Y', '华': 'H', '金': 'J', '魏': 'W', '陶': 'T', '姜': 'J',
    '戚': 'Q', '谢': 'X', '邹': 'Z', '喻': 'Y', '柏': 'B', '水': 'S', '窦': 'D', '章': 'Z',
    '云': 'Y', '苏': 'S', '潘': 'P', '葛': 'G', '奚': 'X', '范': 'F', '彭': 'P', '郎': 'L',
    '鲁': 'L', '韦': 'W', '昌': 'C', '马': 'M', '苗': 'M', '凤': 'F', '花': 'H', '方': 'F',
    '俞': 'Y', '任': 'R', '袁': 'Y', '柳': 'L', '酆': 'F', '鲍': 'B', '史': 'S', '唐': 'T',
    '费': 'F', '廉': 'L', '岑': 'C', '薛': 'X', '雷': 'L', '贺': 'H', '倪': 'N', '汤': 'T',
    '滕': 'T', '殷': 'Y', '罗': 'L', '毕': 'B', '郝': 'H', '邬': 'W', '安': 'A', '常': 'C',
    '乐': 'L', '于': 'Y', '时': 'S', '傅': 'F', '皮': 'P', '卞': 'B', '齐': 'Q', '康': 'K',
    '伍': 'W', '余': 'Y', '元': 'Y', '卜': 'B', '顾': 'G', '孟': 'M', '平': 'P', '黄': 'H',
    '和': 'H', '穆': 'M', '萧': 'X', '尹': 'Y', '姚': 'Y', '邵': 'S', '湛': 'Z', '汪': 'W',
    '祁': 'Q', '毛': 'M', '禹': 'Y', '狄': 'D', '米': 'M', '贝': 'B', '明': 'M', '臧': 'Z',
    '计': 'J', '伏': 'F', '成': 'C', '戴': 'D', '谈': 'T', '宋': 'S', '茅': 'M', '庞': 'P',
    '熊': 'X', '纪': 'J', '舒': 'S', '屈': 'Q', '项': 'X', '祝': 'Z', '董': 'D', '梁': 'L',
    '杜': 'D', '阮': 'R', '蓝': 'L', '闵': 'M', '席': 'X', '季': 'J', '麻': 'M', '强': 'Q',
    '贾': 'J', '路': 'L', '娄': 'L', '危': 'W', '江': 'J', '童': 'T', '颜': 'Y', '郭': 'G',
    '梅': 'M', '盛': 'S', '林': 'L', '刁': 'D', '钟': 'Z', '徐': 'X', '邱': 'Q', '骆': 'L',
    '高': 'G', '夏': 'X', '蔡': 'C', '田': 'T', '樊': 'F', '胡': 'H', '凌': 'L', '霍': 'H',
    '虞': 'Y', '万': 'W', '支': 'Z', '柯': 'K', '昝': 'Z', '管': 'G', '卢': 'L', '莫': 'M',
    '经': 'J', '房': 'F', '裘': 'Q', '缪': 'M', '干': 'G', '解': 'X', '应': 'Y', '宗': 'Z',
    '丁': 'D', '宣': 'X', '贲': 'B', '邓': 'D', '郁': 'Y', '单': 'S', '杭': 'H', '洪': 'H',
    '包': 'B', '诸': 'Z', '左': 'Z', '石': 'S', '崔': 'C', '吉': 'J', '钮': 'N', '龚': 'G',
    '程': 'C', '嵇': 'J', '邢': 'X', '滑': 'H', '裴': 'P', '陆': 'L', '荣': 'R', '翁': 'W',
    '荀': 'X', '羊': 'Y', '於': 'Y', '惠': 'H', '甄': 'Z', '曲': 'Q', '家': 'J', '封': 'F',
    '芮': 'R', '羿': 'Y', '储': 'C', '靳': 'J', '汲': 'J', '邴': 'B', '糜': 'M', '松': 'S',
    '井': 'J', '段': 'D', '富': 'F', '巫': 'W', '乌': 'W', '焦': 'J', '巴': 'B', '弓': 'G',
    '牧': 'M', '隗': 'W', '山': 'S', '谷': 'G', '车': 'C', '侯': 'H', '宓': 'M', '蓬': 'P',
    '全': 'Q', '郗': 'X', '班': 'B', '仰': 'Y', '秋': 'Q', '仲': 'Z', '伊': 'Y', '宫': 'G',
    '宁': 'N', '仇': 'Q', '栾': 'L', '暴': 'B', '甘': 'G', '钭': 'T', '厉': 'L', '戎': 'R',
    '祖': 'Z', '武': 'W', '符': 'F', '刘': 'L', '景': 'J', '詹': 'Z', '束': 'S', '龙': 'L',
    '叶': 'Y', '幸': 'X', '司': 'S', '韶': 'S', '郜': 'G', '黎': 'L', '蓟': 'J', '薄': 'B',
    '印': 'Y', '宿': 'S', '白': 'B', '怀': 'H', '蒲': 'P', '邰': 'T', '从': 'C', '鄂': 'E',
    '索': 'S', '咸': 'X', '籍': 'J', '赖': 'L', '卓': 'Z', '蔺': 'L', '屠': 'T', '蒙': 'M',
    '池': 'C', '乔': 'Q', '阴': 'Y', '鬱': 'Y', '胥': 'X', '能': 'N', '苍': 'C', '双': 'S',
    '闻': 'W', '莘': 'S', '党': 'D', '翟': 'Z', '谭': 'T', '贡': 'G', '劳': 'L', '逢': 'F',
    '姬': 'J', '申': 'S', '扶': 'F', '堵': 'D', '冉': 'R', '宰': 'Z', '郦': 'L', '雍': 'Y',
    '卻': 'Q', '璩': 'Q', '桑': 'S', '桂': 'G', '濮': 'P', '牛': 'N', '寿': 'S', '通': 'T',
    '边': 'B', '扈': 'H', '燕': 'Y', '冀': 'J', '郏': 'J', '浦': 'P', '尚': 'S', '农': 'N',
    '温': 'W', '别': 'B', '庄': 'Z', '晏': 'Y', '柴': 'C', '瞿': 'Q', '阎': 'Y', '充': 'C',
    '慕': 'M', '连': 'L', '茹': 'R', '习': 'X', '宦': 'H', '艾': 'A', '鱼': 'Y', '容': 'R',
    '向': 'X', '古': 'G', '易': 'Y', '慎': 'S', '戈': 'G', '廖': 'L', '庾': 'Y', '终': 'Z',
    '暨': 'J', '居': 'J', '衡': 'H', '步': 'B', '都': 'D', '耿': 'G', '满': 'M', '弘': 'H',
    '匡': 'K', '国': 'G', '文': 'W', '寇': 'K', '广': 'G', '禄': 'L', '阙': 'Q', '东': 'D',
    '欧': 'O', '殳': 'S', '沃': 'W', '利': 'L', '蔚': 'W', '越': 'Y', '夔': 'K', '隆': 'L',
    '师': 'S', '巩': 'G', '厍': 'S', '聂': 'N', '晁': 'C', '勾': 'G', '敖': 'A', '融': 'R',
    '冷': 'L', '訾': 'Z', '辛': 'X', '阚': 'K', '那': 'N', '简': 'J', '饶': 'R', '空': 'K',
    '曾': 'Z', '毋': 'W', '沙': 'S', '乜': 'N', '养': 'Y', '鞠': 'J', '须': 'X', '丰': 'F',
    '巢': 'C', '关': 'G', '蒯': 'K', '相': 'X', '查': 'Z', '后': 'H', '荆': 'J', '红': 'H',
    '游': 'Y', '竺': 'Z', '权': 'Q', '逯': 'L', '盖': 'G', '益': 'Y', '桓': 'H', '公': 'G',
    // 扩展更多常见姓氏
    '阿': 'A', '阿': 'A', '艾': 'A', '安': 'A', '敖': 'A', '巴': 'B', '白': 'B', '柏': 'B',
    '班': 'B', '包': 'B', '鲍': 'B', '贝': 'B', '毕': 'B', '边': 'B', '卞': 'B', '卜': 'B',
    '步': 'B', '蔡': 'C', '曹': 'C', '岑': 'C', '柴': 'C', '常': 'C', '车': 'C', '陈': 'C',
    '成': 'C', '程': 'C', '池': 'C', '迟': 'C', '褚': 'C', '丛': 'C', '崔': 'C', '戴': 'D',
    '党': 'D', '邓': 'D', '狄': 'D', '邸': 'D', '刁': 'D', '丁': 'D', '董': 'D', '窦': 'D',
    '杜': 'D', '段': 'D', '多': 'D', '鄂': 'E', '樊': 'F', '范': 'F', '方': 'F', '房': 'F',
    '费': 'F', '冯': 'F', '凤': 'F', '符': 'F', '傅': 'F', '甘': 'G', '高': 'G', '郜': 'G',
    '戈': 'G', '葛': 'G', '耿': 'G', '宫': 'G', '龚': 'G', '巩': 'G', '古': 'G', '谷': 'G',
    '顾': 'G', '关': 'G', '管': 'G', '桂': 'G', '郭': 'G', '国': 'G', '海': 'H', '韩': 'H',
    '杭': 'H', '郝': 'H', '何': 'H', '和': 'H', '贺': 'H', '赫': 'H', '黑': 'H', '洪': 'H',
    '侯': 'H', '后': 'H', '胡': 'H', '花': 'H', '华': 'H', '怀': 'H', '宦': 'H', '黄': 'H',
    '惠': 'H', '霍': 'H', '姬': 'J', '嵇': 'J', '吉': 'J', '纪': 'J', '季': 'J', '计': 'J',
    '冀': 'J', '暨': 'J', '贾': 'J', '简': 'J', '江': 'J', '姜': 'J', '蒋': 'J', '焦': 'J',
    '金': 'J', '靳': 'J', '荆': 'J', '景': 'J', '鞠': 'J', '康': 'K', '柯': 'K', '孔': 'K',
    '寇': 'K', '蒯': 'K', '匡': 'K', '邝': 'K', '赖': 'L', '蓝': 'L', '郎': 'L', '劳': 'L',
    '乐': 'L', '雷': 'L', '冷': 'L', '黎': 'L', '李': 'L', '厉': 'L', '连': 'L', '廉': 'L',
    '梁': 'L', '廖': 'L', '林': 'L', '蔺': 'L', '凌': 'L', '刘': 'L', '柳': 'L', '龙': 'L',
    '娄': 'L', '卢': 'L', '鲁': 'L', '陆': 'L', '逯': 'L', '路': 'L', '吕': 'L', '栾': 'L',
    '罗': 'L', '骆': 'L', '麻': 'M', '马': 'M', '麦': 'M', '满': 'M', '毛': 'M', '茅': 'M',
    '梅': 'M', '蒙': 'M', '孟': 'M', '糜': 'M', '米': 'M', '宓': 'M', '苗': 'M', '闵': 'M',
    '明': 'M', '莫': 'M', '墨': 'M', '牟': 'M', '慕': 'M', '穆': 'M', '那': 'N', '倪': 'N',
    '聂': 'N', '宁': 'N', '牛': 'N', '农': 'N', '欧': 'O', '欧阳': 'O', '潘': 'P', '庞': 'P',
    '裴': 'P', '彭': 'P', '皮': 'P', '平': 'P', '蒲': 'P', '濮': 'P', '浦': 'P', '戚': 'Q',
    '齐': 'Q', '祁': 'Q', '钱': 'Q', '强': 'Q', '乔': 'Q', '秦': 'Q', '邱': 'Q', '裘': 'Q',
    '仇': 'Q', '曲': 'Q', '屈': 'Q', '麴': 'Q', '全': 'Q', '权': 'Q', '冉': 'R', '饶': 'R',
    '任': 'R', '荣': 'R', '容': 'R', '茹': 'R', '阮': 'R', '芮': 'R', '桑': 'S', '沙': 'S',
    '山': 'S', '单': 'S', '商': 'S', '尚': 'S', '邵': 'S', '申': 'S', '沈': 'S', '盛': 'S',
    '施': 'S', '石': 'S', '时': 'S', '史': 'S', '寿': 'S', '舒': 'S', '束': 'S', '双': 'S',
    '水': 'S', '司': 'S', '司马': 'S', '司徒': 'S', '司空': 'S', '宋': 'S', '苏': 'S', '宿': 'S',
    '粟': 'S', '孙': 'S', '索': 'S', '台': 'T', '邰': 'T', '谈': 'T', '谭': 'T', '汤': 'T',
    '唐': 'T', '陶': 'T', '滕': 'T', '田': 'T', '童': 'T', '涂': 'T', '屠': 'T', '万': 'W',
    '万俟': 'M', '汪': 'W', '王': 'W', '危': 'W', '韦': 'W', '卫': 'W', '魏': 'W', '温': 'W',
    '文': 'W', '闻': 'W', '闻人': 'W', '翁': 'W', '乌': 'W', '邬': 'W', '巫': 'W', '吴': 'W',
    '伍': 'W', '武': 'W', '奚': 'X', '郤': 'X', '席': 'X', '习': 'X', '夏': 'X', '夏侯': 'X',
    '鲜': 'X', '鲜于': 'X', '咸': 'X', '冼': 'X', '向': 'X', '项': 'X', '萧': 'X', '谢': 'X',
    '辛': 'X', '邢': 'X', '熊': 'X', '胥': 'X', '徐': 'X', '许': 'X', '续': 'X', '轩辕': 'X',
    '薛': 'X', '荀': 'X', '鄢': 'Y', '严': 'Y', '阎': 'Y', '颜': 'Y', '晏': 'Y', '燕': 'Y',
    '羊': 'Y', '阳': 'Y', '杨': 'Y', '仰': 'Y', '姚': 'Y', '叶': 'Y', '伊': 'Y', '衣': 'Y',
    '易': 'Y', '殷': 'Y', '尹': 'Y', '应': 'Y', '雍': 'Y', '尤': 'Y', '游': 'Y', '于': 'Y',
    '余': 'Y', '於': 'Y', '鱼': 'Y', '俞': 'Y', '虞': 'Y', '庾': 'Y', '郁': 'Y', '喻': 'Y',
    '元': 'Y', '袁': 'Y', '苑': 'Y', '岳': 'Y', '云': 'Y', '恽': 'Y', '郓': 'Y', '宰': 'Z',
    '臧': 'Z', '曾': 'Z', '查': 'Z', '翟': 'Z', '詹': 'Z', '湛': 'Z', '张': 'Z', '章': 'Z',
    '长孙': 'Z', '仉': 'Z', '赵': 'Z', '甄': 'Z', '郑': 'Z', '支': 'Z', '钟': 'Z', '钟离': 'Z',
    '仲': 'Z', '仲孙': 'Z', '周': 'Z', '朱': 'Z', '诸葛': 'Z', '竺': 'Z', '祝': 'Z', '庄': 'Z',
    '卓': 'Z', '宗': 'Z', '宗政': 'Z', '邹': 'Z', '祖': 'Z', '左': 'Z', '佐': 'Z', '上官': 'S',
    '东方': 'D', '赫连': 'H', '皇甫': 'H', '尉迟': 'Y', '公羊': 'G', '澹台': 'T', '公冶': 'G',
    '濮阳': 'P', '淳于': 'C', '单于': 'S', '太叔': 'T', '申屠': 'S', '公孙': 'G', '令狐': 'L',
    '宇文': 'Y', '慕容': 'M'
  };
  
  // 检查复合姓氏（双字姓）
  if (name.length >= 2) {
    const doubleSurname = name.substring(0, 2);
    if (surnamePinyinMap[doubleSurname]) {
      return surnamePinyinMap[doubleSurname];
    }
  }
  
  // 单字姓氏处理
  return surnamePinyinMap[surname] || surname.toUpperCase();
}

// 按姓氏拼音排序学生
sortStudentsBySurname() {
  if (!this.students || this.students.length === 0) return;
  
  // 复制学生数组以避免修改原数组
  const studentsCopy = [...this.students];
  
  // 按姓氏拼音排序
  studentsCopy.sort((a, b) => {
    const surnameA = this.getSurnamePinyin(a.name);
    const surnameB = this.getSurnamePinyin(b.name);
    
    // 比较拼音首字母
    if (surnameA < surnameB) return this.sortDirection === 'asc' ? -1 : 1;
    if (surnameA > surnameB) return this.sortDirection === 'asc' ? 1 : -1;
    
    // 如果拼音首字母相同，按姓名全拼比较
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    if (nameA < nameB) return this.sortDirection === 'asc' ? -1 : 1;
    if (nameA > nameB) return this.sortDirection === 'asc' ? 1 : -1;
    
    return 0;
  });
  
  // 更新学生数组
  this.students = studentsCopy;
  
  // 更新排序状态
  this.currentSortMode = 'surname';
  
  // 重新渲染学生列表
  this.renderStudents();
  
  // 更新排序状态显示
  this.updateSortStatus();
}



// 应用排序
applySort() {
  const sortSelect = document.getElementById('sortMode');
  if (!sortSelect) return;
  
  const sortMode = sortSelect.value;
  
  switch (sortMode) {
    case 'surname-asc':
      this.sortDirection = 'asc';
      this.sortStudentsBySurname();
      break;
    case 'surname-desc':
      this.sortDirection = 'desc';
      this.sortStudentsBySurname();
      break;
    default:
      // 重置为原始顺序
      this.loadFromLocalStorage();
      this.currentSortMode = 'none';
      this.renderStudents();
      this.updateSortStatus();
      break;
  }
}

// 根据排序类型应用排序
applySortByType(sortType) {
  switch (sortType) {
    case 'name-asc':
      this.sortDirection = 'asc';
      this.sortStudentsBySurname();
      break;
    case 'name-desc':
      this.sortDirection = 'desc';
      this.sortStudentsBySurname();
      break;
    default:
      // 重置为原始顺序
      this.loadFromLocalStorage();
      this.currentSortMode = 'none';
      this.renderStudents();
      this.updateSortStatus();
      break;
  }
}

// 更新排序状态显示
updateSortStatus() {
  const sortStatusElement = document.getElementById('currentSortStatus');
  if (!sortStatusElement) return;
  
  let statusText = '';
  
  switch (this.currentSortMode) {
    case 'surname':
      statusText = this.sortDirection === 'asc' ? '当前：按姓氏拼音 A-Z' : '当前：按姓氏拼音 Z-A';
      break;
    default:
      statusText = '当前：默认排序';
      break;
  }
  
  sortStatusElement.textContent = statusText;
}

// 切换排序方向
toggleSortDirection() {
  this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
  
  // 如果当前有排序模式，重新应用排序
  if (this.currentSortMode === 'surname') {
    this.sortStudentsBySurname();
  }
}

// 初始化排序事件监听器
setupSortListeners() {
  // 主排序按钮事件 - 改为直接切换排序方向
  const sortByNameBtn = document.getElementById('sortByNameBtn');
  if (sortByNameBtn) {
    sortByNameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // 如果当前没有按姓氏排序，则设置为升序
      if (this.currentSortMode !== 'surname') {
        this.sortDirection = 'asc';
        this.sortStudentsBySurname();
      } else {
        // 如果已经在按姓氏排序，则切换方向
        this.toggleSortDirection();
      }
    });
  }
}
  
  // 打开技术支持模态框
  openTechSupportModal() {
    const modal = document.getElementById('techSupportModal');
    if (modal) {
      // 确保页面滚动被锁定
      document.body.style.overflow = 'hidden';
      // 添加动画效果
      setTimeout(() => {
        modal.classList.add('show');
      }, 10);
    }
  }
  
  // 关闭技术支持模态框
  closeTechSupportModal() {
    const modal = document.getElementById('techSupportModal');
    if (modal) {
      modal.classList.remove('show');
      // 恢复页面滚动
      document.body.style.overflow = '';
      // 延迟隐藏以确保动画完成
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    }
  }
}


// 隐藏加载遮罩
function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.remove(); }, 400);
  }
  document.body.classList.remove('loading');
}

// 初始化系统
document.addEventListener('DOMContentLoaded', () => {
  const initStart = Date.now();
  // 安全超时：最多3秒后强制显示页面
  const safetyTimer = setTimeout(() => {
    console.warn('加载超时，强制显示页面');
    hideLoadingOverlay();
  }, 3000);

  (async () => {
    console.time('[perf] total init');
    const system = new ClassPointsSystem();

    // 关键：先从服务器预加载数据到内存缓存，再初始化班级和学生数据
    let loadSuccess = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.time('[perf] preload+pet parallel');
        await Promise.all([
          system.preloadRemoteStorage(),
          system.petFeaturesReady || Promise.resolve()
        ]);
        console.timeEnd('[perf] preload+pet parallel');
        loadSuccess = true;
        break;
      } catch (e) {
        console.error(`数据加载第 ${attempt + 1} 次失败:`, e);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (!loadSuccess && window.USE_DATABASE) {
      hideLoadingOverlay();
      alert('数据加载失败，请刷新页面重试');
      return;
    }

    // 服务器数据已加载到内存缓存，现在可以安全地初始化班级和学生数据
    system.init();

    system.setupTimeFilterListeners();
    system.setupSortListeners();

    // 挂到全局方便调试（可选）
    window.pointsSystem = system;

    // 添加全局函数用于调用积分历史
    window.openStudentHistory = function(index) {
      console.log('全局函数openStudentHistory被调用', {index, system: !!window.pointsSystem});
      if (window.pointsSystem) {
        window.pointsSystem.openStudentHistory(index);
      } else {
        console.error('window.pointsSystem不存在');
        alert('系统未初始化完成，请稍后再试');
      }
    };

    window.openGroupHistory = function(index) {
      console.log('全局函数openGroupHistory被调用', {index, system: !!window.pointsSystem});
      if (window.pointsSystem) {
        window.pointsSystem.openGroupHistory(index);
      } else {
        console.error('window.pointsSystem不存在');
        alert('系统未初始化完成，请稍后再试');
      }
    };

    // 数据加载完成，隐藏遮罩
    clearTimeout(safetyTimer);
    console.timeEnd('[perf] total init');
    const elapsed = Date.now() - initStart;
    // 至少显示加载动画300ms，避免闪烁
    const minDelay = Math.max(0, 300 - elapsed);
    setTimeout(() => { hideLoadingOverlay(); }, minDelay);

    // 首次加载后自动刷新一次数据，确保显示最新
    setTimeout(() => {
      if (window.pointsSystem) {
        window.pointsSystem.loadFromLocalStorage();
        window.pointsSystem.renderRankings();
      }
    }, 500);
  })();
});
