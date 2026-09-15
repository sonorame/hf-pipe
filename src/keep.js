var fso = new ActiveXObject("Scripting.FileSystemObject");
var sh = new ActiveXObject("WScript.Shell");
var dir = fso.GetParentFolderName(WScript.ScriptFullName);
sh.CurrentDirectory = dir;
var side = "dirty";
if (WScript.Arguments.length > 0) side = WScript.Arguments(0);
var nodeLocal = dir + "\\node.exe";
var pf = "C:\\Program Files\\nodejs\\node.exe";
var pack = sh.ExpandEnvironmentStrings("%USERPROFILE%") + "\\Desktop\\hf-matrix-pack\\node.exe";
var node = fso.FileExists(nodeLocal) ? nodeLocal : (fso.FileExists(pf) ? pf : pack);
var entry = dir + "\\index.mjs";
var alive = false;
try {
  var procs = GetObject("winmgmts:\\\\.\\root\\cimv2").ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'");
  var e = new Enumerator(procs);
  for (; !e.atEnd(); e.moveNext()) {
    var cmd = "";
    try { cmd = (e.item().CommandLine + "").toLowerCase(); } catch (e2) {}
    if (cmd.indexOf("keep.mjs") >= 0 || cmd.indexOf("keep.js") >= 0) continue;
    if (cmd.indexOf("index.mjs") >= 0 || cmd.indexOf("hf-matrix.mjs") >= 0) {
      alive = true;
      break;
    }
  }
} catch (err) {}
if (alive) WScript.Quit(0);
if (!fso.FileExists(node) || !fso.FileExists(entry)) WScript.Quit(1);
sh.Run('"' + node + '" "' + entry + '" ' + side, 0, false);
WScript.Quit(0);
