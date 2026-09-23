/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type ChangeEvent } from "react";
import { api, apiBaseUrl, type MasterApplyResponse, type RoadrunnerSiteReconcileResponse, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { decodeRoadrunnerSiteMasterBytes, parseRoadrunnerSiteMasterCsv } from "./roadrunnerCsv";

export type MasterEntity = "driver" | "vehicle" | "trailer" | "site";
type FlatPayload = Record<string, string | number | boolean>;
type UploadKind = "workbook" | "generic-csv" | "roadrunner-sites";

type ParsedMasterCsv = {
  requests: StageBatchRequest[];
  headers: string[];
  preview: FlatPayload[];
  warnings: string[];
};

type WorkbookSummaryCounts = {
  total: number; matched: number; imported: number; ready: number; review: number; skipped: number; newRows: number;
};
type WorkbookRowResult = {
  section: string; rowNumber: number; key: string; status: string; reason: string; confidence: number; actionTaken?: string; relatedRecords?: string[];
};
type WorkbookImportResult = {
  mode: string; rows: WorkbookRowResult[]; warnings: string[]; summary?: Record<string, WorkbookSummaryCounts>;
};
type UploadState = {
  file?: File;
  fileName: string;
  kind?: UploadKind;
  detectedEntity?: MasterEntity;
  csv?: ParsedMasterCsv;
  roadrunnerCount?: number;
  workbookPreview?: WorkbookImportResult;
  workbookCommit?: WorkbookImportResult;
  csvCommit?: MasterApplyResponse;
  roadrunnerCommit?: RoadrunnerSiteReconcileResponse;
};

const MASTER_IMPORT_CHUNK_SIZE = 25;
const MASTER_ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

const identityFields: Record<MasterEntity, string[]> = {
  driver: ["employeeNumber", "displayName"],
  vehicle: ["registration"],
  trailer: ["trailerNumber"],
  site: ["externalCode", "name"],
};

const aliases: Record<string, string> = {
  employeenumber:"employeeNumber", drivernumber:"employeeNumber", driverno:"employeeNumber", payrollnumber:"employeeNumber", payrollno:"employeeNumber",
  displayname:"displayName", drivername:"displayName", name:"name",
  drivinglicencenumber:"drivingLicenceNumber", licencenumber:"drivingLicenceNumber", licensenumber:"drivingLicenceNumber",
  licenceexpiry:"licenceExpiry", licenseexpiry:"licenceExpiry", cpcexpiry:"cpcExpiry", digitaltachocardexpiry:"digitalTachoCardExpiry", medicalexpiry:"medicalExpiry",
  tachoname:"tachoName", tachomasterdriverid:"tachoMasterDriverId", membercode:"tachoMasterDriverId", tachocardnumber:"tachoCardNumber",
  mobilenumber:"mobileNumber", mobile:"mobileNumber", email:"email", drivergroup:"driverGroup", drivertype:"driverType", skills:"skills", coding:"coding", agency:"agencyName",
  registration:"registration", reg:"registration", vin:"vin", ownertype:"ownerType", vehiclesite:"vehicleSite", fleetnumber:"fleetNumber", fleetno:"fleetNumber",
  abbreviation:"abbreviation", transmission:"transmission", dvs:"dvsCompliant", dvscompliant:"dvsCompliant", fuelprovider:"fuelProvider", cabmobile:"cabMobile",
  fuelpin:"fuelPin", shellcard:"shellCard", bpredcard:"bpRedCard", bpplaincard:"bpPlainCard", motexpiry:"motExpiry",
  tachocalibrationexpiry:"tachoCalibrationExpiry", vehicletestexpiry:"vehicleTestExpiry", fleetioid:"fleetioId", fleetioname:"fleetioName", fleetiostatus:"fleetioStatus", notes:"notes",
  trailernumber:"trailerNumber", trailerno:"trailerNumber", standardcapacity:"standardCapacity", eurocapacity:"euroCapacity", type:"type",
  externalcode:"externalCode", sitecode:"externalCode", sitename:"name", customercode:"customerCode", drivertextname:"driverTextName",
  collectionaddress:"collectionAddress", address:"collectionAddress", siteaddress:"collectionAddress", collectioninstructions:"collectionInstructions",
  maplink:"mapLink", latitude:"latitude", longitude:"longitude", aliases:"aliases", roadrunnercode:"roadrunnerCode", operationalregion:"operationalRegion",
  customfield1:"customField1", customfield2:"customField2", customfield3:"customField3",
  active:"active",
};

function key(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""); }
function fieldName(value: string) {
  const compact = key(value);
  return aliases[compact] || value.trim().replace(/^./, c => c.toLowerCase()).replace(/\s+(.)/g, (_, c: string) => c.toUpperCase());
}

export function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (!quoted && character === ",") { row.push(value.trim()); value = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normaliseDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}` : value;
}
function typedValue(field: string, raw: string): string | number | boolean {
  const text = raw.trim();
  if (["active","dvsCompliant","northEligible","preloadEligible"].includes(field))
    return !["false","no","0","inactive","n"].includes(text.toLowerCase());
  if (["standardCapacity","euroCapacity","latitude","longitude"].includes(field) && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (field.toLowerCase().includes("expiry") || field.toLowerCase().endsWith("date")) return normaliseDate(text);
  return text;
}

export function parseMasterDataCsv(text: string, entity: MasterEntity, fileName: string): ParsedMasterCsv {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const headers = rows[0].map(fieldName);
  const warnings: string[] = [], preview: FlatPayload[] = [], requests: StageBatchRequest[] = [];
  rows.slice(1).forEach((cells,index) => {
    const payload: FlatPayload = {};
    headers.forEach((header,column) => { const raw=cells[column]??""; if(raw!=="") payload[header]=typedValue(header,raw); });
    const identity=identityFields[entity].map(field=>payload[field]).find(value=>value!=null&&String(value).trim());
    if(!identity){ warnings.push(`Row ${index+2} was skipped because it has no ${identityFields[entity].join(" / ")} identity.`); return; }
    preview.push(payload);
    requests.push({
      entityType:entity,
      idempotencyKey:`master-import:${entity}:${String(identity).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g,"-")}`,
      source:`Master Data import · ${fileName}`,
      payload,
    });
  });
  if(!requests.length) throw new Error("No importable master-data rows were found in the CSV.");
  return {requests,headers,preview:preview.slice(0,6),warnings};
}

export function detectMasterEntity(headers: string[]): MasterEntity | undefined {
  const normal = new Set(headers.map(fieldName));
  if (normal.has("employeeNumber") || normal.has("drivingLicenceNumber") || normal.has("tachoName")) return "driver";
  if (normal.has("registration") || normal.has("vin") || normal.has("fleetNumber")) return "vehicle";
  if (normal.has("trailerNumber") || (normal.has("standardCapacity") && normal.has("euroCapacity"))) return "trailer";
  if (normal.has("externalCode") || normal.has("collectionAddress") || normal.has("driverTextName")) return "site";
  return undefined;
}

export async function applyMasterDataInChunks(
  records: StageBatchRequest[],
  applyBatch:(batch:StageBatchRequest[])=>Promise<MasterApplyResponse>,
  chunkSize=MASTER_IMPORT_CHUNK_SIZE,
  onProgress?:(completed:number,total:number)=>void,
):Promise<MasterApplyResponse>{
  if(!Number.isInteger(chunkSize)||chunkSize<1) throw new Error("Import chunk size must be at least 1.");
  const aggregate:MasterApplyResponse={received:0,applied:0,registered:0,failed:0,linked:0,results:[]};
  for(let offset=0;offset<records.length;offset+=chunkSize){
    const batch=records.slice(offset,offset+chunkSize), result=await applyBatch(batch);
    aggregate.received+=result.received; aggregate.applied+=result.applied; aggregate.registered=(aggregate.registered??0)+(result.registered??0);
    aggregate.failed+=result.failed; aggregate.linked=(aggregate.linked??0)+(result.linked??0); aggregate.results.push(...result.results);
    onProgress?.(Math.min(offset+batch.length,records.length),records.length);
  }
  return aggregate;
}

function isWorkbookFile(file:File){const n=file.name.toLowerCase();return n.endsWith(".xlsx")||n.endsWith(".xls");}
function isCsvFile(file:File){return file.name.toLowerCase().endsWith(".csv");}
function isRoadrunnerHeaders(headers:string[]){
  const h=new Set(headers.map(v=>key(v)));
  return ["code","company","addpostcode","addtown","latitude","longitude"].every(v=>h.has(v));
}
function sectionCount(result:WorkbookImportResult|undefined,section:string){return result?.rows?.filter(row=>row.section===section).length??0;}
function shortResultRows(result:WorkbookImportResult|undefined){
  return result?.rows?.filter(row=>["review","conflict","skipped","matched","updated","imported","ready","new"].includes(String(row.status).toLowerCase())).slice(0,40)??[];
}
function apiErrorMessage(payload:unknown,fallback:string){
  if(payload&&typeof payload==="object"){const r=payload as Record<string,unknown>; if(typeof r.detail==="string")return r.detail;if(typeof r.message==="string")return r.message;if(typeof r.error==="string")return r.error;}
  return fallback;
}
async function postWorkbook(file:File,action:"preview"|"commit",accessToken?:string):Promise<WorkbookImportResult>{
  const form=new FormData(); form.append("file",file,file.name);
  const response=await fetch(`${apiBaseUrl}/api/v1/master-data/workbook/${action}`,{method:"POST",headers:{Accept:"application/json",...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},body:form});
  if(!response.ok){const payload:unknown=await response.json().catch(()=>null);throw new Error(apiErrorMessage(payload,`Workbook import failed (${response.status}).`));}
  return await response.json() as WorkbookImportResult;
}

export function MasterDataCsvImport({ onCommitted }: { onCommitted?: () => void } = {}) {
  const token=useAccessToken();
  const [upload,setUpload]=useState<UploadState>({fileName:""});
  const [entityOverride,setEntityOverride]=useState<MasterEntity|"" >("");
  const [message,setMessage]=useState<string>();
  const [error,setError]=useState<string>();
  const [busy,setBusy]=useState(false);
  const latestWorkbook=upload.workbookCommit||upload.workbookPreview;
  const resultRows=useMemo(()=>shortResultRows(latestWorkbook),[latestWorkbook]);

  const summarySections=useMemo(()=>{
    if(!latestWorkbook)return[];
    const fromSummary=latestWorkbook.summary?Object.entries(latestWorkbook.summary).map(([section,counts])=>({section,...counts})):[];
    if(fromSummary.length)return fromSummary;
    return ["Sites","Site Cutoffs","Run Times","Vehicles & Fuel","Drivers","Customer Contacts","Market Contacts","Fuel Price History"]
      .map(section=>({section,total:sectionCount(latestWorkbook,section),matched:0,imported:0,ready:0,review:0,skipped:0,newRows:0})).filter(row=>row.total>0);
  },[latestWorkbook]);

  async function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]; setUpload({fileName:""}); setMessage(undefined); setError(undefined); setEntityOverride("");
    if(!file)return;
    if(!isWorkbookFile(file)&&!isCsvFile(file)){setError("Choose a CSV, XLS or XLSX master-data file.");return;}
    try{
      if(isWorkbookFile(file)){
        setUpload({file,fileName:file.name,kind:"workbook"});
        setMessage("Excel master-data file selected. Preview it before committing changes to the canonical master.");
        return;
      }
      const text=decodeRoadrunnerSiteMasterBytes(await file.arrayBuffer());
      const rows=parseCsvRows(text);
      const headers=rows[0]??[];
      if(isRoadrunnerHeaders(headers)){
        const profiles=parseRoadrunnerSiteMasterCsv(text);
        setUpload({file,fileName:file.name,kind:"roadrunner-sites",roadrunnerCount:profiles.length});
        setMessage(`Roadrunner Site Master detected: ${profiles.length} site rows ready to reconcile into canonical Site Master.`);
        return;
      }
      const detected=detectMasterEntity(headers);
      if(!detected){
        setUpload({file,fileName:file.name,kind:"generic-csv"});
        setError("The CSV structure is not clear enough to route safely. Choose its master-data type below, then reselect the file.");
        return;
      }
      const parsed=parseMasterDataCsv(text,detected,file.name);
      setUpload({file,fileName:file.name,kind:"generic-csv",detectedEntity:detected,csv:parsed});
      setEntityOverride(detected);
      setMessage(`${parsed.requests.length} ${detected} row(s) detected and ready to apply to Master Data.`);
    }catch(exception){setError(exception instanceof Error?exception.message:"The master-data file could not be read.");}
  }

  async function reparseCsv(entity:MasterEntity){
    if(!upload.file||!isCsvFile(upload.file))return;
    setEntityOverride(entity);setError(undefined);
    try{
      const text=decodeRoadrunnerSiteMasterBytes(await upload.file.arrayBuffer());
      const parsed=parseMasterDataCsv(text,entity,upload.file.name);
      setUpload(current=>({...current,kind:"generic-csv",detectedEntity:entity,csv:parsed}));
      setMessage(`${parsed.requests.length} ${entity} row(s) ready to apply.`);
    }catch(exception){setError(exception instanceof Error?exception.message:"The CSV could not be mapped.");}
  }

  async function preview(){
    if(!upload.file||upload.kind!=="workbook")return;
    setBusy(true);setError(undefined);setMessage("Reading workbook and checking live Master Data matches…");
    try{const result=await postWorkbook(upload.file,"preview",await token());setUpload(c=>({...c,workbookPreview:result,workbookCommit:undefined}));setMessage(`${result.rows?.length??0} rows checked. Review conflicts before committing.`);}
    catch(e){setError(e instanceof Error?e.message:"Preview failed.");}finally{setBusy(false);}
  }

  async function commit(){
    if(!upload.file||!upload.kind)return;
    setBusy(true);setError(undefined);
    try{
      if(upload.kind==="workbook"){
        if(!upload.workbookPreview)throw new Error("Preview the workbook before committing.");
        const result=await postWorkbook(upload.file,"commit",await token());
        setUpload(c=>({...c,workbookCommit:result}));
        const written=result.rows?.filter(row=>["imported","updated","matched"].includes(String(row.status).toLowerCase())).length??0;
        const review=result.rows?.filter(row=>["review","conflict","skipped"].includes(String(row.status).toLowerCase())).length??0;
        setMessage(`${written} rows written/matched · ${review} held or skipped for review.`);
      }else if(upload.kind==="roadrunner-sites"){
        const text=decodeRoadrunnerSiteMasterBytes(await upload.file.arrayBuffer());
        const result=await api.reconcileRoadrunnerSites(parseRoadrunnerSiteMasterCsv(text),await token());
        setUpload(c=>({...c,roadrunnerCommit:result}));
        setMessage(`${result.linked} Roadrunner sites linked/enriched · ${result.review} review · ${result.unmatched} unmatched. Existing populated Site Master values were preserved.`);
      }else{
        if(!upload.csv?.requests.length)throw new Error("Map the CSV to a master-data type first.");
        const accessToken=await token();
        const result=await applyMasterDataInChunks(upload.csv.requests,batch=>api.applyMasterData(batch,accessToken));
        setUpload(c=>({...c,csvCommit:result}));
        setMessage(`${result.applied} master rows applied${result.failed?` · ${result.failed} failed`:""}${result.linked?` · ${result.linked} linked`:""}.`);
      }
      onCommitted?.();
    }catch(e){setError(e instanceof Error?e.message:"Master Data commit failed.");}
    finally{setBusy(false);}
  }

  const rr=upload.roadrunnerCommit;
  return <section className="panel master-csv-import">
    <div className="title-row"><div>
      <p className="eyebrow">Canonical Master Data import</p>
      <h2>Import and enrich Master Data</h2>
      <p className="hint">One governed import point for CSV, XLS and XLSX. Files are routed to the correct master register. Roadrunner site files enrich missing address/postcode/GPS and retain the Roadrunner identity without creating duplicate sites. Existing populated master values are preserved unless the authoritative SLH workbook explicitly updates them.</p>
    </div></div>

    <div className="master-csv-controls">
      <label>Master data file<input type="file" accept={MASTER_ACCEPT} onChange={event=>void chooseFile(event)} /></label>
      {upload.fileName&&<strong>{upload.fileName}</strong>}
    </div>

    {upload.kind==="generic-csv"&&<div className="form-grid" style={{marginTop:10}}>
      <label>CSV master type<select value={entityOverride} onChange={e=>void reparseCsv(e.target.value as MasterEntity)}>
        <option value="">Choose type…</option><option value="site">Sites</option><option value="driver">Drivers</option><option value="vehicle">Vehicles</option><option value="trailer">Trailers</option>
      </select></label>
      <p className="hint">Detected: <strong>{upload.detectedEntity||"Needs selection"}</strong></p>
    </div>}

    {message&&<p className="notice ready">{message}</p>}
    {error&&<p className="notice">{error}</p>}
    {upload.csv?.warnings.length?<div className="notice"><strong>CSV warnings</strong><span>{upload.csv.warnings.slice(0,8).join(" · ")}</span></div>:null}

    <div className="actions">
      {upload.kind==="workbook"&&<button type="button" className="primary" disabled={busy} onClick={()=>void preview()}>{busy?"Checking…":"Preview Excel file"}</button>}
      <button type="button" className="primary" disabled={busy||!upload.file||(upload.kind==="workbook"&&!upload.workbookPreview)||(upload.kind==="generic-csv"&&!upload.csv?.requests.length)} onClick={()=>void commit()}>
        {busy?"Applying…":upload.kind==="roadrunner-sites"?"Reconcile into Site Master":"Commit to Master Data"}
      </button>
    </div>

    {rr&&<div className="metrics">
      <article className="metric"><span>Received</span><strong>{rr.received}</strong><small>Roadrunner sites</small></article>
      <article className="metric"><span>Linked / enriched</span><strong>{rr.linked}</strong><small>canonical sites</small></article>
      <article className="metric"><span>Review</span><strong>{rr.review}</strong><small>ambiguous</small></article>
      <article className="metric"><span>Unmatched</span><strong>{rr.unmatched}</strong><small>not auto-created</small></article>
    </div>}

    {rr?.results.some(row=>row.status!=="linked")&&<div className="master-csv-preview"><h3>Site reconciliation review</h3><table className="master-table"><thead><tr><th>Roadrunner</th><th>Company</th><th>Status</th><th>Confidence</th><th>Reason</th></tr></thead><tbody>
      {rr.results.filter(row=>row.status!=="linked").slice(0,50).map((row,index)=><tr key={`${row.code||"rr"}-${index}`}><td>{row.code||"—"}</td><td>{row.company||"—"}</td><td>{row.status}</td><td>{row.confidence}%</td><td>{row.reason}</td></tr>)}
    </tbody></table></div>}

    {latestWorkbook?.warnings?.length?<div className="notice inline-notice"><strong>Workbook warnings</strong><ul>{latestWorkbook.warnings.slice(0,10).map((warning,index)=><li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>:null}
    {summarySections.length?<div className="master-csv-preview"><h3>Import summary</h3><table className="master-table"><thead><tr><th>Section</th><th>Total</th><th>Matched</th><th>Imported</th><th>Ready</th><th>Review</th><th>Skipped</th><th>New</th></tr></thead><tbody>
      {summarySections.map(row=><tr key={row.section}><td>{row.section}</td><td>{row.total}</td><td>{row.matched}</td><td>{row.imported}</td><td>{row.ready}</td><td>{row.review}</td><td>{row.skipped}</td><td>{row.newRows}</td></tr>)}
    </tbody></table></div>:null}
    {resultRows.length?<div className="master-csv-preview"><h3>Review rows</h3><table className="master-table"><thead><tr><th>Section</th><th>Row</th><th>Key</th><th>Status</th><th>Confidence</th><th>Action</th><th>Reason</th></tr></thead><tbody>
      {resultRows.map((row,index)=><tr key={`${row.section}-${row.rowNumber}-${index}`}><td>{row.section}</td><td>{row.rowNumber}</td><td>{row.key}</td><td>{row.status}</td><td>{row.confidence}</td><td>{row.actionTaken??""}</td><td>{row.reason}</td></tr>)}
    </tbody></table></div>:null}
  </section>;
}
