var fso = new ActiveXObject("Scripting.FileSystemObject");
var sh = new ActiveXObject("WScript.Shell");
var dir = fso.GetParentFolderName(WScript.ScriptFullName);
var root = fso.GetParentFolderName(dir);
sh.CurrentDirectory = root;
var side = "dirty";
if (WScript.Arguments.length > 0) side = WScript.Arguments(0);
function findNode() {
  var local = dir + "\\node.exe";
  if (fso.FileExists(local)) return local;
  var pf = "C:\\Program Files\\nodejs\\node.exe";
  if (fso.FileExists(pf)) return pf;
  try {
    var out = sh.Exec("where node");
    var line = out.StdOut.ReadLine();
    if (line) return line;
  } catch (e) {}
  return "node";
}
var node = findNode();
var entry = dir + "\\index.mjs";
var alive = false;
try {
  var procs = GetObject("winmgmts:\\\\.\\root\\cimv2").ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'");
  var e = new Enumerator(procs);
  for (; !e.atEnd(); e.moveNext()) {
    var cmd = "";
    try { cmd = (e.item().CommandLine + "").toLowerCase(); } catch (e2) {}
    if (cmd.indexOf("keep.mjs") >= 0 || cmd.indexOf("keep.js") >= 0) continue;
    if (cmd.indexOf("index.mjs") >= 0 || cmd.indexOf("hf-matrix.mjs") >= 0 || cmd.indexOf("run.mjs") >= 0) {
      alive = true;
      break;
    }
  }
} catch (err) {}
var sweep = dir + "\\temp-sweep.mjs";
if (fso.FileExists(sweep)) {
  sh.Run('"' + node + '" "' + sweep + '"', 0, false);
}
if (alive) WScript.Quit(0);
if (!fso.FileExists(entry)) WScript.Quit(1);
sh.Run('"' + node + '" "' + entry + '" ' + side, 0, false);
WScript.Quit(0);
