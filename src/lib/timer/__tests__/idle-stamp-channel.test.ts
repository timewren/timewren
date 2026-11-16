import { describe, expect, it } from "vitest";
import { mergeIdleStamp, parseIdleStampMessage } from "../idle-stamp-channel";

describe("parseIdleStampMessage", () => {
  it("godtager et stempel og en rydning", () => {
    expect(parseIdleStampMessage({ type: "idle_stamp", at: 1000 })).toEqual({
      type: "idle_stamp",
      at: 1000,
    });
    expect(parseIdleStampMessage({ type: "idle_stamp", at: null })).toEqual({
      type: "idle_stamp",
      at: null,
    });
  });

  it("ignorerer alt andet", () => {
    expect(parseIdleStampMessage(null)).toBeNull();
    expect(parseIdleStampMessage({ type: "data_changed" })).toBeNull();
    expect(parseIdleStampMessage({ type: "idle_stamp", at: "1" })).toBeNull();
    expect(parseIdleStampMessage({ type: "idle_stamp", at: -5 })).toBeNull();
  });
});

describe("mergeIdleStamp", () => {
  it("overtager en anden fanes stempel, når fanen selv intet har", () => {
    expect(mergeIdleStamp(null, 1000)).toBe(1000);
  });

  it("beholder det tidligste stempel (serverens første detektor vinder)", () => {
    expect(mergeIdleStamp(1000, 2000)).toBe(1000);
    expect(mergeIdleStamp(2000, 1000)).toBe(1000);
  });

  it("en rydning (brugeren er tilbage) rydder fanens stempel", () => {
    expect(mergeIdleStamp(1000, null)).toBeNull();
  });
});
