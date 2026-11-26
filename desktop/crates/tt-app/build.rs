//! Windows: indlejr brand-ikonet og versionsoplysninger i exe'en
//! (`bundle/windows/timetrack.rc` eller, med featuren `brand-timewren`,
//! `timewren.rc`). Ikonet bruges af Stifinder og af GPUI som vinduets ikon i
//! titellinjen. macOS med featuren `mas`: StoreKit 2-broen til in-app-købet
//! (`src/store/bridge.swift`). Andre platforme: intet.

fn main() {
    // Brandet vælges med cargo-featuren `brand-timewren` (se tt-core/src/edition.rs).
    let timewren = std::env::var_os("CARGO_FEATURE_BRAND_TIMEWREN").is_some();
    let (rc, ico) = if timewren {
        ("bundle/windows/timewren.rc", "bundle/windows/TimeWren.ico")
    } else {
        (
            "bundle/windows/timetrack.rc",
            "bundle/windows/TimeTrack.ico",
        )
    };
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={rc}");
    println!("cargo:rerun-if-changed={ico}");
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let v = |k: &str| std::env::var(k).expect("CARGO_PKG_VERSION_*");
        let macros = [
            format!("TT_MAJOR={}", v("CARGO_PKG_VERSION_MAJOR")),
            format!("TT_MINOR={}", v("CARGO_PKG_VERSION_MINOR")),
            format!("TT_PATCH={}", v("CARGO_PKG_VERSION_PATCH")),
        ];
        let params = embed_resource::ParamsMacrosAndIncludeDirs(&macros, ["bundle/windows"]);
        embed_resource::compile(rc, params)
            .manifest_optional()
            .expect("Windows-ressourcerne (ikon) kunne ikke indlejres");
    }
    // App Store-udgaven på macOS: StoreKit 2-broen (src/store/bridge.swift).
    if std::env::var_os("CARGO_FEATURE_MAS").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        swift_store_bridge();
    }
}

/// Oversæt `src/store/bridge.swift` til et statisk bibliotek og link det med
/// Swift-runtime fra systemet (`/usr/lib/swift`, macOS 13+) og StoreKit.
/// Kræver Xcode eller Command Line Tools (`xcrun swiftc`).
fn swift_store_bridge() {
    use std::process::Command;
    let src = "src/store/bridge.swift";
    println!("cargo:rerun-if-changed={src}");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("StoreKit-broen: ukendt arkitektur {other:?}"),
    };
    // StoreKit 2 kræver macOS 12; App Store-udgaven kræver 13.
    let min = std::env::var("MACOSX_DEPLOYMENT_TARGET")
        .ok()
        .filter(|v| {
            v.split('.')
                .next()
                .and_then(|m| m.parse::<u32>().ok())
                .is_some_and(|m| m >= 13)
        })
        .unwrap_or_else(|| "13.0".into());
    let target = format!("{arch}-apple-macosx{min}");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let run = |args: &[&str]| -> String {
        let o = Command::new("xcrun")
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("xcrun {args:?}: {e} (kræver Xcode eller Command Line Tools)"));
        if !o.status.success() {
            panic!("xcrun {args:?} fejlede:\n{}", String::from_utf8_lossy(&o.stderr));
        }
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    };
    let sdk = run(&["--sdk", "macosx", "--show-sdk-path"]);
    let lib = out.join("libttstore.a");
    run(&[
        "--sdk",
        "macosx",
        "swiftc",
        "-emit-library",
        "-static",
        "-parse-as-library",
        "-module-name",
        "TTStore",
        "-swift-version",
        "5",
        "-O",
        "-whole-module-optimization",
        "-target",
        &target,
        "-sdk",
        &sdk,
        src,
        "-o",
        lib.to_str().expect("OUT_DIR er UTF-8"),
    ]);
    // Swift-objekterne autolinker swiftCore, swift_Concurrency osv.; de skal
    // kunne findes i værktøjskædens og SDK'ets biblioteksmapper.
    let info: serde_json::Value = serde_json::from_str(&run(&[
        "--sdk",
        "macosx",
        "swiftc",
        "-print-target-info",
        "-target",
        &target,
    ]))
    .expect("swiftc -print-target-info gav ikke JSON");
    for key in ["runtimeLibraryPaths", "runtimeLibraryImportPaths"] {
        for p in info["paths"][key]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p.as_str())
        {
            println!("cargo:rustc-link-search=native={p}");
        }
    }
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=ttstore");
    println!("cargo:rustc-link-lib=framework=StoreKit");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
