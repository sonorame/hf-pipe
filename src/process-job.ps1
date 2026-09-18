if (-not ("HfProcessJob" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class HfProcessJob {
  [StructLayout(LayoutKind.Sequential)]
  private struct BasicLimits {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct IoCounters {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ExtendedLimits {
    public BasicLimits BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetInformationJobObject(
    IntPtr job,
    int informationClass,
    IntPtr information,
    uint informationLength
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  public static IntPtr CreateKillOnClose() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    ExtendedLimits limits = new ExtendedLimits();
    limits.BasicLimitInformation.LimitFlags = 0x00002000;
    int size = Marshal.SizeOf(typeof(ExtendedLimits));
    IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      Marshal.StructureToPtr(limits, buffer, false);
      if (!SetInformationJobObject(job, 9, buffer, (uint)size)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
    return job;
  }

  public static void Assign(IntPtr job, IntPtr process) {
    if (!AssignProcessToJobObject(job, process)) {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
"@
}

function New-HfKillOnCloseJob {
  return [HfProcessJob]::CreateKillOnClose()
}

function Add-HfProcessToJob {
  param(
    [IntPtr]$Job,
    [System.Diagnostics.Process]$Process
  )
  [HfProcessJob]::Assign($Job, $Process.Handle)
}
