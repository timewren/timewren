//! macOS + `local-llm`: link clangs runtime (`libclang_rt.osx.a`).
//!
//! llama.cpp's Metal-kode bruger `@available(macOS …)`. Når den bygges til en
//! ældre macOS end værtens (MACOSX_DEPLOYMENT_TARGET, se scripts/bundle-macos.sh),
//! bliver tjekket et kald til `__isPlatformVersionAtLeast` i compiler-rt. rustc
//! linker uden clangs standardbiblioteker, så det skal med her.

use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let macos = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    let local_llm = std::env::var_os("CARGO_FEATURE_LOCAL_LLM").is_some();
    if !(macos && local_llm) {
        return;
    }
    let out = Command::new("xcrun")
        .args(["clang", "--print-resource-dir"])
        .output()
        .expect("xcrun clang --print-resource-dir (Xcode Command Line Tools mangler?)");
    assert!(
        out.status.success(),
        "xcrun clang --print-resource-dir fejlede"
    );
    let dir = String::from_utf8(out.stdout).expect("ugyldig sti fra clang");
    let lib_dir = format!("{}/lib/darwin", dir.trim());
    assert!(
        std::path::Path::new(&lib_dir)
            .join("libclang_rt.osx.a")
            .exists(),
        "libclang_rt.osx.a findes ikke i {lib_dir}"
    );
    // Stien indeholder clangs version: kør igen, når Xcode opdateres og den forsvinder.
    println!("cargo:rerun-if-changed={lib_dir}/libclang_rt.osx.a");
    println!("cargo:rustc-link-search=native={lib_dir}");
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
