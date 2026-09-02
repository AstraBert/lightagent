#!/bin/bash

rm -rf dist/
mkdir -p dist/

for target in x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-msvc x86_64-apple-darwin aarch64-apple-darwin
do
    deno compile -A --target "$target" -o dist/lightagent-cli-${target} --reload --no-lock --exclude-unused-npm src/main.ts
done
