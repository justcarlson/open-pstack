#!/usr/bin/env bash
set -euo pipefail

actionlint_dir="$(mktemp -d)"
trap 'rm -rf "$actionlint_dir"' EXIT
archive=actionlint_1.7.12_linux_amd64.tar.gz
curl --fail --silent --show-error --location \
  "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$archive" \
  --output "$actionlint_dir/$archive"
printf '%s  %s\n' \
  8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 \
  "$actionlint_dir/$archive" | sha256sum --check
tar -xzf "$actionlint_dir/$archive" -C "$actionlint_dir" actionlint
"$actionlint_dir/actionlint" "$@"
