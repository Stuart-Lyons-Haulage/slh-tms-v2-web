/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type ChangeEvent } from "react";
import { apiBaseUrl, type MasterApplyResponse, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";

export type MasterEntity = "driver" | "vehicle" | "trailer" | "site";
type FlatPayload = Record<string, string | number | boolean>;
type UploadKind = "workbook";

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
  mode: string;
  rows: WorkbookRowResult[];
  warnings: string[];
  summary?: Record<string, WorkbookSummaryCounts>;
  detectedSheets?: string[];
  detectedSections?: string[];
};
type UploadState = {
  file?: File;
  fileName: string;
  kind?: UploadKind;
  workbookPreview?: WorkbookImportResult;
  workbookCommit?: WorkbookImportResult;
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
function sectionCount(result:WorkbookImportResult|undefined,section:string){return result?.rows?.filter(row=>row.section===section).length??0;}
function shortResultRows(result:WorkbookImportResult|undefined){
  return result?.rows?.filter(row=>["review","conflict","weak","skipped","matched","updated","imported","ready","new"].includes(String(row.status).toLowerCase())).slice(0,40)??[];
}
function apiErrorMessage(payload:unknown,fallback:string){
  if(payload&&typeof payload==="object"){const r=payload as Record<string,unknown>; if(typeof r.detail==="string")return r.detail;if(typeof r.message==="string")return r.message;if(typeof r.error==="string")return r.error;}
  return fallback;
}
async function postWorkbook(file:File,action:"preview"|"commit",accessToken?:string):Promise<WorkbookImportResult>{
  const form=new FormData(); form.append("file",file,file.name);
  const response=await fetch(`${apiBaseUrl}/api/v2/master-data/workbook/${action}`,{method:"POST",headers:{Accept:"application/json",...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},body:form});
  if(!response.ok){const payload:unknown=await response.json().catch(()=>null);throw new Error(apiErrorMessage(payload,`Workbook import failed (${response.status}).`));}
  return await response.json() as WorkbookImportResult;
}

export function MasterDataCsvImport({ onCommitted }: { onCommitted?: () => void } = {}) {
  const token=useAccessToken();
  const [upload,setUpload]=useState<UploadState>({fileName:""});
  const [message,setMessage]=useState<string>();
  const [error,setError]=useState<string>();
  const [busy,setBusy]=useState(false);
  const latestWorkbook=upload.workbookCommit||upload.workbookPreview;
  const resultRows=useMemo(()=>shortResultRows(latestWorkbook),[latestWorkbook]);

  const summarySections=useMemo(()=>{
    if(!latestWorkbook)return[];
    const fromSummary=latestWorkbook.summary?Object.entries(latestWorkbook.summary).map(([section,counts])=>({section,...counts})):[];
    if(fromSummary.length)return fromSummary;
    return ["Sites","Site Cutoffs","Run Times","Vehicles & Fuel","Drivers","Customer Contacts","Market Contacts"]
      .map(section=>({section,total:sectionCount(latestWorkbook,section),matched:0,imported:0,ready:0,review:0,skipped:0,newRows:0})).filter(row=>row.total>0);
  },[latestWorkbook]);

  async function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    setUpload({fileName:""});
    setMessage(undefined);
    setError(undefined);

    if(!file)return;

    if(!isWorkbookFile(file)&&!isCsvFile(file)){
      setError("Choose a CSV, XLS or XLSX master-data file.");
      return;
    }

    setUpload({
      file,
      fileName:file.name,
      kind:"workbook"
    });

    setMessage(
      "Master-data file selected. Preview it to detect the sheets, columns and matching records before committing."
    );
  }

  async function preview(){
    if(!upload.file||upload.kind!=="workbook")return;
    setBusy(true);setError(undefined);setMessage("Reading workbook and checking live Master Data matches…");
    try{const result=await postWorkbook(upload.file,"preview",await token());setUpload(c=>({...c,workbookPreview:result,workbookCommit:undefined}));setMessage(`${result.rows?.length??0} rows checked. Review conflicts before committing.`);}
    catch(e){setError(e instanceof Error?e.message:"Preview failed.");}finally{setBusy(false);}
  }

  async function commit(){
    if(!upload.file)return;
    setBusy(true);
    setError(undefined);
    try{
      if(!upload.workbookPreview)throw new Error("Preview the file before committing.");

      const result=await postWorkbook(upload.file,"commit",await token());
      setUpload(current=>({...current,workbookCommit:result}));

      const written=result.rows?.filter(row=>
        ["imported","updated","matched"].includes(String(row.status).toLowerCase())
      ).length??0;

      const review=result.rows?.filter(row=>
        ["review","conflict","weak","skipped"].includes(String(row.status).toLowerCase())
      ).length??0;

      setMessage(`${written} rows written/matched · ${review} held or skipped for review.`);
      onCommitted?.();
    }catch(e){
      setError(e instanceof Error?e.message:"Master Data commit failed.");
    }finally{
      setBusy(false);
    }
  }

  return <section className="panel master-csv-import">
    <div className="title-row"><div>
      <p className="eyebrow">Canonical Master Data import</p>
      <h2>Master Import</h2>
      <p className="hint">Upload CSV or XLSX, preview automatic matches, then commit confident updates. Weak or conflicting site identities are held for normal Master Data review; canonical Site codes and existing good fields are preserved.</p>
    </div></div>

    <div className="master-csv-controls">
      <label>Master data file<input type="file" accept={MASTER_ACCEPT} onChange={event=>void chooseFile(event)} /></label>
      {upload.fileName&&<strong>{upload.fileName}</strong>}
    </div>

    {message&&<p className="notice ready">{message}</p>}
    {error&&<p className="notice">{error}</p>}

    <div className="actions">
      {upload.kind==="workbook"&&<button type="button" className="primary" disabled={busy} onClick={()=>void preview()}>{busy?"Checking…":"Preview file"}</button>}
      <button type="button" className="primary" disabled={busy||!upload.file||!upload.workbookPreview} onClick={()=>void commit()}>
        {busy?"Applying…":"Commit to Master Data"}
      </button>
    </div>

    {(latestWorkbook?.detectedSheets?.length||latestWorkbook?.detectedSections?.length)?<div className="master-csv-preview">
      <h3>Detected import content</h3>
      {latestWorkbook?.detectedSections?.length?<p className="hint"><strong>Sections:</strong> {latestWorkbook.detectedSections.join(" · ")}</p>:null}
      {latestWorkbook?.detectedSheets?.length?<p className="hint"><strong>Sheets:</strong> {latestWorkbook.detectedSheets.join(" · ")}</p>:null}
    </div>:null}

    {latestWorkbook?.warnings?.length?<div className="notice inline-notice"><strong>Workbook warnings</strong><ul>{latestWorkbook.warnings.slice(0,10).map((warning,index)=><li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>:null}
    {summarySections.length?<div className="master-csv-preview"><h3>Import summary</h3><table className="master-table"><thead><tr><th>Section</th><th>Total</th><th>Matched</th><th>Imported</th><th>Ready</th><th>Review</th><th>Skipped</th><th>New</th></tr></thead><tbody>
      {summarySections.map(row=><tr key={row.section}><td>{row.section}</td><td>{row.total}</td><td>{row.matched}</td><td>{row.imported}</td><td>{row.ready}</td><td>{row.review}</td><td>{row.skipped}</td><td>{row.newRows}</td></tr>)}
    </tbody></table></div>:null}
    {resultRows.length?<div className="master-csv-preview"><h3>Review rows</h3><table className="master-table"><thead><tr><th>Section</th><th>Row</th><th>Key</th><th>Status</th><th>Confidence</th><th>Action</th><th>Reason</th></tr></thead><tbody>
      {resultRows.map((row,index)=><tr key={`${row.section}-${row.rowNumber}-${index}`}><td>{row.section}</td><td>{row.rowNumber}</td><td>{row.key}</td><td>{row.status}</td><td>{row.confidence}</td><td>{row.actionTaken??""}</td><td>{row.reason}</td></tr>)}
    </tbody></table></div>:null}
  </section>;
}
