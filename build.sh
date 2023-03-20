#!/bin/bash

type -p emcc
if [ $? -ne 0 ]; then
    echo "emcc not found"
    exit 1
fi

type -p ninja
if [ $? -ne 0 ]; then
    gen="Unix Makefiles" 
else
    gen=Ninja
fi

emcmake cmake --trace-expand -B build -G "$gen"
cmake --build build