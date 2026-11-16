#!/bin/bash
# Stub til `cargo check --target x86_64-pc-windows-msvc` på macOS uden LLVM installeret.
# GPUI's build.rs indlejrer et Windows-manifest via embed-resource → llvm-rc. Til check
# (ingen linkning) er indholdet ligegyldigt, så stubben skriver bare en tom .res-fil.
# Brug: mkdir -p /tmp/winstub && cp tools/llvm-rc-stub.sh /tmp/winstub/llvm-rc && PATH=/tmp/winstub:$PATH cargo check ...
for a in "$@"; do
  if [ "$a" = "/?" ]; then echo "OVERVIEW: Resource Converter (stub) no-preprocess"; exit 0; fi
done
out=""; prev=""
for a in "$@"; do
  if [ "$prev" = "/fo" ]; then out=$a; fi
  case "$a" in /fo?*) out=${a#/fo};; esac
  prev=$a
done
[ -n "$out" ] && : > "$out"
exit 0
