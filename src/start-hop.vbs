Option Explicit
Dim side, scheduler, task
side = "dirty"
If WScript.Arguments.Count > 0 Then side = LCase(WScript.Arguments(0))
If side <> "dirty" And side <> "clean" Then WScript.Quit 2
On Error Resume Next
Set scheduler = CreateObject("Schedule.Service")
scheduler.Connect
Set task = scheduler.GetFolder("\").GetTask("HFPipe-" & side)
task.Run Null
If Err.Number <> 0 Then
  MsgBox "hf-pipe: scheduled task is unavailable. Install the signed package first.", 48, "hf-pipe"
  WScript.Quit 1
End If
WScript.Quit 0
