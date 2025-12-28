const fs = require('fs');

// 读取原始文件
const filePath = 'd:\\suncj\\edusss\\app\\static\\script.js';
const content = fs.readFileSync(filePath, 'utf8');

// 分割为行数组
const lines = content.split('\n');

// 找到重复代码段的位置
// 第一个重复段从第2800行开始
const firstDuplicateStart = 2799; // 0-based index

// 第二个重复段从第5600行开始
const secondDuplicateStart = 5599; // 0-based index

// 第一个重复段结束位置（第二个重复段开始前）
const firstDuplicateEnd = secondDuplicateStart - 1;

// 创建新内容，保留第一段，删除第二段和第三段重复
const newLines = [];
for (let i = 0; i < lines.length; i++) {
    if (i < firstDuplicateStart || i > firstDuplicateEnd) {
        newLines.push(lines[i]);
    }
}

// 写入修复后的文件
fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('文件修复完成，已删除重复代码段');