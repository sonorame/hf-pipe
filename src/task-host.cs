using System;
using System.IO;
using System.Reflection;
using System.Management.Automation;
using System.Management.Automation.Runspaces;

// Compiled as WinExe: Task Scheduler never starts a console application.
internal static class HfWindowlessHost
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string side = "dirty";
        string statusUrl = null, detailsUrl = null, trayStateFile = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--root" && i + 1 < args.Length) root = args[++i];
            else if (args[i] == "--side" && i + 1 < args.Length) side = args[++i];
            else if (args[i] == "--status-url" && i + 1 < args.Length) statusUrl = args[++i];
            else if (args[i] == "--details-url" && i + 1 < args.Length) detailsUrl = args[++i];
            else if (args[i] == "--tray-state-file" && i + 1 < args.Length) trayStateFile = args[++i];
            else return 2;
        }
        if (side != "clean" && side != "dirty") return 2;
        root = Path.GetFullPath(root);
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs e)
        {
            if (new AssemblyName(e.Name).Name != "System.Management.Automation") return null;
            return Assembly.LoadFrom(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell", "v1.0", "System.Management.Automation.dll"));
        };
        try { return Run(root, side, statusUrl, detailsUrl, trayStateFile); }
        catch (Exception e)
        {
            try { File.AppendAllText(Path.Combine(root, "task-host-errors.log"), DateTime.UtcNow.ToString("o") + " " + e + Environment.NewLine); }
            catch { }
            return 1;
        }
    }

    private static int Run(string root, string side, string statusUrl, string detailsUrl, string trayStateFile)
    {
        string script = Path.Combine(root, "task-host.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("Signed task host is missing", script);
        InitialSessionState initial = InitialSessionState.CreateDefault();
        initial.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;
        using (Runspace runspace = RunspaceFactory.CreateRunspace(initial))
        {
            runspace.ApartmentState = System.Threading.ApartmentState.STA;
            runspace.ThreadOptions = PSThreadOptions.UseCurrentThread;
            runspace.Open();
            using (PowerShell shell = PowerShell.Create())
            {
                shell.Runspace = runspace;
                shell.AddCommand(script).AddParameter("Side", side).AddParameter("Root", root);
                if (statusUrl != null) shell.AddParameter("StatusUrl", statusUrl);
                if (detailsUrl != null) shell.AddParameter("DetailsUrl", detailsUrl);
                if (trayStateFile != null) shell.AddParameter("TrayStateFile", trayStateFile);
                shell.Invoke();
                if (shell.HadErrors)
                {
                    foreach (ErrorRecord error in shell.Streams.Error)
                        File.AppendAllText(Path.Combine(root, "task-host-errors.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine);
                    return 1;
                }
            }
        }
        return 0;
    }
}
