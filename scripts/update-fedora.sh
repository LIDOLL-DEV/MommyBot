#!/usr/bin/env bash
# Fetch the checkout's configured upstream using the operator's Git credentials.
set -Eeuo pipefail

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
    echo 'Usage: bash scripts/update-fedora.sh (run as your normal Git user, without sudo)'
    exit 0
fi
[[ $# -eq 0 ]] || { echo 'This script takes no arguments.' >&2; exit 2; }
[[ $EUID -ne 0 ]] || { echo 'Run without sudo; the deployment step requests sudo itself.' >&2; exit 1; }
update() {
    local source_dir
    source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
    cd -- "$source_dir"
    [[ $(git rev-parse --show-toplevel) == "$source_dir" ]] || {
        echo 'This directory must be the MommyBot Git checkout root.' >&2; exit 1;
    }
    [[ -z $(git status --porcelain) ]] || {
        echo 'Commit or stash local changes (including untracked files) before updating.' >&2; exit 1;
    }
    git symbolic-ref --quiet HEAD >/dev/null || { echo 'Check out a branch before updating.' >&2; exit 1; }
    git rev-parse --abbrev-ref '@{upstream}' >/dev/null || {
        echo 'Configure an upstream branch before updating.' >&2; exit 1;
    }
    git pull --ff-only # Preserve the chosen branch and refuse merges or destructive resets.
    exec sudo bash "$source_dir/scripts/deploy-fedora.sh" --update
} # Load the update body before Git can replace this script on disk.

update
