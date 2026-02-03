# 📊 数据统计仪表盘组件使用文档

## 📦 组件特点

✅ **完全本地化** - 无外部CDN依赖，支持离线使用
✅ **零依赖** - 纯CSS + JavaScript实现
✅ **响应式设计** - 自适应各种屏幕尺寸
✅ **动画效果** - 流畅的加载和交互动画
✅ **轻量级** - 总大小不到10KB
✅ **易于集成** - 简单的API，3步完成集成

---

## 🚀 快速开始

### 1. 引入文件

在HTML页面的 `<head>` 中引入CSS：

```html
<link rel="stylesheet" href="dashboard-stats.css">
```

在 `</body>` 之前引入JavaScript：

```html
<script src="dashboard-stats.js"></script>
```

### 2. 添加容器

在HTML中添加一个容器元素：

```html
<div id="myDashboard" class="dashboard-stats"></div>
```

### 3. 初始化和渲染

```javascript
// 创建实例
const dashboard = new DashboardStats('myDashboard');

// 准备数据
const statsData = [
  {
    label: '学生总数',
    value: 2,
    percentage: 75,
    color: 'purple'
  },
  {
    label: '班级数',
    value: 1,
    percentage: 50,
    color: 'orange'
  }
];

// 渲染
dashboard.render(statsData);
```

---

## 📖 API文档

### 构造函数

```javascript
new DashboardStats(containerId)
```

**参数：**
- `containerId` (string) - 容器元素的ID

**示例：**
```javascript
const dashboard = new DashboardStats('myDashboard');
```

---

### 方法

#### render(statsData)

渲染仪表盘数据。

**参数：**
- `statsData` (Array) - 统计数据数组

**statsData 对象属性：**

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `label` | string | 是 | - | 统计项标签 |
| `value` | number | 是 | - | 统计值 |
| `percentage` | number | 否 | 100 | 圆环进度(0-100) |
| `color` | string | 否 | 'blue' | 颜色主题 |
| `showPercentage` | boolean | 否 | false | 值是否显示%符号 |
| `trend` | object | 否 | null | 趋势指示器 |

**颜色主题选项：**
- `purple` - 紫色 (#9f7aea)
- `orange` - 橙色 (#ed8936)
- `green` - 绿色 (#48bb78)
- `pink` - 粉色 (#ed64a6)
- `blue` - 蓝色 (#4299e1)
- `red` - 红色 (#f56565)
- `yellow` - 黄色 (#ecc94b)
- `teal` - 青色 (#38b2ac)

**示例：**
```javascript
dashboard.render([
  {
    label: '学生总数',
    value: 50,
    percentage: 75,
    color: 'purple',
    trend: { direction: 'up', value: '+5 本周' }
  },
  {
    label: '及格率',
    value: 85,
    percentage: 85,
    color: 'green',
    showPercentage: true
  }
]);
```

---

#### update(index, newData)

更新单个统计项。

**参数：**
- `index` (number) - 统计项索引
- `newData` (object) - 新数据

**示例：**
```javascript
dashboard.update(0, { value: 100, percentage: 90 });
```

---

#### showLoading()

显示加载状态。

**示例：**
```javascript
dashboard.showLoading();

// 模拟数据加载
setTimeout(() => {
  dashboard.render(statsData);
}, 1000);
```

---

## 💡 使用示例

### 示例1：基础使用

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="dashboard-stats.css">
</head>
<body>
  <div id="dashboard" class="dashboard-stats"></div>

  <script src="dashboard-stats.js"></script>
  <script>
    const dashboard = new DashboardStats('dashboard');
    dashboard.render([
      { label: '总用户', value: 1234, percentage: 80, color: 'purple' },
      { label: '活跃用户', value: 567, percentage: 60, color: 'green' }
    ]);
  </script>
</body>
</html>
```

### 示例2：成绩管理系统

```javascript
const gradeDashboard = new DashboardStats('gradeDashboard');

// 从API获取数据
fetch('/api/students/summary')
  .then(res => res.json())
  .then(data => {
    gradeDashboard.render([
      {
        label: '学生总数',
        value: data.totalStudents,
        percentage: 75,
        color: 'purple'
      },
      {
        label: '平均分',
        value: data.avgScore,
        percentage: (data.avgScore / 100) * 100,
        color: 'orange'
      },
      {
        label: '及格率',
        value: data.passRate,
        percentage: data.passRate,
        color: 'green',
        showPercentage: true
      },
      {
        label: '优秀率',
        value: data.excellentRate,
        percentage: data.excellentRate,
        color: 'blue',
        showPercentage: true
      }
    ]);
  });
```

### 示例3：带趋势的积分系统

```javascript
const pointsDashboard = new DashboardStats('pointsDashboard');

pointsDashboard.render([
  {
    label: '总积分',
    value: 12500,
    percentage: 85,
    color: 'purple',
    trend: { direction: 'up', value: '+1200 本周' }
  },
  {
    label: '兑换次数',
    value: 45,
    percentage: 30,
    color: 'orange',
    trend: { direction: 'down', value: '-5 本周' }
  }
]);
```

### 示例4：动态更新

```javascript
const dashboard = new DashboardStats('dashboard');

// 初始渲染
dashboard.render([
  { label: '在线用户', value: 0, percentage: 0, color: 'green' }
]);

// 定时更新
setInterval(() => {
  const onlineUsers = Math.floor(Math.random() * 1000);
  dashboard.update(0, {
    value: onlineUsers,
    percentage: (onlineUsers / 1000) * 100
  });
}, 5000);
```

---

## 🎨 自定义样式

### 修改卡片圆角

```css
.stat-card {
  border-radius: 20px; /* 默认: 12px */
}
```

### 修改字体大小

```css
.stat-value {
  font-size: 36px; /* 默认: 32px */
}

.stat-label {
  font-size: 16px; /* 默认: 14px */
}
```

### 修改圆环粗细

```css
.circle-bg,
.circle-progress {
  stroke-width: 5; /* 默认: 3.8 */
}
```

### 添加自定义颜色

```css
.stat-card.custom .circle-progress {
  stroke: #your-color;
}

.stat-card.custom::before {
  background: #your-color;
}
```

使用：
```javascript
dashboard.render([
  { label: '自定义', value: 100, color: 'custom' }
]);
```

---

## 📱 响应式布局

组件自动适配不同屏幕尺寸：

- **桌面** (≥1025px): 4列网格
- **平板** (769-1024px): 2列网格
- **手机** (<768px): 1列网格

---

## 🔧 集成到现有项目

### grades.html 集成示例

```html
<!-- 在 <head> 中添加 -->
<link rel="stylesheet" href="dashboard-stats.css">

<!-- 在页面内容区添加 -->
<div id="statsOverview" class="dashboard-stats"></div>

<!-- 在 </body> 前添加 -->
<script src="dashboard-stats.js"></script>
<script>
  // 创建仪表盘
  const statsOverview = new DashboardStats('statsOverview');

  // 渲染数据
  function updateDashboard() {
    // 从页面数据计算统计
    statsOverview.render([
      {
        label: '学生总数',
        value: document.querySelectorAll('.student-row').length,
        percentage: 75,
        color: 'purple'
      }
      // ... 更多统计项
    ]);
  }

  // 初始加载
  updateDashboard();
</script>
```

---

## 🐛 常见问题

### Q: 为什么圆环不显示？

A: 确保 `percentage` 值在 0-100 之间。

### Q: 如何隐藏圆环？

A: 设置 CSS：
```css
.stat-chart {
  display: none;
}
```

### Q: 数值太大显示不全？

A: 组件会自动添加千位分隔符。如需自定义格式，修改 `createStatCard` 方法中的 `displayValue`。

### Q: 如何添加点击事件？

A: 在渲染后添加：
```javascript
dashboard.render(statsData);

document.querySelectorAll('.stat-card').forEach((card, index) => {
  card.addEventListener('click', () => {
    console.log('点击了第', index, '个卡片');
  });
});
```

---

## 📄 文件清单

- `dashboard-stats.css` - 样式文件 (~4KB)
- `dashboard-stats.js` - 脚本文件 (~5KB)
- `dashboard-example.html` - 示例页面
- `DASHBOARD_README.md` - 使用文档

---

## 📞 支持

如有问题或建议，请查看示例页面 `dashboard-example.html` 或参考本文档。

---

**最后更新**: 2025-11-30
