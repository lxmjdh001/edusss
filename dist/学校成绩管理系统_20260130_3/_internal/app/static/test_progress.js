// 进度条计算逻辑测试脚本
// 专门测试负分情况下进度条显示问题

// 模拟ClassPointsSystem类的核心方法
class MockClassPointsSystem {
  constructor() {
    // 默认宠物等级配置
    this.defaultStages = [
      { name: "蛋", minPoints: 0, maxPoints: 20, emoji: "🥚" },
      { name: "幼崽", minPoints: 20, maxPoints: 50, emoji: "🐣" },
      { name: "成长", minPoints: 50, maxPoints: 100, emoji: "🐥" },
      { name: "成熟", minPoints: 100, maxPoints: 200, emoji: "🐔" },
      { name: "精英", minPoints: 200, maxPoints: 400, emoji: "🦚" },
      { name: "传说", minPoints: 400, maxPoints: Infinity, emoji: "🐉" }
    ];
  }
  
  // 获取宠物阶段（修复后的逻辑）
  getPetStage(points, studentName = null) {
    const stages = this.defaultStages;
    
    // 当分数低于所有阶段的最小分数时，返回最低等级
    if (points < stages[0].minPoints) {
      return stages[0];
    }
    
    // 找到对应的阶段
    for (let i = stages.length - 1; i >= 0; i--) {
      if (points >= stages[i].minPoints) {
        return stages[i];
      }
    }
    
    return stages[0];
  }
  
  // 修复后的进度条计算方法
  getStageProgress(points, studentName = null) {
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
  
  // 修复前的进度条计算方法（用于对比）
  getStageProgressOld(points, studentName = null) {
    const stage = this.getPetStage(points, studentName);
    if (stage.maxPoints === Infinity) return 100;
    
    const current = points - stage.minPoints;
    const total = stage.maxPoints - stage.minPoints;
    return Math.min(100, (current / total) * 100);
  }
}

// 运行测试
function runTests() {
  const system = new MockClassPointsSystem();
  
  console.log("=== 进度条计算逻辑测试（修复前后对比） ===\n");
  
  // 测试用例：重点关注负分情况
  const testCases = [
    { points: -1000, description: "极端负分" },
    { points: -100, description: "负分" },
    { points: -50, description: "负分" },
    { points: -10, description: "负分" },
    { points: -1, description: "负分边界" },
    { points: 0, description: "零分" },
    { points: 10, description: "正分" },
    { points: 50, description: "正分" }
  ];
  
  console.log("测试用例结果对比：");
  console.log("分数\t\t描述\t\t修复前\t\t修复后\t\t状态");
  console.log("-".repeat(70));
  
  let allTestsPassed = true;
  
  testCases.forEach(testCase => {
    const oldProgress = system.getStageProgressOld(testCase.points);
    const newProgress = system.getStageProgress(testCase.points);
    const stage = system.getPetStage(testCase.points);
    
    // 判断测试是否通过：负分时应该显示0%，正分时应该正常显示
    let passed = true;
    let status = "✅";
    
    if (testCase.points < 0) {
      // 负分情况：修复前可能显示负数，修复后应该显示0%
      passed = newProgress === 0;
      status = passed ? "✅" : "❌";
    } else {
      // 正分情况：修复前后应该一致
      passed = Math.abs(oldProgress - newProgress) < 0.1;
      status = passed ? "✅" : "⚠️";
    }
    
    if (!passed) allTestsPassed = false;
    
    console.log(`${testCase.points}\t\t${testCase.description}\t\t${oldProgress.toFixed(2)}%\t\t${newProgress.toFixed(2)}%\t\t${status}`);
  });
  
  console.log("\n" + "=".repeat(70));
  console.log(`总体测试结果: ${allTestsPassed ? '✅ 所有测试通过' : '❌ 部分测试失败'}`);
  
  // 详细分析负分问题的修复效果
  console.log("\n=== 负分问题修复效果分析 ===");
  console.log("问题描述：负分时进度条计算为负数，导致浏览器显示为满格");
  console.log("修复措施：添加负分检查，当points < stage.minPoints时返回0%");
  console.log("修复效果：");
  
  const negativeTestPoints = [-100, -50, -10, -1];
  negativeTestPoints.forEach(points => {
    const oldProgress = system.getStageProgressOld(points);
    const newProgress = system.getStageProgress(points);
    const stage = system.getPetStage(points);
    
    console.log(`  分数 ${points}: 修复前=${oldProgress.toFixed(2)}% → 修复后=${newProgress.toFixed(2)}%`);
    console.log(`    当前等级: ${stage.name} (${stage.minPoints}-${stage.maxPoints === Infinity ? '∞' : stage.maxPoints})`);
    console.log(`    修复前问题: 进度条为负数(${oldProgress.toFixed(2)}%)，浏览器显示为满格`);
    console.log(`    修复后效果: 进度条为0%，正确显示空进度条`);
    console.log("");
  });
  
  return allTestsPassed;
}

// 执行测试
runTests();