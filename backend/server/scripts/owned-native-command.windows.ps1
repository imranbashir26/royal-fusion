param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required; uncontained compiler fallback is forbidden' }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OwnedNativeBridge {
 [StructLayout(LayoutKind.Sequential)] struct Limits { public long User,Job; public uint Flags; public UIntPtr Min,Max; public uint Active; public UIntPtr Affinity; public uint Priority,Schedule; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong A,B,C,D,E,F; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Limits Basic; public IO Counters; public UIntPtr A,B,C,D; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long A,B,C,D; public uint Faults,Total,Active,Terminated; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public uint Size; public string Reserved,Desktop,Title; public uint X,Y,Width,Height,CX,CY,Fill,Flags; public ushort Show,ReservedSize; public IntPtr ReservedPtr,In,Out,Err; }
 [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Info; public IntPtr Attributes; }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
 [StructLayout(LayoutKind.Sequential)] struct Security { public int Size; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref Extended value,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,ref Accounting value,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,IntPtr value,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool answer);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr ps,IntPtr ts,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx info,out ProcessInfo process);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint sharing,ref Security security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public sealed class Outcome {
  public string kind="spawn_error",error=null,cleanupError=null; public int? exitCode=null;
  public bool timedOut=false,cancelled=false,containmentVerified=false,cleanupComplete=false;
  public bool rootExitObserved=false,terminationRequested=false;
  public uint? activeProcessCountAtRootExit=null,activeProcessCountBeforeCleanup=null,finalActiveProcessCount=null;
  public int[] activePidsAtRootExit=new int[0],activePidsBeforeCleanup=new int[0];
  public double durationMs; public int[] observedPids=new int[0],remainingPids=new int[0];
 }
 static Exception Failure(string op) { return new Win32Exception(Marshal.GetLastWin32Error(),op); }
 static uint Active(IntPtr job) { var a=new Accounting(); if(!QueryInformationJobObject(job,1,ref a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero))throw Failure("Query owned job"); return a.Active; }
 static int[] Pids(IntPtr job) {
  for(int count=64;count<=65536;count*=2){int size=8+count*IntPtr.Size;IntPtr p=Marshal.AllocHGlobal(size);
   try{if(QueryInformationJobObject(job,3,p,(uint)size,IntPtr.Zero)){int n=Marshal.ReadInt32(p,4);var ids=new int[n];for(int i=0;i<n;i++)ids[i]=Marshal.ReadIntPtr(p,8+i*IntPtr.Size).ToInt32();return ids;}
    if(Marshal.GetLastWin32Error()!=234)throw Failure("Read owned job members");
   }finally{Marshal.FreeHGlobal(p);}
  }throw new Exception("Owned job member limit exceeded");
 }
 static string Quote(string value) {
  var b=new StringBuilder("\"");int slashes=0;
  foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}
  b.Append('\\',slashes*2);return b.Append('"').ToString();
 }
 static IntPtr Open(string file,uint access,ref Security security) {
  var h=CreateFile(file,access,3,ref security,2,128,IntPtr.Zero);if(h==new IntPtr(-1))throw Failure("Open owned command log");return h;
 }
 public static Outcome Run(string file,string[] args,string cwd,string stdout,string stderr,int timeout,int cleanup) {
  var result=new Outcome();IntPtr job=IntPtr.Zero,list=IntPtr.Zero,jobs=IntPtr.Zero,handles=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero,errors=IntPtr.Zero;
  var pi=new ProcessInfo();bool attributesReady=false,launched=false;var watch=new Stopwatch();string requested=null;var observed=new HashSet<int>();
  var reader=new Thread(()=>{try{string line=Console.ReadLine();Interlocked.CompareExchange(ref requested,line??"parent_closed",null);}catch{Interlocked.CompareExchange(ref requested,"parent_closed",null);}});reader.IsBackground=true;reader.Start();
  try {
   job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw Failure("Create private job");
   var limits=new Extended();limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway flags.
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))))throw Failure("Set owned job limits");
   IntPtr bytes=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref bytes);list=Marshal.AllocHGlobal(bytes);
   if(!InitializeProcThreadAttributeList(list,2,0,ref bytes))throw Failure("Initialize launch attributes");attributesReady=true;
   jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);
   // JOB_LIST attaches containment atomically at CreateProcess, not after start.
   if(!UpdateProcThreadAttribute(list,0,new IntPtr(0x2000D),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero))throw Failure("Assign job at process creation");
   var security=new Security{Size=Marshal.SizeOf(typeof(Security)),Inherit=true};
   input=CreateFile("NUL",0x80000000,3,ref security,3,128,IntPtr.Zero);if(input==new IntPtr(-1))throw Failure("Open null input");
   output=Open(stdout,0x40000000,ref security);errors=Open(stderr,0x40000000,ref security);
   handles=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handles,0,input);Marshal.WriteIntPtr(handles,IntPtr.Size,output);Marshal.WriteIntPtr(handles,IntPtr.Size*2,errors);
   if(!UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero))throw Failure("Restrict inherited handles");
   var si=new StartupEx();si.Info.Size=(uint)Marshal.SizeOf(typeof(StartupEx));si.Info.Flags=0x100;si.Info.In=input;si.Info.Out=output;si.Info.Err=errors;si.Attributes=list;
   var command=new StringBuilder(Quote(file));foreach(string arg in args)command.Append(' ').Append(Quote(arg));
   if(Volatile.Read(ref requested)!=null){result.kind="cancelled";result.cancelled=true;result.error="Cancelled before process creation";return result;}
   watch.Start();if(!CreateProcess(file,command,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,cwd,ref si,out pi))throw Failure("Create contained process");launched=true;
   bool contained;if(!IsProcessInJob(pi.Process,job,out contained)||!contained)throw Failure("Verify process job ownership");result.containmentVerified=true;observed.Add((int)pi.Pid);
   if(ResumeThread(pi.Thread)==0xffffffff)throw Failure("Resume contained process");
   Console.WriteLine("{\"event\":\"started\",\"pid\":"+pi.Pid+",\"containmentVerified\":true}");Console.Out.Flush();
   while(true){
    foreach(int pid in Pids(job))observed.Add(pid);
    string cancellation=Volatile.Read(ref requested);
    if(cancellation!=null){result.kind=cancellation;result.cancelled=cancellation=="cancelled"||cancellation=="parent_closed";result.timedOut=cancellation.Contains("timeout");result.error="Owned command "+cancellation;break;}
    uint code;if(WaitForSingleObject(pi.Process,0)==0){
     if(!GetExitCodeProcess(pi.Process,out code))throw Failure("Read process exit");result.exitCode=unchecked((int)code);
     if(!result.rootExitObserved){
      result.rootExitObserved=true;result.activePidsAtRootExit=Pids(job);result.activeProcessCountAtRootExit=Active(job);
      foreach(int pid in result.activePidsAtRootExit)observed.Add(pid);
      Console.WriteLine("{\"event\":\"root_exit\",\"exitCode\":"+result.exitCode+",\"activePids\":["+String.Join(",",result.activePidsAtRootExit)+"],\"activeProcessCount\":"+result.activeProcessCountAtRootExit+"}");Console.Out.Flush();
     }
     if(code!=0){result.kind="exit_nonzero";result.error="Owned command exited nonzero";break;}
     if(Active(job)==0){result.kind="success";break;}
    }
    if(watch.ElapsedMilliseconds>=timeout){result.kind="timeout";result.timedOut=true;result.error="Owned command timeout";break;}Thread.Sleep(10);
   }
  }catch(Exception e){result.error=e.Message;result.kind="spawn_error";}
  finally {
   result.durationMs=watch.Elapsed.TotalMilliseconds;
   try {
    if(job!=IntPtr.Zero){result.activePidsBeforeCleanup=Pids(job);foreach(int pid in result.activePidsBeforeCleanup)observed.Add(pid);
     uint active=Active(job);result.activeProcessCountBeforeCleanup=active;if(active>0){
      result.terminationRequested=true;
      if(result.kind=="success"){result.kind="forced_cleanup";result.error="Unfinished owned processes required forced cleanup";}
      if(!TerminateJobObject(job,1))throw Failure("Terminate owned job");
      var grace=Stopwatch.StartNew();while(Active(job)>0&&grace.ElapsedMilliseconds<cleanup)Thread.Sleep(10);
      result.finalActiveProcessCount=Active(job);result.cleanupComplete=cleanup>0&&result.finalActiveProcessCount==0;
      if(!result.cleanupComplete)result.cleanupError="Owned job cleanup verification deadline expired";
     }else{result.finalActiveProcessCount=0;result.cleanupComplete=true;}
    }else result.cleanupComplete=!launched;
   }catch(Exception e){result.cleanupComplete=false;result.cleanupError=e.Message;}
   var seen=new List<int>(observed);seen.Sort();result.observedPids=seen.ToArray();
   if(!result.cleanupComplete&&launched)try{result.remainingPids=Pids(job);}catch{result.cleanupError=(result.cleanupError??"")+"; remaining members could not be enumerated";}
   // No child inherits the job handle. Closing it is a final containment backstop.
   if(pi.Thread!=IntPtr.Zero)CloseHandle(pi.Thread);if(pi.Process!=IntPtr.Zero)CloseHandle(pi.Process);
   foreach(IntPtr h in new[]{input,output,errors})if(h!=IntPtr.Zero&&h!=new IntPtr(-1))CloseHandle(h);
   if(attributesReady)DeleteProcThreadAttributeList(list);foreach(IntPtr p in new[]{list,jobs,handles})if(p!=IntPtr.Zero)Marshal.FreeHGlobal(p);
   if(job!=IntPtr.Zero)CloseHandle(job);
  }
  return result;
 }
}
'@
$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
$result = [OwnedNativeBridge]::Run($request.file, [string[]]$request.args, $request.cwd, $request.stdoutPath, $request.stderrPath, $request.timeoutMs, $request.cleanupTimeoutMs)
@{event='result';result=$result} | ConvertTo-Json -Depth 6 -Compress
if ($result.kind -ne 'success' -or -not $result.cleanupComplete) { exit 1 }
