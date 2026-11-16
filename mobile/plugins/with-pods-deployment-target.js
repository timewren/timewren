// Hæver alle pods' IPHONEOS_DEPLOYMENT_TARGET til appens minimum.
// EAS' "latest"-image (Xcode 27, okt. 2026) afviser pods, der stadig erklærer
// 9.0–12.4 (fx SDWebImage, Sentry og RNSVG), og archive fejler med
// "range of supported deployment target versions is 15.0 to 27.1".
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const MARKER = '# with-pods-deployment-target';

function withPodsDeploymentTarget(config, { minimum = '15.1' } = {}) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(MARKER)) {
        const hook = 'post_install do |installer|';
        if (!contents.includes(hook))
          throw new Error('with-pods-deployment-target: fandt ikke post_install i Podfile');
        contents = contents.replace(
          hook,
          `${hook}
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        if build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${Number.parseFloat(minimum)}
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${minimum}'
        end
      end
    end`,
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
}

module.exports = withPodsDeploymentTarget;
