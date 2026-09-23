import { useMemo, useState, type ChangeEvent } from "react";
import { apiBaseUrl, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { parseCsvRows } from "./MasterDataCsvImport";

type TachoWorkerRow = {
  memberCode?: string;
  workerName?: string;
  department?: string;
  type?: string;
  employeeNumber?: string;
  agency?: string;
  email?: string;
  started?: string;
  cardLastRead?: string;
  driverCardNumber?: string;
  driverCardExpiry?: string;
  cardReadingState?: string;
  contract?: string;
  licencePassDate?: string;
  drivingLicenceExpiry?: string;
  licenceCheckDue?: string;
  licencePhotoExpiry?: string;
  cpcExpiry?: string;
  doubleDeckerTrainingDate?: string;
  atWorkNow?: string;
  dqcExpiry?: string;
};

type ImportResult = {
  received: number;
  linked: number;
  updated: number;
  review: number;
  skipped: number;
  results: Array<{
    status: string;
    workerName?: string;
    memberCode?: string;
    cardNumber?: string;
    confidence?: number;
    reason?: string;
    employeeNumber?: string;
    displayName?: string;
  }>;
};

type WorkbookResult = {
  rows?: Array<{ section: string; status: string; reason: string; key: string }>;
  warnings?: string[];
};

const accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

function norm(value:string){return value.trim().toLowerCase().replace(/[^a-z0-9]/g,"");}

const fieldMap:Record<string,keyof TachoWorkerRow>={
  membercode:"memberCode",
  workername:"workerName",
  department:"department",
  type:"type",
  employeenumber:"employeeNumber",
  agency:"agency",
  email:"email",
  started:"started",
  cardlastread:"cardLastRead",
  drivercardno:"driverCardNumber",
  drivercardnumber:"driverCardNumber",
  drivercardexp:"driverCardExpiry",
  drivercardexpiry:"driverCardExpiry",
  cardreadingstate:"cardReadingState",
  contract:"contract",
  licencepassdate:"licencePassDate",
  drivinglicenceexp:"drivingLicenceExpiry",
  drivinglicenceexpiry:"drivingLicenceExpiry",
  licencecheckdue:"licenceCheckDue",
  licencephotoexp:"licencePhotoExpiry",
  cpcexpiry:"cpcExpiry",
  doubledeckertrainingdate:"doubleDeckerTrainingDate",
  atworknow:"atWorkNow",
  dqcexpiry:"dqcExpiry",
};

export function parseTachoWorkerCsv(text:string):TachoWorkerRow[]{
  const rows=parseCsvRows(text);
  if(rows.length<2) throw new Error("The TachoMaster worker file needs a header row and at least one worker.");
  const mapped=rows[0].map(header=>fieldMap[norm(header)]);
  const recognised=mapped.filter(Boolean).length;
  if(!mapped.includes("memberCode") || !mapped.includes("workerName") || recognised<4)
    throw new Error("This does not look like a TachoMaster Worker List. Expected Member Code and Worker Name columns.");

  return rows.slice(1).map(cells=>{
    const row:TachoWorkerRow={};
    mapped.forEach((field,index)=>{
      if(!field) return;
      const value=(cells[index]||"").trim();
      if(value) row[field]=value;
    });
    return row;
  }).filter(row=>row.memberCode||row.workerName||row.driverCardNumber||row.employeeNumber);
}

async function postWorkbook(file:File, action:"preview"|"commit", accessToken?:string):Promise<WorkbookResult>{
  const form=new FormData();
  form.append("file",file,file.name);
  const response=await fetch(`${apiBaseUrl}/api/v1/master-data/workbook/${action}`,{
    method:"POST",
    headers:{Accept:"application/json",...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},
    body:form,
  });
  if(!response.ok) throw new Error(`Driver Master workbook ${action} failed (${response.status}).`);
  return await response.json() as WorkbookResult;
}

export function DriverMasterImport(){
  const token=useAccessToken();
  const [file,setFile]=useState<File>();
  const [rows,setRows]=useState<TachoWorkerRow[]>([]);
  const [message,setMessage]=useState<string>();
  const [error,setError]=useState<string>();
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<ImportResult>();
  const [workbookPreview,setWorkbookPreview]=useState<WorkbookResult>();

  const isWorkbook=Boolean(file && /\.xlsx?$|\.xls$/i.test(file.name));
  const withCards=useMemo(()=>rows.filter(row=>row.driverCardNumber).length,[rows]);

  async function choose(event:ChangeEvent<HTMLInputElement>){
    const chosen=event.target.files?.[0];
    setFile(chosen); setRows([]); setResult(undefined); setWorkbookPreview(undefined); setMessage(undefined); setError(undefined);
    if(!chosen) return;
    try{
      if(/\.csv$/i.test(chosen.name)){
        const parsed=parseTachoWorkerCsv(await chosen.text());
        setRows(parsed);
        setMessage(`${parsed.length} TachoMaster worker row(s) recognised · ${parsed.filter(row=>row.driverCardNumber).length} with driver cards.`);
      }else if(/\.xlsx?$|\.xls$/i.test(chosen.name)){
        setMessage("Excel Driver Master/TachoMaster file selected. Preview it before committing.");
      }else{
        setError("Choose a CSV, XLS or XLSX Driver Master file.");
      }
    }catch(e){setError(e instanceof Error?e.message:"The Driver Master file could not be read.");}
  }

  async function previewWorkbook(){
    if(!file||!isWorkbook) return;
    setBusy(true); setError(undefined);
    try{
      const preview=await postWorkbook(file,"preview",await token());
      setWorkbookPreview(preview);
      const driverRows=(preview.rows||[]).filter(row=>row.section==="Drivers");
      setMessage(`${driverRows.length} Driver row(s) checked. Unknown workers remain update-only and are not auto-created.`);
    }catch(e){setError(e instanceof Error?e.message:"Workbook preview failed.");}
    finally{setBusy(false);}
  }

  async function commit(){
    if(!file) return;
    setBusy(true); setError(undefined);
    try{
      if(isWorkbook){
        if(!workbookPreview) throw new Error("Preview the Excel file before committing.");
        const committed=await postWorkbook(file,"commit",await token());
        const driverRows=(committed.rows||[]).filter(row=>row.section==="Drivers");
        setMessage(`${driverRows.filter(row=>row.status==="updated").length} Driver row(s) updated · ${driverRows.filter(row=>row.status==="skipped"||row.status==="review").length} held/skipped.`);
      }else{
        if(!rows.length) throw new Error("No TachoMaster workers are ready to import.");
        const response=await request<ImportResult>("/api/v1/driver-master/tachomaster/import-workers",await token(),{
          method:"POST",
          body:JSON.stringify(rows),
        },60000);
        setResult(response);
        setMessage(`${response.linked} linked · ${response.updated} updated · ${response.review} review · ${response.skipped} skipped. Unknown workers were not created.`);
      }
    }catch(e){setError(e instanceof Error?e.message:"Driver Master import failed.");}
    finally{setBusy(false);}
  }

  return <section className="panel">
    <div className="title-row"><div>
      <p className="eyebrow">Driver Master import</p>
      <h2>Import TachoMaster workers / Driver Master</h2>
      <p className="hint">Use CSV, XLS or XLSX here. TachoMaster Member Code is matched first, then driver card, employee number and finally a unique name. Existing Driver Master rows are enriched; unmatched workers are held for review and are never auto-created.</p>
    </div></div>

    <div className="master-csv-controls">
      <label>Driver Master file<input type="file" accept={accept} onChange={event=>void choose(event)} /></label>
      {file&&<strong>{file.name}</strong>}
    </div>

    {rows.length>0&&<div className="metrics">
      <article className="metric"><span>Workers</span><strong>{rows.length}</strong><small>recognised rows</small></article>
      <article className="metric"><span>With cards</span><strong>{withCards}</strong><small>driver card numbers</small></article>
      <article className="metric"><span>No card</span><strong>{rows.length-withCards}</strong><small>kept as identity evidence</small></article>
    </div>}

    {message&&<p className="notice ready">{message}</p>}
    {error&&<p className="notice error">{error}</p>}

    <div className="actions">
      {isWorkbook&&<button type="button" onClick={()=>void previewWorkbook()} disabled={busy}>{busy?"Checking…":"Preview Excel"}</button>}
      <button type="button" className="primary" onClick={()=>void commit()} disabled={busy||!file||(isWorkbook&&!workbookPreview)||(!isWorkbook&&!rows.length)}>{busy?"Applying…":"Import to Driver Master"}</button>
    </div>

    {result&&<div className="metrics">
      <article className="metric"><span>Linked</span><strong>{result.linked}</strong><small>existing drivers</small></article>
      <article className="metric"><span>Updated</span><strong>{result.updated}</strong><small>enriched records</small></article>
      <article className="metric"><span>Review</span><strong>{result.review}</strong><small>no safe single match</small></article>
      <article className="metric"><span>Skipped</span><strong>{result.skipped}</strong><small>no usable identity</small></article>
    </div>}

    {result?.results.some(row=>row.status==="review")&&<div className="table-scroll" style={{marginTop:12}}>
      <table>
        <thead><tr><th>Worker</th><th>Member</th><th>Status</th><th>Reason</th></tr></thead>
        <tbody>{result.results.filter(row=>row.status==="review").slice(0,50).map((row,index)=><tr key={`${row.memberCode||row.workerName||"worker"}-${index}`}><td>{row.workerName||"—"}</td><td>{row.memberCode||"—"}</td><td>{row.status}</td><td>{row.reason||"Review required"}</td></tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
