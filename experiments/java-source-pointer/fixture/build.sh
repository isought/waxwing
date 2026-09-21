#!/bin/sh
set -eu
mkdir -p build/classes
javac -cp lib/vendor-rules.jar -d build/classes app/src/example/Quote.java
