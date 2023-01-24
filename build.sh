#!/bin/bash

type -p emcc
if [ $? -ne 0 ]; then
    echo "emcc not found"
    exit 1
fi

emcmake cmake -B build -G Ninja
cmake --build build