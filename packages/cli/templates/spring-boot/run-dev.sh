#!/bin/sh
# Starts incremental Kotlin compilation alongside Spring Boot.
# DevTools detects new .class files and triggers a fast in-JVM restart.

set -e

echo "[dev] Starting incremental compiler (classes -t)..."
./gradlew classes -t --no-daemon -q &
COMPILER_PID=$!

echo "[dev] Starting Spring Boot (bootRun with DevTools)..."
./gradlew bootRun --no-daemon &
APP_PID=$!

# Forward SIGTERM to both child processes
trap 'kill $COMPILER_PID $APP_PID 2>/dev/null; exit 0' TERM INT

wait $APP_PID
