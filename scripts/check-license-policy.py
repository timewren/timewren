#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Check metadata against the checked-in policy; never chooses a license."""
import json
from pathlib import Path
import sys


def check(root):
    policy = json.loads((root / "license-policy.json").read_text())
    if policy["schemaVersion"] != 1 or not policy["packages"]:
        raise ValueError("Invalid license policy")
    for package in policy["packages"]:
        folder = (root / package["path"]).resolve()
        if not folder.is_relative_to(root.resolve()):
            raise ValueError("Package path escapes source root")
        manifest = json.loads((folder / "package.json").read_text())
        if manifest.get("license") != package["license"]:
            raise ValueError(f"License metadata mismatch: {package['path']}")
        if "private" in package and manifest.get("private") is not package["private"]:
            raise ValueError(f"Private flag mismatch: {package['path']}")
        if package["marker"] not in (folder / package["licenseFile"]).read_text():
            raise ValueError(f"License text mismatch: {package['path']}")
    print("License policy: passed")


if __name__ == "__main__":
    try:
        check(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
