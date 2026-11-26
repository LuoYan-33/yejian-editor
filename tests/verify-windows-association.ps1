param(
  [Parameter(Mandatory)][string]$Executable
)

$ErrorActionPreference = 'Stop'
$classes = 'HKCU:\Software\Classes'
$capabilities = 'HKCU:\Software\Yejian\Capabilities'
$icon = '"{0}",0' -f $Executable
$command = '"{0}" "%1"' -f $Executable

# 对照实际安装路径核对 Windows 解析图标和启动命令所需的登记值。
function Assert-RegistryValue($Path, $Name, $Expected) {
  $key = Get-Item -LiteralPath $Path
  if ($key.GetValue($Name) -cne $Expected) { throw "文件关联登记不匹配 $Path $Name" }
}

foreach ($entry in 'Yejian.md', 'Applications\Yejian.exe') {
  Assert-RegistryValue "$classes\$entry\DefaultIcon" '' $icon
  Assert-RegistryValue "$classes\$entry\shell\open\command" '' $command
}
Assert-RegistryValue 'HKCU:\Software\RegisteredApplications' '页间' 'Software\Yejian\Capabilities'
Assert-RegistryValue $capabilities 'ApplicationIcon' $icon
foreach ($extension in '.md', '.markdown', '.mdown', '.mkd') {
  $openWith = Get-Item -LiteralPath "$classes\$extension\OpenWithProgids"
  if ('Yejian.md' -notin $openWith.GetValueNames()) { throw "缺少打开方式 $extension" }
  Assert-RegistryValue "$capabilities\FileAssociations" $extension 'Yejian.md'
}
Write-Output '安装版已登记 Markdown 图标、打开命令和默认应用候选'
