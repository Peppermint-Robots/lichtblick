# Build recipes for the Peppermint Lichtblick fork.
# Run `just` to list recipes.

# List available recipes
default:
    @just --list

# Install dependencies
install:
    yarn install

# --- Web (the bundle packaged into the Peppermint host software) ---

# Production web build (output: web/.webpack)
web-build:
    yarn web:build:prod

# Development web build (output: web/.webpack)
web-build-dev:
    yarn web:build:dev

# Serve the web app with hot reload at http://localhost:8080
web-serve:
    yarn web:serve

# --- Desktop ---

# Production desktop build (webpack only, output: desktop/.webpack)
desktop-build:
    yarn desktop:build:prod

# Development desktop build
desktop-build-dev:
    yarn desktop:build:dev

# Desktop dev: run this in one terminal, then `just desktop-start` in another
desktop-serve:
    yarn desktop:serve

# Launch the Electron app against the dev server
desktop-start:
    yarn desktop:start

# Package the desktop app for Linux — all targets (deb + tar.gz, x64 + arm64)
desktop-package: desktop-build
    yarn package:linux

# Quick Debian package for x64 only (output: dist/lichtblick-<version>-linux-amd64.deb)
desktop-deb: desktop-build
    yarn package --linux deb --x64

# --- Quality ---

# Run unit tests; pass a path to narrow: `just test packages/suite-base/...`
test *ARGS:
    yarn test {{ARGS}}

lint:
    yarn lint
