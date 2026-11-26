!define YEJIAN_PROGID "Software\Classes\Yejian.md"
!define YEJIAN_APPLICATION "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!define YEJIAN_CAPABILITIES "Software\Yejian\Capabilities"

; 登记指定扩展名的候选应用，保留系统中已有的默认关联。
!macro registerMarkdownExtension EXT
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "Yejian.md"
  WriteRegStr SHELL_CONTEXT "${YEJIAN_APPLICATION}\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHELL_CONTEXT "${YEJIAN_CAPABILITIES}\FileAssociations" ".${EXT}" "Yejian.md"
!macroend

; 用户从默认应用或「打开方式」选择页间时，两个入口都能解析同一个图标。
!macro customInstall
  WriteRegStr SHELL_CONTEXT "${YEJIAN_PROGID}" "" "Markdown 文档"
  WriteRegStr SHELL_CONTEXT "${YEJIAN_PROGID}\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr SHELL_CONTEXT "${YEJIAN_PROGID}\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "${YEJIAN_APPLICATION}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${YEJIAN_APPLICATION}\DefaultIcon" "" '$\"$appExe$\",0'
  WriteRegStr SHELL_CONTEXT "${YEJIAN_APPLICATION}\shell\open\command" "" '$\"$appExe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "${YEJIAN_CAPABILITIES}" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${YEJIAN_CAPABILITIES}" "ApplicationDescription" "页间 Markdown 编辑器"
  WriteRegStr SHELL_CONTEXT "${YEJIAN_CAPABILITIES}" "ApplicationIcon" '$\"$appExe$\",0'
  !insertmacro registerMarkdownExtension "md"
  !insertmacro registerMarkdownExtension "markdown"
  !insertmacro registerMarkdownExtension "mdown"
  !insertmacro registerMarkdownExtension "mkd"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${YEJIAN_CAPABILITIES}"
  System::Call 'shell32::SHChangeNotify(i, i, p, p) v (0x08000000, 0, 0, 0)'
!macroend

; 升级会重新登记同一个关联，卸载只清理指向当前安装位置的页间条目。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 SHELL_CONTEXT "${YEJIAN_PROGID}\shell\open\command" ""
    ${if} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "Yejian.md"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown\OpenWithProgids" "Yejian.md"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.mdown\OpenWithProgids" "Yejian.md"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.mkd\OpenWithProgids" "Yejian.md"
      DeleteRegKey SHELL_CONTEXT "${YEJIAN_PROGID}"
      DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
      DeleteRegKey SHELL_CONTEXT "${YEJIAN_CAPABILITIES}"
      DeleteRegKey /ifempty SHELL_CONTEXT "Software\Yejian"
    ${endif}
    ReadRegStr $0 SHELL_CONTEXT "${YEJIAN_APPLICATION}\shell\open\command" ""
    ${if} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
      DeleteRegKey SHELL_CONTEXT "${YEJIAN_APPLICATION}"
    ${endif}
  ${endif}
!macroend
