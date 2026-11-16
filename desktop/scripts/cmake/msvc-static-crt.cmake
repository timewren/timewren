# Toolchain-fil til llama-cpp-sys-2 på Windows (MSVC), sat via
# CMAKE_TOOLCHAIN_FILE_x86_64-pc-windows-msvc i .cargo/config.toml.
#
# cmake-rs' static_crt() sætter -MT i CMAKE_C(XX)_FLAGS, men med CMake 4
# (CMP0091 NEW) styres runtimen af CMAKE_MSVC_RUNTIME_LIBRARY, som ellers
# er /MD. Så blev llama.cpp bygget med /MD mod resten af exe'ens /MT, og
# linkningen fejlede med LNK2038 (RuntimeLibrary mismatch).
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
