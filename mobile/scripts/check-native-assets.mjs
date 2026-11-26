#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import process from 'node:process';

import { PNG } from 'pngjs';

/** @typedef {Pick<import('@expo/config').ExpoConfig, 'icon' | 'ios' | 'android' | 'plugins'>} AssetConfig */
/** @typedef {'timetrack' | 'timewren'} Brand */
/** @typedef {{ extends?: string, env?: Record<string, string> }} Profile */

/** @param {AssetConfig} config @param {string} name */
function pluginOptions(config, name) {
  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === name)
      return plugin[1];
  }
  return undefined;
}

/** @param {string} path @param {string} root @param {Brand} brand */
function belongsToBrand(path, root, brand) {
  const assets = join(root, 'assets');
  return dirname(path) === (brand === 'timewren' ? join(assets, 'timewren') : assets);
}

/** @param {Buffer} data */
function notificationIconProblem(data) {
  let hasBackground = false;
  let hasVisiblePixels = false;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) {
      hasBackground = true;
      continue;
    }

    hasVisiblePixels = true;
    if (data[index] !== 255 || data[index + 1] !== 255 || data[index + 2] !== 255)
      return 'synlige pixels skal være hvide';
  }

  if (!hasBackground)
    return 'mangler transparent baggrund';
  if (!hasVisiblePixels)
    return 'mangler synlige pixels';
  return undefined;
}

/** @param {AssetConfig} config @param {string} root @param {Brand} brand */
export function findProblems(config, root, brand) {
  /** @type {string[]} */
  const problems = [];

  /** @param {string} field @param {unknown} reference @param {number} size */
  function checkImage(field, reference, size) {
    const label = `${field} (${reference ?? 'manglende sti'})`;
    if (typeof reference !== 'string' || extname(reference) !== '.png') {
      problems.push(`${label}: forventede en lokal PNG-sti`);
      return;
    }

    try {
      const path = resolve(root, reference);
      if (!belongsToBrand(path, root, brand) || !belongsToBrand(realpathSync(path), realpathSync(root), brand)) {
        problems.push(`${label}: tilhører ikke ${brand}`);
        return;
      }

      const { width, height, data } = PNG.sync.read(readFileSync(path));
      if (width !== size || height !== size) {
        problems.push(`${label}: forventede ${size}×${size}, fik ${width}×${height}`);
      }
      else if (field.startsWith('ios.icon') && data.some((value, index) => index % 4 === 3 && value !== 255)) {
        problems.push(`${label}: indeholder gennemsigtige pixels`);
      }
      else if (field === 'expo-notifications.icon') {
        const problem = notificationIconProblem(data);
        if (problem)
          problems.push(`${label}: ${problem}`);
      }
    }
    catch (error) {
      problems.push(`${label}: ${error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'filen findes ikke' : 'kunne ikke læses som PNG'}`);
    }
  }

  const iosIcon = config.ios?.icon ?? config.icon;
  if (iosIcon && typeof iosIcon === 'object') {
    checkImage('ios.icon.light', iosIcon.light, 1024);
    for (const variant of /** @type {const} */ (['dark', 'tinted'])) {
      if (iosIcon[variant] !== undefined)
        checkImage(`ios.icon.${variant}`, iosIcon[variant], 1024);
    }
  }
  else {
    checkImage('ios.icon', iosIcon, 1024);
  }

  const adaptive = config.android?.adaptiveIcon;
  checkImage('android.adaptiveIcon.foregroundImage', adaptive?.foregroundImage, 1024);
  for (const layer of /** @type {const} */ (['backgroundImage', 'monochromeImage'])) {
    if (adaptive?.[layer] !== undefined)
      checkImage(`android.adaptiveIcon.${layer}`, adaptive[layer], 1024);
  }

  checkImage('expo-notifications.icon', pluginOptions(config, 'expo-notifications')?.icon, 96);

  const splashSize = brand === 'timewren' ? 512 : 600;
  const splash = pluginOptions(config, 'expo-splash-screen');
  if (splash?.image !== undefined || !(splash?.android?.image && splash?.ios?.image))
    checkImage('expo-splash-screen.image', splash?.image, splashSize);
  for (const scope of ['', 'android', 'ios']) {
    const options = scope ? splash?.[scope] : splash;
    const field = scope ? `expo-splash-screen.${scope}` : 'expo-splash-screen';
    if (scope && options?.image !== undefined)
      checkImage(`${field}.image`, options.image, splashSize);
    if (options?.dark?.image !== undefined)
      checkImage(`${field}.dark.image`, options.dark.image, splashSize);
  }
  return problems;
}

/** @param {Record<string, Profile>} profiles @param {string} name @returns {Record<string, string>} */
function profileEnv(profiles, name) {
  const profile = profiles[name];
  return {
    ...profile.extends && profileEnv(profiles, profile.extends),
    ...profile.env,
  };
}

// Expo's dynamic config evaluator retains plugin options before plugins replace
// source paths (e.g. app-icon-badge). Isolate each profile from TS module caching.
const resolveConfig = `
  const { getConfigFilePaths } = require('@expo/config');
  const { getDynamicConfig, getStaticConfig } = require('@expo/config/build/getConfig');
  const { join } = require('node:path');
  const projectRoot = process.cwd();
  const { dynamicConfigPath, staticConfigPath } = getConfigFilePaths(projectRoot);
  const base = staticConfigPath ? getStaticConfig(staticConfigPath) : {};
  console.log = console.error;
  const { config } = getDynamicConfig(dynamicConfigPath, {
    projectRoot, staticConfigPath, config: base.expo ?? base, packageJsonPath: join(projectRoot, 'package.json'),
  });
  process.stdout.write(JSON.stringify(config.expo ?? config));
`;

/** @param {string} root */
function main(root) {
  const { build: profiles } = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
  const problems = [];
  const brands = new Set();
  for (const name of Object.keys(profiles).filter(name => name !== 'base')) {
    const brand = name.startsWith('timewren-') ? 'timewren' : 'timetrack';
    const env = { ...process.env, APP_VARIANT: 'timetrack', ...profileEnv(profiles, name) };
    brands.add(brand);
    const output = execFileSync(process.execPath, ['--eval', resolveConfig], { cwd: root, env, encoding: 'utf8' });
    problems.push(...findProblems(JSON.parse(output), root, brand).map(problem => `${name}: ${problem}`));
  }

  if (brands.size !== 2)
    problems.push('eas.json: forventede profiler for både TimeTrack og TimeWren');
  if (problems.length) {
    console.error(`Native kildebilleder: ${problems.length} problem(er)\n${problems.join('\n')}`);
    process.exitCode = 1;
  }
  else {
    console.log('Native kildebilleder: ok (TimeTrack og TimeWren)');
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'check-native-assets.mjs')
  main(process.cwd());
