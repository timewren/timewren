#!/usr/bin/env node
// Tester scripts/release-manifest.mjs for begge udgaver:
//   - TimeTrack: filnavne og latest.json er præcis som før TimeWren kom til
//     (eksisterende installationer skal blive ved at opdatere sig),
//   - TimeWren: egne filnavne, og en udgivelse kan aldrig bygges af den andens filer.
//
//   node scripts/test-release-manifest.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/release-manifest.mjs");
const V = "9.8.7";
const BASE = "https://example.invalid/dl";

function names(prefix) {
  return [
    `${prefix}_${V}_x64-setup.exe`,
    `darwin-aarch64-${prefix}.app.tar.gz`,
    `darwin-x86_64-${prefix}.app.tar.gz`,
  ];
}

function release(prefix, { sig = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-manifest-"));
  for (const n of names(prefix)) {
    fs.writeFileSync(path.join(dir, n), "x");
    if (sig) fs.writeFileSync(path.join(dir, n + ".sig"), `sig-${n}\n`);
  }
  return dir;
}

// Kør uden for repoet (CHANGELOG.md læses fra arbejdsmappen), så noterne er standardnoterne.
function run(dir, ...args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tt-manifest-cwd-"));
  return spawnSync("node", [script, dir, V, BASE, "2026-01-02T03:04:05Z", ...args], { cwd, encoding: "utf8" });
}

// TimeTrack, uden --brand: som før.
{
  const dir = release("TimeTrack");
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
  assert.equal(m.version, V);
  assert.equal(m.notes, `TimeTrack ${V}`);
  assert.deepEqual(Object.keys(m.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
  assert.equal(m.platforms["windows-x86_64"].url, `${BASE}/TimeTrack_${V}_x64-setup.exe`);
  assert.equal(m.platforms["darwin-aarch64"].url, `${BASE}/darwin-aarch64-TimeTrack.app.tar.gz`);
  assert.equal(m.platforms["darwin-x86_64"].url, `${BASE}/darwin-x86_64-TimeTrack.app.tar.gz`);
  assert.equal(m.platforms["darwin-aarch64"].signature, "sig-darwin-aarch64-TimeTrack.app.tar.gz");
  // --brand=timetrack er det samme som ingen flag.
  const dir2 = release("TimeTrack");
  assert.equal(run(dir2, "--brand=timetrack").status, 0);
  assert.equal(
    fs.readFileSync(path.join(dir2, "latest.json"), "utf8"),
    fs.readFileSync(path.join(dir, "latest.json"), "utf8"),
  );
}

// TimeWren: egne filnavne.
{
  const dir = release("TimeWren");
  const r = run(dir, "--brand=timewren");
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
  assert.equal(m.notes, `TimeWren ${V}`);
  assert.equal(m.platforms["windows-x86_64"].url, `${BASE}/TimeWren_${V}_x64-setup.exe`);
  assert.equal(m.platforms["darwin-aarch64"].url, `${BASE}/darwin-aarch64-TimeWren.app.tar.gz`);
  assert.equal(m.platforms["darwin-x86_64"].url, `${BASE}/darwin-x86_64-TimeWren.app.tar.gz`);
  assert.ok(!JSON.stringify(m).includes("TimeTrack"), "TimeWrens manifest nævner TimeTrack");
}

// Aldrig den andens pakker.
{
  const dir = release("TimeWren");
  const r = run(dir); // TimeTrack-udgivelse af TimeWren-filer
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /platforme mangler/);
  assert.ok(!fs.existsSync(path.join(dir, "latest.json")));
  const dir2 = release("TimeTrack");
  const r2 = run(dir2, "--brand=timewren");
  assert.notEqual(r2.status, 0);
  assert.ok(!fs.existsSync(path.join(dir2, "latest.json")));
}

// Mangler en signatur, udgives intet.
{
  const dir = release("TimeWren", { sig: false });
  const r = run(dir, "--brand=timewren");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /mangler \.sig/);
}

// Ukendt brand.
{
  const dir = release("TimeWren");
  const r = run(dir, "--brand=andet");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Ukendt brand/);
}

console.log("release-manifest: ok (TimeTrack uændret, TimeWren adskilt)");
