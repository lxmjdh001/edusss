# 读取原始文件
$filePath = 'd:\suncj\edusss\app\static\script.js'
$content = Get-Content -Path $filePath -Raw

# 找到第一个重复段的开始位置（大约在2800行）
$lines = $content -split "`r`n"
$firstDuplicateStart = 2799  # 0-based index for line 2800

# 找到第二个重复段的开始位置（大约在5600行）
$secondDuplicateStart = 5599  # 0-based index for line 5600

# 找到第一个重复段的结束位置（在第二个重复段开始之前）
$firstDuplicateEnd = $secondDuplicateStart - 1

# 创建新内容：保留第一段，删除第二段和第三段重复
$newContent = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($i -lt $firstDuplicateStart -or $i -gt $firstDuplicateEnd) {
        $newContent += $lines[$i]
    }
}

# 写入修复后的文件
$newContent -join "`r`n" | Out-File -FilePath $filePath -Encoding UTF8
Write-Host '文件修复完成，已删除重复代码段'