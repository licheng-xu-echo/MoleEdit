' =============================================================================
' MolEdit Launcher  (launch.vbs)
' Opens index.html in an installed Chrome/Edge (no console window).
' Fallback: system file association.
' Usage:
'   wscript.exe launch.vbs            -> launch the app
'   wscript.exe launch.vbs /check     -> print resolved paths only (for testing)
' =============================================================================
Option Explicit

Dim fso, sh, base, htmlPath, fileUrl, checkOnly
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
htmlPath = fso.BuildPath(base, "index.html")
fileUrl = "file:///" & Replace(htmlPath, "\", "/")

checkOnly = False
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/check" Or LCase(WScript.Arguments(0)) = "--check" Then
    checkOnly = True
  End If
End If

If Not fso.FileExists(htmlPath) Then
  MsgBox "Cannot find index.html:" & vbCrLf & htmlPath, vbCritical, "MolEdit"
  WScript.Quit 2
End If

' Candidate browsers, in priority order.
Dim candidates(5)
candidates(0) = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
candidates(1) = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"
candidates(2) = sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe"
candidates(3) = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
candidates(4) = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
candidates(5) = sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Microsoft\Edge\Application\msedge.exe"

Dim browser, i
browser = ""
For i = 0 To UBound(candidates)
  If fso.FileExists(candidates(i)) Then
    browser = candidates(i)
    Exit For
  End If
Next

If checkOnly Then
  WScript.Echo "index.html : " & htmlPath
  WScript.Echo "file URL   : " & fileUrl
  If browser = "" Then
    WScript.Echo "browser    : (not found; will use system default association)"
  Else
    WScript.Echo "browser    : " & browser
  End If
  WScript.Quit 0
End If

If browser <> "" Then
  sh.Run """" & browser & """ --new-window """ & fileUrl & """", 1, False
Else
  sh.Run """" & htmlPath & """", 1, False
End If
