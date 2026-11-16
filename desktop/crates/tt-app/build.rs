//! Windows: indlejr brand-ikonet og versionsoplysninger i timetrack.exe
//! (`bundle/windows/timetrack.rc`). Ikonet bruges af Stifinder og af GPUI som
//! vinduets ikon i titellinjen. Andre platforme: intet.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=bundle/windows/timetrack.rc");
    println!("cargo:rerun-if-changed=bundle/windows/TimeTrack.ico");
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let v = |k: &str| std::env::var(k).expect("CARGO_PKG_VERSION_*");
        let macros = [
            format!("TT_MAJOR={}", v("CARGO_PKG_VERSION_MAJOR")),
            format!("TT_MINOR={}", v("CARGO_PKG_VERSION_MINOR")),
            format!("TT_PATCH={}", v("CARGO_PKG_VERSION_PATCH")),
        ];
        let params = embed_resource::ParamsMacrosAndIncludeDirs(&macros, ["bundle/windows"]);
        embed_resource::compile("bundle/windows/timetrack.rc", params)
            .manifest_optional()
            .expect("Windows-ressourcerne (ikon) kunne ikke indlejres");
    }
}
