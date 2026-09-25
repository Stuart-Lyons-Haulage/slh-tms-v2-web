import { describe, expect, it, vi } from "vitest";
import { applyMasterDataInChunks, detectMasterEntity, parseMasterDataCsv, parseCsvRows } from "./MasterDataCsvImport";
import type { MasterApplyResponse, StageBatchRequest } from "../lib/api";

describe("MasterDataCsvImport", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsvRows('Driver Number,Driver Name\nD01,"Smith, Alex"\n')).toEqual([["Driver Number", "Driver Name"], ["D01", "Smith, Alex"]]);
  });

  it("maps driver sanity-check headers and normalises licence expiry", () => {
    const parsed = parseMasterDataCsv("Driver Number,Driver Name,Licence Number,Licence Expiry\nD01,Alex Smith,SMITH123,31/12/2027\n", "driver", "drivers.csv");
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].payload).toMatchObject({ employeeNumber: "D01", displayName: "Alex Smith", drivingLicenceNumber: "SMITH123", licenceExpiry: "2027-12-31" });
  });

  it("detects common canonical master CSV structures", () => {
    expect(detectMasterEntity(["External Code", "Site Name", "Collection Address", "Roadrunner Code"])).toBe("site");
    expect(detectMasterEntity(["Registration", "Fleet Number", "MOT Expiry"])).toBe("vehicle");
    expect(detectMasterEntity(["Trailer Number", "Type", "Standard Capacity"])).toBe("trailer");
    expect(detectMasterEntity(["Driver Number", "Driver Name", "Tacho Name"])).toBe("driver");
  });

  it("maps site enrichment fields without losing canonical identity", () => {
    const parsed = parseMasterDataCsv(
      "External Code,Site Name,Collection Address,Roadrunner Code,Latitude,Longitude\nSITE012,Aldi Goldthorpe,Commercial Road Goldthorpe S63 9BL,ALDIGOLD,53.534,-1.302\n",
      "site",
      "sites.csv",
    );
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].payload).toMatchObject({
      externalCode: "SITE012",
      name: "Aldi Goldthorpe",
      collectionAddress: "Commercial Road Goldthorpe S63 9BL",
      roadrunnerCode: "ALDIGOLD",
      latitude: 53.534,
      longitude: -1.302,
    });
  });

  it("maps vehicle fuel and compliance enrichment fields", () => {
    const parsed = parseMasterDataCsv(
      "Registration,Fleet Number,Fuel Provider,MOT Expiry,Tacho Calibration Expiry\nAB12 CDE,12,Shell,31/12/2026,01/02/2027\n",
      "vehicle",
      "vehicles.csv",
    );
    expect(parsed.requests[0].payload).toMatchObject({
      registration: "AB12 CDE",
      fleetNumber: "12",
      fuelProvider: "Shell",
      motExpiry: "2026-12-31",
      tachoCalibrationExpiry: "2027-02-01",
    });
  });

  it("routes the current TachoMaster Worker List through the governed Admin import parser", () => {
    const csv = [
      "Member Code,Worker Name,Department,Type,Employee Number,Agency,Email,Started,Card Last Read,Driver Card No.,Driver Card Exp.,Card Reading State,Contract,Licence Pass Date,Driving Licence Exp.,Licence Check Due,Licence Photo Exp.,CPC Expiry,Double Decker Training Date,At Work Now,DQC Expiry",
      '762763,"Sultanov, Daniel Ivaylov",Stuart Lyons,agency,,A1 RECRUITMENT,,13-04-2016,26-07-2026 18:14,DB15104162091502,14-04-2030,include,,,,,,,,0,',
    ].join("\n");

    expect(detectMasterEntity(parseCsvRows(csv)[0])).toBe("driver");
    const parsed = parseMasterDataCsv(csv, "driver", "TachoMaster Worker List.csv");
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].payload).toMatchObject({
      tachoMasterDriverId: "762763",
      displayName: "Sultanov, Daniel Ivaylov",
      driverType: "agency",
      agencyName: "A1 RECRUITMENT",
      tachoCardNumber: "DB15104162091502",
      digitalTachoCardExpiry: "14-04-2030",
    });
  });

  it("applies large imports in bounded chunks and aggregates the result", async () => {
    const records: StageBatchRequest[] = Array.from({ length: 125 }, (_, index) => ({
      entityType: "driver",
      idempotencyKey: `driver-${index}`,
      payload: { employeeNumber: `D${index}`, displayName: `Driver ${index}` },
    }));
    const applyBatch = vi.fn(async (batch: StageBatchRequest[]): Promise<MasterApplyResponse> => ({
      received: batch.length,
      applied: batch.length,
      failed: 0,
      results: batch.map((record) => ({ entityType: record.entityType, idempotencyKey: record.idempotencyKey, applied: true })),
    }));

    const result = await applyMasterDataInChunks(records, applyBatch, 50);

    expect(applyBatch).toHaveBeenCalledTimes(3);
    expect(applyBatch.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 25]);
    expect(result.received).toBe(125);
    expect(result.applied).toBe(125);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(125);
  });
});
