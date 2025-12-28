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
      localStorage.setItem(`displayMode_${this.currentClassId}`, this.displayMode);
      localStorage.setItem('displayMode', this.displayMode);
    } catch (error) {
      console.error('保存显示模式失败:', error);
    }
  }
  
  this.renderStudents();
  this.renderGroups();
  this.saveAll();
}
	
  constructor(){
    // 添加全局配置属性
    this.globalRules = []; // 全局积分规则
    this.globalShopItems = []; // 全局商店商品
    this.globalGroupRules = []; // 全局小组规则
    this.currentConfigScope = 'global'; // 当前配置范围：global 或 class

	// 显示模式：'emoji' | 'local' - 强制使用'local'模式
  this.displayMode = 'local'; // 强制使用local模式，确保能看到上传的自定义图片
  // 立即更新localStorage中的显示模式
  if (this.safeLocalStorageSet) {
    this.safeLocalStorageSet('displayMode', this.displayMode);
    this.safeLocalStorageSet(`displayMode_${this.currentClassId}`, this.displayMode);
  } else {
    localStorage.setItem('displayMode', this.displayMode);
    localStorage.setItem(`displayMode_${this.currentClassId}`, this.displayMode);
  }
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
    
    // 初始化宠物功能
    this.initializePetFeatures();
    
    // 设置模态框点击外部关闭功能
    this.setupModalClickOutsideClose();
    
    this.init();
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
          } else if (modalId === 'randomNameModal') {
            this.closeRandomNameModal();
          } else if (modalId === 'timerModal') {
            this.closeTimerModal();
          }
        }
      });
    });
  }
  
  // 初始化宠物功能
  initializePetFeatures() {
    // 加载宠物图片配置
    this.initializePetImages();
    
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

// 初始化宠物图片配置
initializePetImages() {
  const savedPetImages = localStorage.getItem(`petImages_${this.currentClassId}`);
  if (savedPetImages) {
    try {
      const parsedImages = JSON.parse(savedPetImages);
      // 直接替换整个petImages对象，确保所有图片数据都被加载
      this.petImages = parsedImages;
      // 确保所有宠物类型都有完整的图片数据结构
      this.petTypes.forEach(type => {
        if (!this.petImages[type.id]) {
          this.petImages[type.id] = {};
        }
        for (let i = 1; i <= 6; i++) {
          const levelKey = `level${i}`;
          if (typeof this.petImages[type.id][levelKey] === 'undefined') {
            this.petImages[type.id][levelKey] = '';
          }
        }
      });
    } catch (error) {
      console.error('加载宠物图片配置失败:', error);
      // 如果加载失败，初始化空的图片数据结构
      this.petImages = {};
      this.petTypes.forEach(type => {
        this.petImages[type.id] = {};
        for (let i = 1; i <= 6; i++) {
          this.petImages[type.id][`level${i}`] = '';
        }
      });
    }
  } else {
    // 如果没有保存的图片数据，初始化空的图片数据结构
    this.petImages = {};
    this.petTypes.forEach(type => {
      this.petImages[type.id] = {};
      for (let i = 1; i <= 6; i++) {
        this.petImages[type.id][`level${i}`] = '';
      }
    });
  }
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
          <div style="display: flex; align-items: center;">
            <div class="pet-config-emoji" style="background: ${type.color}30; color: ${type.color}; padding: 8px; border-radius: 8px; font-size: 24px; margin-right: 15px;">
              ${type.emoji}
            </div>
            <div class="pet-config-basic-info">
            <input 
              type="text" 
              class="pet-config-name-input" 
              value="${type.name}" 
              data-pet-type="${type.id}"
              placeholder="宠物名称"
              style="width: 120px; margin-right: 10px;"
            >
            <input 
              type="text" 
              class="pet-config-emoji-input" 
              value="${type.emoji}" 
              data-pet-type="${type.id}"
              placeholder="表情符号"
              style="width: 60px; margin-right: 10px; text-align: center;"
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
          <button 
            class="btn btn-danger btn-sm delete-pet-type-btn" 
            data-pet-type="${type.id}"
            style="margin-left: 10px; padding: 4px 12px; font-size: 0.8em;"
          >
            删除
          </button>
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
  
  // 添加添加宠物类型按钮
  const addPetTypeBtn = document.createElement('button');
  addPetTypeBtn.className = 'btn btn-primary';
  addPetTypeBtn.textContent = '添加新宠物类型';
  addPetTypeBtn.style.marginTop = '20px';
  addPetTypeBtn.addEventListener('click', () => {
    this.addNewPetType();
  });
  container.appendChild(addPetTypeBtn);
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
          localStorage.setItem(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
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
          localStorage.setItem(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
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
          localStorage.setItem(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
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
              localStorage.setItem(`petStagesByType_${this.currentClassId}`, JSON.stringify(this.petStagesByType));
              
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
              localStorage.setItem(`petStages_${this.currentClassId}`, JSON.stringify(this.petStages));
              
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
}

// 上传宠物图片
uploadPetImage(file, petType, level) {
  console.log('🚀 uploadPetImage调用开始:', {file, petType, level, currentClassId: this.currentClassId});
  console.log('🔍 当前显示模式:', this.displayMode); // 添加显示模式日志
  
  // 参数完整性验证
  if (!file) {
    console.error('❌ 错误：未提供文件');
    this.showNotification('请选择要上传的图片文件！', 'error');
    return;
  }
  
  if (!petType || typeof level === 'undefined') {
    console.error('❌ 错误：缺少必要参数', {petType, level});
    this.showNotification('图片配置参数错误！', 'error');
    return;
  }
  
  // 验证文件类型
  if (!file.type.match('image.*')) {
    console.error('❌ 错误：文件类型无效', {fileType: file.type});
    this.showNotification('请上传有效的图片文件！', 'error');
    return;
  }
  
  // 验证文件大小（限制3MB，减少localStorage压力）
  const maxSize = 3 * 1024 * 1024;
  if (file.size > maxSize) {
    console.error('❌ 错误：文件过大', {fileSize: file.size, maxSize: maxSize});
    this.showNotification('图片大小不能超过3MB！', 'error');
    return;
  }
  
  // 显示上传中的提示
  const selector = `.pet-config-level input[data-pet-type="${petType}"][data-level="${level}"]`;
  console.log('🔍 查找上传输入框:', selector);
  const input = document.querySelector(selector);
  console.log('✅ 查找结果:', {inputFound: !!input});
  
  if (input) {
    const container = input.closest('.pet-config-upload');
    if (container) {
      const divContainer = input.closest('div[style*="position: absolute"]') || container.querySelector('div');
      if (divContainer) {
        divContainer.style.backgroundColor = '#f0fdf4';
        divContainer.style.borderColor = '#bbf7d0';
        divContainer.style.transition = 'all 0.3s ease';
      }
    }
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      console.log('文件读取成功');
      let imageData = e.target.result;
      const levelKey = `level${level}`;
      
      // 先定义saveImageData函数，确保在使用前初始化
      const saveImageData = (finalImageData) => {
        console.log('💾 saveImageData函数开始:', {finalImageDataLength: finalImageData.length, levelKey});
        
        // 保存图片数据到对应的配置对象
        // 保存图片数据到对应的配置对象
        console.log('👤 保存宠物图片数据');
        if (!this.petImages) {
          console.log('📂 初始化petImages对象');
          this.petImages = {};
        }
        if (!this.petImages[petType]) {
          console.log(`📂 初始化宠物类型 ${petType} 的数据结构`);
          this.petImages[petType] = {};
        }
        this.petImages[petType][levelKey] = finalImageData;
        console.log('✅ 图片数据保存成功:', {petType, levelKey, dataLength: finalImageData.length});
        
        // 更新UI
        if (input) {
          console.log('开始更新UI');
          // 简化DOM查找逻辑，直接查找最外层的上传容器
          const uploadContainer = input.closest('.pet-config-upload');
          if (uploadContainer) {
            // 查找上传提示容器（带虚线边框的div）
            const uploadPromptDiv = uploadContainer.querySelector('div[style*="position: absolute"]') || uploadContainer.querySelector('div');
            if (uploadPromptDiv) {
              // 清空容器内容，重新创建图片元素
              uploadPromptDiv.innerHTML = '';
              
              // 创建新图片元素
              const newImg = document.createElement('img');
              newImg.src = finalImageData;
              newImg.className = 'pet-config-image has-image';
              newImg.alt = `宠物图片 - 等级${level}`;
              newImg.style.maxWidth = '60px';
              newImg.style.maxHeight = '60px';
              newImg.style.objectFit = 'contain';
              newImg.style.border = '2px solid #3b82f6';
              newImg.style.borderRadius = '4px';
              
              // 将图片添加到上传提示容器
              uploadPromptDiv.appendChild(newImg);
              
              // 重新创建文件输入框（避免事件绑定问题）
              const newInput = document.createElement('input');
              newInput.type = 'file';
              newInput.accept = 'image/*';
              newInput.dataset.petType = petType;
              newInput.dataset.level = level;

              newInput.style.position = 'absolute';
              newInput.style.inset = '0';
              newInput.style.opacity = '0';
              newInput.style.cursor = 'pointer';
              newInput.style.zIndex = '2';
              
              // 重新绑定事件
              newInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                  this.uploadPetImage(file, petType, level);
                }
              });
              
              uploadPromptDiv.appendChild(newInput);
              console.log('图片元素已成功创建和更新');
            }
            
            // 恢复容器样式
            const divContainer = input.closest('div[style*="position: absolute"]') || uploadContainer.querySelector('div');
            if (divContainer) {
              divContainer.style.backgroundColor = '#f8fafc';
              divContainer.style.borderColor = '#3b82f6';
              divContainer.style.display = 'flex';
              divContainer.style.flexDirection = 'column';
              divContainer.style.justifyContent = 'center';
              divContainer.style.alignItems = 'center';
            }
          }
          
          // 启用移除按钮
          const petConfigLevel = input.closest('.pet-config-level');
          if (petConfigLevel) {
            // 更精确地查找移除按钮
            let removeBtn;
            if (isGroup) {
              removeBtn = petConfigLevel.querySelector('.group-remove-image');
            } else {
              removeBtn = petConfigLevel.querySelector(`button[data-pet-type="${petType}"][data-level="${level}"]`);
            }
            
            if (removeBtn) {
              removeBtn.disabled = false;
              removeBtn.style.opacity = '1';
              removeBtn.style.cursor = 'pointer';
              console.log('✅ 启用移除按钮成功:', {petType, level, isGroup});
            } else {
              console.warn('⚠️ 未找到移除按钮:', {petType, level, isGroup});
              // 如果找不到按钮，重新渲染整个宠物配置来确保UI同步
              if (isGroup) {
                this.renderGroupPetConfig();
              } else {
                this.renderPetConfig();
              }
            }
          }
        }
        
        // 保存到本地存储
        console.log('💾 开始保存到localStorage');
        try {
          const storageKey = `petImages_${this.currentClassId}`;
          console.log(`🔑 存储键名: ${storageKey}`);
          
          // 获取数据大小，监控存储空间使用
          const dataToSave = this.petImages;
          const jsonString = JSON.stringify(dataToSave);
          const dataSize = new Blob([jsonString]).size;
          console.log(`📊 数据大小: ${dataSize} bytes (约${(dataSize/1024).toFixed(2)} KB)`);
          
          localStorage.setItem(storageKey, jsonString);
          console.log('✅ 图片保存到localStorage成功');
          
          // 验证保存是否成功
          const savedData = localStorage.getItem(storageKey);
          if (savedData) {
            console.log('✅ 验证保存结果: 数据存在');
          } else {
            console.warn('⚠️ 验证保存结果: 数据保存后无法读取');
          }
          
          this.showNotification('图片上传成功！', 'success');
          
          // 保存成功后，更新相关卡片上的头像
          console.log('🔄 保存成功，更新相关卡片上的头像');
          this.renderStudents();
          this.renderGroups();
          this.renderRankings();
        } catch (storageError) {
          console.error('❌ localStorage保存失败:', {error: storageError, errorName: storageError.name, errorMessage: storageError.message});
          
          // 详细诊断存储错误类型
          if (storageError instanceof DOMException) {
            console.warn('⚠️ 存储错误类型:', storageError.name);
            if (storageError.name === 'QuotaExceededError' || storageError.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
              console.warn('⚠️ 存储空间配额超出');
            }
          }
          
          this.showNotification('图片保存失败！本地存储空间不足，请尝试使用较小的图片。', 'error');
          
          // 尝试清理缓存
          if (confirm('存储空间不足，是否尝试清理部分缓存数据？')) {
            console.log('🧹 用户确认清理缓存');
            this.clearOldCache();
          }
        }
      };
      
      // 图片压缩逻辑 - 在saveImageData函数定义后执行
      if (imageData.length > 200000) { // 如果超过200KB，尝试优化
        console.log('图片较大，尝试优化...');
        // 使用canvas进行简单压缩
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 200;
          const MAX_HEIGHT = 200;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          imageData = canvas.toDataURL(file.type, 0.8);
          console.log('图片优化完成，大小从', e.target.result.length, '减少到', imageData.length);
          
          // 保存优化后的图片
          saveImageData(imageData);
        };
        img.onerror = () => {
          console.error('图片压缩失败，使用原始数据');
          saveImageData(e.target.result);
        };
        img.src = imageData;
      } else {
        // 直接保存原始数据
        saveImageData(imageData);
      }
    } catch (error) {
      console.error('图片处理失败:', error);
      this.showNotification('图片处理失败，请重试！', 'error');
      // 恢复容器样式
      if (input) {
        const divContainer = input.closest('div[style*="position: absolute"]');
        if (divContainer) {
          divContainer.style.backgroundColor = '#f8fafc';
          divContainer.style.borderColor = '#ddd';
        }
      }
    }
  };
  reader.onerror = () => {
    this.showNotification('图片读取失败，请重试！', 'error');
    // 恢复容器样式
    if (input) {
      const divContainer = input.closest('div[style*="position: absolute"]');
      if (divContainer) {
        divContainer.style.backgroundColor = '#f8fafc';
        divContainer.style.borderColor = '#ddd';
      }
    }
  };
  reader.readAsDataURL(file);
}

// 移除宠物图片
removePetImage(petType, level) {
  const levelKey = `level${level}`;
  const targetImages = this.petImages;
  
  if (targetImages[petType] && targetImages[petType][levelKey]) {
    // 确认删除
    if (!confirm('确定要移除这张宠物图片吗？')) {
      return;
    }
    
    targetImages[petType][levelKey] = '';
    
    // 更新UI
    const selector = `.pet-config-level input[data-pet-type="${petType}"][data-level="${level}"]`;
    const input = document.querySelector(selector);
    if (input) {
      // 找到图片元素
      const img = input.parentElement.querySelector('img');
      if (img) {
        // 移除图片元素
        img.remove();
      }
      
      // 显示上传提示文本
      const uploadText = input.parentElement.querySelector('span');
      if (uploadText) {
        uploadText.style.display = 'block';
      } else {
        // 如果没有span元素，需要创建上传提示文本
        const uploadDiv = input.parentElement;
        const newSpan = document.createElement('span');
        newSpan.textContent = '上传图片';
        newSpan.style.fontSize = '0.9em';
        newSpan.style.color = '#64748b';
        newSpan.style.fontWeight = '500';
        uploadDiv.appendChild(newSpan);
      }
      
      // 禁用移除按钮
      const removeBtn = input.closest('.pet-config-level').querySelector('button[data-pet-type]');
      if (removeBtn) {
        removeBtn.disabled = true;
        removeBtn.style.opacity = '0.5';
        removeBtn.style.cursor = 'not-allowed';
      }
    }
    
    // 保存到本地存储
    this.saveAllPetConfig();
    
    // 显示成功提示
    this.showNotification('图片已移除！', 'info');
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
    localStorage.setItem(`petTypes_${this.currentClassId}`, JSON.stringify(this.petTypes));
    localStorage.setItem(`petStages_${this.currentClassId}`, JSON.stringify(this.petStages));
    localStorage.setItem(`groupStages_${this.currentClassId}`, JSON.stringify(this.groupStages)); // 保存小组等级配置
    localStorage.setItem(`petImages_${this.currentClassId}`, JSON.stringify(this.petImages));
    // groupLevels已废弃，不再保存
    localStorage.setItem(`studentPets_${this.currentClassId}`, JSON.stringify(this.studentPets));
    localStorage.setItem(`groupPets_${this.currentClassId}`, JSON.stringify(this.groupPets)); // 保存小组宠物选择
    
    this.showNotification('宠物配置保存成功！', 'success');
    return true;
  } catch (error) {
    console.error('保存宠物配置失败:', error);
    this.showNotification(`保存失败: ${error.message}`, 'error');
    return false;
  }
}

// 保存宠物图片配置（保留兼容性）
savePetImages() {
  try {
    localStorage.setItem(`petImages_${this.currentClassId}`, JSON.stringify(this.petImages));
    return true;
  } catch (error) {
    console.error('保存宠物图片失败:', error);
    this.showNotification('宠物图片保存失败', 'error');
    return false;
  }
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
    
    // 清空本地存储
    localStorage.removeItem(`petImages_${this.currentClassId}`);
    localStorage.removeItem(`groupPetImages_${this.currentClassId}`); // 同时清空小组宠物图片
    
    // 重新渲染配置界面
    this.renderPetConfig();
    
    this.showNotification('已恢复默认宠物配置！', 'success');
  }
}

// 清理旧缓存数据
// 检查localStorage是否可用
isLocalStorageAvailable() {
  try {
    const test = '__localStorage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (e) {
    return false;
  }
}

// 安全地获取localStorage数据
safeLocalStorageGet(key) {
  try {
    if (!this.isLocalStorageAvailable()) {
      console.warn('localStorage不可用');
      return null;
    }
    return localStorage.getItem(key);
  } catch (error) {
    console.error(`获取localStorage数据失败 [${key}]:`, error);
    return null;
  }
}

// 安全地设置localStorage数据
safeLocalStorageSet(key, value) {
  try {
    if (!this.isLocalStorageAvailable()) {
      console.warn('localStorage不可用');
      return false;
    }
    
    // 检查存储空间是否足够
    if (this.checkStorageSize(value) > 5) { // 如果数据大于5MB，尝试清理缓存
      console.warn(`数据过大 (${this.formatStorageSize(this.checkStorageSize(value))})，尝试清理缓存...`);
      this.clearOldCache();
    }
    
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`设置localStorage数据失败 [${key}]:`, error);
    // 存储空间不足时尝试清理缓存
    if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.warn('存储空间不足，尝试清理缓存...');
      if (this.clearOldCache()) {
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (retryError) {
          console.error('清理缓存后仍无法保存数据:', retryError);
        }
      }
    }
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
  try {
    if (!this.isLocalStorageAvailable()) {
      console.warn('localStorage不可用，无法清理缓存');
      return false;
    }
    
    // 保留必要的数据，清理可能不需要的大型历史数据
    const keysToKeep = [
      `petTypes_${this.currentClassId}`,
      `petStages_${this.currentClassId}`,
      `petImages_${this.currentClassId}`,
      `groupPetImages_${this.currentClassId}`,
      `groupLevels_${this.currentClassId}`,
      `studentPets_${this.currentClassId}`,
      `groupPets_${this.currentClassId}`,
      `students_${this.currentClassId}`,
      `groups_${this.currentClassId}`,
      `rules_${this.currentClassId}`,
      `groupRules_${this.currentClassId}`,
      'classPointsGlobalRules',
      'classPointsGlobalShopItems',
      'classPointsGlobalGroupRules',
      'classPointsClasses',
      'displayMode',
      `displayMode_${this.currentClassId}`
    ];
    
    let clearedCount = 0;
    // 创建一个副本以避免迭代时修改集合的问题
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }
    
    keys.forEach(key => {
      if (!keysToKeep.includes(key)) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    });
    
    this.showNotification(`已清理 ${clearedCount} 项缓存数据！`, 'success');
    return true;
  } catch (error) {
    console.error('清理缓存失败:', error);
    this.showNotification('清理缓存失败！', 'error');
    return false;
  }
}

// 渲染宠物选择界面
renderPetSelection(student) {
  const studentNameEl = document.getElementById('petSelectionStudentName');
  const currentPetPreview = document.getElementById('currentPetPreview');
  const petTypeGrid = document.getElementById('petTypeGrid');
  const petLevelPreviews = document.getElementById('petLevelPreviews');
  
  if (!studentNameEl || !currentPetPreview || !petTypeGrid || !petLevelPreviews) return;
  
  // 设置学生姓名和欢迎信息
  studentNameEl.innerHTML = `<span style="color: #3b82f6; font-weight: 600;">${student.name}</span>`;
  
  // 获取学生当前宠物选择
  const studentPet = this.studentPets[student.name] || {};
  const currentPetType = studentPet.petType || 'cat'; // 默认小猫
  
  // 显示当前宠物（带样式和信息）
  const petType = this.petTypes.find(type => type.id === currentPetType);
  currentPetPreview.innerHTML = `
    <div style="position: relative; display: inline-block;">
      <div style="font-size: 2.5em; padding: 20px; background: ${petType?.color}20; border-radius: 50%;">${petType?.emoji || '🐱'}</div>
      <div style="position: absolute; bottom: 5px; right: 5px; background: ${petType?.color || '#3b82f6'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</div>
    </div>
    <div style="margin-top: 10px; font-size: 1.2em; font-weight: 500; color: ${petType?.color || '#3b82f6'};">${petType?.name || '小猫'}</div>
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
      const baseEmoji = typeInfo?.emoji || '🐱';
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
  const petType = studentPet.petType || 'cat'; // 默认小猫
  
  // 计算学生当前等级 - 使用总积分以保持与等级显示一致
  const totalPoints = this.getStudentTotalPoints(student);
  const studentLevel = this.getLevel(totalPoints) - 1; // getLevel返回1-6，转为0-5
  const levelKey = `level${studentLevel + 1}`; // 0-5转为level1-level6
  
  // 根据显示模式返回对应的显示内容
  if (this.displayMode === 'local') {
    // 检查是否有自定义图片
    if (this.petImages && this.petImages[petType] && this.petImages[petType][levelKey]) {
      // 如果是数据URL，确保用img标签包裹
      const imageData = this.petImages[petType][levelKey];
      if (imageData.startsWith('data:image/')) {
        return `<img src="${imageData}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
      }
      return imageData;
    } else {
      // 如果没有自定义图片，显示默认emoji
      const emojiMap = {  
        0: '🥚', 1: '🐣', 2: '🐤', 3: '🐦', 4: '🕊️', 5: '🦅'
      };
      const validLevel = Math.max(0, Math.min(5, studentLevel));
      return emojiMap[validLevel] || '❓';
    }
  } else {
    // emoji模式下直接返回对应的宠物等级emoji
    const emojiMap = {  
      0: '🥚', 1: '🐣', 2: '🐤', 3: '🐦', 4: '🕊️', 5: '🦅'
    };
    const validLevel = Math.max(0, Math.min(5, studentLevel));
    return emojiMap[validLevel] || '❓';
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
  const petType = groupPet.petType || 'cat'; // 默认小猫
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
  const hasCustomImage = this.displayMode === 'local' && this.petImages && this.petImages[petType] && this.petImages[petType][levelKey];
  console.log(`🖼️ 自定义图片状态: ${hasCustomImage ? '存在' : '不存在'}`);
  
  if (hasCustomImage) {
    // 如果是数据URL，确保用img标签包裹
    const imageData = this.petImages[petType][levelKey];
    console.log(`📁 自定义图片数据: 长度=${imageData.length}, 类型=${imageData.startsWith('data:image/') ? '数据URL' : '其他'}`);
    
    if (imageData.startsWith('data:image/')) {
      const result = `<img src="${imageData}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
      console.log('✅ 返回自定义图片HTML');
      return result;
    }
    console.log('✅ 返回自定义图片数据');
    return imageData;
  } else {
    // 返回对应的宠物等级emoji
    const emojiMap = {  
      0: '🥚', 1: '🐣', 2: '🐤', 3: '🐦', 4: '🕊️', 5: '🦅'
    };
    const emoji = emojiMap[validLevel] || '🐾';
    console.log(`🔤 返回默认emoji: ${emoji} (对应等级${validLevel})`);
    return emoji; // 使用更友好的🐾符号替代❓
  }
}

// 保存学生宠物选择
saveStudentPets() {
  localStorage.setItem(`studentPets_${this.currentClassId}`, JSON.stringify(this.studentPets));
}

// 加载学生宠物选择
loadStudentPets() {
  const savedPets = localStorage.getItem(`studentPets_${this.currentClassId}`);
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
  const savedPets = localStorage.getItem(`groupPets_${this.currentClassId}`);
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
  const savedMode = localStorage.getItem(`displayMode_${this.currentClassId}`);
  if (savedMode) {
    this.displayMode = savedMode;
  }

  this.loadFromLocalStorage(); // 最后加载当前班级数据
  
  // 🆕 新增：数据修复调用（确保数据已加载）
  this.fixExistingData();
  
  // 加载宠物类型配置（在currentClassId正确设置后）
  const savedPetTypes = localStorage.getItem(`petTypes_${this.currentClassId}`);
  if (savedPetTypes) {
    try {
      const parsedTypes = JSON.parse(savedPetTypes);
      if (Array.isArray(parsedTypes) && parsedTypes.length > 0) {
        this.petTypes = parsedTypes;
      } else {
        // 如果解析失败或数组为空，使用默认宠物类型
        this.petTypes = [
          { id: 'cat', name: '小猫', emoji: '🐱', color: '#FFD93D' },
          { id: 'dog', name: '小狗', emoji: '🐶', color: '#FFA726' },
          { id: 'rabbit', name: '小兔', emoji: '🐰', color: '#E1BEE7' },
          { id: 'panda', name: '熊猫', emoji: '🐼', color: '#212121' },
          { id: 'fox', name: '狐狸', emoji: '🦊', color: '#FF9800' },
          { id: 'bear', name: '小熊', emoji: '🐻', color: '#795548' }
        ];
      }
    } catch (error) {
      console.error('加载宠物类型配置失败:', error);
      // 如果解析失败，使用默认宠物类型
      this.petTypes = [
        { id: 'cat', name: '小猫', emoji: '🐱', color: '#FFD93D' },
        { id: 'dog', name: '小狗', emoji: '🐶', color: '#FFA726' },
        { id: 'rabbit', name: '小兔', emoji: '🐰', color: '#E1BEE7' },
        { id: 'panda', name: '熊猫', emoji: '🐼', color: '#212121' },
        { id: 'fox', name: '狐狸', emoji: '🦊', color: '#FF9800' },
        { id: 'bear', name: '小熊', emoji: '🐻', color: '#795548' }
      ];
    }
  } else {
    // 如果没有保存的宠物类型配置，使用默认宠物类型
    this.petTypes = [
      { id: 'cat', name: '小猫', emoji: '🐱', color: '#FFD93D' },
      { id: 'dog', name: '小狗', emoji: '🐶', color: '#FFA726' },
      { id: 'rabbit', name: '小兔', emoji: '🐰', color: '#E1BEE7' },
      { id: 'panda', name: '熊猫', emoji: '🐼', color: '#212121' },
      { id: 'fox', name: '狐狸', emoji: '🦊', color: '#FF9800' },
      { id: 'bear', name: '小熊', emoji: '🐻', color: '#795548' }
    ];
  }
  
  // 加载宠物阶段配置（在currentClassId正确设置后）
  const savedPetStages = localStorage.getItem(`petStages_${this.currentClassId}`);
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
  const savedGroupStages = localStorage.getItem(`groupStages_${this.currentClassId}`);
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
  const tempRule = localStorage.getItem('tempTaskRule');
  if (tempRule) {
    this.applyTempTaskRule(JSON.parse(tempRule));
    localStorage.removeItem('tempTaskRule'); // 只用一次
  }
  
  // 初始化配置范围
  if (!this.currentConfigScope) {
    // 检查当前班级是否有自定义配置
    const data = localStorage.getItem(`classPointsData_${this.currentClassId}`);
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
  
  // 运行配置系统测试（仅在开发模式）
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    setTimeout(() => {
      if (this.testPetConfigSystem()) {
        this.showNotification('宠物配置系统测试通过', 'success');
      } else {
        this.showNotification('宠物配置系统测试失败', 'warning');
      }
    }, 1000);
  }
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
localStorage.setItem('currentClassId', this.currentClassId);

// 全屏功能
document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

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
  
  // 加载全局配置
  loadGlobalConfig() {
    // 全局积分规则
    const globalRulesData = localStorage.getItem('classPointsGlobalRules');
    this.globalRules = globalRulesData ? JSON.parse(globalRulesData) : this.getDefaultRules();
    
    // 全局商店商品
    const globalShopData = localStorage.getItem('classPointsGlobalShopItems');
    this.globalShopItems = globalShopData ? JSON.parse(globalShopData) : this.getDefaultShopItems();
    
    // 全局小组规则
    const globalGroupRulesData = localStorage.getItem('classPointsGlobalGroupRules');
    this.globalGroupRules = globalGroupRulesData ? JSON.parse(globalGroupRulesData) : this.getDefaultGroupRules();
    
    // 初始化当前使用的配置为全局配置
    this.rules = this.globalRules;
    this.shopItems = this.globalShopItems;
    this.groupRules = this.globalGroupRules;
  }
  
  // 保存全局配置
  saveGlobalConfig() {
    localStorage.setItem('classPointsGlobalRules', JSON.stringify(this.globalRules));
    localStorage.setItem('classPointsGlobalShopItems', JSON.stringify(this.globalShopItems));
    localStorage.setItem('classPointsGlobalGroupRules', JSON.stringify(this.globalGroupRules));
  }
  
  // 渲染等级积分设置
renderLevelSettings() {
  this.renderPetLevelSettings();
  this.renderGroupLevelSettings();
  this.renderScoreRatioSettings();
// 把两个总按钮插到“等级积分设置”标签页最底部
const tab=document.getElementById('levelSettingsTab');   // 等级设置标签页
const bottomBar=document.createElement('div');
bottomBar.style.display='flex';           // 横向排列
bottomBar.style.justifyContent='center';  // 居中
bottomBar.style.gap='12px';               // 按钮间距
bottomBar.style.margin='25px 0 10px 0';
bottomBar.innerHTML=
  '<button class="btn btn-warning" id="resetPetBtn">🔄 恢复个人宠物默认</button>'+
  '<button class="btn btn-warning" id="resetGroupBtn">🔄 恢复小组积分默认</button>';
tab.appendChild(bottomBar);
}



renderPetLevelSettings() {
  const container = document.getElementById('petLevelSettings');
  container.innerHTML = '';
  this.petStages.forEach((stage, i) => {
    const next = this.petStages[i + 1];
    const maxValue = next ? next.minPoints - 1 : '';
    const row = document.createElement('div');
    row.className = 'level-setting-item';

    row.innerHTML = `
      <div style="width: 80px; font-weight: bold; color: #374151;">${i + 1}级</div>
      <div>
        <input id="pet-min-${i}" type="number" value="${stage.minPoints}" min="0" style="width:70px">
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
    const next = this.groupStages[i + 1];
    const maxValue = next ? next.minPoints - 1 : '';
    const row = document.createElement('div');
    row.className = 'level-setting-item';

    row.innerHTML = `
      <div style="width: 80px; font-weight: bold; color: #374151;">${i + 1}级</div>
      <div>
        <input id="group-min-${i}" type="number" value="${stage.minPoints}" min="0" style="width:70px">
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
  if(!confirm('确定把个人宠物图片、名字、积分区间全部恢复成默认吗？')) return;
  // 1. 恢复默认数据
  this.petStages=[
    {name:'蛋',   img:'images/pet/1.png', minPoints:0,  maxPoints:20},
    {name:'孵化中',img:'images/pet/2.png', minPoints:20, maxPoints:50},
    {name:'雏鸟', img:'images/pet/3.png', minPoints:50, maxPoints:100},
    {name:'幼鸟', img:'images/pet/4.png', minPoints:100,maxPoints:200},
    {name:'成长鸟',img:'images/pet/5.png', minPoints:200,maxPoints:400},
    {name:'雄鹰', img:'images/pet/6.png', minPoints:400,maxPoints:Infinity}
  ];
  // 2. 存盘
  this.saveAll();
  // 3. 重新画界面
  this.renderPetLevelSettings();
  alert('已恢复个人宠物默认设置！');
}

resetGroupToDefault(){
  if(!confirm('确定把小组积分区间全部恢复成默认吗？')) return;
  this.groupStages=[
    {name:'青铜',img:'images/group/1.png', minPoints:0,  maxPoints:40},
    {name:'白银',img:'images/group/2.png', minPoints:40, maxPoints:100},
    {name:'黄金',img:'images/group/3.png', minPoints:100,maxPoints:200},
    {name:'铂金',img:'images/group/4.png', minPoints:200,maxPoints:400},
    {name:'钻石',img:'images/group/5.png', minPoints:400,maxPoints:800},
    {name:'王者',img:'images/group/6.png', minPoints:800,maxPoints:Infinity}
  ];
  this.saveAll();
  this.renderGroupLevelSettings();
  alert('已恢复小组等级默认设置！');
}
    
  // 加载班级列表
  loadClassesFromLocalStorage() {
    const classesData = localStorage.getItem('classPointsClasses');
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
    localStorage.setItem('classPointsClasses', JSON.stringify(this.classes));
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
      toggleBtn.textContent = isHidden ? '↑ 收起' : '⋯ 更多';
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
  localStorage.setItem(`classPointsData_${this.currentClassId}`, JSON.stringify(data));
  
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
    localStorage.setItem(`groupStages_${this.currentClassId}`, JSON.stringify(groupStagesData));
  }
  
  this.updateClassStudentCount();
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
loadAllPetConfig() {
  try {
    if (!this.currentClassId) return false;
    
    // 加载宠物类型配置
    const savedPetTypes = localStorage.getItem(`petTypes_${this.currentClassId}`);
    if (savedPetTypes) {
      try {
        const parsedTypes = JSON.parse(savedPetTypes);
        // 合并保存的宠物类型数据，保留默认类型的结构
        parsedTypes.forEach(savedType => {
          const existingType = this.petTypes.find(t => t.id === savedType.id);
          if (existingType) {
            Object.assign(existingType, savedType);
          }
        });
      } catch (error) {
        console.error('加载宠物类型配置失败:', error);
        this.showNotification('宠物类型配置加载失败', 'warning');
      }
    }
    
    // 加载个人宠物阶段配置
    const savedPetStages = localStorage.getItem(`petStages_${this.currentClassId}`);
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
    
    // 加载小组阶段配置
    const savedGroupStages = localStorage.getItem(`groupStages_${this.currentClassId}`);
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
    
    // 加载宠物图片配置
    const savedPetImages = localStorage.getItem(`petImages_${this.currentClassId}`);
    if (savedPetImages) {
      try {
        const parsedImages = JSON.parse(savedPetImages);
        if (typeof parsedImages === 'object') {
          this.petImages = parsedImages;
          // 确保所有宠物类型都有图片数据结构
          this.petTypes.forEach(type => {
            if (!this.petImages[type.id]) {
              this.petImages[type.id] = {};
              for (let i = 1; i <= 6; i++) {
                this.petImages[type.id][`level${i}`] = '';
              }
            }
          });
        }
      } catch (error) {
        console.error('加载宠物图片配置失败:', error);
        this.showNotification('宠物图片配置加载失败', 'warning');
      }
    }
    
    // 加载小组宠物图片配置（新增）
    const savedGroupPetImages = localStorage.getItem(`groupPetImages_${this.currentClassId}`);
    if (savedGroupPetImages) {
      try {
        const parsedGroupImages = JSON.parse(savedGroupPetImages);
        if (typeof parsedGroupImages === 'object') {
          this.groupPetImages = parsedGroupImages;
          // 确保所有宠物类型都有小组图片数据结构
          this.petTypes.forEach(type => {
            if (!this.groupPetImages[type.id]) {
              this.groupPetImages[type.id] = {};
              for (let i = 1; i <= 6; i++) {
                this.groupPetImages[type.id][`level${i}`] = '';
              }
            }
          });
        }
      } catch (error) {
        console.error('加载小组宠物图片配置失败:', error);
        this.showNotification('小组宠物图片配置加载失败', 'warning');
      }
    }
    
    // groupLevels数据结构已废弃，所有功能都基于groupStages
    // 注意：小组等级配置已在loadFromLocalStorage()中加载，此处不再重复加载
    
    // 加载学生宠物选择数据
    const savedStudentPets = localStorage.getItem(`studentPets_${this.currentClassId}`);
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
    const savedGroupPets = localStorage.getItem(`groupPets_${this.currentClassId}`);
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
    const savedGroupAvatars = localStorage.getItem(`groupAvatars_${this.currentClassId}`);
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
  const savedPetStages = localStorage.getItem(`petStages_${this.currentClassId}`);
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
  
  // 为每个宠物类型复制一份等级数据
  this.petTypes.forEach(type => {
    this.petStagesByType[type.id] = JSON.parse(JSON.stringify(this.petStages));
  });
}

// 修改原有的加载方法，按班级ID加载数据
loadFromLocalStorage(){
  if (!this.currentClassId) return;
  
  const data = localStorage.getItem(`classPointsData_${this.currentClassId}`);
  if(data){
    try{
      const parsed = JSON.parse(data);
      this.students = parsed.students || [];
      this.groups = parsed.groups || [];
      this.history = parsed.history || [];
      // 加载成绩比例设置
      this.scoreToPointsRatio = parsed.scoreToPointsRatio || 10;
      
      // 优先从按宠物类型独立存储的petStagesByType加载个人等级数据
      const savedPetStagesByType = localStorage.getItem(`petStagesByType_${this.currentClassId}`);
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
      const savedGroupStages = localStorage.getItem(`groupStages_${this.currentClassId}`);
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
  
  // 无论是否找到班级数据，都加载宠物配置
  this.loadAllPetConfig();
  
  const title = localStorage.getItem(`mainTitle_${this.currentClassId}`) || 
                localStorage.getItem('mainTitle') || 
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
  const savedMode = localStorage.getItem(`displayMode_${this.currentClassId}`);
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
localStorage.setItem('currentClassId', classId);
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
    localStorage.removeItem(`classPointsData_${classId}`);
    localStorage.removeItem(`mainTitle_${classId}`);
    
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
    document.getElementById('lockBtn').addEventListener('click',()=>this.toggleLock());
    document.getElementById('batchBtn').addEventListener('click',()=>{
      if(this.isLocked) return;
      this.openBatchModal();
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

	  const studentData = this.students.map(stu => {
		const totalPoints = stu.points + (stu.purchases || []).reduce((sum, p) => sum + p.cost, 0);
		const stage = this.getStudentPetStage(stu);
		return {
		  name: stu.name,
		  avatar: stage.emoji
		};
	  });

	  const query = new URLSearchParams({
		students: JSON.stringify(studentData),
		className: this.currentClassName
	  });

	  window.location.href = `renwu.html?${query.toString()}`;
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
        localStorage.setItem(`mainTitle_${this.currentClassId}`, document.getElementById('mainTitle').textContent);
      } else {
        localStorage.setItem('mainTitle', document.getElementById('mainTitle').textContent);
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

// 个人规则 txt 导出
document.getElementById('ruleTxtExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalRules : this.rules;
  if (!target.length) return alert('当前没有个人规则可导出');
  const content = target.map(r => `${r.name}|${r.points}`).join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `个人积分规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
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

// 小组规则 txt 导出
document.getElementById('groupRuleTxtExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalGroupRules : this.groupRules;
  if (!target.length) return alert('当前没有小组规则可导出');
  const content = target.map(r => `${r.name}|${r.points}`).join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `小组积分规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// 商店规则导入
document.getElementById('shopRuleImport')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw '文件格式不正确，应为商品数组';
      
      // 验证每个商品项的格式
      const validItems = data.filter(item => {
        return item && typeof item.name === 'string' && 
               typeof item.cost === 'number' && item.cost > 0 &&
               (item.stock === null || (typeof item.stock === 'number' && item.stock >= 0));
      });
      
      if (!validItems.length) throw '没有有效的商品数据';
      
      // 根据当前配置范围决定导入到哪个数组
      const targetArray = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
      
      // 询问用户是否替换现有数据
      const shouldReplace = confirm(`检测到 ${validItems.length} 个有效商品。\n\n选择"确定"将替换现有商品，选择"取消"将追加到现有商品列表。`);
      
      if (shouldReplace) {
        // 替换现有数据
        targetArray.length = 0;
        targetArray.push(...validItems);
      } else {
        // 追加到现有数据
        targetArray.push(...validItems);
      }
      
      // 保存数据
      if (this.currentConfigScope === 'global') {
        this.saveGlobalConfig();
      }
      this.saveAll();
      this.renderShopList();
      
      alert(`成功导入 ${validItems.length} 个商品！`);
    } catch (err) {
      alert('导入失败：' + err);
      e.target.value = ''; // 允许重复导入同一文件
    }
  };
  reader.readAsText(file, 'utf-8');
});

// 商店规则导出
document.getElementById('shopRuleExport')?.addEventListener('click', () => {
  const target = this.currentConfigScope === 'global' ? this.globalShopItems : this.shopItems;
  if (!target.length) return alert('当前没有商品可导出');
  
  const data = JSON.stringify(target, null, 2);
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `商店商品规则_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
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
  this.groups.forEach((group, i) => {
    const stage = this.getGroupStage(group.points, group.name);
    const level = this.getGroupLevel(group.points, group.name);

    // 显示小组头像（优先显示自定义emoji头像，其次显示宠物形象）
    let showContent;
    const groupAvatars = this.loadGroupAvatars();
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
    // 直接使用学生的总积分（包括所有历史积分和兑换记录）
    let totalPoints = this.getStudentTotalPoints(student);
    
    // 如果指定了时间段，需要筛选该时间段内的积分
    if (start && end) {
      // 筛选时间段内的历史积分
      const periodHistoryPoints = (student.history || [])
        .filter(isInPeriod)
        .reduce((sum, h) => {
          const pointsValue = parseInt(h.points) || 0;
          return sum + pointsValue;
        }, 0);
      
      // 筛选时间段内的兑换积分
      const periodPurchaseDeductions = (student.purchases || [])
        .filter(isInPeriod)
        .reduce((sum, p) => {
          const costValue = parseInt(p.cost) || 0;
          return sum + costValue;
        }, 0);
      
      // 时间段内的总积分 = 时间段内历史积分 - 时间段内兑换积分
      totalPoints = periodHistoryPoints - periodPurchaseDeductions;
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
          
          // 净积分 = 获得的积分 - 兑换花费
          points += memberEarnedPoints - memberSpentPoints;
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
    
    // 获取小组当前宠物选择
    const groupPet = this.groupPets[group.name] || {};
    const currentPetType = groupPet.petType || 'cat'; // 默认小猫
    
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
        <div style="font-size: 2.5em; padding: 20px; background: ${petType?.color}20; border-radius: 50%;">${petType?.emoji || '🐱'}</div>
        <div style="position: absolute; bottom: 5px; right: 5px; background: ${petType?.color || '#3b82f6'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</div>
      </div>
      <div style="margin-top: 10px; font-size: 1.2em; font-weight: 500; color: ${petType?.color || '#3b82f6'};">${petType?.name || '小猫'}</div>
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
              <div style="font-size: 2.5em; padding: 20px; background: ${petTypeInfo?.color}20; border-radius: 50%;">${petTypeInfo?.emoji || '🐱'}</div>
              <div style="position: absolute; bottom: 5px; right: 5px; background: ${petTypeInfo?.color || '#3b82f6'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold;">1</div>
            </div>
            <div style="margin-top: 10px; font-size: 1.2em; font-weight: 500; color: ${petTypeInfo?.color || '#3b82f6'};">${petTypeInfo?.name || '小猫'}</div>
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
    
    alert(`小组宠物已成功设置为${this.petTypes.find(type => type.id === petType)?.name || '小猫'}！`);
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
		const data = localStorage.getItem(`classPointsData_${this.currentClassId}`);
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
	  
	  const blob = new Blob([JSON.stringify(globalData, null, 2)], {type: 'application/json'});
	  const url = URL.createObjectURL(blob);
	  const a = document.createElement('a');
	  a.href = url;
	  a.download = filename;
	  a.click();
	  URL.revokeObjectURL(url);
	  
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
      const classData = localStorage.getItem(`classPointsData_${cls.id}`);
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
        
        localStorage.setItem(`classPointsData_${cls.id}`, JSON.stringify(data));
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
    
    // 按学生/小组统计
    const studentStats = {};
    const groupStats = {};
    let totalPoints = 0;
    
    history.forEach(record => {
      if(record.type === 'student') {
        if(!studentStats[record.name]) {
          studentStats[record.name] = { points: 0, records: [] };
        }
        studentStats[record.name].points += record.points;
        studentStats[record.name].records.push(record);
        totalPoints += record.points;
      } else if(record.type === 'group') {
        if(!groupStats[record.group]) {
          groupStats[record.group] = { points: 0, records: [] };
        }
        groupStats[record.group].points += record.points;
        groupStats[record.group].records.push(record);
        totalPoints += record.points;
      } else if(record.type === 'purchase') {
        // 购买记录不计入总积分变化
        if(!studentStats[record.name]) {
          studentStats[record.name] = { points: 0, records: [] };
        }
        studentStats[record.name].points -= record.cost;
        studentStats[record.name].records.push(record);
        totalPoints -= record.cost;
      }
    });
    
    let html = `
      <div class="statistics-summary">
        <h4>${title}</h4>
        <p>总积分变化: ${totalPoints > 0 ? '+' : ''}${totalPoints}</p>
        <p>记录总数: ${history.length}</p>
      </div>
    `;
    
    if(Object.keys(studentStats).length > 0) {
      html += '<h4>个人积分统计</h4><table class="statistics-table"><tr><th>姓名</th><th>积分变化</th><th>记录数</th></tr>';
      Object.entries(studentStats).forEach(([name, stats]) => {
        html += `<tr><td>${name}</td><td>${stats.points > 0 ? '+' : ''}${stats.points}</td><td>${stats.records.length}</td></tr>`;
      });
      html += '</table>';
    }
    
    if(Object.keys(groupStats).length > 0) {
      html += '<h4>小组积分统计</h4><table class="statistics-table"><tr><th>小组</th><th>积分变化</th><th>记录数</th></tr>';
      Object.entries(groupStats).forEach(([group, stats]) => {
        html += `<tr><td>${group}</td><td>${stats.points > 0 ? '+' : ''}${stats.points}</td><td>${stats.records.length}</td></tr>`;
      });
      html += '</table>';
    }
    
    if(Object.keys(studentStats).length === 0 && Object.keys(groupStats).length === 0) {
      html += '<p>该时间段内无积分记录</p>';
    }
    
    container.innerHTML = html;
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
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `随机点名记录_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
	  
	  this.applyRuleToStudent(this.currentStudent, ruleName, points);
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
	  
	  this.applyRuleToGroup(this.currentGroup, ruleName, points);
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
	  
	  // 应用规则到所有选中的学生
	  selectedIndexes.forEach(index => {
		this.applyRuleToStudent(index, ruleName, points);
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
  
  // 应用规则到所有选中的小组
  selectedIndexes.forEach(index => {
    this.applyRuleToGroup(index, ruleName, points);
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
    // 根据学生名称获取对应的宠物类型
    let petType = null;
    if (studentName && this.studentPets && this.studentPets[studentName]) {
      petType = this.studentPets[studentName].petType;
    }
    
    // 如果该宠物类型有独立的等级名称存储，使用对应的等级数据
    let stagesToUse = this.petStages;
    if (petType && this.petStagesByType && this.petStagesByType[petType]) {
      stagesToUse = this.petStagesByType[petType];
    }
    
    for(let i = stagesToUse.length - 1; i >= 0; i--){
      if(points >= stagesToUse[i].minPoints){
        // 根据显示模式返回不同的等级名称
        const stage = {...stagesToUse[i]};
        if (this.displayMode === 'emoji') {
          // emoji模式下使用默认等级名称
          const defaultStages = this.getDefaultPetStages();
          if (defaultStages[i]) {
            stage.name = defaultStages[i].name;
          }
        } else {
          // 自定义模式下使用自定义等级名称
          stage.name = stagesToUse[i].name;
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
      }
    } else {
      // 自定义模式下使用自定义等级名称
      stage.name = stagesToUse[0].name;
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
  
  getStageProgress(points, studentName = null){
    const stage=this.getPetStage(points, studentName);
    if(stage.maxPoints===Infinity) return 100;
    
    const current=points-stage.minPoints;
    const total=stage.maxPoints-stage.minPoints;
    return Math.min(100,(current/total)*100);
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
    if(stage.maxPoints===Infinity) return 100;
    
    const current=points-stage.minPoints;
    const total=stage.maxPoints-stage.minPoints;
    return Math.min(100,(current/total)*100);
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
    localStorage.setItem(`groupAvatars_${this.currentClassId}`, JSON.stringify(groupAvatars));
  }
  
  // 加载小组头像数据
  loadGroupAvatars() {
    try {
      const data = localStorage.getItem(`groupAvatars_${this.currentClassId}`);
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
		  localStorage.removeItem(`mainTitle_${this.currentClassId}`);
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
  const data = {
    classId: this.currentClassId,
    className: this.currentClassName,
    students: this.students,
    groups: this.groups,
    history: this.history,
    
    // 🔧 修复：添加等级积分设置
    scoreToPointsRatio: this.scoreToPointsRatio,
    petStages: this.petStages,
    // 导出小组等级时只包含积分范围，不包含自定义名称
    groupStages: this.groupStages.map(stage => ({
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
    rules: this.rules,
    shopItems: this.shopItems,
    groupRules: this.groupRules,
    
    // 如果是班级配置，也保存班级的自定义配置
    usesCustomRules: this.currentConfigScope === 'class',
    usesCustomShopItems: this.currentConfigScope === 'class',
    usesCustomGroupRules: this.currentConfigScope === 'class',
    
    // 如果是班级配置且使用了自定义配置，保存班级的配置数据
    classRules: this.currentConfigScope === 'class' ? this.rules : [],
    classShopItems: this.currentConfigScope === 'class' ? this.shopItems : [],
    classGroupRules: this.currentConfigScope === 'class' ? this.groupRules : [],
    
    // 🔧 修复：导出完整的全局配置信息
    globalRules: this.globalRules,
    globalShopItems: this.globalShopItems,
    globalGroupRules: this.globalGroupRules,
    
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
  const filename = `${this.currentClassName}_班级完整数据备份_${timestamp}.json`;
  
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  let exportMessage = `备份导出成功！\n包含：\n- ${this.students.length} 名学生\n- ${this.groups.length} 个小组\n- ${this.rules.length} 条个人规则\n- ${this.groupRules.length} 条小组规则\n- ${this.shopItems.length} 个商店商品`;
  exportMessage += `\n- 个人等级配置（${this.petStages.length}个等级）`;
  exportMessage += `\n- 小组等级配置（${this.groupStages.length}个等级）`;
  exportMessage += `\n- 成绩积分比例：${this.scoreToPointsRatio}:1`;
  exportMessage += `\n- 使用${this.currentConfigScope}配置`;
  
  alert(exportMessage);
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
		const classData = localStorage.getItem(`classPointsData_${cls.id}`);
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
			
			localStorage.setItem(`classPointsData_${cls.id}`, JSON.stringify(data));
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
  
  const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `系统配置_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
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

  window.location.href = `renwu.html?${query.toString()}`;
}

deleteTaskRecord(recordIndex) {
  if (!confirm('确定删除这条任务记录吗？')) return;
  this.taskRecords.splice(recordIndex, 1);
  this.saveAll();
  this.renderTaskRecords();
  alert('记录已删除');
}
}



// 初始化系统
document.addEventListener('DOMContentLoaded', () => {
  const system = new ClassPointsSystem();
  system.loadFromLocalStorage();          // 加载数据
  system.setupTimeFilterListeners();      // 👈 关键！绑定时间按钮事件
  system.renderRankings();                // 初始渲染排行榜

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
});